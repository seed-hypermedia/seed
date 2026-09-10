import {hmId, unpackHmId} from '../utils/entity-id-url'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {nanoid} from 'nanoid'
import {assign, createActor, fromPromise, setup, toPromise} from 'xstate'

/** Legacy snapshot key, read only when migrating an installation without a durable job store. */
export const CLEANUP_MACHINE_STORAGE_KEY = 'DocumentCardCleanupMachineSnapshot-v001'
/** Storage key for durable reconciliation jobs. */
export const CLEANUP_STORAGE_KEY = 'DocumentCardCleanupState-v001'
/** Backoff after each of the three automatic retries. */
export const RETRY_DELAYS_MS = [1_000, 5_000, 15_000]

/** Public coordinator execution state. */
export type CleanupCoordinatorState = 'idle' | 'running' | 'retryWaiting'

/** Supported parent-reference mutations. */
export type DocumentCardCleanupOperation = 'remove' | 'add' | 'rewrite' | 'delete-child'

/** Job progress, including the one-attempt failure consumed by the coordinator. */
export type DocumentCardCleanupJobState =
  | 'idle'
  | 'awaitingPrimary'
  | 'loadingParent'
  | 'updating'
  | 'publishing'
  | 'verifying'
  | 'done'
  | 'skippedTerminal'
  | 'retryScheduled'
  | 'failedNeedsAttention'
  | 'dismissed'
  | 'failed'

/** Durable intent and retry progress for a parent-reference operation. */
export type DocumentCardCleanupJob = {
  id: string
  operation?: DocumentCardCleanupOperation
  /** A held intent is released only after the primary action succeeds, or exact recovery proof. */
  awaitingPrimary?: {
    documentId: string
    expectedVersion?: string
    expectedGenesis?: string
    expectedType: 'document' | 'redirect' | 'tombstone'
    targetDocumentId?: string
  }
  primaryConfirmed?: boolean
  source?: UnpackedHypermediaId
  target?: UnpackedHypermediaId
  /** Only populated for reference jobs in a document other than the hierarchical parent. */
  container?: UnpackedHypermediaId
  signingAccountUid: string
  capabilityId?: string
  /** Temporary child draft identity, used to preserve its card placement. */
  cardBlockId?: string
  cardParentId?: string
  cardLeftSibling?: string
  targetBlockId?: string
  childDraftId?: string
  /** Verified publication checkpoint; retries reconcile drafts without republishing. */
  publishedVersion?: string
  /** Explicitly approved destructive scope, captured at confirmation. */
  approvedSubtree?: Array<{id: string; version: string}>
  authorizingParentVersion?: string
  isDraft?: boolean
  parentDraftId?: string
  state: DocumentCardCleanupJobState
  attempts: number
  maxRetries: number
  nextRunAt?: number
  lastError?: string
  /** When this job was moved out of the active queue into history. */
  dismissedAt?: number
  updatedAt: number
  createdAt: number
}

/** Persisted queue and its public coordinator state. */
export type DocumentCardCleanupStore = {
  schemaVersion?: 2
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
  verifyPrimaryOutcome?: (job: DocumentCardCleanupJob) => Promise<void>
  findTemporaryCard?: (
    job: DocumentCardCleanupJob,
  ) => Promise<string | {blockId: string; parentId?: string; leftSibling?: string} | undefined>
  reconcileParentDraft?: (job: DocumentCardCleanupJob, parentDocument: CleanupDocument) => Promise<void>
  executeConfirmedDeletion?: (job: DocumentCardCleanupJob) => Promise<void>
  planPublishedParent: (
    job: DocumentCardCleanupJob,
    parentDocument: CleanupDocument,
  ) => CleanupJobPlan | Promise<CleanupJobPlan>
  publishParentUpdate: (
    job: DocumentCardCleanupJob,
    parentDocument: CleanupDocument,
    changes: unknown[],
  ) => Promise<'published' | 'missing-parent'>
  invalidateParent: (parentDocumentId: string) => void
  onJobProgress?: (job: DocumentCardCleanupJob) => void
}

/** Platform effects supplied by the web or desktop adapter. */
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

/** Creates an empty queue for an installation with no saved jobs. */
export function emptyDocumentCardCleanupStore(): DocumentCardCleanupStore {
  return {schemaVersion: 2, coordinatorState: 'idle', jobs: []}
}

type LegacyCleanupJob = Omit<DocumentCardCleanupJob, 'source' | 'target' | 'container'> & {
  source?: UnpackedHypermediaId
  target?: UnpackedHypermediaId
  container?: UnpackedHypermediaId
  deletedDocumentId?: string
  sourceDocumentId?: string
  targetDocumentId?: string
  parentDocumentId?: string
}

/** Resolves the captured hierarchical parent, or an explicitly different reference container. */
export function getCleanupJobParent(
  job: Pick<DocumentCardCleanupJob, 'source' | 'target' | 'container' | 'operation'>,
): UnpackedHypermediaId {
  if (job.container) return job.container
  const child = job.operation === 'add' ? job.target ?? job.source : job.source ?? job.target
  if (!child) throw new Error('Maintenance job has no document identity')
  return hmId(child.uid, {path: (child.path ?? []).slice(0, -1)})
}

function migrateCleanupJob(raw: LegacyCleanupJob): DocumentCardCleanupJob {
  const {deletedDocumentId, sourceDocumentId, targetDocumentId, parentDocumentId, ...job} = raw
  const source = job.source ?? unpackHmId(sourceDocumentId || deletedDocumentId) ?? undefined
  const target = job.target ?? unpackHmId(targetDocumentId) ?? undefined
  const identity = {operation: job.operation, source, target, container: job.container}
  const parent = parentDocumentId ? unpackHmId(parentDocumentId) : undefined
  const derived = source || target ? getCleanupJobParent({...identity, container: undefined}) : null
  const container = job.container ?? (parent && parent.id !== derived?.id ? parent : undefined)
  return {
    ...job,
    ...(source ? {source} : {}),
    ...(target ? {target} : {}),
    ...(container ? {container} : {}),
    state: ['awaitingPrimary', 'loadingParent', 'updating', 'publishing', 'verifying', 'failed'].includes(job.state)
      ? 'idle'
      : job.state,
    maxRetries: job.maxRetries ?? 3,
    ...(job.operation === 'add' ? {cardBlockId: job.cardBlockId || nanoid(10)} : {}),
  }
}

/** Migrates legacy identities once at persistence boundaries and recovers interrupted attempts. */
export function normalizeDocumentCardCleanupStore(
  raw: {jobs: LegacyCleanupJob[]; coordinatorState?: CleanupCoordinatorState} | undefined,
): DocumentCardCleanupStore {
  if (!raw || !Array.isArray(raw.jobs)) return emptyDocumentCardCleanupStore()
  return {schemaVersion: 2, coordinatorState: 'idle', jobs: raw.jobs.map(migrateCleanupJob)}
}

function retainDismissedHistory(jobs: DocumentCardCleanupJob[], now: number) {
  const cutoff = now - 90 * 24 * 60 * 60 * 1_000
  const retained = new Set(
    jobs
      .filter((job) => job.state === 'dismissed' && (job.dismissedAt ?? job.updatedAt) > cutoff)
      .sort((a, b) => (b.dismissedAt ?? b.updatedAt) - (a.dismissedAt ?? a.updatedAt))
      .slice(0, 500),
  )
  return jobs.filter((job) => job.state !== 'dismissed' || retained.has(job))
}

/** Returns whether a cleanup job is still running or eligible for retry/recovery. */
export function isDocumentCardCleanupJobActive(job: DocumentCardCleanupJob) {
  return !['done', 'skippedTerminal', 'failedNeedsAttention', 'dismissed'].includes(job.state)
}

/** Produces a stable deduplication key for a reconciliation intent. */
export function cleanupJobId(input: {
  targetBlockId?: string
  intentId?: string
  operation?: DocumentCardCleanupOperation
  deletedDocumentId?: string
  sourceDocumentId?: string
  targetDocumentId?: string
  parentDocumentId: string
  signingAccountUid: string
}): string {
  if (input.intentId) return input.intentId
  if (input.targetBlockId) return `${cleanupJobId({...input, targetBlockId: undefined})}|block:${input.targetBlockId}`
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

/** Returns the backoff for a failed attempt. */
export function getRetryDelayMs(attempts: number) {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_MS.length - 1)] ?? 1_000
}

/** Returns whether a queued job has reached its scheduled execution time. */
export function isJobDue(job: DocumentCardCleanupJob, now: number) {
  if (job.state === 'idle') return !job.nextRunAt || job.nextRunAt <= now
  if (job.state === 'retryScheduled') return !!job.nextRunAt && job.nextRunAt <= now
  return false
}

function findNextDueJob(jobs: DocumentCardCleanupJob[], now: number) {
  const pendingParents = new Set<string>()
  for (const job of jobs) {
    if (job.state !== 'idle' && job.state !== 'retryScheduled') continue
    if (pendingParents.has(getCleanupJobParent(job).id)) continue
    pendingParents.add(getCleanupJobParent(job).id)
    if (isJobDue(job, now)) return job
  }
  return null
}

/** Finds the next runnable deadline while preserving order within each parent. */
export function nextDocumentCardCleanupDelayMs(jobs: DocumentCardCleanupJob[], now = Date.now()) {
  if (findNextDueJob(jobs, now)) return 0
  const pendingParents = new Set<string>()
  const nextRetry = jobs
    .filter((job) => {
      if (job.state !== 'idle' && job.state !== 'retryScheduled') return false
      if (pendingParents.has(getCleanupJobParent(job).id)) return false
      pendingParents.add(getCleanupJobParent(job).id)
      return job.nextRunAt != null
    })
    .map((job) => job.nextRunAt as number)
    .sort((a, b) => a - b)[0]
  if (nextRetry == null) return null
  return Math.max(nextRetry - now, 0)
}

function replaceJob(jobs: DocumentCardCleanupJob[], nextJob: DocumentCardCleanupJob, preserveAttention = false) {
  return jobs.map((job) => {
    if (job.id !== nextJob.id) return job
    // A mounted editor can report a conflict while publication/reconciliation is still resolving.
    // Its attention state must survive the attempt's later progress/completion.
    return preserveAttention && job.state === 'failedNeedsAttention' && nextJob.state !== 'failedNeedsAttention'
      ? {...nextJob, state: job.state, lastError: job.lastError, nextRunAt: undefined}
      : nextJob
  })
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

/** Creates an actor that makes one reconciliation attempt; the coordinator owns retries. */
export function createDocumentCardCleanupJobMachine(effects: CleanupJobEffects) {
  return setup({
    types: {} as {
      context: JobContext
      events: any
      input: {job: DocumentCardCleanupJob; now: number}
      output: DocumentCardCleanupJob
    },
    actors: {
      verifyPrimary: fromPromise(async ({input}: {input: JobContext}) => {
        if (!effects.verifyPrimaryOutcome) throw new Error('Confirmation required: primary action outcome is unknown')
        await effects.verifyPrimaryOutcome(input.job)
      }),
      findTemporaryCard: fromPromise(async ({input}: {input: JobContext}) => effects.findTemporaryCard?.(input.job)),
      loadParentDocument: fromPromise(async ({input}: {input: {job: DocumentCardCleanupJob}}) => {
        const document = await effects.loadParentDocument(input.job)
        const plan = document ? await effects.planPublishedParent(input.job, document) : null
        return {document, plan}
      }),
      publishParentUpdate: fromPromise(async ({input}: {input: JobContext}) =>
        effects.publishParentUpdate(input.job, input.parentDocument!, input.publishedPlan!.changes),
      ),
      verifyParent: fromPromise(async ({input}: {input: JobContext}) => {
        const document = await effects.loadParentDocument(input.job)
        if (!document?.version) throw new Error('Cannot verify the published parent version')
        if ((await effects.planPublishedParent(input.job, document)).changes.length) {
          throw new Error('Parent publication is not yet visible or its references changed concurrently')
        }
        return document
      }),
      reconcileDraft: fromPromise(async ({input}: {input: JobContext}) => {
        if (effects.reconcileParentDraft) {
          await effects.reconcileParentDraft(input.job, input.parentDocument!)
        } else {
          const draft = await effects.loadParentDraft(input.job)
          if (draft) await effects.cleanupParentDraft(input.job, draft)
        }
      }),
      deleteChild: fromPromise(async ({input}: {input: JobContext}) => {
        if (!effects.executeConfirmedDeletion) throw new Error('Confirmed deletion is unavailable')
        await effects.executeConfirmedDeletion(input.job)
      }),
    },
    actions: {
      state: assign(({context}, params: {state: DocumentCardCleanupJobState}) => ({
        job: updateJob(context.job, {state: params.state}, effects.now()),
      })),
      progress: ({context}) => effects.onJobProgress?.(context.job),
      loaded: assign(({event}) => ({
        parentDocument: event.output.document,
        publishedPlan: event.output.plan,
      })),
      checkpoint: assign(({context, event}) => ({
        parentDocument: event.output,
        job: updateJob(context.job, {publishedVersion: event.output.version}, effects.now()),
      })),
      failure: assign(({context, event}) => ({
        job: updateJob(context.job, {state: 'failed', lastError: toErrorMessage(event.error)}, effects.now()),
      })),
      finish: assign(({context}) => ({
        job: updateJob(context.job, {state: 'done', lastError: undefined, nextRunAt: undefined}, effects.now()),
      })),
      invalidate: ({context}) => effects.invalidateParent(getCleanupJobParent(context.job).id),
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
    initial: 'routing',
    output: ({context}) => context.job,
    states: {
      routing: {
        always: [
          {
            guard: ({context}) => !!context.job.awaitingPrimary && !context.job.primaryConfirmed,
            target: 'verifyingPrimary',
          },
          {guard: ({context}) => context.job.operation === 'delete-child', target: 'deleting'},
          {
            guard: ({context}) =>
              context.job.operation === 'add' && !!context.job.childDraftId && !context.job.publishedVersion,
            target: 'preparing',
          },
          {target: 'loading'},
        ],
      },
      preparing: {
        invoke: {
          src: 'findTemporaryCard',
          input: ({context}) => context,
          onDone: {
            target: 'loading',
            actions: [
              assign(({context, event}) => ({
                job: {
                  ...context.job,
                  ...(typeof event.output === 'string'
                    ? {cardBlockId: event.output}
                    : event.output
                      ? {
                          cardBlockId: event.output.blockId,
                          cardParentId: event.output.parentId,
                          cardLeftSibling: event.output.leftSibling,
                        }
                      : {}),
                },
              })),
              'progress',
            ],
          },
          onError: {target: 'failed', actions: 'failure'},
        },
      },
      verifyingPrimary: {
        invoke: {
          src: 'verifyPrimary',
          input: ({context}) => context,
          onDone: {
            target: 'routing',
            actions: [assign(({context}) => ({job: {...context.job, primaryConfirmed: true}})), 'progress'],
          },
          onError: {target: 'attention', actions: 'failure'},
        },
      },
      attention: {type: 'final', entry: [{type: 'state', params: {state: 'failedNeedsAttention'}}, 'progress']},
      deleting: {
        entry: [{type: 'state', params: {state: 'updating'}}, 'progress'],
        invoke: {
          src: 'deleteChild',
          input: ({context}) => context,
          onDone: 'done',
          onError: {target: 'failed', actions: 'failure'},
        },
      },
      loading: {
        entry: [{type: 'state', params: {state: 'loadingParent'}}, 'progress'],
        invoke: {
          src: 'loadParentDocument',
          input: ({context}) => ({job: context.job}),
          onDone: {target: 'planning', actions: 'loaded'},
          onError: {target: 'failed', actions: 'failure'},
        },
      },
      planning: {
        always: [
          {guard: ({context}) => !context.parentDocument, target: 'skipped'},
          {guard: ({context}) => !!context.job.publishedVersion, target: 'reconciling'},
          {guard: ({context}) => !!context.publishedPlan?.changes.length, target: 'publishing'},
          {target: 'verifying'},
        ],
      },
      publishing: {
        entry: [{type: 'state', params: {state: 'publishing'}}, 'progress'],
        invoke: {
          src: 'publishParentUpdate',
          input: ({context}) => context,
          onDone: [{guard: ({event}) => event.output === 'missing-parent', target: 'skipped'}, {target: 'verifying'}],
          onError: {target: 'failed', actions: 'failure'},
        },
      },
      verifying: {
        entry: [{type: 'state', params: {state: 'verifying'}}, 'progress'],
        invoke: {
          src: 'verifyParent',
          input: ({context}) => context,
          onDone: {target: 'reconciling', actions: ['checkpoint', 'progress']},
          onError: {target: 'failed', actions: 'failure'},
        },
      },
      reconciling: {
        entry: [{type: 'state', params: {state: 'updating'}}, 'progress'],
        invoke: {
          src: 'reconcileDraft',
          input: ({context}) => context,
          onDone: 'done',
          onError: {target: 'failed', actions: 'failure'},
        },
      },
      done: {type: 'final', entry: ['finish', 'invalidate', 'progress']},
      skipped: {type: 'final', entry: [{type: 'state', params: {state: 'skippedTerminal'}}, 'progress']},
      failed: {type: 'final', entry: ['invalidate', 'progress']},
    },
  })
}

/** Runs one attempt and disposes the child actor after its result or error. */
export async function runCleanupJobWithMachine(
  effects: CleanupJobEffects,
  job: DocumentCardCleanupJob,
  now: number,
): Promise<DocumentCardCleanupJob> {
  const actor = createActor(createDocumentCardCleanupJobMachine(effects), {input: {job, now}})
  const result = toPromise(actor)
  actor.start()
  try {
    return await result
  } finally {
    actor.stop()
  }
}

function supersedePendingReferenceJobs(
  jobs: DocumentCardCleanupJob[],
  next: DocumentCardCleanupJob,
  activeJobId: string | null,
) {
  if (next.awaitingPrimary && !next.primaryConfirmed) return jobs
  const source = next.source?.id
  return jobs.map((job) => {
    if (
      job.id === next.id ||
      job.id === activeJobId ||
      (job.operation !== 'add' && job.operation !== 'rewrite') ||
      getCleanupJobParent(job).id !== getCleanupJobParent(next).id ||
      (job.target?.id || job.source?.id) !== source ||
      !['idle', 'retryScheduled', 'failedNeedsAttention', 'awaitingPrimary'].includes(job.state)
    )
      return job
    if (next.operation === 'rewrite')
      return {
        ...job,
        target: next.target,
        publishedVersion: undefined,
        primaryConfirmed: true,
        state: 'idle' as const,
        attempts: 0,
        nextRunAt: undefined,
        lastError: undefined,
      }
    if ((next.operation || 'remove') === 'remove' && job.operation === 'rewrite')
      return {
        ...job,
        operation: 'remove' as const,
        target: undefined,
        publishedVersion: undefined,
        primaryConfirmed: true,
        state: 'idle' as const,
        attempts: 0,
        nextRunAt: undefined,
        lastError: undefined,
      }
    if ((next.operation || 'remove') === 'remove')
      return {
        ...job,
        state: 'skippedTerminal' as const,
        lastError: 'Superseded by a later removal',
        nextRunAt: undefined,
      }
    return job
  })
}

/** Creates the long-lived queue owner for attempts, backoff, and manual recovery. */
export function createDocumentCardCleanupCoordinatorMachine(effects: CleanupCoordinatorEffects) {
  return setup({
    types: {} as {
      context: CoordinatorContext
      events: any
      input: {jobs?: DocumentCardCleanupJob[]; now?: number}
    },
    actors: {
      runCleanupJob: fromPromise<
        DocumentCardCleanupJob,
        {job: DocumentCardCleanupJob; now: number; onProgress: (job: DocumentCardCleanupJob) => void}
      >(async ({input}) => {
        return runCleanupJobWithMachine(
          {
            ...effects,
            onJobProgress: (job) => {
              input.onProgress(job)
              effects.onJobProgress?.(job)
            },
          },
          input.job,
          input.now,
        )
      }),
    },
    guards: {
      hasDueJob: ({context, event}) => {
        const now = event.type === 'cleanup.tick' ? event.now ?? effects.now() : effects.now()
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
          targetBlockId: event.targetBlockId,
          intentId: event.intentId,
          operation,
          deletedDocumentId: event.deletedDocumentId,
          sourceDocumentId: event.sourceDocumentId,
          targetDocumentId: event.targetDocumentId,
          parentDocumentId: parent.id,
          signingAccountUid: event.signingAccountUid,
        })
        if (
          context.jobs.some(
            (job) =>
              job.id === jobId &&
              !['done', 'skippedTerminal'].includes(job.state) &&
              (job.state !== 'dismissed' || event.intentId),
          )
        )
          return {}
        const now = effects.now()
        const job: DocumentCardCleanupJob = {
          ...migrateCleanupJob({
            sourceDocumentId: event.sourceDocumentId || event.deletedDocumentId,
            targetDocumentId: event.targetDocumentId,
            parentDocumentId: parent.id,
            operation,
          } as LegacyCleanupJob),
          id: jobId,
          operation,
          awaitingPrimary: event.awaitingPrimary,
          signingAccountUid: event.signingAccountUid,
          capabilityId: event.capabilityId,
          cardBlockId: nanoid(10),
          childDraftId: event.childDraftId,
          targetBlockId: event.targetBlockId,
          approvedSubtree: event.approvedSubtree,
          authorizingParentVersion: event.authorizingParentVersion,
          state: event.awaitingPrimary ? 'awaitingPrimary' : 'idle',
          attempts: 0,
          maxRetries: 3,
          createdAt: now,
          updatedAt: now,
        }
        return {
          jobs: [
            ...supersedePendingReferenceJobs(
              context.jobs
                .map((old) =>
                  old.id === jobId && old.state === 'dismissed' ? {...old, id: `${jobId}|dismissed:${nanoid()}`} : old,
                )
                .filter((old) => old.id !== jobId),
              job,
              context.activeJobId,
            ),
            job,
          ],
          lastNow: now,
        }
      }),
      setTickNow: assign(({context, event}) => {
        const now = event.type === 'cleanup.tick' ? event.now ?? effects.now() : context.lastNow
        return {lastNow: now, jobs: retainDismissedHistory(context.jobs, now)}
      }),
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
        const result = event.output as DocumentCardCleanupJob
        const now = effects.now()
        let jobs = replaceJob(
          context.jobs,
          result.state === 'failed' ? toRetryJob(result, result.lastError, now) : result,
          true,
        )
        const completedIndex = jobs.findIndex((job) => job.id === result.id)
        // An intent may have arrived while the old attempt was in flight. Compose
        // it only after that attempt settles, never mutate an active actor's input.
        for (const newer of jobs.slice(completedIndex + 1)) jobs = supersedePendingReferenceJobs(jobs, newer, null)
        return {jobs, activeJobId: null, lastNow: now}
      }),
      recordActorFailure: assign(({context, event}) => {
        const active = context.jobs.find((job) => job.id === context.activeJobId)
        const now = effects.now()
        return {
          jobs: active ? replaceJob(context.jobs, toRetryJob(active, event.error, now)) : context.jobs,
          activeJobId: null,
          lastNow: now,
        }
      }),
      retryJob: assign(({context, event}) => {
        const job = context.jobs.find(
          (job) =>
            job.id === event.jobId &&
            job.operation !== 'delete-child' &&
            (job.state === 'failedNeedsAttention' || job.state === 'dismissed'),
        )
        if (!job || job.id === context.activeJobId) return {}
        const now = effects.now()
        return {
          jobs: replaceJob(
            context.jobs,
            updateJob(
              job,
              {
                state: 'idle',
                attempts: 0,
                lastError: undefined,
                nextRunAt: undefined,
                dismissedAt: undefined,
                ...(job.state === 'dismissed' ? {publishedVersion: undefined, primaryConfirmed: false} : {}),
              },
              now,
            ),
          ),
          lastNow: now,
        }
      }),
      dismissJob: assign(({context, event}) => {
        const now = effects.now()
        return {
          jobs: retainDismissedHistory(
            context.jobs.map((job) =>
              job.id === event.jobId && job.id !== context.activeJobId && job.state === 'failedNeedsAttention'
                ? updateJob(job, {state: 'dismissed', dismissedAt: now, nextRunAt: undefined}, now)
                : job,
            ),
            now,
          ),
          lastNow: now,
        }
      }),
      scheduleNext: ({context}) =>
        effects.scheduleCleanup(nextDocumentCardCleanupDelayMs(context.jobs, context.lastNow)),
    },
  }).createMachine({
    id: 'documentCardCleanupCoordinator',
    context: ({input}) => ({
      jobs: retainDismissedHistory(
        normalizeDocumentCardCleanupStore({coordinatorState: 'idle', jobs: input.jobs || []}).jobs,
        input.now ?? effects.now(),
      ),
      activeJobId: null,
      lastNow: input.now ?? effects.now(),
    }),
    initial: 'idle',
    on: {
      'cleanup.reconfirmDeletion': {
        actions: [
          assign(({context, event}) => ({
            jobs: context.jobs.map((job) =>
              job.id === event.jobId &&
              job.id !== context.activeJobId &&
              job.operation === 'delete-child' &&
              (job.state === 'failedNeedsAttention' || job.state === 'dismissed') &&
              Array.isArray(event.approvedSubtree) &&
              event.approvedSubtree.length > 0
                ? {
                    ...job,
                    approvedSubtree: event.approvedSubtree,
                    dismissedAt: undefined,
                    state: 'idle' as const,
                    attempts: 0,
                    lastError: undefined,
                    nextRunAt: undefined,
                    updatedAt: effects.now(),
                  }
                : job,
            ),
          })),
          'scheduleNext',
        ],
      },
      'cleanup.release': {
        actions: [
          assign(({context, event}) => {
            const job = context.jobs.find((job) => job.id === event.jobId)
            if (!job || job.primaryConfirmed || job.state === 'dismissed') return {}
            const released = updateJob(
              job,
              {
                state: 'idle',
                primaryConfirmed: true,
                authorizingParentVersion: event.authorizingParentVersion || job.authorizingParentVersion,
              },
              effects.now(),
            )
            return {
              jobs: supersedePendingReferenceJobs(replaceJob(context.jobs, released), released, context.activeJobId),
            }
          }),
          'scheduleNext',
        ],
      },
      'cleanup.needsAttention': {
        actions: assign(({context, event}) => ({
          jobs: context.jobs.map((job) =>
            job.id === event.jobId && job.state !== 'dismissed'
              ? updateJob(
                  job,
                  {state: 'failedNeedsAttention', lastError: event.error, nextRunAt: undefined},
                  effects.now(),
                )
              : job,
          ),
        })),
      },
      'cleanup.progress': {actions: assign(({context, event}) => ({jobs: replaceJob(context.jobs, event.job, true)}))},
      'cleanup.enqueue': {actions: ['addJob', 'scheduleNext']},
      'cleanup.retry': {actions: ['retryJob', 'scheduleNext']},
      'cleanup.dismiss': {actions: ['dismissJob', 'scheduleNext']},
      'cleanup.clearDismissed': {
        actions: assign(({context}) => ({jobs: context.jobs.filter((job) => job.state !== 'dismissed')})),
      },
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
          input: ({context, self}) => ({
            onProgress: (job: DocumentCardCleanupJob) => self.send({type: 'cleanup.progress', job}),
            job: context.jobs.find((job) => job.id === context.activeJobId) as DocumentCardCleanupJob,
            now: context.lastNow,
          }),
          onDone: {target: 'idle', actions: 'applyJobResult'},
          onError: {target: 'idle', actions: 'recordActorFailure'},
        },
        on: {
          'cleanup.tick': {actions: 'setTickNow'},
        },
      },
    },
  })
}

/** Unconfigured job machine for visualization; running apps supply platform effects. */
export const documentCardCleanupJobMachine = createDocumentCardCleanupJobMachine(defaultEffects())
/** Unconfigured coordinator for visualization; running apps supply platform effects. */
export const documentCardCleanupCoordinatorMachine = createDocumentCardCleanupCoordinatorMachine(defaultEffects())

/** Selects serializable queue state without persisting in-flight promise actors. */
export function getPublicDocumentCardCleanupSnapshot(snapshot: {
  value: unknown
  context: CoordinatorContext
}): DocumentCardCleanupStore {
  const coordinatorState: CleanupCoordinatorState =
    snapshot.value === 'running' ? 'running' : snapshot.value === 'waitingForRetry' ? 'retryWaiting' : 'idle'
  return {schemaVersion: 2, coordinatorState, jobs: snapshot.context.jobs}
}
