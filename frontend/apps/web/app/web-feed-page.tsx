import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {CommentsProvider, InlineEditCommentProps} from '@shm/shared/comments-service-provider'
import {DocumentActionsProvider} from '@shm/shared/document-actions-context'
import {FeedPage, type FeedPageView} from '@shm/ui/feed-page-common'
import type {CommentEditorProps} from '@shm/ui/resource-page-common'
import {Spinner} from '@shm/ui/spinner'
import {useSearchParams} from '@remix-run/react'
import {lazy, Suspense, useCallback} from 'react'
import {WebHeaderActions, WebSitePageShell, useWebMenuItems} from './web-utils'

const LazyWebInlineEditor = lazy(() => import('./commenting').then((mod) => ({default: mod.WebInlineEditBox})))

const LazyWebCommenting = lazy(() => import('./commenting'))

function WebFeedCommentEditor(props: CommentEditorProps) {
  return (
    <Suspense fallback={<Spinner />}>
      <LazyWebCommenting {...props} />
    </Suspense>
  )
}

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
  const [searchParams, setSearchParams] = useSearchParams()
  const activeView: FeedPageView = searchParams.get('feedView') === 'discussions' ? 'discussions' : 'feed'

  const setActiveView = useCallback(
    (view: FeedPageView) => {
      const nextParams = new URLSearchParams(searchParams)
      if (view === 'feed') {
        nextParams.delete('feedView')
      } else {
        nextParams.set('feedView', 'discussions')
      }
      setSearchParams(nextParams, {replace: true})
    },
    [searchParams, setSearchParams],
  )

  return (
    <WebSitePageShell siteUid={docId.uid}>
      <CommentsProvider renderInlineEditor={renderWebInlineEditor}>
        <DocumentActionsProvider onCopyLink={() => {}}>
          <FeedPage
            docId={docId}
            extraMenuItems={menuItems}
            rightActions={<WebHeaderActions siteUid={docId.uid} />}
            feedView={activeView}
            onFeedViewChange={setActiveView}
            CommentEditor={WebFeedCommentEditor}
          />
        </DocumentActionsProvider>
      </CommentsProvider>
    </WebSitePageShell>
  )
}
