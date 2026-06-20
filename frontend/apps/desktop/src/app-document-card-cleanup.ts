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
import {createActor} from 'xstate'
import {
  CLEANUP_MACHINE_STORAGE_KEY,
  CLEANUP_STORAGE_KEY,
  cleanupJobId,
  createDocumentCardCleanupCoordinatorMachine,
  DocumentCardCleanupJob,
  DocumentCardCleanupStore,
  getPublicDocumentCardCleanupSnapshot,
  normalizeDocumentCardCleanupStore,
} from './app-document-card-cleanup-machine'

const CLEANUP_STATUS_QUERY_KEY = ['trpc.documentCardCleanup.getSnapshot']
const CLEANUP_LOG_PREFIX = '[Document embed cleanup]'

type RunOptions = {
  now?: () => number
}

let scheduledRun: ReturnType<typeof setTimeout> | null = null
let hasStarted = false
let cleanupActor: any | null = null

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

function createCleanupActor() {
  const persistedSnapshot = appStore.get(CLEANUP_MACHINE_STORAGE_KEY)
  const previousStore = normalizeDocumentCardCleanupStore(
    appStore.get(CLEANUP_STORAGE_KEY) as DocumentCardCleanupStore | undefined,
  )
  const machine = createDocumentCardCleanupCoordinatorMachine({
    now: () => Date.now(),
    getParentDocumentId,
    scheduleCleanup: scheduleDocumentCardCleanup,
    loadParentDraft: (job) => loadParentDraft(job.parentDocumentId, job.id),
    loadParentDocument: (job) => loadParentDocument(job.parentDocumentId),
    cleanupParentDraft: (job, draft) => cleanupParentDraft(job, draft as any),
    planPublishedParent: (job, parentDocument) => {
      const plan = planDocumentCardRemoval(parentDocument as any, job.deletedDocumentId)
      log.debug(`${CLEANUP_LOG_PREFIX} published parent plan`, {
        jobId: job.id,
        deletedDocumentId: job.deletedDocumentId,
        parentDocumentId: job.parentDocumentId,
        changeCount: plan.changes.length,
        removedBlockIds: plan.removedBlockIds,
      })
      return plan
    },
    publishParentUpdate: async (job, parentDocument, changes) => {
      return publishParentUpdate(
        job,
        parentDocument as Awaited<ReturnType<typeof loadParentDocument>>,
        changes as any[],
      )
    },
    invalidateParent,
    onJobProgress: (job) => {
      log.debug(`${CLEANUP_LOG_PREFIX} job progress`, {
        jobId: job.id,
        deletedDocumentId: job.deletedDocumentId,
        parentDocumentId: job.parentDocumentId,
        state: job.state,
        attempts: job.attempts,
        nextRunAt: job.nextRunAt ?? null,
      })
    },
  })

  const actor = createActor(
    machine as any,
    persistedSnapshot
      ? ({snapshot: persistedSnapshot as any, input: {jobs: previousStore.jobs}} as any)
      : {input: {jobs: previousStore.jobs}},
  )
  actor.subscribe((snapshot) => {
    const publicSnapshot = getPublicDocumentCardCleanupSnapshot(snapshot as any)
    appStore.set(CLEANUP_MACHINE_STORAGE_KEY, actor.getPersistedSnapshot())
    appStore.set(CLEANUP_STORAGE_KEY, publicSnapshot)
    appInvalidateQueries(CLEANUP_STATUS_QUERY_KEY)
  })
  actor.start()
  return actor
}

function getCleanupActor() {
  if (!cleanupActor) cleanupActor = createCleanupActor()
  return cleanupActor
}

function getPublicSnapshot() {
  const actor = getCleanupActor()
  return getPublicDocumentCardCleanupSnapshot(actor.getSnapshot() as any)
}

function scheduleDocumentCardCleanup(delayMs?: number | null) {
  if (scheduledRun) clearTimeout(scheduledRun)
  if (delayMs == null) return
  scheduledRun = setTimeout(() => {
    scheduledRun = null
    getCleanupActor().send({type: 'cleanup.tick'})
  }, delayMs)
}

export const documentCardCleanupApi = t.router({
  getSnapshot: t.procedure.query(() => getPublicSnapshot()),
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
      if (getPublicSnapshot().jobs.some((job) => job.id === jobId)) {
        return {enqueued: false, reason: 'duplicate' as const, jobId}
      }

      getCleanupActor().send({
        type: 'cleanup.enqueue',
        deletedDocumentId: input.deletedDocumentId,
        signingAccountUid: input.signingAccountUid,
        capabilityId: input.capabilityId,
      } as any)
      return {enqueued: true, jobId}
    }),
})

export function startDocumentCardCleanupCoordinator() {
  if (hasStarted) return
  hasStarted = true
  getCleanupActor().send({type: 'cleanup.tick'})
}

export function getDocumentCardCleanupSnapshotForTest() {
  return getPublicSnapshot()
}

export async function runNextDocumentCardCleanupForTest(options: RunOptions = {}) {
  const actor = getCleanupActor()
  actor.send({type: 'cleanup.tick', now: options.now?.() ?? Date.now()} as any)
  if ((actor.getSnapshot() as any).value !== 'running') return
  await new Promise<void>((resolve) => {
    const sub = actor.subscribe((snapshot: any) => {
      if ((snapshot as any).value !== 'running') {
        sub.unsubscribe()
        resolve()
      }
    })
  })
}
