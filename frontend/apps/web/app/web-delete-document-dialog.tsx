import {createTombstoneRef} from '@seed-hypermedia/client'
import type {HMDocumentInfo, HMSigner, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, useUniversalClient} from '@shm/shared'
import {getDocumentTitle, getMetadataName} from '@shm/shared/content'
import {useResource} from '@shm/shared/models/entity'
import {queryDirectory} from '@shm/shared/models/queries'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {UniversalClient} from '@shm/shared/universal-client'
import {getParentPaths} from '@shm/shared/utils/breadcrumbs'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {DeleteDocumentDialog} from '@shm/ui/delete-document-dialog'
import {Spinner} from '@shm/ui/spinner'
import {Text} from '@shm/ui/text'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useQuery} from '@tanstack/react-query'
import {enqueueWebDocumentCardCleanup} from './document-edit/web-document-card-cleanup'

export type WebDeleteDocumentDialogInput = {
  id: UnpackedHypermediaId
  onSuccess?: () => void
}

export type WebDeleteDocumentDialogOptions = {
  signingAccountId?: string
  capabilityId?: string
  canDelete: boolean
}

/** Opens the shared delete document dialog with web-specific data and delete behavior. */
export function useWebDeleteDocumentDialog(options: WebDeleteDocumentDialogOptions) {
  return useAppDialog<WebDeleteDocumentDialogInput>((props) => <WebDeleteDocumentDialog {...props} {...options} />, {
    isAlert: true,
  })
}

function WebDeleteDocumentDialog({
  input: {id, onSuccess},
  onClose,
  signingAccountId,
  capabilityId,
  canDelete,
}: {
  input: WebDeleteDocumentDialogInput
  onClose?: () => void
} & WebDeleteDocumentDialogOptions) {
  const client = useUniversalClient()
  const doc = useResource(id)
  const directory = useQuery(queryDirectory(client, id, 'AllDescendants'))
  const childDocs = getChildDocuments(id, directory.data)

  if (doc.isLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )

  if (doc.isError || doc.data?.type !== 'document') {
    return <Text className="text-destructive text-sm">{doc.error ? String(doc.error) : 'Could not load document'}</Text>
  }

  const childDocIds = childDocs.map((item) => hmId(id.uid, {path: item.path}))
  const document = doc.data.document

  return (
    <DeleteDocumentDialog
      document={{
        key: id.id,
        title: getDocumentTitle(document),
        path: id.path,
      }}
      childDocuments={childDocs.map((item) => ({
        key: item.id.id,
        title: getMetadataName(item.metadata),
        path: item.path,
      }))}
      canDelete={canDelete && !!signingAccountId}
      cannotDeleteReason={!signingAccountId ? 'No signing account available' : 'Not allowed to delete'}
      onConfirm={() => {
        if (!signingAccountId) throw new Error('No signing account available')
        return deleteWebDocuments(client, {
          ids: [id, ...childDocIds],
          signingAccountId,
          capabilityId,
        })
      }}
      onClose={onClose}
      onSuccess={onSuccess}
    />
  )
}

function getChildDocuments(id: UnpackedHypermediaId, documents: HMDocumentInfo[] | undefined): HMDocumentInfo[] {
  const parentPath = id.path ?? []
  return (documents || []).filter((item) => {
    if (!item.path?.length) return false
    if (item.path.length <= parentPath.length) return false
    return parentPath.every((segment, index) => item.path[index] === segment)
  })
}

export async function deleteWebDocuments(
  client: Pick<UniversalClient, 'request' | 'publish' | 'getSigner' | 'deleteRecent'>,
  input: {ids: UnpackedHypermediaId[]; signingAccountId: string; capabilityId?: string},
): Promise<void> {
  if (!client.getSigner) throw new Error('Signing not available')
  const signer = client.getSigner(input.signingAccountId) as HMSigner

  await Promise.all(
    input.ids.map(async (id) => {
      await client.deleteRecent?.(id.id)
      const resource = await client.request('Resource', id)
      if (resource.type !== 'document') throw new Error(`Cannot delete: resource is ${resource.type}`)
      const doc = resource.document
      const generation = doc.generationInfo ? Number(doc.generationInfo.generation) : 0
      const refInput = await createTombstoneRef(
        {
          space: id.uid,
          path: hmIdPathToEntityQueryPath(id.path),
          genesis: doc.genesis,
          generation,
          capability: input.capabilityId,
        },
        signer,
      )
      await client.publish(refInput)
    }),
  )

  const selectedDeletedDocument = input.ids[0]
  if (selectedDeletedDocument) {
    await enqueueWebDocumentCardCleanup(
      {
        deletedDocumentId: selectedDeletedDocument.id,
        signingAccountUid: input.signingAccountId,
        capabilityId: input.capabilityId,
      },
      {client},
    )
  }

  invalidateQueries([])
  input.ids.forEach((id) => {
    invalidateQueries([queryKeys.ENTITY, id.id])
    invalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
    invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, id.id])
    getParentPaths(id.path).forEach((path) => {
      const parentId = hmId(id.uid, {path})
      invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id, 'Children'])
      invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, parentId.id, 'AllDescendants'])
      invalidateQueries([queryKeys.DOCUMENT_INTERACTION_SUMMARY, parentId.id])
    })
  })
}
