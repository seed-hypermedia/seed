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
import {planDocumentCardMoveOperations} from '@shm/shared/utils/document-card-cleanup'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {
  DocumentDestinationDialog,
  type DocumentDestinationSubmitInput,
  type WritableDocumentDestination,
} from '@shm/ui/document-destination-dialog'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useQuery} from '@tanstack/react-query'
import {useMemo} from 'react'
import {useNavigate} from '@shm/shared/utils/navigation'
import {enqueueWebDocumentCardCleanup} from './document-edit/web-document-card-cleanup'

export type WebMoveDocumentDialogInput = {
  id: UnpackedHypermediaId
  mode: WebDocumentDestinationMode
  origin?: DocumentCardActionOrigin
}

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
