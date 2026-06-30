import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {CommentsProvider, InlineEditCommentProps} from '@shm/shared/comments-service-provider'
import {DocumentActionsProvider} from '@shm/shared/document-actions-context'
import type {DocumentCardActionOrigin} from '@shm/shared/utils/document-actions'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Spinner} from '@shm/ui/spinner'
import {FeedPage} from '@shm/ui/feed-page-common'
import {lazy, Suspense, useCallback} from 'react'
import {useWebCanEdit} from './document-edit/use-web-can-edit'
import {WebHeaderActions, WebSitePageShell, useWebMenuItems} from './web-utils'
import {useWebDeleteDocumentDialog} from './web-delete-document-dialog'
import {useWebDocumentDestinationDialog} from './web-move-document-dialog'

const LazyWebInlineEditor = lazy(() => import('./commenting').then((mod) => ({default: mod.WebInlineEditBox})))

function renderWebInlineEditor(props: InlineEditCommentProps) {
  return (
    <Suspense fallback={<Spinner />}>
      <LazyWebInlineEditor {...props} />
    </Suspense>
  )
}

/** Web-specific wrapper for the site feed page, including host-site context UI. */
export function WebFeedPage({docId}: {docId: UnpackedHypermediaId}) {
  const menuItems = useWebMenuItems(docId)
  const {canEdit, signingAccountId, capability} = useWebCanEdit(docId)
  const deleteDialog = useWebDeleteDocumentDialog({
    signingAccountId: signingAccountId ?? undefined,
    capabilityId: capability && capability.id !== '_owner' ? capability.id : undefined,
    canDelete: canEdit,
  })
  const destinationDialog = useWebDocumentDestinationDialog({
    signingAccountId: signingAccountId ?? undefined,
    capabilityId: capability && capability.id !== '_owner' ? capability.id : undefined,
    writableLocationId: capability?.id === '_owner' ? hmId(docId.uid) : capability?.grantId,
    canMove: !!signingAccountId,
  })
  const onDeleteDocument = useCallback(
    (id: UnpackedHypermediaId, onSuccess?: () => void) => {
      deleteDialog.open({id, onSuccess})
    },
    [deleteDialog],
  )
  const onMoveDocument = useCallback(
    (id: UnpackedHypermediaId, origin?: DocumentCardActionOrigin) => destinationDialog.open({id, mode: 'move', origin}),
    [destinationDialog],
  )
  const canWriteDocument = useCallback(
    (id: UnpackedHypermediaId) =>
      !!signingAccountId && (id.uid === signingAccountId || (canEdit && id.uid === docId.uid)),
    [canEdit, docId.uid, signingAccountId],
  )

  return (
    <WebSitePageShell siteUid={docId.uid}>
      <CommentsProvider renderInlineEditor={renderWebInlineEditor}>
        <DocumentActionsProvider
          onCopyLink={() => {}}
          selectedAccountUid={signingAccountId ?? undefined}
          myAccountIds={signingAccountId ? [signingAccountId] : []}
          canWriteDocument={canWriteDocument}
          onMoveDocument={signingAccountId ? onMoveDocument : undefined}
          onDeleteDocument={onDeleteDocument}
        >
          <FeedPage docId={docId} extraMenuItems={menuItems} rightActions={<WebHeaderActions siteUid={docId.uid} />} />
        </DocumentActionsProvider>
      </CommentsProvider>
      {deleteDialog.content}
      {destinationDialog.content}
    </WebSitePageShell>
  )
}
