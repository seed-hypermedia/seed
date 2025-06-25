import {
  roleCanWrite,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useDeleteKey} from '@/models/daemon'
import {useListSite} from '@/models/documents'

import {hmId} from '@shm/shared'
import {getDocumentTitle, getMetadataName} from '@shm/shared/content'
import {HMMetadata, UnpackedHypermediaId} from '@shm/shared/hm-types'

import {useEntity} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {Spinner} from '@shm/ui/spinner'
import {Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {ReactNode} from 'react'
import {useDeleteEntities} from '../models/entities'
import {useAppDialog} from './dialog'

export type DeleteDialogProps = {
  trigger?: (props: {onPress: () => void}) => JSX.Element
  cancelButton?: ReactNode
  actionButton?: ReactNode
  title: string
  description: string
}

export function useDeleteDialog() {
  return useAppDialog(DeleteEntityDialog, {isAlert: true})
}

export function DeleteEntityDialog({
  input: {id, onSuccess},
  onClose,
}: {
  input: {id: UnpackedHypermediaId; onSuccess?: () => void}
  onClose?: () => void
}) {
  const list = useListSite(id)
  const childDocs =
    list.data?.filter((item) => {
      if (!item.path?.length) return false
      if (!id.path) return false
      if (id.path.length === item.path.length) return false
      return item.path.join('/').startsWith(id.path.join('/'))
    }) || []
  const deleteEntity = useDeleteEntities({
    onSuccess: () => {
      toast.success(`Successfully deleted ${childDocs.length + 1} documents`)
      onClose?.(), onSuccess?.()
    },
  })
  const cap = useSelectedAccountCapability(id)
  const doc = useEntity(id)

  if (doc.isLoading)
    return (
      <div className="flex justify-center items-center">
        <Spinner />
      </div>
    )
  if (doc.isError || !doc.data?.document)
    return (
      <Text className="text-sm text-destructive">
        {doc.error || 'Could not load document'}
      </Text>
    )
  return (
    <div className="flex max-w-[440px] flex-col gap-4 rounded-lg p-4">
      <Text className="text-lg font-semibold">
        Delete "{getDocumentTitle(doc.data?.document)}"
      </Text>
      <Text className="text-sm text-muted-foreground">
        Are you sure you want to delete{' '}
        {childDocs.length ? 'these documents' : 'this document'}? This may break
        links that refer to the current{' '}
        {childDocs.length ? 'versions' : 'version'}.
      </Text>
      <Text className="text-sm text-muted-foreground">
        {childDocs.length ? 'They' : 'It'} will be removed from your directory
        but the content will remain on your computer, and other people may still
        have it saved.
      </Text>
      <Text className="text-sm text-muted-foreground">
        Note: This feature is a work-in-progress. For now, the raw document data
        will continue to be synced with other peers. Soon we will avoid that.
        Eventually, you will be able to recover deleted documents.
      </Text>
      <div className="flex flex-col gap-3 my-4">
        <DeletionListItem
          metadata={doc.data.document.metadata}
          path={id.path}
        />
        {childDocs.map((item) => (
          <DeletionListItem
            key={item.path?.join('/')}
            metadata={item.metadata}
            path={item.path}
          />
        ))}
      </div>
      <div className="flex gap-3 justify-end">
        <Button onClick={onClose} variant="outline">
          Cancel
        </Button>

        <Button
          variant="destructive"
          onClick={() => {
            if (!cap || !roleCanWrite(cap?.role))
              throw new Error('Not allowed to delete')
            deleteEntity.mutate({
              ids: [
                id,
                ...childDocs.map((item) => hmId(id.uid, {path: item.path})),
              ],
              signingAccountUid: cap.accountUid,
              capabilityId: cap.capabilityId,
            })
          }}
        >
          {childDocs.length ? 'Delete Documents' : 'Delete Document'}
        </Button>
      </div>
    </div>
  )
}

function DeletionListItem({
  metadata,
  path,
}: {
  metadata: HMMetadata
  path: string[] | null
}) {
  return (
    <div className="flex gap-3 justify-between">
      <Text className="line-through text-destructive">
        {getMetadataName(metadata)}
      </Text>
      <Text className="line-through text-destructive/70">
        {path?.join('/') || '?'}
      </Text>
    </div>
  )
}

export function useDeleteKeyDialog() {
  const c = useAppDialog(DeleteKeyDialog, {isAlert: true})
  return c
}

export function DeleteKeyDialog({
  input: {accountId, onSuccess},
  onClose,
}: {
  input: {accountId: string; onSuccess?: () => void}
  onClose?: () => void
}) {
  const deleteKey = useDeleteKey()

  return (
    <div className="p-4 rounded-lg bg-background">
      <Text className="text-lg font-semibold">Delete Key</Text>
      <Text className="text-sm text-muted-foreground">
        Are you sure you want to delete this key from your computer? You will
        NOT be able to recover this neither sign content with this identity.
      </Text>

      <div className="flex gap-3 justify-end">
        <Button onClick={onClose} variant="outline">
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            deleteKey.mutate({accountId})
            onSuccess?.()
            onClose?.()
          }}
        >
          Delete Key
        </Button>
      </div>
    </div>
  )
}
