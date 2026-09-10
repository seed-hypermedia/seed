import {reconcileChildRemovalIntent} from '@shm/shared/utils/confirmed-child-deletion'
import {getCleanupJobParent} from '@shm/shared/models/document-card-cleanup-machine'
import {editorBlocksToHMBlockNodes} from '@seed-hypermedia/client/editorblock-to-hmblock'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {
  executeConfirmedChildDeletion,
  resolveDirectDocumentReferences,
} from '@shm/shared/utils/confirmed-child-deletion'
import type {UniversalClient} from '@shm/shared/universal-client'
import {rebaseDocumentReferenceDraft, findPublishedCardPosition} from '@shm/shared/utils/document-reference-rebase'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {unpackHmId} from '@seed-hypermedia/client/hm-types'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {queryKeys} from '@shm/shared/models/query-keys'
import {prepareHMDocument} from '@shm/shared/document-utils'
import {
  verifyDocumentCleanupPrimary,
  planDocumentCardAppend,
  planDocumentCardRemoval,
  planDocumentCardRewrite,
} from '@shm/shared/utils/document-card-cleanup'
import {z} from 'zod'
// @ts-expect-error ignore import
import {appStore} from './app-store.mts'
import {getSigner, seedClient} from './app-client'
import {grpcClient} from './app-grpc'
import {appInvalidateQueries} from './app-invalidation'
import {draftsApi, compareAndSwapDraft} from './app-drafts'
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
  DocumentCardCleanupOperation,
  DocumentCardCleanupStore,
  getPublicDocumentCardCleanupSnapshot,
  isDocumentCardCleanupJobActive,
  normalizeDocumentCardCleanupStore,
} from './app-document-card-cleanup-machine'
import {nanoid} from 'nanoid'

const CLEANUP_STATUS_QUERY_KEY = ['trpc.documentCardCleanup.getSnapshot']
const CLEANUP_LOG_PREFIX = '[Document embed cleanup]'

function isCleanupLoggingEnabled() {
  return Boolean((globalThis as any).__SEED_DOCUMENT_EMBED_CLEANUP_LOGS__)
}

function cleanupDebug(message: string, data?: any) {
  if (isCleanupLoggingEnabled()) log.debug(message, data)
}

function cleanupInfo(message: string, data?: any) {
  if (isCleanupLoggingEnabled()) log.info(message, data)
}

type RunOptions = {
  now?: () => number
}

let scheduledRun: ReturnType<typeof setTimeout> | null = null
let hasStarted = false
let cleanupActor: any | null = null
let storageError: string | undefined

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
  appInvalidateQueries([queryKeys.DOC_LIST_UNREFERENCED, parent.uid])
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

function getJobOperation(job: DocumentCardCleanupJob): DocumentCardCleanupOperation {
  return job.operation || 'remove'
}

function getJobSourceDocumentId(job: DocumentCardCleanupJob) {
  return job.source?.id
}

function getJobTargetDocumentId(job: DocumentCardCleanupJob) {
  return job.target?.id || job.source?.id
}

async function loadParentDraft(parentDocumentId: string, jobId?: string) {
  const parent = unpackHmId(parentDocumentId)
  if (!parent) throw new Error(`Invalid parent document id: ${parentDocumentId}`)

  const drafts = draftsApi.createCaller({})
  const parentDraft = await drafts.findByEdit({editUid: parent.uid, editPath: parent.path || []})
  cleanupDebug(`${CLEANUP_LOG_PREFIX} parent draft lookup`, {
    jobId,
    parentDocumentId,
    editUid: parent.uid,
    editPath: parent.path || [],
    foundDraftId: parentDraft?.id || null,
  })
  if (!parentDraft) return null

  const draft = await drafts.get(parentDraft.id)
  cleanupDebug(`${CLEANUP_LOG_PREFIX} parent draft load`, {
    jobId,
    parentDocumentId,
    draftId: parentDraft.id,
    foundDraft: !!draft,
    topLevelBlockCount: Array.isArray(draft?.content) ? draft.content.length : 0,
  })
  if (!draft) return null
  return draft
}

async function reconcileParentDraft(
  job: DocumentCardCleanupJob,
  publishedDocument: NonNullable<Awaited<ReturnType<typeof loadParentDocument>>>,
) {
  const draft = await loadParentDraft(getCleanupJobParent(job).id, job.id)
  if (!draft) return
  let base = draft.baseBlocks
  if (!base) {
    if (!draft.deps?.length) throw new Error('Parent draft has no published baseline')
    const parent = getCleanupJobParent(job)
    const document = await grpcClient.documents.getDocument({
      account: parent.uid,
      path: hmIdPathToEntityQueryPath(parent.path || []),
      version: draft.deps.join('.'),
    })
    base = prepareHMDocument(document).content || []
  }
  const previousContent = editorBlocksToHMBlockNodes(draft.content || [])
  function resolveTemporaryCards(blocks: any[]): any[] {
    return blocks.map((block) => ({
      ...block,
      ...(job.operation === 'add' && job.childDraftId && block.props?.draftId === job.childDraftId
        ? {props: {...block.props, draftId: '', url: getJobTargetDocumentId(job), revision: undefined}}
        : {}),
      children: resolveTemporaryCards(block.children || []),
    }))
  }
  const mine = editorBlocksToHMBlockNodes(resolveTemporaryCards(draft.content || []))
  const result = rebaseDocumentReferenceDraft(
    {...job, sourceDocumentId: job.source?.id, targetDocumentId: job.target?.id},
    base,
    mine,
    publishedDocument.content || [],
  )
  if (
    !(await compareAndSwapDraft(draft, {
      ...draft,
      removedChildDocumentIds: reconcileChildRemovalIntent(
        {operation: job.operation, sourceDocumentId: job.source?.id, targetDocumentId: job.target?.id},
        draft.removedChildDocumentIds ?? [],
      ),
      content: hmBlocksToEditorContent(result.content),
      baseBlocks: publishedDocument.content || [],
      deps: publishedDocument.version.split('.'),
      mineTouchedIds: result.mineTouchedIds,
    }))
  ) {
    throw new Error('Parent draft changed while reconciling; retrying with the latest edits')
  }
  appInvalidateQueries([queryKeys.DRAFT, draft.id])
  dispatchAllWindowsAppEvent({
    type: 'draft_externally_modified',
    draftId: draft.id,
    source: 'document-card-cleanup',
    jobId: job.id,
    maintenanceRevision: (draft.maintenanceRevision ?? 0) + 1,
    cardBlockId: job.cardBlockId,
    childDraftId: job.childDraftId,
    targetBlockId: job.targetBlockId,
    operation: getJobOperation(job) as 'add' | 'remove' | 'rewrite',
    sourceDocumentId: getJobSourceDocumentId(job),
    targetDocumentId: getJobTargetDocumentId(job),
    deletedDocumentId: job.source?.id,
    previousContent,
    publishedDocument,
    autoReload: false,
  })
}

async function publishParentUpdate(
  job: DocumentCardCleanupJob,
  parentDocument: Awaited<ReturnType<typeof loadParentDocument>>,
  changes: any[],
) {
  if (storageError) throw new Error(storageError)
  const parent = getCleanupJobParent(job)
  if (!parent) throw new Error(`Invalid parent document id: ${getCleanupJobParent(job).id}`)
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
  const persistedSnapshot = appStore.get(CLEANUP_MACHINE_STORAGE_KEY) as
    | {context?: {jobs?: DocumentCardCleanupJob[]}}
    | undefined
  const previousStore = normalizeDocumentCardCleanupStore(
    (appStore.get(CLEANUP_STORAGE_KEY) as DocumentCardCleanupStore | undefined) ?? {
      coordinatorState: 'idle',
      jobs: persistedSnapshot?.context?.jobs || [],
    },
  )
  const machine = createDocumentCardCleanupCoordinatorMachine({
    now: () => Date.now(),
    getParentDocumentId,
    scheduleCleanup: scheduleDocumentCardCleanup,
    loadParentDraft: (job) => loadParentDraft(getCleanupJobParent(job).id, job.id),
    loadParentDocument: (job) => loadParentDocument(getCleanupJobParent(job).id),
    cleanupParentDraft: async () => [],
    verifyPrimaryOutcome: (job) =>
      verifyDocumentCleanupPrimary({request: seedClient.request as UniversalClient['request']}, job.awaitingPrimary!),
    executeConfirmedDeletion: (job) => {
      if (storageError) throw new Error(storageError)
      return executeConfirmedChildDeletion(
        {request: seedClient.request as UniversalClient['request'], publish: seedClient.publish, getSigner},
        {...job, parentDocumentId: getCleanupJobParent(job).id, sourceDocumentId: job.source?.id},
      )
    },
    findTemporaryCard: async (job) => {
      const draft = await loadParentDraft(getCleanupJobParent(job).id)
      function find(blocks: any[]): string | undefined {
        for (const block of blocks) {
          if (block.props?.draftId === job.childDraftId) return block.id
          const nested = find(block.children || [])
          if (nested) return nested
        }
      }
      const blockId = find(draft?.content || [])
      if (!blockId || !draft) return undefined
      const published = await loadParentDocument(getCleanupJobParent(job).id)
      const position = findPublishedCardPosition(
        published?.content || [],
        editorBlocksToHMBlockNodes(draft.content || []),
        blockId,
      )
      return {blockId, parentId: position?.parent || '', leftSibling: position?.leftSibling || ''}
    },
    reconcileParentDraft: (job, document) => {
      if (storageError) throw new Error(storageError)
      return reconcileParentDraft(job, document as any)
    },
    planPublishedParent: async (job, parentDocument) => {
      const operation = getJobOperation(job)
      const sourceDocumentId = getJobSourceDocumentId(job)
      const targetDocumentId = getJobTargetDocumentId(job)
      const plan =
        operation === 'add' && targetDocumentId
          ? planDocumentCardAppend(
              parentDocument as any,
              getCleanupJobParent(job).id,
              targetDocumentId,
              job.cardBlockId || nanoid(10),
            )
          : operation === 'rewrite' && sourceDocumentId && targetDocumentId
            ? planDocumentCardRewrite(parentDocument as any, sourceDocumentId, targetDocumentId)
            : sourceDocumentId
              ? planDocumentCardRemoval(parentDocument as any, sourceDocumentId, {targetBlockId: job.targetBlockId})
              : {changes: [], removedBlockIds: []}
      cleanupDebug(`${CLEANUP_LOG_PREFIX} published parent plan`, {
        jobId: job.id,
        deletedDocumentId: job.source?.id,
        operation,
        sourceDocumentId,
        targetDocumentId,
        parentDocumentId: getCleanupJobParent(job).id,
        changeCount: plan.changes.length,
        removedBlockIds: 'removedBlockIds' in plan ? plan.removedBlockIds : [],
      })
      if (operation === 'add' && plan.changes.length && targetDocumentId) {
        const references = await resolveDirectDocumentReferences((parentDocument as HMDocument).content || [])
        if (references.ids.some((id) => id.id === targetDocumentId)) return {changes: [], removedBlockIds: []}
        if (job.cardParentId !== undefined) {
          for (const change of plan.changes) {
            if (change.op.case === 'moveBlock') {
              change.op.value.parent = job.cardParentId
              change.op.value.leftSibling = job.cardLeftSibling || ''
            }
          }
        }
      }
      const targetIdentity = job.target || (operation === 'add' ? job.source : undefined)
      if ((operation === 'add' || operation === 'rewrite') && plan.changes.length && targetIdentity) {
        const target = await seedClient.request('Resource', {...targetIdentity, version: null, latest: true})
        if (target.type !== 'document')
          throw new Error(
            'The child target moved, was deleted, or is not yet available. Review this reference update before retrying.',
          )
      }
      return {
        changes: plan.changes,
        removedBlockIds:
          'removedBlockIds' in plan
            ? plan.removedBlockIds
            : 'addedBlockIds' in plan
              ? plan.addedBlockIds
              : plan.rewrittenBlockIds,
      }
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
      cleanupDebug(`${CLEANUP_LOG_PREFIX} job progress`, {
        jobId: job.id,
        deletedDocumentId: job.source?.id,
        parentDocumentId: getCleanupJobParent(job).id,
        state: job.state,
        attempts: job.attempts,
        nextRunAt: job.nextRunAt ?? null,
      })
    },
  })

  const actor = createActor(machine as any, {input: {jobs: previousStore.jobs}})
  actor.subscribe((snapshot) => {
    const publicSnapshot = getPublicDocumentCardCleanupSnapshot(snapshot as any)
    try {
      appStore.set(CLEANUP_STORAGE_KEY, publicSnapshot)
    } catch (error) {
      storageError = error instanceof Error ? error.message : 'Could not save document maintenance progress'
      log.error('Document maintenance storage failed; subsequent mutations are paused', {error: storageError})
    }
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

/** Durable parent-reference maintenance and recovery endpoints. */
export const documentCardCleanupApi = t.router({
  retry: t.procedure.input(z.object({jobId: z.string()})).mutation(({input}) => {
    getCleanupActor().send({type: 'cleanup.retry', jobId: input.jobId})
    return getPublicSnapshot()
  }),
  reviewDeletion: t.procedure.input(z.object({jobId: z.string()})).query(async ({input}) => {
    const job = getPublicSnapshot().jobs.find((job) => job.id === input.jobId)
    if (!job || job.operation !== 'delete-child' || (job.state !== 'failedNeedsAttention' && job.state !== 'dismissed'))
      throw new Error('This deletion is no longer awaiting review')
    const {reviewConfirmedChildDeletion} = await import('@shm/shared/utils/confirmed-child-deletion')
    return reviewConfirmedChildDeletion(
      {request: seedClient.request as UniversalClient['request']},
      {
        parentDocumentId: getCleanupJobParent(job).id,
        sourceDocumentId: job.source?.id,
        approvedSubtree: job.approvedSubtree,
        authorizingParentVersion: job.authorizingParentVersion,
      },
    )
  }),
  confirmDeletion: t.procedure
    .input(
      z.object({jobId: z.string(), approvedSubtree: z.array(z.object({id: z.string(), version: z.string()})).min(1)}),
    )
    .mutation(async ({input}) => {
      const job = getPublicSnapshot().jobs.find((job) => job.id === input.jobId)
      if (
        !job ||
        job.operation !== 'delete-child' ||
        (job.state !== 'failedNeedsAttention' && job.state !== 'dismissed')
      )
        throw new Error('This deletion is no longer awaiting review')
      const {reviewConfirmedChildDeletion} = await import('@shm/shared/utils/confirmed-child-deletion')
      const current = await reviewConfirmedChildDeletion(
        {request: seedClient.request as UniversalClient['request']},
        {
          parentDocumentId: getCleanupJobParent(job).id,
          sourceDocumentId: job.source?.id,
          approvedSubtree: job.approvedSubtree,
          authorizingParentVersion: job.authorizingParentVersion,
        },
      )
      if (
        current.length !== input.approvedSubtree.length ||
        current.some(
          (document) =>
            !input.approvedSubtree.some(
              (approved) => approved.id === document.id && approved.version === document.version,
            ),
        )
      )
        throw new Error('The deletion scope changed again. Review the current scope before confirming.')
      getCleanupActor().send({type: 'cleanup.reconfirmDeletion', ...input})
      if (storageError) throw new Error(storageError)
      return getPublicSnapshot()
    }),
  dismiss: t.procedure.input(z.object({jobId: z.string()})).mutation(({input}) => {
    if (storageError) throw new Error(storageError)
    getCleanupActor().send({type: 'cleanup.dismiss', jobId: input.jobId})
    if (storageError) throw new Error(storageError)
    return getPublicSnapshot()
  }),
  clearDismissed: t.procedure.mutation(() => {
    if (storageError) throw new Error(storageError)
    getCleanupActor().send({type: 'cleanup.clearDismissed'})
    if (storageError) throw new Error(storageError)
    return getPublicSnapshot()
  }),
  getSnapshot: t.procedure.query(() => ({...getPublicSnapshot(), storageError})),
  release: t.procedure
    .input(z.object({jobId: z.string(), authorizingParentVersion: z.string().optional()}))
    .mutation(({input}) => {
      getCleanupActor().send({type: 'cleanup.release', ...input})
      if (storageError) throw new Error(storageError)
      return getPublicSnapshot()
    }),
  reportConflict: t.procedure.input(z.object({jobId: z.string(), error: z.string()})).mutation(({input}) => {
    getCleanupActor().send({type: 'cleanup.needsAttention', ...input})
    return getPublicSnapshot()
  }),
  enqueue: t.procedure
    .input(
      z.object({
        operation: z.enum(['remove', 'add', 'rewrite', 'delete-child']).optional(),
        deletedDocumentId: z.string().optional(),
        sourceDocumentId: z.string().optional(),
        targetDocumentId: z.string().optional(),
        parentDocumentId: z.string().optional(),
        signingAccountUid: z.string(),
        capabilityId: z.string().optional(),
        awaitingPrimary: z
          .object({
            documentId: z.string(),
            expectedVersion: z.string().optional(),
            expectedGenesis: z.string().optional(),
            expectedType: z.enum(['document', 'redirect', 'tombstone']),
            targetDocumentId: z.string().optional(),
          })
          .optional(),
        childDraftId: z.string().optional(),
        targetBlockId: z.string().optional(),
        approvedSubtree: z.array(z.object({id: z.string(), version: z.string()})).optional(),
        authorizingParentVersion: z.string().optional(),
      }),
    )
    .mutation(async ({input}) => {
      const operation = input.operation || 'remove'
      const parent = input.parentDocumentId
        ? {id: input.parentDocumentId}
        : input.deletedDocumentId
          ? getParentDocumentId(input.deletedDocumentId)
          : null
      if (!parent) return {enqueued: false, reason: 'no-parent' as const}
      const sourceDocumentId = input.sourceDocumentId || input.deletedDocumentId
      const targetDocumentId = input.targetDocumentId

      const intentId = input.awaitingPrimary ? nanoid(16) : undefined
      const jobId = cleanupJobId({
        targetBlockId: input.targetBlockId,
        intentId,
        operation,
        deletedDocumentId: input.deletedDocumentId,
        sourceDocumentId,
        targetDocumentId,
        parentDocumentId: parent.id,
        signingAccountUid: input.signingAccountUid,
      })
      if (getPublicSnapshot().jobs.some((job) => job.id === jobId && isDocumentCardCleanupJobActive(job))) {
        return {enqueued: false, reason: 'duplicate' as const, jobId}
      }

      getCleanupActor().send({
        type: 'cleanup.enqueue',
        intentId,
        operation,
        deletedDocumentId: input.deletedDocumentId,
        sourceDocumentId,
        targetDocumentId,
        parentDocumentId: parent.id,
        signingAccountUid: input.signingAccountUid,
        capabilityId: input.capabilityId,
        awaitingPrimary: input.awaitingPrimary,
        childDraftId: input.childDraftId,
        targetBlockId: input.targetBlockId,
        approvedSubtree: input.approvedSubtree,
        authorizingParentVersion: input.authorizingParentVersion,
      } as any)
      if (storageError) throw new Error(storageError)
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
