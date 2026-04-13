import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {CommentsProvider, InlineEditCommentProps} from '@shm/shared/comments-service-provider'
import {Spinner} from '@shm/ui/spinner'
import {FeedPage} from '@shm/ui/feed-page-common'
import {lazy, Suspense} from 'react'
import {WebHeaderActions, WebSitePageShell, useWebMenuItems} from './web-utils'

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
  const menuItems = useWebMenuItems()

  return (
    <WebSitePageShell siteUid={docId.uid}>
      <CommentsProvider renderInlineEditor={renderWebInlineEditor}>
        <FeedPage docId={docId} extraMenuItems={menuItems} rightActions={<WebHeaderActions siteUid={docId.uid} />} />
      </CommentsProvider>
    </WebSitePageShell>
  )
}
