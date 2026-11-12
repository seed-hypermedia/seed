import type {HMDocumentInfo, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, useUniversalClient} from '@shm/shared'
import {getDocumentTitle, getMetadataName} from '@shm/shared/content'
import {useResource} from '@shm/shared/models/entity'
import {queryDirectory} from '@shm/shared/models/queries'
import {registerWebAgentsPlatform} from '@/web-agents-platform'
import {useMountedAgentDeletion} from '@shm/ui/agents/delete-mounted-agent'
import {DeleteDocumentDialog} from '@shm/ui/delete-document-dialog'
import {Spinner} from '@shm/ui/spinner'
import {Text} from '@shm/ui/text'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useQuery} from '@tanstack/react-query'
import {deleteWebDocuments} from './web-delete-documents'

export type WebDeleteDocumentDialogInput = {
  id: UnpackedHypermediaId
  onSuccess?: () => void
  onMoveChildren?: () => void
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
  input: {id, onSuccess, onMoveChildren},
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
  // A mounted agent goes with its document; the agent server call is signed by the same account.
  registerWebAgentsPlatform()
  const agentDeletion = useMountedAgentDeletion(
    id,
    doc.data?.type === 'document' ? doc.data.document.metadata : undefined,
    signingAccountId,
  )

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
      subject={agentDeletion.isAgent ? 'agent' : 'document'}
      onConfirm={async () => {
        if (!signingAccountId) throw new Error('No signing account available')
        await agentDeletion.deleteAgent()
        await deleteWebDocuments(client, {
          ids: [id, ...childDocIds],
          signingAccountId,
          capabilityId,
        })
      }}
      // Moving children requires the same delete permission: it still tombstones the parent.
      onMoveChildren={canDelete ? onMoveChildren : undefined}
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
