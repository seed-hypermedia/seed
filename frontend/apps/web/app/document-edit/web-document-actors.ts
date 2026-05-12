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

import {signDocumentChange} from '@seed-hypermedia/client'
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
    console.log('[Publish] writeDraft actor invoked', {
      docId: deps.docId.id,
      incomingDraftId: input.draftId,
      signingAccountId: input.signingAccountId,
    })
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
    console.log('[Publish] writeDraft persisted', {draftId, blockCount: content.length})
    return {id: draftId}
  })
}

function makePublishDocumentActor(deps: CreateWebDocumentMachineDeps) {
  return fromPromise<HMDocument, PublishInput>(async ({input}) => {
    console.log('[Publish] actor invoked', {
      docId: deps.docId.id,
      draftId: input.draftId,
      hasPathOverride: !!input.pathOverride,
      pathOverride: input.pathOverride,
      publishAccountUid: input.publishAccountUid,
    })
    try {
      const result = await publishWebDocument(input, deps)
      console.log('[Publish] actor success', {
        version: result.version,
        path: result.path,
      })
      return result
    } catch (err) {
      console.error('[Publish] actor failed', err)
      throw err
    }
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
  console.log('[Publish] step 1: fetching draft from IDB', {draftId: input.draftId})
  const draft = await getWebDocDraft(input.draftId)
  if (!draft) throw new Error(`web publish: draft ${input.draftId} not found`)
  console.log('[Publish] step 1 done', {
    draftId: draft.draftId,
    contentBlocks: draft.content?.length ?? 0,
    metadataKeys: Object.keys(draft.metadata ?? {}),
    signingAccountId: draft.signingAccountId,
  })

  const editor = deps.getEditor()
  const editorBlocks = editor?.getTopLevelBlocks() ?? null
  const liveEditorBlocks: EditorBlock[] =
    editorBlocks && editorBlocks.length
      ? editorBlocks
      : hmBlocksToEditorContent(draft.content ?? [], {childrenType: 'Group'})
  console.log('[Publish] step 2: editor blocks resolved', {
    fromEditor: !!(editorBlocks && editorBlocks.length),
    count: liveEditorBlocks.length,
  })

  console.log('[Publish] step 3: fetching latest resource')
  const resource = await deps.client.request('Resource', deps.docId)
  const editDocument = resource.type === 'document' ? resource.document : null
  console.log('[Publish] step 3 done', {
    resourceType: resource.type,
    hasDoc: !!editDocument,
    publishedVersion: editDocument?.version ?? null,
    publishedBlockCount: editDocument?.content?.length ?? 0,
  })

  const baselineMap = createBlocksMap(editDocument?.content ?? [], '')
  const blockDiff = compareBlocksWithMap(baselineMap, liveEditorBlocks, '')
  const deleteChanges = extractDeletes(baselineMap, blockDiff.touchedBlocks)

  const navChanges = getNavigationChanges(
    draft.navigation ?? undefined,
    editDocument?.detachedBlocks?.navigation ?? null,
  )

  const metadataChanges = getDocAttributeChanges(draft.metadata as HMMetadata)

  const allChanges = [...navChanges, ...metadataChanges, ...blockDiff.changes, ...deleteChanges]
  console.log('[Publish] step 4: built changes', {
    nav: navChanges.length,
    metadata: metadataChanges.length,
    blocks: blockDiff.changes.length,
    deletes: deleteChanges.length,
    total: allChanges.length,
  })
  console.log('[Publish] step 4 detail: liveEditorBlock IDs', liveEditorBlocks.map((b) => b.id))
  console.log(
    '[Publish] step 4 detail: published baseline block IDs',
    (editDocument?.content ?? []).map((n) => n.block?.id ?? '(no-id)'),
  )
  console.log('[Publish] step 4 detail: blockDiff.touchedBlocks', Array.from(blockDiff.touchedBlocks))
  console.log('[Publish] step 4 detail: allChanges payload', allChanges)

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

  const capabilityCid = deps.getCapabilityCid() ?? ''
  // Web signs the version Ref blob client-side via `signDocumentChange`. The Ref's
  // `generation` field decides which blob wins for `(account, path)`. If we
  // forward the existing HEAD's generation here, the new Ref ties with the
  // current HEAD and the daemon doesn't advance it — so we must omit
  // `generation` and let the client default to `Date.now()`, which is strictly
  // newer than the previous Ref. Desktop avoids this because it routes through
  // the daemon's `createDocumentChange` gRPC, which manages generation server-side.
  console.log('[Publish] step 5: calling client.publishDocument', {
    signerAccountUid,
    account: deps.docId.uid,
    baseVersion,
    path,
    capability: capabilityCid || '(empty/owner)',
    genesis: editDocument?.genesis ?? null,
    changeCount: allChanges.length,
  })

  // Inline publish flow so each step can be logged independently. Mirrors
  // `seedClient.publishDocument` for the non-bootstrap branch.
  const signer = deps.getSigner(signerAccountUid)
  console.log('[Publish] step 5a: PrepareDocumentChange request')
  const prepareResult = (await deps.client.request('PrepareDocumentChange' as any, {
    account: deps.docId.uid,
    path,
    baseVersion,
    changes: allChanges as any,
    capability: capabilityCid,
  } as any)) as any
  console.log('[Publish] step 5a done', {
    unsignedChangeLen: prepareResult?.unsignedChange?.byteLength ?? prepareResult?.unsignedChange?.length ?? null,
    keys: Object.keys(prepareResult ?? {}),
    full: prepareResult,
  })

  // Pick a generation strictly greater than the existing HEAD's. The daemon
  // resolves HEAD by max generation for `(account, path)`, so a tie or lower
  // value silently keeps the old HEAD. Other clients (desktop, the daemon's
  // own publish path) may have advanced the generation past `Date.now()`,
  // so we can't rely on the clock alone.
  const existingGenerationRaw = editDocument?.generationInfo?.generation
  const existingGenerationNum = existingGenerationRaw != null ? Number(existingGenerationRaw) : 0
  const nextGeneration = Math.max(Date.now(), existingGenerationNum + 1)
  console.log('[Publish] step 5b: signDocumentChange', {
    existingGeneration: existingGenerationNum,
    nextGeneration,
    nowMs: Date.now(),
  })
  const {changeCid, publishInput} = await signDocumentChange(
    {
      account: deps.docId.uid,
      path,
      unsignedChange: prepareResult.unsignedChange,
      genesis: editDocument?.genesis,
      generation: nextGeneration,
      capability: capabilityCid,
    },
    signer,
  )
  console.log('[Publish] step 5b done', {
    changeCid: changeCid.toString(),
    blobCount: publishInput.blobs.length,
    blobCids: publishInput.blobs.map((b: any) => b.cid),
  })

  console.log('[Publish] step 5c: PublishBlobs')
  let publishResult: any = null
  try {
    publishResult = await (deps.client as any).publish(publishInput)
  } catch (err) {
    console.error('[Publish] step 5c FAILED', err)
    throw err
  }
  console.log('[Publish] step 5c done', {
    result: publishResult,
    resultKeys: publishResult ? Object.keys(publishResult) : null,
  })
  console.log('[Publish] step 5 done: gRPC publish succeeded')

  // Diagnostic: read the daemon's change log for this doc to confirm a new
  // change blob actually committed (vs publish-without-effective-ops).
  try {
    const changes = (await (deps.client as any).request('ListChanges', {targetId: deps.docId})) as any
    console.log('[Publish] step 5.5 ListChanges after publish', {
      count: Array.isArray(changes?.changes) ? changes.changes.length : 'n/a',
      latest: changes?.changes?.[0]?.cid ?? null,
      raw: changes,
    })
  } catch (err) {
    console.warn('[Publish] step 5.5 ListChanges failed', err)
  }

  console.log('[Publish] step 6: refetching post-publish resource')
  const after = await deps.client.request('Resource', deps.docId)
  if (after.type !== 'document') {
    throw new Error('post-publish resource is not a document')
  }
  console.log('[Publish] step 6 done', {newVersion: after.document.version, blockCount: after.document.content?.length ?? 0})

  await deleteWebDocDraft(input.draftId)
  console.log('[Publish] step 7 done: IDB draft deleted')
  return after.document
}

/** Cleanup the IDB draft for a given draftId. Used by the toolbar's Discard button. */
export async function discardWebDocDraft(draftId: string): Promise<void> {
  await deleteWebDocDraft(draftId)
}
