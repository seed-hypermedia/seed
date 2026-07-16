/**
 * Web-side actor implementations for the document state machine.
 *
 * The shared `documentMachine` delegates three side-effects to host-provided actors:
 *   - `writeDraft`     — persist a draft (web: IndexedDB)
 *   - `publishDocument` — diff editor blocks vs baseline and submit a signed change
 *   - `pushDocument`    — push to other servers after publish (web: no-op in V1)
 *
 * `createWebDocumentMachine` builds a `documentMachine.provide({actors})` instance,
 * closing over the host's editor accessor + universal client + signer factory.
 */

import {signDocumentChange} from '@seed-hypermedia/client'
import {ResourceVisibility} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {editorBlocksToHMBlockNodes} from '@seed-hypermedia/client/editorblock-to-hmblock'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {HMDocument, HMMetadata, HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  documentMachine,
  retargetQueryBlockIncludesForPublish,
  type DiscardDraftInput,
  type EditorAccessor,
  type PublishInput,
  type PushDocumentInput,
  type WriteDraftInput,
  type WriteDraftOutput,
} from '@shm/shared/models/document-machine'
import {invalidateAfterPublish} from '@shm/shared/models/post-publish-cache'
import {invalidateQueries, refetchQueriesByKey} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import type {UniversalClient} from '@shm/shared/universal-client'
import {
  compareBlocksWithMap,
  createBlocksMap,
  extractDeletes,
  getDocAttributeChanges,
} from '@shm/shared/utils/document-changes'
import {getNavigationChanges} from '@shm/shared/utils/navigation-changes'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {computeInlineDraftPublishPath} from '@shm/shared/utils/publish-paths'
import {nanoid} from 'nanoid'
import {fromPromise} from 'xstate'

import {deleteWebDocDraft, getWebDocDraft, putWebDocDraft, type WebDocDraft} from './web-draft-db'
import {enqueueWebDocumentCardCleanup} from './web-document-card-cleanup'
import {getWebDraftPlaceholderId, isWebDraftPlaceholderPath, isWebPrivateDraftPlaceholderPath} from './web-draft-path'

/** @deprecated Use `EditorAccessor` from `@shm/shared/models/document-machine` instead. */
export type WebEditorAccessor = EditorAccessor

export interface CreateWebDocumentMachineDeps {
  /** Document this machine instance is bound to. */
  docId: UnpackedHypermediaId
  /** Returns the editor accessor (or null when the editor isn't mounted yet). */
  getEditor: () => EditorAccessor | null
  /** Universal client used for publish + refetch on the web. */
  client: UniversalClient
  /** Returns a signer for the given vault-delegated account UID. */
  getSigner: (accountUid: string) => HMSigner
  /** Capability CID granting write access; undefined for owner publishes. */
  getCapabilityCid: () => string | undefined
  /** Called after publish succeeds with the new document. */
  onPublishSuccess?: (newDocument: HMDocument) => void
}

/**
 * Build a documentMachine wired with web actors. Caller wraps result in
 * `<DocumentMachineProvider machine={machine} input={...}>`.
 */
export function createWebDocumentMachine(deps: CreateWebDocumentMachineDeps) {
  return documentMachine.provide({
    actors: {
      writeDraft: makeWriteDraftActor(deps),
      publishDocument: makePublishDocumentActor(deps),
      discardDraft: makeDiscardDraftActor(),
      pushDocument: fromPromise<void, PushDocumentInput>(async () => {
        // V1: no-op. Future: post to a web push endpoint.
      }),
    },
  })
}

function makeWriteDraftActor(deps: CreateWebDocumentMachineDeps) {
  return fromPromise<WriteDraftOutput, WriteDraftInput>(async ({input}) => {
    const editor = deps.getEditor()
    const cursorPosition = editor?.getCursorPosition?.() ?? null
    const draftId = input.draftId ?? nanoid(10)
    const existingDraft = input.draftId ? await getWebDocDraft(input.draftId) : null
    // No editor mounted (e.g. an attributes-only edit from the :metadata view):
    // preserve the draft's existing content or the published blocks instead of
    // clobbering the body with an empty array.
    const content = editor
      ? editorBlocksToHMBlockNodes(editor.getTopLevelBlocks() ?? [])
      : existingDraft?.content ?? input.baseBlocks ?? []
    const currentPath = deps.docId.path ?? []
    const routeDraftId = getWebDraftPlaceholderId(currentPath)
    const isReservedRouteDraft = !!routeDraftId && routeDraftId === draftId && !existingDraft
    const isReservedPrivateDraft = isReservedRouteDraft && isWebPrivateDraftPlaceholderPath(currentPath)
    const isReservedPublicDraft = isReservedRouteDraft && !isReservedPrivateDraft
    const locationPath = isReservedPublicDraft ? currentPath.slice(0, -1) : input.locationPath
    const editPath = isReservedRouteDraft ? (isReservedPrivateDraft ? currentPath : []) : input.editPath
    const record: Omit<WebDocDraft, 'updatedAt'> = {
      draftId,
      docId: deps.docId.id,
      signingAccountId: input.signingAccountId ?? '',
      capabilityCid: existingDraft?.capabilityCid ?? deps.getCapabilityCid(),
      content,
      metadata: input.metadata ?? {},
      deps: input.deps,
      navigation: input.navigation ?? null,
      locationUid: isReservedRouteDraft ? deps.docId.uid : input.locationUid || null,
      locationPath: locationPath?.length ? locationPath : null,
      editUid: isReservedPublicDraft ? null : input.editUid || null,
      editPath: editPath?.length ? editPath : null,
      visibility:
        existingDraft?.visibility ??
        (isReservedPrivateDraft
          ? 'PRIVATE'
          : currentPath.some((segment) => segment.startsWith('-'))
            ? 'PUBLIC'
            : undefined),
      cursorPosition,
    }
    await putWebDocDraft(record)
    invalidateQueries(['web-doc-draft', deps.docId.id])
    return {id: draftId, content, cursorPosition}
  })
}

function makePublishDocumentActor(deps: CreateWebDocumentMachineDeps) {
  return fromPromise<HMDocument, PublishInput>(async ({input}) => {
    try {
      return await publishWebDocument(input, deps)
    } catch (err) {
      // SeedClientError carries the daemon's real gRPC message in `.body`; the
      // `.message` only has the HTTP statusText. Surface both so publish
      // failures show the actual cause instead of a bare "Internal Server Error".
      const body = (err as {body?: string})?.body
      console.error('[WebPublish] failed', err, body ? {serverError: body} : undefined)
      throw err
    }
  })
}

function makeDiscardDraftActor() {
  return fromPromise<void, DiscardDraftInput>(async ({input}) => {
    await discardWebDocDraft(input.draftId, input.deletedChildDraftIds)
    invalidateQueries([queryKeys.DRAFT, input.draftId])
    invalidateQueries([queryKeys.DRAFTS_LIST])
    invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
  })
}

/**
 * Algorithmic core of the publish actor. Exported for unit testing.
 *
 * Steps:
 *  1. Read the IDB draft.
 *  2. Read live editor blocks (fall back to draft.content when the editor isn't mounted).
 *  3. Fetch the latest published doc to (a) build the baseline blocks map, (b) get
 *     genesis + generation, and (c) rebase against latest heads.
 *  4. Build `DocumentChange[]`: navigation changes + metadata + block diff + deletes.
 *  5. Submit via `client.publishDocument` (universal client; signs client-side).
 *  6. Refetch the doc and return it. Delete the IDB draft.
 */
export async function publishWebDocument(input: PublishInput, deps: CreateWebDocumentMachineDeps): Promise<HMDocument> {
  const draft = await getWebDocDraft(input.draftId)
  if (!draft) throw new Error(`web publish: draft ${input.draftId} not found`)

  const editor = deps.getEditor()
  const editorBlocks = editor?.getTopLevelBlocks() ?? null
  const liveEditorBlocks: EditorBlock[] =
    editorBlocks && editorBlocks.length
      ? editorBlocks
      : hmBlocksToEditorContent(draft.content ?? [], {childrenType: 'Group'})

  const resource = await deps.client.request('Resource', deps.docId)
  const editDocument = resource.type === 'document' ? resource.document : null
  const isPrivate = draft.visibility === 'PRIVATE' || editDocument?.visibility === 'PRIVATE'
  const currentPath = deps.docId.path ?? []
  const isPlaceholderPath = isWebDraftPlaceholderPath(currentPath, draft.draftId)
  const publishPath = isPrivate
    ? currentPath
    : input.pathOverride
      ? input.pathOverride
      : !editDocument && isPlaceholderPath
        ? computeInlineDraftPublishPath(currentPath, (draft.metadata as HMMetadata).name || '', draft.draftId)
        : currentPath
  const publishedDocId =
    publishPath === currentPath ? deps.docId : hmId(deps.docId.uid, {...deps.docId, path: publishPath})
  const publishBlocks = !editDocument
    ? retargetQueryBlockIncludesForPublish(liveEditorBlocks, deps.docId, publishedDocId)
    : liveEditorBlocks
  const path = hmIdPathToEntityQueryPath(publishPath)

  const baselineMap = createBlocksMap(editDocument?.content ?? [], '')
  const blockDiff = compareBlocksWithMap(baselineMap, publishBlocks, '')
  const deleteChanges = extractDeletes(baselineMap, blockDiff.touchedBlocks)

  const navChanges = getNavigationChanges(
    draft.navigation ?? undefined,
    editDocument?.detachedBlocks?.navigation ?? null,
  )

  const metadataChanges = getDocAttributeChanges(draft.metadata as HMMetadata)

  const allChanges = [...navChanges, ...metadataChanges, ...blockDiff.changes, ...deleteChanges]

  const latestVersion = editDocument?.version ?? ''
  const baseVersion = draft.deps.length ? draft.deps.join('.') : latestVersion

  if (!deps.client.publishDocument) {
    throw new Error('Universal client does not provide publishDocument; cannot publish on web')
  }

  const signerAccountUid = input.publishAccountUid ?? draft.signingAccountId
  if (!signerAccountUid) {
    throw new Error('No signing account available for publish')
  }

  const capabilityCid = deps.getCapabilityCid() ?? draft.capabilityCid ?? ''
  const visibility = isPrivate ? ResourceVisibility.PRIVATE : ResourceVisibility.UNSPECIFIED
  // Web signs client-side via `signDocumentChange`. Generation must be strictly
  // greater than existing HEAD's — a tie keeps the old HEAD.
  const signer = deps.getSigner(signerAccountUid)
  const prepareResult = (await deps.client.request(
    'PrepareDocumentChange' as any,
    {
      account: deps.docId.uid,
      path,
      baseVersion,
      changes: allChanges as any,
      capability: capabilityCid,
      visibility,
    } as any,
  )) as any

  const existingGenerationRaw = editDocument?.generationInfo?.generation
  const existingGenerationNum = existingGenerationRaw != null ? Number(existingGenerationRaw) : 0
  const nextGeneration = Math.max(Date.now(), existingGenerationNum + 1)
  const {changeCid, publishInput} = await signDocumentChange(
    {
      account: deps.docId.uid,
      path,
      unsignedChange: prepareResult.unsignedChange,
      genesis: editDocument?.genesis,
      generation: nextGeneration,
      capability: capabilityCid,
      visibility,
    },
    signer,
  )

  await (deps.client as any).publish(publishInput)

  // Refetch by explicit version CID — the daemon's "latest" pointer may not
  // have caught up yet after the Ref publish.
  const newVersionStr = changeCid.toString()
  const after = await deps.client.request('Resource', {
    ...deps.docId,
    path: publishPath,
    version: newVersionStr,
  })
  if (after.type !== 'document') {
    throw new Error('post-publish resource is not a document')
  }

  await cleanupWebDocDrafts(input.draftId, input.deletedChildDraftIds)

  // Shared cache invalidation: writes new doc to cache + marks stale.
  // Do NOT refetch ENTITY — daemon's "latest" pointer may still be stale.
  invalidateAfterPublish(publishedDocId, after.document)
  if (publishedDocId.id !== deps.docId.id) {
    invalidateAfterPublish(deps.docId, after.document)
  }
  invalidateQueries(['web-doc-draft', deps.docId.id])
  enqueueParentCardAfterFirstPublish({
    shouldEnqueue: !editDocument,
    publishedDocId,
    signingAccountUid: signerAccountUid,
    capabilityId: capabilityCid || undefined,
    client: deps.client,
  })

  // Refetch draft query only — clears existingDraftContent in the UI.
  try {
    await refetchQueriesByKey(['web-doc-draft', deps.docId.id])
  } catch {
    // Non-critical: draft cache will clear on next mount via invalidation.
  }

  deps.onPublishSuccess?.(after.document)

  return after.document
}

function enqueueParentCardAfterFirstPublish({
  shouldEnqueue,
  publishedDocId,
  signingAccountUid,
  capabilityId,
  client,
}: {
  shouldEnqueue: boolean
  publishedDocId: UnpackedHypermediaId
  signingAccountUid: string
  capabilityId?: string
  client: UniversalClient
}) {
  const path = publishedDocId.path || []
  if (!shouldEnqueue || !path.length) return

  void enqueueWebDocumentCardCleanup(
    {
      operation: 'add',
      parentDocumentId: hmId(publishedDocId.uid, {path: path.slice(0, -1)}).id,
      targetDocumentId: publishedDocId.id,
      signingAccountUid,
      capabilityId,
    },
    {client},
  ).catch((error) => {
    console.warn('Document published, but parent document card cleanup failed to enqueue', error)
  })
}

/** Delete a parent draft plus any removed child drafts. */
async function cleanupWebDocDrafts(parentDraftId: string, childDraftIds: string[]): Promise<void> {
  const ids = Array.from(new Set(childDraftIds.filter((id) => id && id !== parentDraftId)))
  for (const id of ids) {
    await deleteWebDocDraft(id)
  }
  await deleteWebDocDraft(parentDraftId)
}

/** Cleanup the IDB draft for a given draftId. Used by the toolbar's Discard button. */
export async function discardWebDocDraft(draftId: string, deletedChildDraftIds: string[] = []): Promise<void> {
  await cleanupWebDocDrafts(draftId, deletedChildDraftIds)
}
