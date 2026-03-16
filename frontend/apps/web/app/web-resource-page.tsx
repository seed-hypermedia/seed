import {HMComment, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useUniversalAppContext} from '@shm/shared'
import {CommentsProvider, isRouteEqualToCommentTarget} from '@shm/shared/comments-service-provider'
import {useNavRoute, useNavigate} from '@shm/shared/utils/navigation'
import {HypermediaHostBanner} from '@shm/ui/hm-host-banner'
import {CommentEditorProps, ResourcePage} from '@shm/ui/resource-page-common'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useCallback, useEffect, useMemo, useRef} from 'react'
import {EditProfileDialog, LogoutButton, useLocalKeyPair} from './auth'
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
  const userKeyPair = useLocalKeyPair()
  const editProfileDialog = useAppDialog(EditProfileDialog)

  // Determine if viewing own profile on site-profile page
  const isSiteProfile = route.key === 'site-profile'
  const profileAccountUid = isSiteProfile ? route.accountUid || docId.uid : null
  const isOwnProfile = isSiteProfile && userKeyPair && profileAccountUid === userKeyPair.id
  const isDelegated = !!userKeyPair?.delegatedAccountUid

  // Profile edit callback - only for non-delegated own profile
  const onEditProfile = useMemo(() => {
    if (!isOwnProfile || isDelegated || !profileAccountUid) return undefined
    return () => editProfileDialog.open({accountUid: profileAccountUid})
  }, [isOwnProfile, isDelegated, profileAccountUid, editProfileDialog])

  // Profile header buttons (logout) - only for own profile
  const profileHeaderButtons = useMemo(() => {
    if (!isOwnProfile) return undefined
    return <LogoutButton />
  }, [isOwnProfile])

  // Preload the comment editor chunk on first hover over any Comments-related element
  const preloaded = useRef(false)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (preloaded.current) return
      const target = e.target as HTMLElement
      if (target.closest?.('[data-tab="comments"]')) {
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
    <WebAccountFooter liftForPageFooter={true} siteUid={docId.uid}>
      {showBanner && <HypermediaHostBanner origin={origin} />}
      <CommentsProvider onReplyClick={onReplyClick} onReplyCountClick={onReplyCountClick}>
        <ResourcePage
          docId={docId}
          CommentEditor={CommentEditor}
          pageFooter={<PageFooter id={docId} hideDeviceLinkToast={true} />}
          onEditProfile={onEditProfile}
          profileHeaderButtons={profileHeaderButtons}
        />
      </CommentsProvider>
      {editProfileDialog.content}
    </WebAccountFooter>
  )
}
