import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {unpackHmId} from '@seed-hypermedia/client/hm-types'
import {
  applyDocumentCardCleanupToBlockNodes,
  planDocumentCardAppend,
  planDocumentCardRemoval,
  planDocumentCardRewrite,
} from '@shm/shared/utils/document-card-cleanup'
import {queryKeys} from '@shm/shared/models/query-keys'
import {invalidateQueries, updateQueriesDataByKey} from '@shm/shared/models/query-client'
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
import {getWebDocDraft, listWebDocDraftsForAccount, putWebDocDraft, type WebDocDraft} from './web-draft-db'

type WebCleanupDeps = {
  client: Pick<UniversalClient, 'request'> & {publishDocument?: UniversalClient['publishDocument']}
}

type EnqueueWebDocumentCardCleanupInput = {
  operation?: DocumentCardCleanupOperation
  deletedDocumentId?: string
  sourceDocumentId?: string
  targetDocumentId?: string
  parentDocumentId?: string
  signingAccountUid: string
  capabilityId?: string
}

const WEB_CLEANUP_MACHINE_STORAGE_KEY = `Web${CLEANUP_MACHINE_STORAGE_KEY}`
const WEB_CLEANUP_STORAGE_KEY = `Web${CLEANUP_STORAGE_KEY}`
const CLEANUP_STATUS_QUERY_KEY = ['web-document-card-cleanup']

let scheduledRun: ReturnType<typeof setTimeout> | null = null
let hasStarted = false
let cleanupActor: ReturnType<typeof createActor<any>> | null = null
let cleanupDeps: WebCleanupDeps | null = null
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
  return job.sourceDocumentId || job.deletedDocumentId
}

function getJobTargetDocumentId(job: DocumentCardCleanupJob) {
  return job.targetDocumentId || job.sourceDocumentId || job.deletedDocumentId
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

async function cleanupParentDraft(job: DocumentCardCleanupJob, draft: WebDocDraft): Promise<string[]> {
  const operation = getJobOperation(job)
  const sourceDocumentId = getJobSourceDocumentId(job)
  const targetDocumentId = getJobTargetDocumentId(job)
  const result = applyDocumentCardCleanupToBlockNodes(draft.content || [], {
    operation,
    deletedDocumentId: job.deletedDocumentId,
    sourceDocumentId,
    targetDocumentId,
    parentDocumentId: job.parentDocumentId,
    newBlockId: nanoid(10),
  } as any)

  if (!result.changedBlockIds.length) return []

  await putWebDocDraft({
    ...draft,
    content: result.content,
    updatedAt: Date.now(),
  })
  invalidateQueries(['web-doc-draft', draft.docId])
  invalidateQueries([queryKeys.DRAFT, draft.draftId])
  invalidateQueries([queryKeys.DRAFTS_LIST])
  invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
  dispatchWebDraftExternallyModified({
    draftId: draft.draftId,
    operation,
    deletedDocumentId: job.deletedDocumentId,
    sourceDocumentId,
    targetDocumentId,
    changedBlockIds: result.changedBlockIds,
  })
  return result.changedBlockIds
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
  const parent = unpackHmId(job.parentDocumentId)
  if (!parent) throw new Error(`Invalid parent document id: ${job.parentDocumentId}`)
  const currentGeneration = parentDocument.generationInfo?.generation
  const generation = Math.max(Date.now(), currentGeneration == null ? 1 : Number(currentGeneration) + 1)
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
  updatePublishedParentCache(job, parentDocument)
  return 'published' as const
}

function updatePublishedParentCache(job: DocumentCardCleanupJob, parentDocument: HMDocument) {
  const operation = getJobOperation(job)
  const sourceDocumentId = getJobSourceDocumentId(job)
  const targetDocumentId = getJobTargetDocumentId(job)
  const result = applyDocumentCardCleanupToBlockNodes(parentDocument.content || [], {
    operation,
    deletedDocumentId: job.deletedDocumentId,
    sourceDocumentId,
    targetDocumentId,
    parentDocumentId: job.parentDocumentId,
    newBlockId: nanoid(10),
  } as any)
  if (!result.changedBlockIds.length) return

  updateQueriesDataByKey([queryKeys.ENTITY, job.parentDocumentId], (data) => {
    if (!data || typeof data !== 'object' || (data as any).type !== 'document') return data
    return {
      ...(data as any),
      document: {
        ...(data as any).document,
        content: result.content,
      },
    }
  })
}

function invalidateParent(parentDocumentId: string) {
  invalidateQueries([queryKeys.ENTITY, parentDocumentId])
  invalidateQueries([queryKeys.RESOLVED_ENTITY, parentDocumentId])
  invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentDocumentId, 'Children'])
  invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentDocumentId, 'AllDescendants'])
  invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, parentDocumentId])
}

function createCleanupActor(deps: WebCleanupDeps) {
  const persistedSnapshot = getStoredValue(WEB_CLEANUP_MACHINE_STORAGE_KEY)
  const previousStore = normalizeDocumentCardCleanupStore(
    getStoredValue<DocumentCardCleanupStore>(WEB_CLEANUP_STORAGE_KEY),
  )
  const machine = createDocumentCardCleanupCoordinatorMachine({
    now: () => Date.now(),
    getParentDocumentId,
    scheduleCleanup: scheduleWebDocumentCardCleanup,
    loadParentDraft: (job) => loadParentDraft(job.parentDocumentId) as any,
    loadParentDocument: (job) => loadParentDocument(deps.client, job.parentDocumentId),
    cleanupParentDraft: (job, draft) => cleanupParentDraft(job, draft as unknown as WebDocDraft),
    planPublishedParent: (job, parentDocument) => {
      const operation = getJobOperation(job)
      const sourceDocumentId = getJobSourceDocumentId(job)
      const targetDocumentId = getJobTargetDocumentId(job)
      const plan =
        operation === 'add' && targetDocumentId
          ? planDocumentCardAppend(parentDocument as any, job.parentDocumentId, targetDocumentId, nanoid(10))
          : operation === 'rewrite' && sourceDocumentId && targetDocumentId
            ? planDocumentCardRewrite(parentDocument as any, sourceDocumentId, targetDocumentId)
            : sourceDocumentId
              ? planDocumentCardRemoval(parentDocument as any, sourceDocumentId)
              : {changes: [], removedBlockIds: []}
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
    publishParentUpdate: (job, parentDocument, changes) =>
      publishParentUpdate(deps.client, job, parentDocument as HMDocument, changes as any[]),
    invalidateParent,
  })

  const actor = createActor(
    machine as any,
    persistedSnapshot
      ? ({snapshot: persistedSnapshot as any, input: {jobs: previousStore.jobs}} as any)
      : {input: {jobs: previousStore.jobs}},
  )
  actor.subscribe((snapshot) => {
    const publicSnapshot = getPublicDocumentCardCleanupSnapshot(snapshot as any)
    setStoredValue(WEB_CLEANUP_MACHINE_STORAGE_KEY, actor.getPersistedSnapshot())
    setStoredValue(WEB_CLEANUP_STORAGE_KEY, publicSnapshot)
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
  const actor = getCleanupActor()
  return getPublicDocumentCardCleanupSnapshot(actor.getSnapshot() as any)
}

function waitForRunningCleanup(actor: ReturnType<typeof createActor<any>>) {
  if ((actor.getSnapshot() as any).value !== 'running') return Promise.resolve()
  return new Promise<void>((resolve) => {
    const sub = actor.subscribe((snapshot: any) => {
      if ((snapshot as any).value !== 'running') {
        sub.unsubscribe()
        resolve()
      }
    })
  })
}

function scheduleWebDocumentCardCleanup(delayMs?: number | null) {
  if (scheduledRun) clearTimeout(scheduledRun)
  if (delayMs == null) return
  scheduledRun = setTimeout(() => {
    scheduledRun = null
    getCleanupActor().send({type: 'cleanup.tick'})
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
  const jobId = cleanupJobId({
    operation,
    deletedDocumentId: input.deletedDocumentId,
    sourceDocumentId,
    targetDocumentId,
    parentDocumentId: parent.id,
    signingAccountUid: input.signingAccountUid,
  })
  const actor = getCleanupActor(deps)
  const snapshot = getPublicDocumentCardCleanupSnapshot(actor.getSnapshot() as any)
  if (snapshot.jobs.some((job) => job.id === jobId)) return {enqueued: false, reason: 'duplicate' as const, jobId}

  actor.send({
    type: 'cleanup.enqueue',
    operation,
    deletedDocumentId: input.deletedDocumentId,
    sourceDocumentId,
    targetDocumentId,
    parentDocumentId: parent.id,
    signingAccountUid: input.signingAccountUid,
    capabilityId: input.capabilityId,
  } as any)
  actor.send({type: 'cleanup.tick'} as any)
  await waitForRunningCleanup(actor)
  return {enqueued: true, jobId}
}

export function startWebDocumentCardCleanupCoordinator(deps: WebCleanupDeps) {
  getCleanupActor(deps)
  if (hasStarted) return
  hasStarted = true
  getCleanupActor().send({type: 'cleanup.tick'} as any)
}

export function getWebDocumentCardCleanupSnapshotForTest() {
  return getPublicSnapshot()
}

export async function runNextWebDocumentCleanupJobForTest(options: {now?: () => number} = {}) {
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

export const runNextWebDocumentCardCleanupForTest = runNextWebDocumentCleanupJobForTest

export type WebDraftExternallyModifiedEvent = {
  type: 'web_draft_externally_modified'
  draftId: string
  source: 'document-card-cleanup'
  operation: DocumentCardCleanupOperation
  deletedDocumentId?: string
  sourceDocumentId?: string
  targetDocumentId?: string
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
  if (scheduledRun) clearTimeout(scheduledRun)
  scheduledRun = null
  cleanupActor?.stop()
  cleanupActor = null
  cleanupDeps = null
  hasStarted = false
  memoryStore.clear()
}
