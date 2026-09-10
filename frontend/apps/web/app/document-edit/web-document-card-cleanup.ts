import {reconcileChildRemovalIntent} from '@shm/shared/utils/confirmed-child-deletion'
import {getCleanupJobParent} from '@shm/shared/models/document-card-cleanup-machine'
import {createWebCleanupWorker} from './web-cleanup-worker'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {unpackHmId} from '@seed-hypermedia/client/hm-types'
import {
  applyDocumentCardCleanupToBlockNodes,
  verifyDocumentCleanupPrimary,
  planDocumentCardAppend,
  planDocumentCardRemoval,
  planDocumentCardRewrite,
} from '@shm/shared/utils/document-card-cleanup'
import {
  executeConfirmedChildDeletion,
  resolveDirectDocumentReferences,
} from '@shm/shared/utils/confirmed-child-deletion'
import {rebaseDocumentReferenceDraft, findPublishedCardPosition} from '@shm/shared/utils/document-reference-rebase'
import {queryKeys} from '@shm/shared/models/query-keys'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import type {UniversalClient} from '@shm/shared/universal-client'
import {
  CLEANUP_MACHINE_STORAGE_KEY,
  CLEANUP_STORAGE_KEY,
  cleanupJobId,
  createDocumentCardCleanupCoordinatorMachine,
  DocumentCardCleanupJob,
  DocumentCardCleanupOperation,
  DocumentCardCleanupStore,
  getPublicDocumentCardCleanupSnapshot,
  normalizeDocumentCardCleanupStore,
} from '@shm/shared/models/document-card-cleanup-machine'
import {createActor} from 'xstate'
import {nanoid} from 'nanoid'
import {
  getWebDocDraft,
  listWebDocDraftsForAccount,
  putWebDocDraft,
  compareAndSwapWebDocDraft,
  type WebDocDraft,
} from './web-draft-db'

type WebCleanupDeps = {
  client: Pick<UniversalClient, 'request'> & {
    publishDocument?: UniversalClient['publishDocument']
    publish?: UniversalClient['publish']
    getSigner?: UniversalClient['getSigner']
  }
}

type EnqueueWebDocumentCardCleanupInput = {
  awaitingPrimary?: DocumentCardCleanupJob['awaitingPrimary']
  operation?: DocumentCardCleanupOperation
  deletedDocumentId?: string
  sourceDocumentId?: string
  targetDocumentId?: string
  parentDocumentId?: string
  signingAccountUid: string
  capabilityId?: string
  childDraftId?: string
  targetBlockId?: string
  approvedSubtree?: Array<{id: string; version: string}>
  authorizingParentVersion?: string
}

const WEB_CLEANUP_MACHINE_STORAGE_KEY = `Web${CLEANUP_MACHINE_STORAGE_KEY}`
const WEB_CLEANUP_STORAGE_KEY = `Web${CLEANUP_STORAGE_KEY}`
const CLEANUP_STATUS_QUERY_KEY = ['web-document-card-cleanup']

let scheduledRun: ReturnType<typeof setTimeout> | null = null
let hasStarted = false
let cleanupActor: ReturnType<typeof createActor<any>> | null = null
let cleanupDeps: WebCleanupDeps | null = null
let worker: ReturnType<typeof createWebCleanupWorker> | null = null
let workerError: string | undefined
let removeStorageListener: (() => void) | undefined
const COMMAND_PREFIX = 'WebDocumentCardCleanupCommand-v001:'
let lastCommandTimestamp = 0
const hasBrowserStorage = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined'

const memoryStore = new Map<string, unknown>()

function getStoredValue<T>(key: string): T | undefined {
  if (typeof localStorage === 'undefined') return memoryStore.get(key) as T | undefined
  const raw = localStorage.getItem(key)
  return raw ? (JSON.parse(raw) as T) : undefined
}

function setStoredValue(key: string, value: unknown) {
  if (typeof localStorage === 'undefined') {
    memoryStore.set(key, value)
    return
  }
  localStorage.setItem(key, JSON.stringify(value))
}

function pathEquals(a: string[] | null | undefined, b: string[] | null | undefined) {
  const left = a || []
  const right = b || []
  if (left.length !== right.length) return false
  return left.every((segment, index) => segment === right[index])
}

function getParentDocumentId(documentId: string) {
  const id = unpackHmId(documentId)
  if (!id) throw new Error(`Invalid document id: ${documentId}`)
  const path = id.path || []
  if (path.length === 0) return null
  const parentPath = path.slice(0, -1)
  return {
    uid: id.uid,
    path: parentPath,
    id: hmId(id.uid, {path: parentPath}).id,
  }
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

async function loadParentDraft(parentDocumentId: string): Promise<(WebDocDraft & {id: string}) | null> {
  const parent = unpackHmId(parentDocumentId)
  if (!parent) throw new Error(`Invalid parent document id: ${parentDocumentId}`)

  const drafts = await listWebDocDraftsForAccount(parent.uid)
  const draft =
    drafts.find((draft) => {
      if (draft.docId === parentDocumentId) return true
      return draft.editUid === parent.uid && pathEquals(draft.editPath, parent.path || [])
    }) || null
  return draft ? {...draft, id: draft.draftId} : null
}

async function reconcileParentDraft(job: DocumentCardCleanupJob, publishedDocument: HMDocument) {
  const found = await loadParentDraft(getCleanupJobParent(job).id)
  if (!found) return
  const {id: _id, ...draft} = found
  let base = draft.baseBlocks
  if (!base) {
    if (!draft.deps.length) throw new Error('Parent draft has no published baseline')
    const parent = getCleanupJobParent(job)
    const resource = await cleanupDeps!.client.request('Resource', {...parent, version: draft.deps.join('.')})
    if (resource.type !== 'document') throw new Error('Cannot load the parent draft baseline')
    base = resource.document.content || []
  }
  const result = rebaseDocumentReferenceDraft(
    {...job, sourceDocumentId: job.source?.id, targetDocumentId: job.target?.id},
    base,
    draft.content,
    publishedDocument.content || [],
  )
  const replacement = {
    ...draft,
    ...result,
    removedChildDocumentIds: reconcileChildRemovalIntent(
      {operation: job.operation, sourceDocumentId: job.source?.id, targetDocumentId: job.target?.id},
      draft.removedChildDocumentIds ?? [],
    ),
    baseBlocks: publishedDocument.content || [],
    deps: publishedDocument.version.split('.'),
    updatedAt: Date.now(),
  }
  if (!(await compareAndSwapWebDocDraft(draft, replacement))) {
    throw new Error('Parent draft changed while reconciling; retrying with the latest edits')
  }
  invalidateQueries(['web-doc-draft', draft.docId], {refetchType: 'all'})
  invalidateQueries([queryKeys.DRAFT, draft.draftId], {refetchType: 'all'})
  invalidateQueries([queryKeys.DRAFTS_LIST])
  invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
  dispatchWebDraftExternallyModified({
    jobId: job.id,
    maintenanceRevision: (draft.maintenanceRevision ?? 0) + 1,
    cardBlockId: job.cardBlockId,
    childDraftId: job.childDraftId,
    targetBlockId: job.targetBlockId,
    draftId: draft.draftId,
    operation: getJobOperation(job),
    deletedDocumentId: job.source?.id,
    sourceDocumentId: getJobSourceDocumentId(job),
    targetDocumentId: getJobTargetDocumentId(job),
    previousContent: draft.content,
    publishedDocument,
  })
}

async function loadParentDocument(
  client: WebCleanupDeps['client'],
  parentDocumentId: string,
): Promise<HMDocument | null> {
  const parent = unpackHmId(parentDocumentId)
  if (!parent) throw new Error(`Invalid parent document id: ${parentDocumentId}`)
  const resource = await client.request('Resource', parent)
  if (resource.type === 'document') return resource.document
  if (resource.type === 'not-found' || resource.type === 'tombstone') return null
  throw new Error(`Cannot cleanup parent card: resource is ${resource.type}`)
}

async function publishParentUpdate(
  client: WebCleanupDeps['client'],
  job: DocumentCardCleanupJob,
  parentDocument: HMDocument,
  changes: any[],
) {
  if (!client.publishDocument) throw new Error('Universal client does not provide publishDocument')
  const parent = getCleanupJobParent(job)
  if (!parent) throw new Error(`Invalid parent document id: ${getCleanupJobParent(job).id}`)
  const currentGeneration = parentDocument.generationInfo?.generation
  const generation = currentGeneration == null ? undefined : Number(currentGeneration)
  await client.publishDocument({
    account: parent.uid,
    signerAccountUid: job.signingAccountUid,
    path: hmIdPathToEntityQueryPath(parent.path || []),
    baseVersion: parentDocument.version,
    genesis: parentDocument.genesis,
    generation,
    changes,
    capability: job.capabilityId,
  })
  return 'published' as const
}

function invalidateParent(parentDocumentId: string) {
  invalidateQueries([queryKeys.ENTITY, parentDocumentId], {refetchType: 'all'})
  invalidateQueries([queryKeys.RESOLVED_ENTITY, parentDocumentId], {refetchType: 'all'})
  invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentDocumentId, 'Children'], {refetchType: 'all'})
  invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentDocumentId, 'AllDescendants'], {refetchType: 'all'})
  invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, parentDocumentId], {refetchType: 'all'})
}

function createCleanupActor(deps: WebCleanupDeps) {
  const persistedSnapshot = getStoredValue<{context?: {jobs?: DocumentCardCleanupJob[]}}>(
    WEB_CLEANUP_MACHINE_STORAGE_KEY,
  )
  const previousStore = normalizeDocumentCardCleanupStore(
    getStoredValue<DocumentCardCleanupStore>(WEB_CLEANUP_STORAGE_KEY) ?? {
      coordinatorState: 'idle',
      jobs: persistedSnapshot?.context?.jobs || [],
    },
  )
  const machine = createDocumentCardCleanupCoordinatorMachine({
    now: () => Date.now(),
    getParentDocumentId,
    scheduleCleanup: scheduleWebDocumentCardCleanup,
    loadParentDraft: (job) => loadParentDraft(getCleanupJobParent(job).id) as any,
    loadParentDocument: (job) => loadParentDocument(deps.client, getCleanupJobParent(job).id),
    cleanupParentDraft: async () => [],
    verifyPrimaryOutcome: (job) => verifyDocumentCleanupPrimary(deps.client, job.awaitingPrimary!),
    executeConfirmedDeletion: async (job) => {
      if (workerError) throw new Error(workerError)
      if (!deps.client.publish || !deps.client.getSigner) throw new Error('Confirmed deletion is unavailable')
      await executeConfirmedChildDeletion(
        {request: deps.client.request, publish: deps.client.publish, getSigner: deps.client.getSigner},
        {...job, parentDocumentId: getCleanupJobParent(job).id, sourceDocumentId: job.source?.id},
      )
    },
    findTemporaryCard: async (job) => {
      const draft = await loadParentDraft(getCleanupJobParent(job).id)
      function find(nodes: NonNullable<HMDocument['content']>): string | undefined {
        for (const node of nodes) {
          if (node.block.type === 'Embed' && (node.block.attributes as any)?.draftId === job.childDraftId)
            return node.block.id
          const nested = find(node.children || [])
          if (nested) return nested
        }
        return undefined
      }
      const blockId = find(draft?.content || [])
      if (!blockId || !draft) return undefined
      const published = await loadParentDocument(deps.client, getCleanupJobParent(job).id)
      const position = findPublishedCardPosition(published?.content || [], draft.content, blockId)
      return {blockId, parentId: position?.parent || '', leftSibling: position?.leftSibling || ''}
    },
    reconcileParentDraft: (job, document) => {
      if (workerError) throw new Error(workerError)
      return reconcileParentDraft(job, document as HMDocument)
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
      if (operation === 'add' && plan.changes.length && targetDocumentId) {
        const references = await resolveDirectDocumentReferences((parentDocument as HMDocument).content || [])
        if (references.ids.some((id) => id.id === targetDocumentId)) return {changes: [], removedBlockIds: []}
        if (references.unresolved.length)
          throw new Error('Cannot resolve all parent links. Review the parent references before retrying.')
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
        const target = await deps.client.request('Resource', {...targetIdentity, version: null, latest: true})
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
    publishParentUpdate: (job, parentDocument, changes) => {
      if (workerError) throw new Error(workerError)
      return publishParentUpdate(deps.client, job, parentDocument as HMDocument, changes as any[])
    },
    invalidateParent,
  })

  const actor = createActor(machine as any, {input: {jobs: previousStore.jobs}})
  actor.subscribe((snapshot) => {
    const publicSnapshot = getPublicDocumentCardCleanupSnapshot(snapshot as any)
    try {
      setStoredValue(WEB_CLEANUP_STORAGE_KEY, publicSnapshot)
    } catch (error) {
      workerError = error instanceof Error ? error.message : 'Could not save document maintenance progress.'
      // Keep an in-flight request under the lock until it settles. Effect gates below
      // prevent subsequent publication/rebase steps after persistence fails.
    }
    invalidateQueries(CLEANUP_STATUS_QUERY_KEY)
  })
  actor.start()
  return actor
}

function getCleanupActor(deps?: WebCleanupDeps) {
  if (deps) cleanupDeps = deps
  if (!cleanupDeps) throw new Error('Web document card cleanup has not been started')
  if (!cleanupActor) cleanupActor = createCleanupActor(cleanupDeps)
  return cleanupActor
}

function getPublicSnapshot() {
  if (hasBrowserStorage()) {
    const raw = getStoredValue<DocumentCardCleanupStore>(WEB_CLEANUP_STORAGE_KEY)
    return raw?.schemaVersion === 2 ? raw : normalizeDocumentCardCleanupStore(raw)
  }
  const actor = getCleanupActor()
  return getPublicDocumentCardCleanupSnapshot(actor.getSnapshot() as any)
}

function waitForRunningCleanup(actor: ReturnType<typeof createActor<any>>) {
  if ((actor.getSnapshot() as any).status === 'stopped' || (actor.getSnapshot() as any).value !== 'running')
    return Promise.resolve()
  return new Promise<void>((resolve) => {
    const sub = actor.subscribe({
      next: (snapshot: any) => {
        if (snapshot.value !== 'running') {
          sub.unsubscribe()
          resolve()
        }
      },
      complete: resolve,
      error: () => resolve(),
    })
  })
}

function scheduleWebDocumentCardCleanup(delayMs?: number | null) {
  if (scheduledRun) clearTimeout(scheduledRun)
  if (delayMs == null) return
  scheduledRun = setTimeout(() => {
    scheduledRun = null
    if (hasBrowserStorage()) void worker?.wake()
    else getCleanupActor().send({type: 'cleanup.tick'})
  }, delayMs)
}

export async function enqueueWebDocumentCardCleanup(input: EnqueueWebDocumentCardCleanupInput, deps?: WebCleanupDeps) {
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
  if (deps) cleanupDeps = deps
  const snapshot = hasBrowserStorage()
    ? getPublicSnapshot()
    : getPublicDocumentCardCleanupSnapshot(getCleanupActor(deps).getSnapshot() as any)
  if (snapshot.jobs.some((job) => job.id === jobId && !['done', 'skippedTerminal'].includes(job.state)))
    return {enqueued: false, reason: 'duplicate' as const, jobId}

  await sendCleanupCommand({
    type: 'cleanup.enqueue',
    intentId,
    awaitingPrimary: input.awaitingPrimary,
    operation,
    deletedDocumentId: input.deletedDocumentId,
    sourceDocumentId,
    targetDocumentId,
    parentDocumentId: parent.id,
    signingAccountUid: input.signingAccountUid,
    capabilityId: input.capabilityId,
    childDraftId: input.childDraftId,
    targetBlockId: input.targetBlockId,
    approvedSubtree: input.approvedSubtree,
    authorizingParentVersion: input.authorizingParentVersion,
  } as any)
  return {enqueued: true, jobId}
}

/** Starts an exclusive, freshly hydrated worker; followers only persist commands. */
export function startWebDocumentCardCleanupCoordinator(deps: WebCleanupDeps) {
  cleanupDeps = deps
  if (hasStarted) return
  if (!hasBrowserStorage()) {
    hasStarted = true
    getCleanupActor(deps).send({type: 'cleanup.tick'} as any)
    return
  }
  if (!navigator.locks)
    throw new Error(
      'Automatic document maintenance requires browser Web Locks. Pending actions are saved on this device; use a supported browser to recover them.',
    )
  hasStarted = true
  worker = createWebCleanupWorker({
    locks: navigator.locks,
    onError: (error) => {
      // Global storage failures cannot be repaired by a zero-delay job retry loop.
      if (scheduledRun) clearTimeout(scheduledRun)
      scheduledRun = null
      workerError = error instanceof Error ? error.message : 'Document maintenance could not run.'
      invalidateQueries(CLEANUP_STATUS_QUERY_KEY)
    },
    run: async () => {
      workerError = undefined
      // No other tab can publish or write the queue during this entire session.
      const actor = createCleanupActor(cleanupDeps!)
      cleanupActor = actor
      try {
        if (workerError) throw new Error(workerError)
        const keys = Object.keys(localStorage)
          .filter((key) => key.startsWith(COMMAND_PREFIX))
          .sort()
        for (const key of keys) {
          const raw = localStorage.getItem(key)
          if (!raw) continue
          actor.send(JSON.parse(raw))
          if (workerError) throw new Error(workerError)
          // Explicitly persist before acknowledging: a failed storage write must keep the intent.
          setStoredValue(WEB_CLEANUP_STORAGE_KEY, getPublicDocumentCardCleanupSnapshot(actor.getSnapshot() as any))
          localStorage.removeItem(key)
        }
        actor.send({type: 'cleanup.tick'})
        await waitForRunningCleanup(actor)
        if (workerError) throw new Error(workerError)
      } finally {
        actor.stop()
        cleanupActor = null
      }
    },
  })
  const onStorage = (event: StorageEvent) => {
    if (event.key === WEB_CLEANUP_STORAGE_KEY) {
      invalidateQueries(CLEANUP_STATUS_QUERY_KEY)
      // The worker may run in another tab while this tab is viewing a child.
      // Refresh its inactive parent/draft caches too, before returning to them.
      try {
        const previous = JSON.parse(event.oldValue || '{"jobs":[]}') as DocumentCardCleanupStore
        const next = JSON.parse(event.newValue || '{"jobs":[]}') as DocumentCardCleanupStore
        for (const job of next.jobs) {
          if (!job.publishedVersion) continue
          const oldJob = previous.jobs.find((candidate) => candidate.id === job.id)
          if (oldJob?.publishedVersion === job.publishedVersion && oldJob?.state === job.state) continue
          const parentId = getCleanupJobParent(job).id
          invalidateParent(parentId)
          invalidateQueries(['web-doc-draft', parentId], {refetchType: 'all'})
        }
      } catch (error) {
        console.error('Could not refresh document maintenance updates', error)
      }
    }
    if (event.key?.startsWith(COMMAND_PREFIX) && event.newValue) void worker?.wake()
  }
  window.addEventListener('storage', onStorage)
  removeStorageListener = () => window.removeEventListener('storage', onStorage)
  void worker.wake()
}

async function sendCleanupCommand(event: {type: string; [key: string]: unknown}) {
  if (!hasBrowserStorage()) {
    const actor = getCleanupActor()
    actor.send(event)
    actor.send({type: 'cleanup.tick'})
    return
  }
  // Separate keys avoid read/modify/write races between concurrent publishers.
  lastCommandTimestamp = Math.max(lastCommandTimestamp + 1, Date.now() * 1000)
  localStorage.setItem(
    `${COMMAND_PREFIX}${lastCommandTimestamp.toString().padStart(19, '0')}:${nanoid()}`,
    JSON.stringify(event),
  )
  if (cleanupDeps && !hasStarted) {
    try {
      startWebDocumentCardCleanupCoordinator(cleanupDeps)
    } catch (error) {
      workerError = error instanceof Error ? error.message : 'Document maintenance could not start.'
    }
  }
  void worker?.wake()
  invalidateQueries(CLEANUP_STATUS_QUERY_KEY)
}

/** Reports worker/storage failures separately from an individual parent action. */
export function getWebDocumentCardCleanupWorkerError() {
  return workerError
}

/** Releases a pre-persisted job only after its primary document action succeeds. */
export async function releaseWebDocumentCardCleanup(jobId: string) {
  await sendCleanupCommand({type: 'cleanup.release', jobId})
}

/** Returns durable parent-reference maintenance jobs for recovery UI. */
export function getWebDocumentCardCleanupSnapshot() {
  return getPublicSnapshot()
}

/** Queues a fresh attempt for a failed maintenance job without waiting for execution. */
export async function retryWebDocumentCardCleanup(jobId: string) {
  await sendCleanupCommand({type: 'cleanup.retry', jobId})
  return getPublicSnapshot()
}

/** Retains conflicts discovered by an active editor as user-visible recovery work. */
export async function reportWebDocumentCardCleanupConflict(jobId: string, error: string) {
  await sendCleanupCommand({type: 'cleanup.needsAttention', jobId, error})
}

/** Loads a fresh, identity-checked subtree for explicit destructive consent renewal. */
export async function reviewWebDocumentCardCleanupDeletion(jobId: string) {
  const job = getPublicSnapshot().jobs.find((job) => job.id === jobId)
  if (
    !job ||
    job.operation !== 'delete-child' ||
    (job.state !== 'failedNeedsAttention' && job.state !== 'dismissed') ||
    !cleanupDeps
  )
    throw new Error('This deletion is no longer awaiting review')
  const {reviewConfirmedChildDeletion} = await import('@shm/shared/utils/confirmed-child-deletion')
  return reviewConfirmedChildDeletion(cleanupDeps.client, {
    parentDocumentId: getCleanupJobParent(job).id,
    sourceDocumentId: job.source?.id,
    approvedSubtree: job.approvedSubtree,
    authorizingParentVersion: job.authorizingParentVersion,
  })
}

/** Revalidates the exact reviewed versions before persisting renewed deletion consent. */
export async function confirmWebDocumentCardCleanupDeletion(
  jobId: string,
  approvedSubtree: Array<{id: string; version: string}>,
) {
  const current = await reviewWebDocumentCardCleanupDeletion(jobId)
  if (
    !approvedSubtree.length ||
    current.length !== approvedSubtree.length ||
    current.some(
      (document) =>
        !approvedSubtree.some((approved) => approved.id === document.id && approved.version === document.version),
    )
  ) {
    throw new Error('The deletion scope changed again. Review the current scope before confirming.')
  }
  await sendCleanupCommand({type: 'cleanup.reconfirmDeletion', jobId, approvedSubtree})
}

/** Dismisses a failed maintenance job without changing the user's document action. */
export async function dismissWebDocumentCardCleanup(jobId: string) {
  await sendCleanupCommand({type: 'cleanup.dismiss', jobId})
  return getPublicSnapshot()
}

/** Permanently removes dismissed history only; active maintenance stays queued. */
export async function clearDismissedWebDocumentCardCleanup() {
  await sendCleanupCommand({type: 'cleanup.clearDismissed'})
  return getPublicSnapshot()
}

export function getWebDocumentCardCleanupSnapshotForTest() {
  return getPublicSnapshot()
}

export async function runNextWebDocumentCleanupJobForTest(options: {now?: () => number} = {}) {
  if (hasBrowserStorage()) {
    await worker?.wake()
    return
  }
  const actor = getCleanupActor()
  actor.send({type: 'cleanup.tick', now: options.now?.() ?? Date.now()} as any)
  await waitForRunningCleanup(actor)
}

export const runNextWebDocumentCardCleanupForTest = runNextWebDocumentCleanupJobForTest

export type WebDraftExternallyModifiedEvent = {
  type: 'web_draft_externally_modified'
  draftId: string
  jobId?: string
  maintenanceRevision?: number
  cardBlockId?: string
  childDraftId?: string
  targetBlockId?: string
  source: 'document-card-cleanup'
  operation: DocumentCardCleanupOperation
  deletedDocumentId?: string
  sourceDocumentId?: string
  targetDocumentId?: string
  previousContent?: HMDocument['content']
  publishedDocument?: HMDocument
  changedBlockIds?: string[]
}

function dispatchWebDraftExternallyModified(input: Omit<WebDraftExternallyModifiedEvent, 'type' | 'source'>) {
  const event: WebDraftExternallyModifiedEvent = {
    type: 'web_draft_externally_modified',
    source: 'document-card-cleanup',
    ...input,
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<WebDraftExternallyModifiedEvent>('web_draft_externally_modified', {detail: event}),
    )
  }
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('web-document-card-cleanup')
    channel.postMessage(event)
    channel.close()
  }
}

export function subscribeWebDraftExternallyModified(handler: (event: WebDraftExternallyModifiedEvent) => void) {
  const onWindowEvent = (event: Event) => {
    handler((event as CustomEvent<WebDraftExternallyModifiedEvent>).detail)
  }
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('web-document-card-cleanup') : null
  if (typeof window !== 'undefined') window.addEventListener('web_draft_externally_modified', onWindowEvent)
  channel?.addEventListener('message', (event) => handler(event.data as WebDraftExternallyModifiedEvent))
  return () => {
    if (typeof window !== 'undefined') window.removeEventListener('web_draft_externally_modified', onWindowEvent)
    channel?.close()
  }
}

export async function loadWebCleanupDraft(draftId: string) {
  return getWebDocDraft(draftId)
}

export type {EnqueueWebDocumentCardCleanupInput, WebCleanupDeps}

export function resetWebDocumentCardCleanupForTest() {
  worker?.stop()
  worker = null
  workerError = undefined
  removeStorageListener?.()
  removeStorageListener = undefined
  if (scheduledRun) clearTimeout(scheduledRun)
  scheduledRun = null
  cleanupActor?.stop()
  cleanupActor = null
  cleanupDeps = null
  hasStarted = false
  memoryStore.clear()
}
