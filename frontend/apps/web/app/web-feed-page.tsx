import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {CommentsProvider, InlineEditCommentProps} from '@shm/shared/comments-service-provider'
import {DocumentActionsProvider} from '@shm/shared/document-actions-context'
import {Spinner} from '@shm/ui/spinner'
import {FeedPage} from '@shm/ui/feed-page-common'
import {lazy, Suspense, useCallback} from 'react'
import {useWebCanEdit} from './document-edit/use-web-can-edit'
import {WebHeaderActions, WebSitePageShell, useWebMenuItems} from './web-utils'
import {useWebDeleteDocumentDialog} from './web-delete-document-dialog'

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
  const onDeleteDocument = useCallback(
    (id: UnpackedHypermediaId, onSuccess?: () => void) => {
      deleteDialog.open({id, onSuccess})
    },
    [deleteDialog],
  )

  return (
    <WebSitePageShell siteUid={docId.uid}>
      <CommentsProvider renderInlineEditor={renderWebInlineEditor}>
        <DocumentActionsProvider
          onCopyLink={() => {}}
          selectedAccountUid={signingAccountId ?? undefined}
          myAccountIds={signingAccountId ? [signingAccountId] : []}
          onDeleteDocument={onDeleteDocument}
        >
          <FeedPage docId={docId} extraMenuItems={menuItems} rightActions={<WebHeaderActions siteUid={docId.uid} />} />
        </DocumentActionsProvider>
      </CommentsProvider>
      {deleteDialog.content}
    </WebSitePageShell>
  )
}
