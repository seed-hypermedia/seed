import {unpackHmId} from '@seed-hypermedia/client/hm-types'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {queryKeys} from '@shm/shared/models/query-keys'
import {prepareHMDocument} from '@shm/shared/document-utils'
import {hmLinkTargetsDocument, planDocumentCardRemoval} from '@shm/shared/utils/document-card-cleanup'
import {z} from 'zod'
// @ts-expect-error ignore import
import {appStore} from './app-store.mts'
import {getSigner, seedClient} from './app-client'
import {grpcClient} from './app-grpc'
import {appInvalidateQueries} from './app-invalidation'
import {draftsApi} from './app-drafts'
import {t} from './app-trpc'
import {dispatchAllWindowsAppEvent} from './app-windows'
import * as log from './logger'

const CLEANUP_STORAGE_KEY = 'DocumentCardCleanupState-v001'
const CLEANUP_STATUS_QUERY_KEY = ['trpc.documentCardCleanup.getSnapshot']
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000]
const CLEANUP_LOG_PREFIX = '[Document embed cleanup]'

type CleanupCoordinatorState = 'idle' | 'running' | 'retryWaiting'

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
  deletedDocumentId: string
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

type DocumentCardCleanupStore = {
  coordinatorState: CleanupCoordinatorState
  jobs: DocumentCardCleanupJob[]
}

type RunOptions = {
  now?: () => number
}

let state: DocumentCardCleanupStore = readStore()
let scheduledRun: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<void> | null = null
let hasStarted = false

function emptyStore(): DocumentCardCleanupStore {
  return {coordinatorState: 'idle', jobs: []}
}

function readStore(): DocumentCardCleanupStore {
  const raw = appStore.get(CLEANUP_STORAGE_KEY) as DocumentCardCleanupStore | undefined
  if (!raw || !Array.isArray(raw.jobs)) return emptyStore()
  return {
    coordinatorState: raw.coordinatorState || 'idle',
    jobs: raw.jobs.map((job) => ({...job, maxRetries: job.maxRetries ?? 3})),
  }
}

function writeStore(next: DocumentCardCleanupStore) {
  state = next
  appStore.set(CLEANUP_STORAGE_KEY, next)
  appInvalidateQueries(CLEANUP_STATUS_QUERY_KEY)
}

function updateJob(jobId: string, patch: Partial<DocumentCardCleanupJob>, now = Date.now()) {
  writeStore({
    ...state,
    jobs: state.jobs.map((job) => (job.id === jobId ? {...job, ...patch, updatedAt: now} : job)),
  })
}

function deriveCoordinatorState(now = Date.now()): CleanupCoordinatorState {
  if (inFlight) return 'running'
  const hasDue = state.jobs.some((job) => isJobDue(job, now))
  if (hasDue) return 'idle'
  const hasRetry = state.jobs.some((job) => job.state === 'retryScheduled')
  return hasRetry ? 'retryWaiting' : 'idle'
}

function writeCoordinatorState(coordinatorState: CleanupCoordinatorState) {
  if (state.coordinatorState === coordinatorState) return
  writeStore({...state, coordinatorState})
}

function isJobDue(job: DocumentCardCleanupJob, now: number) {
  if (job.state === 'idle') return !job.nextRunAt || job.nextRunAt <= now
  if (job.state === 'retryScheduled') return !!job.nextRunAt && job.nextRunAt <= now
  return false
}

function findNextDueJob(now: number) {
  return state.jobs.find((job) => isJobDue(job, now)) || null
}

function getRetryDelayMs(attempts: number) {
  return RETRY_DELAYS_MS[Math.min(Math.max(attempts - 1, 0), RETRY_DELAYS_MS.length - 1)]
}

function cleanupJobId(input: {deletedDocumentId: string; parentDocumentId: string; signingAccountUid: string}) {
  return `${input.deletedDocumentId}|${input.parentDocumentId}|${input.signingAccountUid}`
}

function getParentDocumentId(deletedDocumentId: string) {
  const id = unpackHmId(deletedDocumentId)
  if (!id) throw new Error(`Invalid document id: ${deletedDocumentId}`)
  const path = id.path || []
  if (path.length === 0) return null
  return {
    uid: id.uid,
    path: path.slice(0, -1),
    id: `hm://${id.uid}${path.length > 1 ? `/${path.slice(0, -1).join('/')}` : ''}`,
  }
}

async function loadParentDocument(parentDocumentId: string) {
  const parent = unpackHmId(parentDocumentId)
  if (!parent) throw new Error(`Invalid parent document id: ${parentDocumentId}`)
  try {
    const doc = await grpcClient.documents.getDocument({
      account: parent.uid,
      path: hmIdPathToEntityQueryPath(parent.path || []),
    })
    return prepareHMDocument(doc)
  } catch (error: any) {
    const message = error?.message || String(error)
    if (/not found|deleted/i.test(message)) return null
    throw error
  }
}

function invalidateParent(parentDocumentId: string) {
  const parent = unpackHmId(parentDocumentId)
  if (!parent) return
  appInvalidateQueries([queryKeys.ENTITY, parentDocumentId])
  appInvalidateQueries([queryKeys.RESOLVED_ENTITY, parentDocumentId])
  appInvalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentDocumentId, 'Children'])
  appInvalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentDocumentId, 'AllDescendants'])
  appInvalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, parentDocumentId])
}

async function resolveParentCapability(
  job: DocumentCardCleanupJob,
  parent: NonNullable<ReturnType<typeof unpackHmId>>,
) {
  if (job.signingAccountUid === parent.uid) return undefined
  const capabilities = await grpcClient.accessControl.listCapabilities({
    account: parent.uid,
    path: hmIdPathToEntityQueryPath(parent.path || []),
  })
  const capability = capabilities.capabilities.find((cap) => cap.delegate === job.signingAccountUid)
  return capability?.id || job.capabilityId
}

type EditorBlockLike = {
  id?: string
  type?: string
  props?: {url?: string; view?: string}
  children?: EditorBlockLike[]
  [key: string]: unknown
}

function isMatchingDeletedDocumentDraftEmbed(block: EditorBlockLike, deletedDocumentId: string) {
  if (block.type !== 'embed') return false
  const url = block.props?.url
  return !!url && hmLinkTargetsDocument(url, deletedDocumentId)
}

function removeDeletedDocumentEmbedsFromDraftBlocks(blocks: EditorBlockLike[], deletedDocumentId: string) {
  const removedBlockIds: string[] = []
  const inspectedEmbeds: Array<{id?: string; view?: string; url?: string; matches: boolean}> = []

  function expandBlock(block: EditorBlockLike): EditorBlockLike[] {
    const children = Array.isArray(block.children) ? block.children : []
    const isMatchingEmbed = isMatchingDeletedDocumentDraftEmbed(block, deletedDocumentId)
    if (block.type === 'embed') {
      inspectedEmbeds.push({id: block.id, view: block.props?.view, url: block.props?.url, matches: isMatchingEmbed})
    }
    if (isMatchingEmbed) {
      if (block.id) removedBlockIds.push(block.id)
      return children.flatMap(expandBlock)
    }

    const nextChildren = children.flatMap(expandBlock)
    return [{...block, children: nextChildren}]
  }

  const content = blocks.flatMap(expandBlock)
  return {content, removedBlockIds, inspectedEmbeds}
}

async function loadParentDraft(parentDocumentId: string, jobId?: string) {
  const parent = unpackHmId(parentDocumentId)
  if (!parent) throw new Error(`Invalid parent document id: ${parentDocumentId}`)

  const drafts = draftsApi.createCaller({})
  const parentDraft = await drafts.findByEdit({editUid: parent.uid, editPath: parent.path || []})
  log.debug(`${CLEANUP_LOG_PREFIX} parent draft lookup`, {
    jobId,
    parentDocumentId,
    editUid: parent.uid,
    editPath: parent.path || [],
    foundDraftId: parentDraft?.id || null,
  })
  if (!parentDraft) return null

  const draft = await drafts.get(parentDraft.id)
  log.debug(`${CLEANUP_LOG_PREFIX} parent draft load`, {
    jobId,
    parentDocumentId,
    draftId: parentDraft.id,
    foundDraft: !!draft,
    topLevelBlockCount: Array.isArray(draft?.content) ? draft.content.length : 0,
  })
  if (!draft) return null
  return draft
}

async function cleanupParentDraft(job: DocumentCardCleanupJob, draft: Awaited<ReturnType<typeof loadParentDraft>>) {
  if (!draft) return []

  const drafts = draftsApi.createCaller({})
  const originalContent = (draft.content || []) as EditorBlockLike[]
  const {content, removedBlockIds, inspectedEmbeds} = removeDeletedDocumentEmbedsFromDraftBlocks(
    originalContent,
    job.deletedDocumentId,
  )
  log.debug(`${CLEANUP_LOG_PREFIX} draft scan`, {
    jobId: job.id,
    deletedDocumentId: job.deletedDocumentId,
    parentDocumentId: job.parentDocumentId,
    draftId: draft.id,
    topLevelBlockCountBefore: originalContent.length,
    topLevelBlockCountAfter: content.length,
    inspectedEmbeds,
    removedBlockIds,
  })
  if (!removedBlockIds.length) return []

  log.info(`${CLEANUP_LOG_PREFIX} writing parent draft`, {
    jobId: job.id,
    deletedDocumentId: job.deletedDocumentId,
    parentDocumentId: job.parentDocumentId,
    draftId: draft.id,
    removedBlockIds,
    autoReload: true,
  })

  await drafts.write({
    id: draft.id,
    locationUid: draft.locationUid,
    locationPath: draft.locationPath,
    editUid: draft.editUid,
    editPath: draft.editPath,
    metadata: draft.metadata || {},
    content,
    deps: draft.deps || [],
    navigation: draft.navigation,
    visibility: draft.visibility,
    cursorPosition: draft.cursorPosition,
    mineTouchedIds: draft.mineTouchedIds,
    baseBlocks: draft.baseBlocks,
  })
  appInvalidateQueries([queryKeys.DRAFT, draft.id])
  log.info(`${CLEANUP_LOG_PREFIX} broadcasting draft externally modified`, {
    jobId: job.id,
    deletedDocumentId: job.deletedDocumentId,
    parentDocumentId: job.parentDocumentId,
    draftId: draft.id,
    removedBlockIds,
  })
  dispatchAllWindowsAppEvent({
    type: 'draft_externally_modified',
    draftId: draft.id,
    source: 'document-card-cleanup',
    deletedDocumentId: job.deletedDocumentId,
    removedBlockIds,
    autoReload: true,
  })
  const writtenDraft = await drafts.get(draft.id)
  const writtenContent = (writtenDraft?.content || []) as EditorBlockLike[]
  const verifyScan = removeDeletedDocumentEmbedsFromDraftBlocks(writtenContent, job.deletedDocumentId)
  log.info(`${CLEANUP_LOG_PREFIX} parent draft written`, {
    jobId: job.id,
    deletedDocumentId: job.deletedDocumentId,
    parentDocumentId: job.parentDocumentId,
    draftId: draft.id,
    removedBlockIds,
    notifiedWindows: true,
    topLevelBlockCountOnDisk: writtenContent.length,
    stillMatchingBlockIdsOnDisk: verifyScan.removedBlockIds,
  })
  return removedBlockIds
}

async function publishParentUpdate(
  job: DocumentCardCleanupJob,
  parentDocument: Awaited<ReturnType<typeof loadParentDocument>>,
  changes: any[],
) {
  const parent = unpackHmId(job.parentDocumentId)
  if (!parent) throw new Error(`Invalid parent document id: ${job.parentDocumentId}`)
  if (!parentDocument) return 'missing-parent' as const
  await seedClient.publishDocument(
    {
      account: parent.uid,
      path: hmIdPathToEntityQueryPath(parent.path || []),
      baseVersion: parentDocument.version,
      genesis: parentDocument.genesis,
      generation: parentDocument.generationInfo?.generation,
      changes,
      capability: await resolveParentCapability(job, parent),
    },
    getSigner(job.signingAccountUid),
  )
  return 'published' as const
}

async function executeJob(job: DocumentCardCleanupJob, now: number) {
  log.info(`${CLEANUP_LOG_PREFIX} job started`, {
    jobId: job.id,
    deletedDocumentId: job.deletedDocumentId,
    parentDocumentId: job.parentDocumentId,
    attempts: job.attempts,
  })
  updateJob(job.id, {state: 'loadingParent', lastError: undefined}, now)
  const parentDraft = await loadParentDraft(job.parentDocumentId, job.id)
  if (parentDraft) {
    updateJob(job.id, {isDraft: true, parentDraftId: parentDraft.id}, now)
  } else {
    updateJob(job.id, {isDraft: false, parentDraftId: undefined}, now)
  }
  log.info(`${CLEANUP_LOG_PREFIX} target selected`, {
    jobId: job.id,
    deletedDocumentId: job.deletedDocumentId,
    parentDocumentId: job.parentDocumentId,
    target: parentDraft ? 'draft' : 'published-document',
    parentDraftId: parentDraft?.id || null,
  })
  const parentDocument = parentDraft ? null : await loadParentDocument(job.parentDocumentId)

  updateJob(job.id, {state: 'updating'}, now)
  if (parentDraft) {
    const removedBlockIds = await cleanupParentDraft(job, parentDraft)
    if (removedBlockIds.length === 0) {
      log.info(`${CLEANUP_LOG_PREFIX} draft skipped; no matching embeds`, {
        jobId: job.id,
        deletedDocumentId: job.deletedDocumentId,
        parentDocumentId: job.parentDocumentId,
        draftId: parentDraft.id,
      })
      updateJob(job.id, {state: 'skippedTerminal', lastError: undefined}, now)
      return
    }

    updateJob(job.id, {state: 'verifying'}, now)
    invalidateParent(job.parentDocumentId)
    updateJob(job.id, {state: 'done', lastError: undefined}, now)
    log.info(`${CLEANUP_LOG_PREFIX} job done`, {
      jobId: job.id,
      deletedDocumentId: job.deletedDocumentId,
      parentDocumentId: job.parentDocumentId,
      target: 'draft',
      parentDraftId: parentDraft.id,
      removedBlockIds,
    })
    return
  }

  if (!parentDocument) {
    log.info(`${CLEANUP_LOG_PREFIX} skipped; parent document missing and no draft found`, {
      jobId: job.id,
      deletedDocumentId: job.deletedDocumentId,
      parentDocumentId: job.parentDocumentId,
    })
    updateJob(job.id, {state: 'skippedTerminal', lastError: undefined}, now)
    return
  }

  const plan = planDocumentCardRemoval(parentDocument, job.deletedDocumentId)
  log.debug(`${CLEANUP_LOG_PREFIX} published parent plan`, {
    jobId: job.id,
    deletedDocumentId: job.deletedDocumentId,
    parentDocumentId: job.parentDocumentId,
    changeCount: plan.changes.length,
    removedBlockIds: plan.removedBlockIds,
  })
  if (plan.changes.length === 0) {
    log.info(`${CLEANUP_LOG_PREFIX} published parent skipped; no matching embeds`, {
      jobId: job.id,
      deletedDocumentId: job.deletedDocumentId,
      parentDocumentId: job.parentDocumentId,
    })
    updateJob(job.id, {state: 'skippedTerminal', lastError: undefined}, now)
    return
  }

  updateJob(job.id, {state: 'publishing'}, now)
  const publishResult = await publishParentUpdate(job, parentDocument, plan.changes)
  if (publishResult === 'missing-parent') {
    updateJob(job.id, {state: 'skippedTerminal', lastError: undefined}, now)
    return
  }

  updateJob(job.id, {state: 'verifying'}, now)
  invalidateParent(job.parentDocumentId)
  updateJob(job.id, {state: 'done', lastError: undefined}, now)
  log.info(`${CLEANUP_LOG_PREFIX} job done`, {
    jobId: job.id,
    deletedDocumentId: job.deletedDocumentId,
    parentDocumentId: job.parentDocumentId,
    target: 'published-document',
  })
}

function handleJobFailure(job: DocumentCardCleanupJob, error: unknown, now: number) {
  const message = error instanceof Error ? error.message : String(error)
  const attempts = job.attempts + 1
  if (attempts <= job.maxRetries) {
    const nextRunAt = now + getRetryDelayMs(attempts)
    updateJob(job.id, {state: 'retryScheduled', attempts, nextRunAt, lastError: message}, now)
    scheduleDocumentCardCleanup(nextRunAt - now)
    log.warn(`${CLEANUP_LOG_PREFIX} retry scheduled`, {jobId: job.id, attempts, nextRunAt, error: message})
    return
  }

  updateJob(job.id, {state: 'failedNeedsAttention', attempts, nextRunAt: undefined, lastError: message}, now)
  log.error(`${CLEANUP_LOG_PREFIX} failed`, {jobId: job.id, attempts, error: message})
}

async function runNextDocumentCardCleanup(options: RunOptions = {}) {
  const now = options.now?.() ?? Date.now()
  if (inFlight) return inFlight

  const job = findNextDueJob(now)
  if (!job) {
    writeCoordinatorState(deriveCoordinatorState(now))
    return
  }

  inFlight = (async () => {
    writeCoordinatorState('running')
    try {
      await executeJob(job, now)
    } catch (error) {
      handleJobFailure(job, error, now)
    } finally {
      inFlight = null
      writeCoordinatorState(deriveCoordinatorState(options.now?.() ?? Date.now()))
      scheduleDocumentCardCleanup()
    }
  })()

  return inFlight
}

function nextDelayMs(now = Date.now()) {
  const dueNow = state.jobs.some((job) => isJobDue(job, now))
  if (dueNow) return 0
  const nextRetry = state.jobs
    .filter((job) => job.state === 'retryScheduled' && job.nextRunAt)
    .map((job) => job.nextRunAt as number)
    .sort((a, b) => a - b)[0]
  if (!nextRetry) return null
  return Math.max(nextRetry - now, 0)
}

function scheduleDocumentCardCleanup(delayMs?: number | null) {
  if (scheduledRun) clearTimeout(scheduledRun)
  const delay = delayMs ?? nextDelayMs()
  if (delay == null) return
  scheduledRun = setTimeout(() => {
    scheduledRun = null
    void runNextDocumentCardCleanup()
  }, delay)
}

export const documentCardCleanupApi = t.router({
  getSnapshot: t.procedure.query(() => state),
  enqueue: t.procedure
    .input(
      z.object({
        deletedDocumentId: z.string(),
        signingAccountUid: z.string(),
        capabilityId: z.string().optional(),
      }),
    )
    .mutation(async ({input}) => {
      const parent = getParentDocumentId(input.deletedDocumentId)
      if (!parent) return {enqueued: false, reason: 'no-parent' as const}

      const jobId = cleanupJobId({
        deletedDocumentId: input.deletedDocumentId,
        parentDocumentId: parent.id,
        signingAccountUid: input.signingAccountUid,
      })
      const existing = state.jobs.find((job) => job.id === jobId)
      if (existing) return {enqueued: false, reason: 'duplicate' as const, jobId}

      const now = Date.now()
      const job: DocumentCardCleanupJob = {
        id: jobId,
        deletedDocumentId: input.deletedDocumentId,
        parentDocumentId: parent.id,
        signingAccountUid: input.signingAccountUid,
        capabilityId: input.capabilityId,
        state: 'idle',
        attempts: 0,
        maxRetries: 3,
        createdAt: now,
        updatedAt: now,
      }
      writeStore({...state, jobs: [...state.jobs, job], coordinatorState: 'idle'})
      scheduleDocumentCardCleanup(0)
      return {enqueued: true, jobId}
    }),
})

export function startDocumentCardCleanupCoordinator() {
  if (hasStarted) return
  hasStarted = true
  scheduleDocumentCardCleanup()
}

export function getDocumentCardCleanupSnapshotForTest() {
  return state
}

export async function runNextDocumentCardCleanupForTest(options: RunOptions = {}) {
  await runNextDocumentCardCleanup(options)
}
