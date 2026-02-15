import {UnpackedHypermediaId, useUniversalAppContext} from '@shm/shared'
import {
  CommentsProvider,
  isRouteEqualToCommentTarget,
} from '@shm/shared/comments-service-provider'
import {HMComment} from '@shm/shared/hm-types'
import {useNavRoute, useNavigate} from '@shm/shared/utils/navigation'
import {HypermediaHostBanner} from '@shm/ui/hm-host-banner'
import {CommentEditorProps, ResourcePage} from '@shm/ui/resource-page-common'
import {useCallback} from 'react'
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
            key: 'discussions',
            id: targetRoute,
            openComment: replyComment.id,
            isReplying: true,
          },
        })
      } else if (route.key === 'discussions') {
        replaceRoute({...route, openComment: replyComment.id, isReplying: true})
      } else {
        replaceRoute({
          ...route,
          panel: {
            key: 'discussions',
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
            key: 'discussions',
            id: targetRoute,
            openComment: replyComment.id,
          },
        })
      } else if (route.key === 'discussions') {
        replaceRoute({...route, openComment: replyComment.id})
      } else {
        replaceRoute({
          ...route,
          panel: {
            key: 'discussions',
            id: docId,
            openComment: replyComment.id,
          },
        } as any)
      }
    },
    [route, docId, navigate, replaceRoute],
  )

  return (
    <WebAccountFooter>
      {showBanner && <HypermediaHostBanner origin={origin} />}
      <CommentsProvider
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
      >
        <ResourcePage docId={docId} CommentEditor={CommentEditor} />
      </CommentsProvider>
    </WebAccountFooter>
  )
}
