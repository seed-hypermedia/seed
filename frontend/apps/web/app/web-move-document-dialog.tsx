import {createRedirectRef, createVersionRef} from '@seed-hypermedia/client'
import type {HMDocumentInfo, HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, useUniversalClient} from '@shm/shared'
import {useResource, useResources} from '@shm/shared/models/entity'
import {queryDirectory} from '@shm/shared/models/queries'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import type {UniversalClient} from '@shm/shared/universal-client'
import {getParentPaths} from '@shm/shared/utils/breadcrumbs'
import type {DocumentCardActionOrigin} from '@shm/shared/utils/document-actions'
import {
  appendDraftCardToEditorBlocks,
  planDocumentCardMoveOperations,
  removeDraftCardFromEditorBlocks,
} from '@shm/shared/utils/document-card-cleanup'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {
  DocumentDestinationDialog,
  type DocumentDestinationDialogInput,
  type DocumentDestinationSubmitInput,
  type WritableDocumentDestination,
} from '@shm/ui/document-destination-dialog'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useQuery} from '@tanstack/react-query'
import {useMemo} from 'react'
import {useNavigate} from '@shm/shared/utils/navigation'
import {enqueueWebDocumentCardCleanup} from './document-edit/web-document-card-cleanup'
import {
  getLatestWebDocDraftForDoc,
  getWebDocDraft,
  listWebDocDraftsForAccount,
  putWebDocDraft,
  type WebDocDraft,
} from './document-edit/web-draft-db'

export type WebMoveDocumentDialogInput = DocumentDestinationDialogInput

export type WebDocumentDestinationMode = 'move' | 'republish'

export type WebMoveDocumentDialogOptions = {
  signingAccountId?: string
  capabilityId?: string
  writableLocationId?: UnpackedHypermediaId
  canMove: boolean
}

type PlannedMove = {
  from: UnpackedHypermediaId
  to: UnpackedHypermediaId
}

/** Opens the web destination dialog for published documents. */
export function useWebDocumentDestinationDialog(options: WebMoveDocumentDialogOptions) {
  return useAppDialog<WebMoveDocumentDialogInput>((props) => <WebDocumentDestinationDialog {...props} {...options} />)
}

/** Opens the web move dialog for published documents. */
export const useWebMoveDocumentDialog = useWebDocumentDestinationDialog

/** Adapts the shared destination dialog to web move publishing. */
export function WebDocumentDestinationDialog({
  input,
  onClose,
  signingAccountId,
  capabilityId,
  writableLocationId,
  canMove,
}: {
  input: WebMoveDocumentDialogInput
  onClose?: () => void
} & WebMoveDocumentDialogOptions) {
  const client = useUniversalClient()
  const navigate = useNavigate()
  const childDocuments = useWebMoveChildDocuments(client, input.id)
  const writableDocuments = useWebWritableDestinations(input.id, signingAccountId, writableLocationId)

  async function onSubmit(submitInput: DocumentDestinationSubmitInput) {
    if (submitInput.mode !== 'move') throw new Error('Republish is not available on web yet')
    if (!canMove) throw new Error('You are not allowed to move this document')
    if (submitInput.draft?.draftId) {
      await moveWebDraft({
        draftId: submitInput.draft.draftId,
        from: submitInput.from,
        to: submitInput.to,
        origin: submitInput.origin,
      })
      return
    }
    await moveWebDocuments(client, {
      from: submitInput.from,
      to: submitInput.to,
      childDocuments,
      signingAccountId: submitInput.signingAccountId,
      capabilityId,
    })
  }

  return (
    <DocumentDestinationDialog
      input={input}
      onClose={onClose || (() => {})}
      selectedAccountUid={signingAccountId}
      writableDocuments={writableDocuments}
      enabledModes={['move']}
      onSubmit={onSubmit}
      onSuccess={({to}) => navigate({key: 'document', id: to})}
    />
  )
}

function useWebMoveChildDocuments(client: UniversalClient, id: UnpackedHypermediaId) {
  const directory = useQuery(queryDirectory(client, id, 'AllDescendants'))
  return useMemo(() => (directory.data || []).filter((item) => item.path?.length), [directory.data])
}

function useWebWritableDestinations(
  sourceId: UnpackedHypermediaId,
  signingAccountId?: string,
  writableLocationId?: UnpackedHypermediaId,
): WritableDocumentDestination[] {
  const rootIds = useMemo(() => {
    if (!signingAccountId) return []
    if (writableLocationId) return [writableLocationId]
    return [signingAccountId === sourceId.uid ? hmId(sourceId.uid) : sourceId]
  }, [signingAccountId, sourceId, writableLocationId])
  const resources = useResources(rootIds)
  return rootIds.map((id, index) => {
    const resource = resources[index]?.data
    const document = resource?.type === 'document' ? resource.document : null
    return {
      id,
      document,
      accountsWithWrite: signingAccountId ? [signingAccountId] : [],
    }
  })
}

/** Moves a web document by publishing a version ref at the target and a redirect ref at the source. */
export async function moveWebDocuments(
  client: Pick<UniversalClient, 'request' | 'publish' | 'getSigner'>,
  input: {
    from: UnpackedHypermediaId
    to: UnpackedHypermediaId
    childDocuments?: HMDocumentInfo[]
    signingAccountId: string
    capabilityId?: string
  },
): Promise<PlannedMove[]> {
  if (!client.getSigner) throw new Error('Signing not available')
  const signer = client.getSigner(input.signingAccountId) as HMSigner
  const fromPath = input.from.path || []
  const toPath = input.to.path || []
  const childMoves = (input.childDocuments || [])
    .filter((doc) => doc.path && doc.path.length > fromPath.length)
    .map((doc) => ({
      from: hmId(input.from.uid, {path: doc.path}),
      to: hmId(input.to.uid, {path: [...toPath, ...doc.path.slice(fromPath.length)]}),
    }))
  const moves = [{from: input.from, to: input.to}, ...childMoves]

  for (const move of moves) {
    const resource = await client.request('Resource', move.from)
    if (resource.type !== 'document') throw new Error(`Cannot move: resource is ${resource.type}`)
    const doc = resource.document
    if (!doc.generationInfo) throw new Error('No generation info for document')
    const generation = Number(doc.generationInfo.generation)
    const genesis = doc.generationInfo.genesis
    await client.publish(
      await createVersionRef(
        {
          space: move.to.uid,
          path: hmIdPathToEntityQueryPath(move.to.path),
          genesis,
          version: doc.version,
          generation,
          capability: input.capabilityId,
        },
        signer,
      ),
    )
    await client.publish(
      await createRedirectRef(
        {
          space: move.from.uid,
          path: hmIdPathToEntityQueryPath(move.from.path),
          genesis,
          generation,
          targetSpace: move.to.uid,
          targetPath: hmIdPathToEntityQueryPath(move.to.path),
          capability: input.capabilityId,
        },
        signer,
      ),
    )
  }

  await retargetWebDraftAfterPublishedMove(input.from, input.to)

  for (const cleanupInput of getMoveCleanupInputs(input.from, input.to, input.signingAccountId, input.capabilityId)) {
    enqueuePostMoveCleanup(cleanupInput, client)
  }
  invalidateMoveQueries(moves)
  return moves
}

/** Republishes a web document by publishing a republish redirect at the destination. */
export async function republishWebDocument(
  client: Pick<UniversalClient, 'request' | 'publish' | 'getSigner'>,
  input: {
    from: UnpackedHypermediaId
    to: UnpackedHypermediaId
    signingAccountId: string
    capabilityId?: string
  },
): Promise<{from: UnpackedHypermediaId; to: UnpackedHypermediaId}> {
  if (!client.getSigner) throw new Error('Signing not available')
  const signer = client.getSigner(input.signingAccountId) as HMSigner
  const resource = await client.request('Resource', input.from)
  if (resource.type !== 'document') throw new Error(`Cannot republish: resource is ${resource.type}`)
  const doc = resource.document
  if (!doc.generationInfo) throw new Error('No generation info for document')
  await client.publish(
    await createRedirectRef(
      {
        space: input.to.uid,
        path: hmIdPathToEntityQueryPath(input.to.path),
        genesis: doc.generationInfo.genesis,
        generation: Number(doc.generationInfo.generation),
        targetSpace: input.from.uid,
        targetPath: hmIdPathToEntityQueryPath(input.from.path),
        republish: true,
        capability: input.capabilityId,
      },
      signer,
    ),
  )

  const parent = getParentId(input.to)
  if (parent) {
    enqueuePostMoveCleanup(
      {
        operation: 'add',
        parentDocumentId: parent.id,
        targetDocumentId: input.to.id,
        signingAccountUid: input.signingAccountId,
        capabilityId: input.capabilityId,
      },
      client,
    )
  }
  invalidateMoveQueries([{from: input.from, to: input.to}])
  return {from: input.from, to: input.to}
}

function getParentId(id: UnpackedHypermediaId) {
  const path = id.path || []
  if (!path.length) return null
  return hmId(id.uid, {path: path.slice(0, -1)})
}

function pathsEqual(left: string[] | null | undefined, right: string[] | null | undefined) {
  const a = left || []
  const b = right || []
  return a.length === b.length && a.every((segment, index) => segment === b[index])
}

async function findWebDraftEditing(parentId: UnpackedHypermediaId): Promise<WebDocDraft | null> {
  const drafts = await listWebDocDraftsForAccount(parentId.uid)
  return (
    drafts.find((draft) => draft.docId === parentId.id) ||
    drafts.find((draft) => draft.editUid === parentId.uid && pathsEqual(draft.editPath, parentId.path || [])) ||
    null
  )
}

async function writeWebDraftContent(draft: WebDocDraft, content: any[]) {
  await putWebDocDraft({...draft, content, updatedAt: Date.now()})
  invalidateQueries([queryKeys.DRAFT, draft.draftId])
  invalidateQueries([queryKeys.DRAFTS_LIST])
  invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT])
}

async function moveWebDraftCardBetweenParentDrafts({
  draftId,
  fromParentId,
  toParentId,
  sourceBlockId,
}: {
  draftId: string
  fromParentId: UnpackedHypermediaId | null
  toParentId: UnpackedHypermediaId
  sourceBlockId?: string
}) {
  if (fromParentId) {
    const oldParentDraft = await findWebDraftEditing(fromParentId)
    if (oldParentDraft) {
      const removed = removeDraftCardFromEditorBlocks((oldParentDraft.content || []) as any[], draftId, sourceBlockId)
      if (removed.removedBlockIds.length) await writeWebDraftContent(oldParentDraft, removed.content)
    }
  }

  const newParentDraft = await findWebDraftEditing(toParentId)
  if (newParentDraft) {
    const added = appendDraftCardToEditorBlocks((newParentDraft.content || []) as any[], draftId, `${draftId}-card`)
    if (added.addedBlockIds.length) await writeWebDraftContent(newParentDraft, added.content)
  }
}

export async function moveWebDraft(input: {
  draftId: string
  from: UnpackedHypermediaId
  to: UnpackedHypermediaId
  origin?: DocumentCardActionOrigin
}) {
  const draft = await getWebDocDraft(input.draftId)
  if (!draft) throw new Error(`Draft ${input.draftId} not found`)
  const toParent = getParentId(input.to)
  if (!toParent) throw new Error('Choose a destination location.')
  const fromParent = draft.locationUid
    ? hmId(draft.locationUid, {path: draft.locationPath || []})
    : getParentId(input.from)

  await putWebDocDraft({
    ...draft,
    docId: input.to.id,
    locationUid: toParent.uid,
    locationPath: toParent.path || [],
    editUid: input.to.uid,
    editPath: input.to.path || [],
    updatedAt: Date.now(),
  })
  await moveWebDraftCardBetweenParentDrafts({
    draftId: input.draftId,
    fromParentId: fromParent,
    toParentId: toParent,
    sourceBlockId: input.origin?.embedBlockId,
  })
  invalidateQueries([queryKeys.DRAFT, input.draftId])
  invalidateQueries([queryKeys.DRAFTS_LIST])
  invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT, input.from.uid])
  invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT, input.to.uid])
  if (fromParent) invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, fromParent.id])
  invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, toParent.id])
  return {draftId: input.draftId, from: input.from, to: input.to}
}

async function retargetWebDraftAfterPublishedMove(from: UnpackedHypermediaId, to: UnpackedHypermediaId) {
  const draft = await getLatestWebDocDraftForDoc(from.id)
  if (!draft) return
  const fromParent = getParentId(from)
  const toParent = getParentId(to)
  const shouldMoveLocation =
    !!fromParent &&
    !!toParent &&
    draft.locationUid === fromParent.uid &&
    pathsEqual(draft.locationPath, fromParent.path || [])
  await putWebDocDraft({
    ...draft,
    docId: to.id,
    locationUid: shouldMoveLocation ? toParent!.uid : draft.locationUid,
    locationPath: shouldMoveLocation ? toParent!.path || [] : draft.locationPath,
    editUid: to.uid,
    editPath: to.path || [],
    updatedAt: Date.now(),
  })
  invalidateQueries([queryKeys.DRAFT, draft.draftId])
  invalidateQueries([queryKeys.DRAFTS_LIST])
  invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT, from.uid])
  invalidateQueries([queryKeys.DRAFTS_LIST_ACCOUNT, to.uid])
}

function getMoveCleanupInputs(
  from: UnpackedHypermediaId,
  to: UnpackedHypermediaId,
  signingAccountUid: string,
  capabilityId?: string,
) {
  return planDocumentCardMoveOperations(from, to).map((operation) => ({
    ...operation,
    signingAccountUid,
    capabilityId,
  }))
}

function enqueuePostMoveCleanup(
  input: Parameters<typeof enqueueWebDocumentCardCleanup>[0],
  client: Pick<UniversalClient, 'request'> & {publishDocument?: UniversalClient['publishDocument']},
) {
  void enqueueWebDocumentCardCleanup(input, {client}).catch((error) => {
    console.warn('Document moved, but post-move card cleanup failed to enqueue', error)
  })
}

function invalidateMoveQueries(moves: PlannedMove[]) {
  moves.forEach(({from, to}) => {
    const affectedIds = [from, to]
    affectedIds.forEach((id) => {
      invalidateQueries([queryKeys.ENTITY, id.id])
      invalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
      invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, id.id])
      getParentPaths(id.path).forEach((path) => {
        const parentId = hmId(id.uid, {path})
        invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id])
        invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, parentId.id])
      })
    })
  })
  invalidateQueries([queryKeys.SEARCH])
  invalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])
}
