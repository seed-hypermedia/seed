import {HMComment, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {isRouteEqualToCommentTarget} from '../comments-service-provider'
import {type NavRoute} from '../routes'
import {useCallback} from 'react'

/** Navigate function that accepts a route. Both web and desktop provide compatible implementations. */
type NavigateFn = (route: NavRoute) => void

export interface UseCommentNavigationOptions {
  docId: UnpackedHypermediaId
  route: NavRoute
  navigate: NavigateFn
  replaceRoute: NavigateFn
  /** Called after reply navigation completes. Desktop uses this for triggerCommentDraftFocus. */
  onAfterReply?: (docId: UnpackedHypermediaId, comment: HMComment) => void
}

/** Shared comment reply routing logic used by both web and desktop resource pages. */
export function useCommentNavigation({
  docId,
  route,
  navigate,
  replaceRoute,
  onAfterReply,
}: UseCommentNavigationOptions) {
  const onReplyClick = useCallback(
    (replyComment: HMComment) => {
      const threadSelection = {
        openComment: replyComment.threadRoot || replyComment.id,
        replyCommentId:
          replyComment.threadRoot && replyComment.threadRoot !== replyComment.id ? replyComment.id : undefined,
      }
      const currentThread =
        route.key === 'comments'
          ? route.openComment
          : 'panel' in route && route.panel?.key === 'comments'
            ? route.panel.openComment
            : undefined
      const navigateThread = currentThread === threadSelection.openComment ? replaceRoute : navigate
      const replyVersionData = {
        replyCommentVersion: replyComment.version,
        rootReplyCommentVersion: replyComment.threadRootVersion || replyComment.version,
      }
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
            ...threadSelection,
            isReplying: true,
            ...replyVersionData,
          },
        } as any)
      } else if (route.key === 'comments') {
        navigateThread({
          ...route,
          ...threadSelection,
          openCommentVersion: undefined,
          isReplying: true,
          ...replyVersionData,
        } as any)
      } else {
        navigateThread({
          ...route,
          panel: {
            key: 'comments',
            id: docId,
            ...threadSelection,
            isReplying: true,
            ...replyVersionData,
          },
        } as any)
      }
      onAfterReply?.(docId, replyComment)
    },
    [route, docId, navigate, replaceRoute, onAfterReply],
  )

  const onReplyCountClick = useCallback(
    (replyComment: HMComment) => {
      const threadSelection = {
        openComment: replyComment.threadRoot || replyComment.id,
        replyCommentId:
          replyComment.threadRoot && replyComment.threadRoot !== replyComment.id ? replyComment.id : undefined,
      }
      const currentThread =
        route.key === 'comments'
          ? route.openComment
          : 'panel' in route && route.panel?.key === 'comments'
            ? route.panel.openComment
            : undefined
      const navigateThread = currentThread === threadSelection.openComment ? replaceRoute : navigate
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
            ...threadSelection,
          },
        } as any)
      } else if (route.key === 'comments') {
        navigateThread({
          ...route,
          ...threadSelection,
          openCommentVersion: undefined,
          isReplying: undefined,
          replyCommentVersion: undefined,
          rootReplyCommentVersion: undefined,
        } as any)
      } else {
        navigateThread({
          ...route,
          panel: {
            key: 'comments',
            id: docId,
            ...threadSelection,
          },
        } as any)
      }
    },
    [route, docId, navigate, replaceRoute],
  )

  return {onReplyClick, onReplyCountClick}
}
