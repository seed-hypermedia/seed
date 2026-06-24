import {assign, createActor, fromPromise, setup} from 'xstate'

export const CLEANUP_MACHINE_STORAGE_KEY = 'DocumentCardCleanupMachineSnapshot-v001'
export const CLEANUP_STORAGE_KEY = 'DocumentCardCleanupState-v001'
export const RETRY_DELAYS_MS = [1_000, 5_000, 15_000]

export type CleanupCoordinatorState = 'idle' | 'running' | 'retryWaiting'

export type DocumentCardCleanupOperation = 'remove' | 'add' | 'rewrite'

export type DocumentCardCleanupJobState =
  | 'idle'
  | 'loadingParent'
  | 'updating'
  | 'publishing'
  | 'verifying'
  | 'done'
  | 'skippedTerminal'
  | 'retryScheduled'
  | 'failedNeedsAttention'

export type DocumentCardCleanupJob = {
  id: string
  operation?: DocumentCardCleanupOperation
  deletedDocumentId?: string
  sourceDocumentId?: string
  targetDocumentId?: string
  parentDocumentId: string
  signingAccountUid: string
  capabilityId?: string
  isDraft?: boolean
  parentDraftId?: string
  state: DocumentCardCleanupJobState
  attempts: number
  maxRetries: number
  nextRunAt?: number
  lastError?: string
  updatedAt: number
  createdAt: number
}

export type DocumentCardCleanupStore = {
  coordinatorState: CleanupCoordinatorState
  jobs: DocumentCardCleanupJob[]
}

type CleanupParent = {uid: string; path: string[]; id: string}
type CleanupDraft = {id: string; [key: string]: unknown}
type CleanupDocument = {version?: string; [key: string]: unknown}

type CleanupJobPlan = {
  changes: unknown[]
  removedBlockIds: string[]
}

type CleanupJobEffects = {
  now: () => number
  loadParentDraft: (job: DocumentCardCleanupJob) => Promise<CleanupDraft | null>
  loadParentDocument: (job: DocumentCardCleanupJob) => Promise<CleanupDocument | null>
  cleanupParentDraft: (job: DocumentCardCleanupJob, draft: CleanupDraft) => Promise<string[]>
  planPublishedParent: (job: DocumentCardCleanupJob, parentDocument: CleanupDocument) => CleanupJobPlan
  publishParentUpdate: (
    job: DocumentCardCleanupJob,
    parentDocument: CleanupDocument,
    changes: unknown[],
  ) => Promise<'published' | 'missing-parent'>
  invalidateParent: (parentDocumentId: string) => void
  onJobProgress?: (job: DocumentCardCleanupJob) => void
}

export type CleanupCoordinatorEffects = CleanupJobEffects & {
  getParentDocumentId: (deletedDocumentId: string) => CleanupParent | null
  scheduleCleanup: (delayMs: number | null) => void
}

type JobContext = {
  job: DocumentCardCleanupJob
  now: number
  parentDraft: CleanupDraft | null
  parentDocument: CleanupDocument | null
  publishedPlan: CleanupJobPlan | null
  removedBlockIds: string[]
}

type CoordinatorContext = {
  jobs: DocumentCardCleanupJob[]
  activeJobId: string | null
  lastNow: number
}

function defaultEffects(): CleanupCoordinatorEffects {
  const fail = async () => {
    throw new Error('Document card cleanup machine effects were not provided')
  }
  return {
    now: () => Date.now(),
    getParentDocumentId: () => null,
    scheduleCleanup: () => {},
    loadParentDraft: fail,
    loadParentDocument: fail,
    cleanupParentDraft: fail as CleanupJobEffects['cleanupParentDraft'],
    planPublishedParent: () => ({changes: [], removedBlockIds: []}),
    publishParentUpdate: fail as CleanupJobEffects['publishParentUpdate'],
    invalidateParent: () => {},
  }
}

export function emptyDocumentCardCleanupStore(): DocumentCardCleanupStore {
  return {coordinatorState: 'idle', jobs: []}
}

export function normalizeDocumentCardCleanupStore(raw: DocumentCardCleanupStore | undefined): DocumentCardCleanupStore {
  if (!raw || !Array.isArray(raw.jobs)) return emptyDocumentCardCleanupStore()
  return {
    coordinatorState: raw.coordinatorState || 'idle',
    jobs: raw.jobs.map((job) => ({...job, maxRetries: job.maxRetries ?? 3})),
  }
}

export function cleanupJobId(input: {
  operation?: DocumentCardCleanupOperation
  deletedDocumentId?: string
  sourceDocumentId?: string
  targetDocumentId?: string
  parentDocumentId: string
  signingAccountUid: string
}) {
  const operation = input.operation || 'remove'
  if (operation === 'remove' && input.deletedDocumentId && !input.sourceDocumentId && !input.targetDocumentId) {
    return `${input.deletedDocumentId}|${input.parentDocumentId}|${input.signingAccountUid}`
  }
  return [
    operation,
    input.sourceDocumentId || input.deletedDocumentId || '',
    input.targetDocumentId || '',
    input.parentDocumentId,
    input.signingAccountUid,
  ].join('|')
}

export function getRetryDelayMs(attempts: number) {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_MS.length - 1)]
}

export function isJobDue(job: DocumentCardCleanupJob, now: number) {
  if (job.state === 'idle') return !job.nextRunAt || job.nextRunAt <= now
  if (job.state === 'retryScheduled') return !!job.nextRunAt && job.nextRunAt <= now
  return false
}

function findNextDueJob(jobs: DocumentCardCleanupJob[], now: number) {
  const retryingJobs = jobs.filter((job) => job.state === 'retryScheduled')
  if (retryingJobs.length) return retryingJobs.find((job) => isJobDue(job, now)) || null
  return jobs.find((job) => isJobDue(job, now)) || null
}

export function nextDocumentCardCleanupDelayMs(jobs: DocumentCardCleanupJob[], now = Date.now()) {
  const retryingJobs = jobs.filter((job) => job.state === 'retryScheduled')
  const runnableJobs = retryingJobs.length ? retryingJobs : jobs
  const dueNow = runnableJobs.some((job) => isJobDue(job, now))
  if (dueNow) return 0
  const nextRetry = jobs
    .filter((job) => job.state === 'retryScheduled' && job.nextRunAt)
    .map((job) => job.nextRunAt as number)
    .sort((a, b) => a - b)[0]
  if (!nextRetry) return null
  return Math.max(nextRetry - now, 0)
}

function replaceJob(jobs: DocumentCardCleanupJob[], nextJob: DocumentCardCleanupJob) {
  return jobs.map((job) => (job.id === nextJob.id ? nextJob : job))
}

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function updateJob(job: DocumentCardCleanupJob, patch: Partial<DocumentCardCleanupJob>, now: number) {
  return {...job, ...patch, updatedAt: now}
}

function toRetryJob(job: DocumentCardCleanupJob, error: unknown, now: number) {
  const attempts = job.attempts + 1
  const message = toErrorMessage(error)
  if (attempts <= job.maxRetries) {
    return updateJob(
      job,
      {
        state: 'retryScheduled',
        attempts,
        nextRunAt: now + getRetryDelayMs(attempts),
        lastError: message,
      },
      now,
    )
  }
  return updateJob(
    job,
    {
      state: 'failedNeedsAttention',
      attempts,
      nextRunAt: undefined,
      lastError: message,
    },
    now,
  )
}

export function createDocumentCardCleanupJobMachine(effects: CleanupJobEffects) {
  return setup({
    types: {} as {
      context: JobContext
      events: any
      input: {job: DocumentCardCleanupJob; now: number}
      output: DocumentCardCleanupJob
    },
    actors: {
      loadParentDraft: fromPromise<CleanupDraft | null, {job: DocumentCardCleanupJob}>(async ({input}) => {
        return effects.loadParentDraft(input.job)
      }),
      loadParentDocument: fromPromise<CleanupDocument | null, {job: DocumentCardCleanupJob}>(async ({input}) => {
        return effects.loadParentDocument(input.job)
      }),
      cleanupParentDraft: fromPromise<string[], {job: DocumentCardCleanupJob; draft: CleanupDraft}>(async ({input}) => {
        return effects.cleanupParentDraft(input.job, input.draft)
      }),
      publishParentUpdate: fromPromise<
        'published' | 'missing-parent',
        {job: DocumentCardCleanupJob; parentDocument: CleanupDocument; changes: unknown[]}
      >(async ({input}) => {
        return effects.publishParentUpdate(input.job, input.parentDocument, input.changes)
      }),
    },
    guards: {
      hasDraft: ({event}) => event.type === 'xstate.done.actor.loadParentDraft' && !!event.output,
      hasParentDocument: ({event}) => event.type === 'xstate.done.actor.loadParentDocument' && !!event.output,
      removedDraftBlocks: ({event}) => event.type === 'xstate.done.actor.cleanupParentDraft' && event.output.length > 0,
      hasPublishedChanges: ({context}) => !!context.publishedPlan?.changes.length,
      publishedParentMissing: ({event}) =>
        event.type === 'xstate.done.actor.publishParentUpdate' && event.output === 'missing-parent',
    },
    actions: {
      setJobState: assign(({context}, params: {state: DocumentCardCleanupJobState}) => ({
        job: updateJob(context.job, {state: params.state}, context.now),
      })),
      clearLastError: assign(({context}) => ({
        job: updateJob(context.job, {lastError: undefined, nextRunAt: undefined}, context.now),
      })),
      assignParentDraft: assign(({context, event}) => {
        if (event.type !== 'xstate.done.actor.loadParentDraft') return {}
        const draft = event.output
        return {
          parentDraft: draft,
          job: updateJob(
            context.job,
            {isDraft: !!draft, parentDraftId: draft?.id, state: draft ? 'updating' : 'loadingParent'},
            context.now,
          ),
        }
      }),
      assignNoDraftTarget: assign(({context}) => ({
        job: updateJob(context.job, {isDraft: false, parentDraftId: undefined, state: 'loadingParent'}, context.now),
      })),
      assignParentDocument: assign(({event}) => {
        if (event.type !== 'xstate.done.actor.loadParentDocument') return {}
        return {parentDocument: event.output}
      }),
      assignPublishedPlan: assign(({context}) => {
        if (!context.parentDocument) return {}
        return {publishedPlan: effects.planPublishedParent(context.job, context.parentDocument)}
      }),
      assignDraftCleanupResult: assign(({context, event}) => {
        if (event.type !== 'xstate.done.actor.cleanupParentDraft') return {}
        return {
          removedBlockIds: event.output,
          job: updateJob(context.job, {state: event.output.length ? 'verifying' : 'skippedTerminal'}, context.now),
        }
      }),
      markPublishing: assign(({context}) => ({
        job: updateJob(context.job, {state: 'publishing'}, context.now),
      })),
      markVerifying: assign(({context}) => ({
        job: updateJob(context.job, {state: 'verifying'}, context.now),
      })),
      markDone: assign(({context}) => ({
        job: updateJob(context.job, {state: 'done', lastError: undefined, nextRunAt: undefined}, context.now),
      })),
      markSkipped: assign(({context}) => ({
        job: updateJob(
          context.job,
          {state: 'skippedTerminal', lastError: undefined, nextRunAt: undefined},
          context.now,
        ),
      })),
      markFailure: assign(({context, event}) => ({
        job: toRetryJob(
          context.job,
          event.type.startsWith('xstate.error.actor.') ? event.error : 'cleanup failed',
          context.now,
        ),
      })),
      invalidateParent: ({context}) => effects.invalidateParent(context.job.parentDocumentId),
      notifyProgress: ({context}) => effects.onJobProgress?.(context.job),
    },
  }).createMachine({
    id: 'documentCardCleanupJob',
    context: ({input}) => ({
      job: input.job,
      now: input.now,
      parentDraft: null,
      parentDocument: null,
      publishedPlan: null,
      removedBlockIds: [],
    }),
    initial: 'loadingParentDraft',
    output: ({context}) => context.job,
    states: {
      loadingParentDraft: {
        entry: [
          {type: 'setJobState', params: {state: 'loadingParent'}},
          {type: 'clearLastError'},
          {type: 'notifyProgress'},
        ],
        invoke: {
          id: 'loadParentDraft',
          src: 'loadParentDraft',
          input: ({context}) => ({job: context.job}),
          onDone: [
            {
              guard: 'hasDraft',
              target: 'updatingDraft',
              actions: ['assignParentDraft', 'notifyProgress'],
            },
            {
              target: 'loadingPublishedParent',
              actions: ['assignNoDraftTarget', 'notifyProgress'],
            },
          ],
          onError: {target: 'failed', actions: ['markFailure', 'notifyProgress']},
        },
      },
      loadingPublishedParent: {
        entry: [{type: 'setJobState', params: {state: 'loadingParent'}}, 'notifyProgress'],
        invoke: {
          id: 'loadParentDocument',
          src: 'loadParentDocument',
          input: ({context}) => ({job: context.job}),
          onDone: [
            {
              guard: 'hasParentDocument',
              target: 'planningPublishedParent',
              actions: ['assignParentDocument'],
            },
            {target: 'skipped', actions: ['markSkipped', 'notifyProgress']},
          ],
          onError: {target: 'failed', actions: ['markFailure', 'notifyProgress']},
        },
      },
      updatingDraft: {
        entry: [{type: 'setJobState', params: {state: 'updating'}}, 'notifyProgress'],
        invoke: {
          id: 'cleanupParentDraft',
          src: 'cleanupParentDraft',
          input: ({context}) => ({job: context.job, draft: context.parentDraft as CleanupDraft}),
          onDone: [
            {
              guard: 'removedDraftBlocks',
              target: 'verifying',
              actions: ['assignDraftCleanupResult', 'notifyProgress'],
            },
            {target: 'skipped', actions: ['assignDraftCleanupResult', 'notifyProgress']},
          ],
          onError: {target: 'failed', actions: ['markFailure', 'notifyProgress']},
        },
      },
      planningPublishedParent: {
        entry: [{type: 'setJobState', params: {state: 'updating'}}, 'assignPublishedPlan', 'notifyProgress'],
        always: [
          {guard: 'hasPublishedChanges', target: 'publishing'},
          {target: 'skipped', actions: ['markSkipped', 'notifyProgress']},
        ],
      },
      publishing: {
        entry: ['markPublishing', 'notifyProgress'],
        invoke: {
          id: 'publishParentUpdate',
          src: 'publishParentUpdate',
          input: ({context}) => ({
            job: context.job,
            parentDocument: context.parentDocument as CleanupDocument,
            changes: context.publishedPlan?.changes || [],
          }),
          onDone: [
            {guard: 'publishedParentMissing', target: 'skipped', actions: ['markSkipped', 'notifyProgress']},
            {target: 'verifying'},
          ],
          onError: {target: 'failed', actions: ['markFailure', 'notifyProgress']},
        },
      },
      verifying: {
        entry: ['markVerifying', 'invalidateParent', 'notifyProgress'],
        always: {target: 'done', actions: ['markDone', 'notifyProgress']},
      },
      done: {type: 'final'},
      skipped: {type: 'final'},
      failed: {type: 'final'},
    },
  })
}

export async function runCleanupJobWithMachine(
  effects: CleanupJobEffects,
  job: DocumentCardCleanupJob,
  now: number,
): Promise<DocumentCardCleanupJob> {
  return await new Promise<DocumentCardCleanupJob>((resolve, reject) => {
    const actor = createActor(createDocumentCardCleanupJobMachine(effects), {input: {job, now}})
    const sub = actor.subscribe({
      next: (snapshot) => {
        if (snapshot.status === 'done') {
          sub.unsubscribe()
          resolve(snapshot.output)
        }
        if (snapshot.status === 'error') {
          sub.unsubscribe()
          reject(snapshot.error)
        }
      },
      error: (error) => {
        sub.unsubscribe()
        reject(error)
      },
    })
    actor.start()
  })
}

export function createDocumentCardCleanupCoordinatorMachine(effects: CleanupCoordinatorEffects) {
  const jobMachineEffects: CleanupJobEffects = effects
  return setup({
    types: {} as {
      context: CoordinatorContext
      events: any
      input: {jobs?: DocumentCardCleanupJob[]; now?: number}
    },
    actors: {
      runCleanupJob: fromPromise<DocumentCardCleanupJob, {job: DocumentCardCleanupJob; now: number}>(
        async ({input}) => {
          return runCleanupJobWithMachine(jobMachineEffects, input.job, input.now)
        },
      ),
    },
    guards: {
      hasDueJob: ({context, event}) => {
        const now = event.type === 'cleanup.tick' && event.now ? event.now : context.lastNow
        return !!findNextDueJob(context.jobs, now)
      },
      hasRetryJob: ({context}) => context.jobs.some((job) => job.state === 'retryScheduled'),
    },
    actions: {
      addJob: assign(({context, event}) => {
        if (event.type !== 'cleanup.enqueue') return {}
        const operation = event.operation || 'remove'
        const parent = event.parentDocumentId
          ? {id: event.parentDocumentId}
          : effects.getParentDocumentId(event.deletedDocumentId)
        if (!parent) return {}
        const jobId = cleanupJobId({
          operation,
          deletedDocumentId: event.deletedDocumentId,
          sourceDocumentId: event.sourceDocumentId,
          targetDocumentId: event.targetDocumentId,
          parentDocumentId: parent.id,
          signingAccountUid: event.signingAccountUid,
        })
        if (context.jobs.some((job) => job.id === jobId)) return {}
        const now = effects.now()
        const job: DocumentCardCleanupJob = {
          id: jobId,
          operation,
          deletedDocumentId: event.deletedDocumentId || event.sourceDocumentId || event.targetDocumentId,
          sourceDocumentId: event.sourceDocumentId,
          targetDocumentId: event.targetDocumentId,
          parentDocumentId: parent.id,
          signingAccountUid: event.signingAccountUid,
          capabilityId: event.capabilityId,
          state: 'idle',
          attempts: 0,
          maxRetries: 3,
          createdAt: now,
          updatedAt: now,
        }
        return {jobs: [...context.jobs, job], lastNow: now}
      }),
      setTickNow: assign(({context, event}) => ({
        lastNow: event.type === 'cleanup.tick' && event.now ? event.now : context.lastNow,
      })),
      selectDueJob: assign(({context}) => {
        const job = findNextDueJob(context.jobs, context.lastNow)
        if (!job) return {activeJobId: null}
        return {
          activeJobId: job.id,
          jobs: replaceJob(
            context.jobs,
            updateJob(job, {state: 'loadingParent', lastError: undefined}, context.lastNow),
          ),
        }
      }),
      applyJobResult: assign(({context, event}) => {
        if (event.type !== 'xstate.done.actor.runCleanupJob') return {}
        return {jobs: replaceJob(context.jobs, event.output), activeJobId: null}
      }),
      scheduleNext: ({context}) =>
        effects.scheduleCleanup(nextDocumentCardCleanupDelayMs(context.jobs, context.lastNow)),
    },
  }).createMachine({
    id: 'documentCardCleanupCoordinator',
    context: ({input}) => ({
      jobs: input.jobs || [],
      activeJobId: null,
      lastNow: input.now || effects.now(),
    }),
    initial: 'idle',
    on: {
      'cleanup.enqueue': {actions: ['addJob', 'scheduleNext']},
    },
    states: {
      idle: {
        entry: 'scheduleNext',
        on: {
          'cleanup.tick': [
            {guard: 'hasDueJob', target: 'running', actions: ['setTickNow', 'selectDueJob']},
            {guard: 'hasRetryJob', target: 'waitingForRetry', actions: ['setTickNow']},
            {actions: ['setTickNow', 'scheduleNext']},
          ],
        },
      },
      waitingForRetry: {
        entry: 'scheduleNext',
        on: {
          'cleanup.tick': [
            {guard: 'hasDueJob', target: 'running', actions: ['setTickNow', 'selectDueJob']},
            {guard: 'hasRetryJob', actions: ['setTickNow', 'scheduleNext']},
            {target: 'idle', actions: 'setTickNow'},
          ],
        },
      },
      running: {
        invoke: {
          id: 'runCleanupJob',
          src: 'runCleanupJob',
          input: ({context}) => ({
            job: context.jobs.find((job) => job.id === context.activeJobId) as DocumentCardCleanupJob,
            now: context.lastNow,
          }),
          onDone: {target: 'idle', actions: 'applyJobResult'},
        },
        on: {
          'cleanup.tick': {},
        },
      },
    },
  })
}

export const documentCardCleanupJobMachine = createDocumentCardCleanupJobMachine(defaultEffects())
export const documentCardCleanupCoordinatorMachine = createDocumentCardCleanupCoordinatorMachine(defaultEffects())

export function getPublicDocumentCardCleanupSnapshot(snapshot: {
  value: unknown
  context: CoordinatorContext
}): DocumentCardCleanupStore {
  const coordinatorState: CleanupCoordinatorState =
    snapshot.value === 'running' ? 'running' : snapshot.value === 'waitingForRetry' ? 'retryWaiting' : 'idle'
  return {coordinatorState, jobs: snapshot.context.jobs}
}
