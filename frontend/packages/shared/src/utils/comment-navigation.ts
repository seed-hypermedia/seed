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
            openComment: replyComment.id,
            isReplying: true,
            ...replyVersionData,
          },
        } as any)
      } else if (route.key === 'comments') {
        replaceRoute({...route, openComment: replyComment.id, isReplying: true, ...replyVersionData} as any)
      } else {
        replaceRoute({
          ...route,
          panel: {
            key: 'comments',
            id: docId,
            openComment: replyComment.id,
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
        } as any)
      } else if (route.key === 'comments') {
        replaceRoute({
          ...route,
          openComment: replyComment.id,
          isReplying: undefined,
          replyCommentVersion: undefined,
          rootReplyCommentVersion: undefined,
        } as any)
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

  return {onReplyClick, onReplyCountClick}
}
