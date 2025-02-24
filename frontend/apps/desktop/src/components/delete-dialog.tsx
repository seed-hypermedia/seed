import {roleCanWrite, useMyCapability} from '@/models/access-control'
import {useDeleteKey} from '@/models/daemon'
import {useListSite} from '@/models/documents'

import {getDocumentTitle, getMetadataName} from '@shm/shared/content'
import {HMMetadata, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'

import {Button} from '@shm/ui/button'
import {toast} from '@shm/ui/toast'
import {ReactNode} from 'react'
import {
  AlertDialog,
  AlertDialogContentProps,
  AlertDialogProps,
  HeadingProps,
  ParagraphProps,
  SizableText,
  Spinner,
  XStack,
  XStackProps,
  YStack,
} from 'tamagui'
import {useDeleteEntities, useEntity} from '../models/entities'
import {useAppDialog} from './dialog'

export type DeleteDialogProps = AlertDialogProps & {
  dialogContentProps?: AlertDialogContentProps
  trigger?: (props: {onPress: () => void}) => JSX.Element
  cancelButton?: ReactNode
  actionButton?: ReactNode
  contentStackProps?: XStackProps
  actionStackProps?: XStackProps
  title: string
  titleProps?: HeadingProps
  description: string
  descriptionProps?: ParagraphProps
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
  const cap = useMyCapability(id)
  const doc = useEntity(id)

  if (doc.isLoading) return <Spinner />
  if (doc.isError || !doc.data?.document)
    return (
      <AlertDialog.Description theme="red">
        {doc.error || 'Could not load document'}
      </AlertDialog.Description>
    )
  return (
    <YStack gap="$4" padding="$4" borderRadius="$3" maxWidth={440}>
      <AlertDialog.Title>
        Delete "{getDocumentTitle(doc.data?.document)}"
      </AlertDialog.Title>
      <AlertDialog.Description>
        Are you sure you want to delete{' '}
        {childDocs.length ? 'these documents' : 'this document'}? This may break
        links that refer to the current{' '}
        {childDocs.length ? 'versions' : 'version'}.
      </AlertDialog.Description>
      <AlertDialog.Description>
        {childDocs.length ? 'They' : 'It'} will be removed from your directory
        but the content will remain on your computer, and other people may still
        have it saved.
      </AlertDialog.Description>
      <AlertDialog.Description color="$color9">
        Note: This feature is a work-in-progress. For now, the raw document data
        will continue to be synced with other peers. Soon we will avoid that.
        Eventually, you will be able to recover deleted documents.
      </AlertDialog.Description>
      <YStack gap="$3" marginVertical="$4">
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
      </YStack>
      <XStack gap="$3" justifyContent="flex-end">
        <AlertDialog.Cancel asChild>
          <Button onPress={onClose} chromeless>
            Cancel
          </Button>
        </AlertDialog.Cancel>
        {deleteEntity.isLoading ? <Spinner /> : null}
        <AlertDialog.Action asChild>
          <Button
            theme="red"
            onPress={() => {
              if (!cap || !roleCanWrite(cap?.role))
                throw new Error('Not allowed to delete')
              deleteEntity.mutate({
                ids: [
                  id,
                  ...childDocs.map((item) =>
                    hmId('d', id.uid, {path: item.path}),
                  ),
                ],
                signingAccountUid: cap.accountUid,
                capabilityId: cap.capabilityId,
              })
            }}
          >
            {childDocs.length ? 'Delete Documents' : 'Delete Document'}
          </Button>
        </AlertDialog.Action>
      </XStack>
    </YStack>
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
    <XStack jc="space-between" gap="$3">
      <SizableText color="$red11" textDecorationLine="line-through">
        {getMetadataName(metadata)}
      </SizableText>
      <SizableText color="$red9" textDecorationLine="line-through">
        {path?.join('/') || '?'}
      </SizableText>
    </XStack>
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
    <YStack backgroundColor="$background" padding="$4" borderRadius="$3">
      <AlertDialog.Title>Delete Key</AlertDialog.Title>
      <AlertDialog.Description>
        Are you sure you want to delete this key from your computer? You will
        NOT be able to recover this neither sign content with this identity.
      </AlertDialog.Description>

      <XStack gap="$3" justifyContent="flex-end">
        <AlertDialog.Cancel asChild>
          <Button onPress={onClose} chromeless>
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <AlertDialog.Action asChild>
          <Button
            theme="red"
            onPress={() => {
              deleteKey.mutateAsync({accountId}).then(() => {
                onSuccess?.()
                onClose?.()
              })
            }}
          >
            Delete Account
          </Button>
        </AlertDialog.Action>
      </XStack>
    </YStack>
  )
}
