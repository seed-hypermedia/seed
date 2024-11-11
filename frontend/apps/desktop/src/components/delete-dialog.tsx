import {roleCanWrite, useMyCapability} from '@/models/access-control'
import {useDeleteKey} from '@/models/daemon'
import {useListSite} from '@/models/documents'
import {hmId, HYPERMEDIA_ENTITY_TYPES, UnpackedHypermediaId} from '@shm/shared'
import {
  AlertDialog,
  AlertDialogContentProps,
  AlertDialogProps,
  Button,
  HeadingProps,
  ParagraphProps,
  Spinner,
  XStack,
  XStackProps,
  YStack,
} from '@shm/ui'
import {ReactNode} from 'react'
import {useDeleteEntities} from '../models/entities'
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
  input: {id, title, onSuccess},
  onClose,
}: {
  input: {id: UnpackedHypermediaId; title?: string; onSuccess?: () => void}
  onClose?: () => void
}) {
  const deleteEntity = useDeleteEntities({
    onSuccess: () => {
      onClose?.(), onSuccess?.()
    },
  })
  const list = useListSite(id)
  const childDocs =
    list.data?.filter((item) => {
      if (!item.path?.length) return false
      if (!id.path) return false
      if (id.path.length === item.path.length) return false
      return item.path.join('/').startsWith(id.path.join('/'))
    }) || []
  console.log(`== ~ DeleteEntityDialog`, id, title, childDocs)
  const cap = useMyCapability(id)

  return (
    <YStack backgroundColor="$background" padding="$4" borderRadius="$3">
      <AlertDialog.Title>Delete "{title}"</AlertDialog.Title>
      <AlertDialog.Description>
        Are you sure you want to delete this? (TODO: better message, deletion is
        not real. children deleted too)
      </AlertDialog.Description>
      <XStack space="$3" justifyContent="flex-end">
        <AlertDialog.Cancel asChild>
          <Button onPress={onClose} chromeless>
            Cancel
          </Button>
        </AlertDialog.Cancel>
        <XStack gap="$4">
          {deleteEntity.isLoading ? <Spinner /> : null}
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
            {`Delete ${HYPERMEDIA_ENTITY_TYPES[id.type]}`}
          </Button>
        </XStack>
      </XStack>
    </YStack>
  )
}

export function useDeleteKeyDialog() {
  const c = useAppDialog(DeleteKeyDialog, {isAlert: true})

  console.log(`== ~ useDeleteKeyDialog ~ c:`, c)
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
