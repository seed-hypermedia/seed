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
 *
 * Note: this file only sets up the actor wiring. The full publish algorithm
 * (block diffing, metadata + navigation changes, capability CID resolution)
 * lands in Step 5; Step 3 keeps `publishDocument` as a stub so the machine
 * compiles and `writeDraft` round-trips through IndexedDB.
 */

import type {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {editorBlocksToHMBlockNodes} from '@seed-hypermedia/client/editorblock-to-hmblock'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import type {HMDocument, HMMetadata, HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  documentMachine,
  type PublishInput,
  type PushDocumentInput,
  type WriteDraftInput,
} from '@shm/shared/models/document-machine'
import type {UniversalClient} from '@shm/shared/universal-client'
import {
  compareBlocksWithMap,
  createBlocksMap,
  extractDeletes,
  getDocAttributeChanges,
} from '@shm/shared/utils/document-changes'
import {getNavigationChanges} from '@shm/shared/utils/navigation-changes'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {nanoid} from 'nanoid'
import {fromPromise} from 'xstate'

import {deleteWebDocDraft, getWebDocDraft, putWebDocDraft, type WebDocDraft} from './web-draft-db'

/**
 * Minimal interface the actors need from the active editor instance.
 * BlockNote's editor exposes `topLevelBlocks` directly; we only depend on
 * the shape via this interface so tests can mock it.
 */
export interface WebEditorAccessor {
  /** Read the editor's current top-level blocks. */
  getTopLevelBlocks(): EditorBlock[] | null
  /** Optional cursor offset for restoring on reload. */
  getCursorPosition?: () => number | null
}

export interface CreateWebDocumentMachineDeps {
  /** Document this machine instance is bound to. */
  docId: UnpackedHypermediaId
  /** Returns the editor accessor (or null when the editor isn't mounted yet). */
  getEditor: () => WebEditorAccessor | null
  /** Universal client used for publish + refetch on the web. */
  client: UniversalClient
  /** Returns a signer for the given vault-delegated account UID. */
  getSigner: (accountUid: string) => HMSigner
  /** Capability CID granting write access; undefined for owner publishes. */
  getCapabilityCid: () => string | undefined
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
      pushDocument: fromPromise<void, PushDocumentInput>(async () => {
        // V1: no-op. Future: post to a web push endpoint.
      }),
    },
  })
}

function makeWriteDraftActor(deps: CreateWebDocumentMachineDeps) {
  return fromPromise<{id: string}, WriteDraftInput>(async ({input}) => {
    const editor = deps.getEditor()
    const editorBlocks = editor?.getTopLevelBlocks() ?? []
    const cursorPosition = editor?.getCursorPosition?.() ?? null
    const content = editorBlocksToHMBlockNodes(editorBlocks)

    const draftId = input.draftId ?? nanoid(10)
    const record: Omit<WebDocDraft, 'updatedAt'> = {
      draftId,
      docId: deps.docId.id,
      signingAccountId: input.signingAccountId ?? '',
      content,
      metadata: input.metadata ?? {},
      deps: input.deps,
      navigation: input.navigation ?? null,
      locationUid: input.locationUid || null,
      locationPath: input.locationPath?.length ? input.locationPath : null,
      editUid: input.editUid || null,
      editPath: input.editPath?.length ? input.editPath : null,
      cursorPosition,
    }
    await putWebDocDraft(record)
    return {id: draftId}
  })
}

function makePublishDocumentActor(deps: CreateWebDocumentMachineDeps) {
  return fromPromise<HMDocument, PublishInput>(async ({input}) => {
    return publishWebDocument(input, deps)
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

  const baselineMap = createBlocksMap(editDocument?.content ?? [], '')
  const blockDiff = compareBlocksWithMap(baselineMap, liveEditorBlocks, '')
  const deleteChanges = extractDeletes(baselineMap, blockDiff.touchedBlocks)

  const navChanges = getNavigationChanges(
    draft.navigation ?? undefined,
    editDocument?.detachedBlocks?.navigation ?? null,
  )

  const metadataChanges = getDocAttributeChanges(draft.metadata as HMMetadata)

  const allChanges = [...navChanges, ...metadataChanges, ...blockDiff.changes, ...deleteChanges]

  const latestVersion = editDocument?.version ?? ''
  const baseVersion = latestVersion || (draft.deps.length ? draft.deps.join('.') : '')
  const path = hmIdPathToEntityQueryPath(deps.docId.path ?? [])

  if (!deps.client.publishDocument) {
    throw new Error('Universal client does not provide publishDocument; cannot publish on web')
  }

  const signerAccountUid = input.publishAccountUid ?? draft.signingAccountId
  if (!signerAccountUid) {
    throw new Error('No signing account available for publish')
  }

  await deps.client.publishDocument({
    signerAccountUid,
    account: deps.docId.uid,
    baseVersion,
    path,
    // allChanges is DocumentChange[] from shared helpers; structurally compatible with
    // HMPrepareDocumentChangeInput['changes'] under proto-es runtime representation.
    changes: allChanges as any,
    capability: deps.getCapabilityCid() ?? '',
    genesis: editDocument?.genesis,
    generation: editDocument?.generationInfo?.generation,
  })

  const after = await deps.client.request('Resource', deps.docId)
  if (after.type !== 'document') {
    throw new Error('post-publish resource is not a document')
  }

  await deleteWebDocDraft(input.draftId)
  return after.document
}

/** Cleanup the IDB draft for a given draftId. Used by the toolbar's Discard button. */
export async function discardWebDocDraft(draftId: string): Promise<void> {
  await deleteWebDocDraft(draftId)
}
