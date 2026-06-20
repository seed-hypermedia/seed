import {roleCanWrite, useSelectedAccountCapability} from '@/models/access-control'
import {useDeleteKey} from '@/models/daemon'
import {useListSite} from '@/models/documents'

import {hmId} from '@shm/shared'
import {getDocumentTitle, getMetadataName} from '@shm/shared/content'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'

import {useResource} from '@shm/shared/models/entity'
import {Button, ButtonProps} from '@shm/ui/button'
import {DeleteDocumentDialog as SharedDeleteDocumentDialog} from '@shm/ui/delete-document-dialog'
import {Spinner} from '@shm/ui/spinner'
import {Text} from '@shm/ui/text'
import {useAppDialog} from '@shm/ui/universal-dialog'
import React, {ReactNode} from 'react'
import {useDeleteEntities} from '../models/entities'

export type DeleteDialogProps = {
  trigger?: (props: {onClick: ButtonProps['onClick']}) => JSX.Element
  cancelButton?: ReactNode
  actionButton?: ReactNode
  title: string
  description: string
}

export function useDeleteDialog() {
  return useAppDialog(DeleteDocumentDialog, {isAlert: true})
}

export function DeleteDocumentDialog({
  input: {id, onSuccess},
  onClose,
}: {
  input: {id: UnpackedHypermediaId; onSuccess?: () => void}
  onClose?: () => void
}) {
  const list = useListSite(id)
  const parentPath = id.path ?? []
  const childDocs =
    list.data?.filter((item) => {
      if (!item.path?.length) return false
      if (parentPath.length === item.path.length) return false
      return parentPath.every((segment, index) => item.path[index] === segment)
    }) || []
  const deleteEntity = useDeleteEntities({})
  const cap = useSelectedAccountCapability(id)
  const doc = useResource(id)

  if (doc.isLoading)
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )

  if (doc.isError || doc.data?.type !== 'document')
    return <Text className="text-destructive text-sm">{doc.error ? String(doc.error) : 'Could not load document'}</Text>

  const childDocIds = childDocs.map((item) => hmId(id.uid, {path: item.path}))
  const document = doc.data.document

  return (
    <SharedDeleteDocumentDialog
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
      canDelete={!!cap && roleCanWrite(cap.role)}
      onConfirm={() =>
        deleteEntity.mutateAsync({
          ids: [id, ...childDocIds],
          signingAccountUid: cap!.accountUid,
          capabilityId: cap!.capabilityId,
        })
      }
      onClose={onClose}
      onSuccess={onSuccess}
    />
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
    <div className="bg-background rounded-lg p-4">
      <Text className="text-lg font-semibold">Delete Key</Text>
      <Text className="text-muted-foreground text-sm">
        Are you sure you want to delete this key from your computer? You will NOT be able to recover this neither sign
        content with this identity.
      </Text>

      <div className="flex justify-end gap-3">
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
