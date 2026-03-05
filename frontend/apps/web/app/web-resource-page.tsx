import {UnpackedHypermediaId, useUniversalAppContext} from '@shm/shared'
import {CommentsProvider, isRouteEqualToCommentTarget} from '@shm/shared/comments-service-provider'
import {HMComment} from '@shm/shared/hm-types'
import {useNavRoute, useNavigate} from '@shm/shared/utils/navigation'
import {HypermediaHostBanner} from '@shm/ui/hm-host-banner'
import {CommentEditorProps, ResourcePage} from '@shm/ui/resource-page-common'
import {useCallback, useEffect, useRef} from 'react'
import {preloadCommenting} from './client-lazy'
import {PageFooter} from './page-footer'
import {WebAccountFooter} from './web-utils'

export interface WebResourcePageProps {
  docId: UnpackedHypermediaId
  CommentEditor?: React.ComponentType<CommentEditorProps>
}

/**
 * Web-specific wrapper for ResourcePage that handles:
 * - HypermediaHostBanner (shown when viewing content from a different site)
 * - Account button with login/create account flow
 */
export function WebResourcePage({docId, CommentEditor}: WebResourcePageProps) {
  const {origin, originHomeId} = useUniversalAppContext()
  const route = useNavRoute()
  const navigate = useNavigate()
  const replaceRoute = useNavigate('replace')

  // Preload the comment editor chunk on first hover over any Comments-related element
  const preloaded = useRef(false)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (preloaded.current) return
      const target = e.target as HTMLElement
      // Match the Comments tab button or any element with comment-related text
      if (target.closest?.('a[href*="comments"], button')?.textContent?.includes('Comments')) {
        preloaded.current = true
        preloadCommenting()
      }
    }
    document.addEventListener('mouseover', handler, {passive: true})
    return () => document.removeEventListener('mouseover', handler)
  }, [])

  // Show banner when viewing content from a different site than the host
  const siteUid = docId.uid
  const showBanner = origin && originHomeId && siteUid !== originHomeId.uid

  const onReplyClick = useCallback(
    (replyComment: HMComment) => {
      const targetRoute = isRouteEqualToCommentTarget({
        id: docId,
        comment: replyComment,
      })
      if (targetRoute) {
        navigate({
          key: 'document',
          id: targetRoute,
          panel: {
            key: 'comments',
            id: targetRoute,
            openComment: replyComment.id,
            isReplying: true,
          },
        })
      } else if (route.key === 'comments') {
        replaceRoute({...route, openComment: replyComment.id, isReplying: true})
      } else {
        replaceRoute({
          ...route,
          panel: {
            key: 'comments',
            id: docId,
            openComment: replyComment.id,
            isReplying: true,
          },
        } as any)
      }
    },
    [route, docId, navigate, replaceRoute],
  )

  const onReplyCountClick = useCallback(
    (replyComment: HMComment) => {
      const targetRoute = isRouteEqualToCommentTarget({
        id: docId,
        comment: replyComment,
      })
      if (targetRoute) {
        navigate({
          key: 'document',
          id: targetRoute,
          panel: {
            key: 'comments',
            id: targetRoute,
            openComment: replyComment.id,
          },
        })
      } else if (route.key === 'comments') {
        replaceRoute({...route, openComment: replyComment.id})
      } else {
        replaceRoute({
          ...route,
          panel: {
            key: 'comments',
            id: docId,
            openComment: replyComment.id,
          },
        } as any)
      }
    },
    [route, docId, navigate, replaceRoute],
  )

  return (
    <WebAccountFooter liftForPageFooter={true}>
      {showBanner && <HypermediaHostBanner origin={origin} />}
      <CommentsProvider onReplyClick={onReplyClick} onReplyCountClick={onReplyCountClick}>
        <ResourcePage
          docId={docId}
          CommentEditor={CommentEditor}
          pageFooter={<PageFooter id={docId} hideDeviceLinkToast={true} />}
        />
      </CommentsProvider>
    </WebAccountFooter>
  )
}
