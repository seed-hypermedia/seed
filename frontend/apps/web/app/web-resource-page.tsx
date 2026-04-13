import {HMComment, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useJoinSite, useUniversalAppContext} from '@shm/shared'
import {
  CommentsProvider,
  InlineEditCommentProps,
  isRouteEqualToCommentTarget,
} from '@shm/shared/comments-service-provider'
import {NOTIFY_SERVICE_HOST} from '@shm/shared/constants'
import {useResource} from '@shm/shared/models/entity'
import {useNavRoute, useNavigate} from '@shm/shared/utils/navigation'
import {InlineSubscribeBox} from '@shm/ui/inline-subscribe-box'
import {InspectorPage} from '@shm/ui/inspector-page'
import {CommentEditorProps, ResourcePage} from '@shm/ui/resource-page-common'
import {Spinner} from '@shm/ui/spinner'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {lazy, Suspense, useCallback, useEffect, useMemo, useRef} from 'react'
import {EditProfileDialog, LogoutButton, useCreateAccount, useLocalKeyPair, useVaultSuccessDialog} from './auth'
import {preloadCommenting} from './client-lazy'
import {setPendingIntent} from './local-db'
import {PageFooter} from './page-footer'
import {processPendingIntent} from './pending-intent'
import {WebHeaderActions, WebSitePageShell} from './web-utils'

/** Lazy-loaded inline comment editor — avoids pulling the full editor bundle eagerly. */
const LazyWebInlineEditor = lazy(() => import('./commenting').then((mod) => ({default: mod.WebInlineEditBox})))

/** Renders the inline editor for web comment editing, lazy-loaded. */
function renderWebInlineEditor(props: InlineEditCommentProps) {
  return (
    <Suspense fallback={<Spinner />}>
      <LazyWebInlineEditor {...props} />
    </Suspense>
  )
}

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
  const vaultSuccessContent = useVaultSuccessDialog()

  // Determine if viewing own profile on site-profile page
  const isSiteProfile = route.key === 'site-profile'
  const profileAccountUid = isSiteProfile ? route.accountUid || docId.uid : null
  const ownAccountUid = userKeyPair?.delegatedAccountUid ?? userKeyPair?.id
  const isOwnProfile = isSiteProfile && !!userKeyPair && profileAccountUid === ownAccountUid
  const isDelegated = !!userKeyPair?.delegatedAccountUid

  // Profile edit callback - only for non-delegated own profile
  const onEditProfile = useMemo(() => {
    if (!isOwnProfile || isDelegated || !profileAccountUid) return undefined
    return () => editProfileDialog.open({accountUid: profileAccountUid})
  }, [isOwnProfile, isDelegated, profileAccountUid, editProfileDialog])

  // Profile header buttons (vault account settings + logout) - only for own profile
  const profileHeaderButtons = useMemo(() => {
    if (!isOwnProfile) return undefined
    return <LogoutButton />
  }, [isOwnProfile])

  // Follow intent flow for unauthenticated users
  const {content: followAccountContent, createAccount: openFollowAccountDialog} = useCreateAccount({
    onClose: () => {
      processPendingIntent(originHomeId ?? undefined)
    },
  })

  const onFollowClick = useMemo(() => {
    if (userKeyPair) return undefined
    if (!isSiteProfile || !profileAccountUid) return undefined
    return async () => {
      await setPendingIntent({type: 'follow', profileUid: profileAccountUid})
      openFollowAccountDialog()
    }
  }, [userKeyPair, isSiteProfile, profileAccountUid, openFollowAccountDialog])

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

  const siteUid = docId.uid

  // Inline subscribe box for non-members
  const {isJoined} = useJoinSite({siteUid})
  const siteResource = useResource(docId.path?.length ? undefined : docId)
  const siteMetadata = siteResource.data?.type === 'document' ? siteResource.data.document?.metadata : undefined
  const showSubscribeBox = !userKeyPair || !isJoined
  const inlineInsert = useMemo(() => {
    if (!showSubscribeBox || !NOTIFY_SERVICE_HOST) return undefined
    return (
      <InlineSubscribeBox
        accountId={siteUid}
        notifyServiceHost={NOTIFY_SERVICE_HOST}
        accountMeta={siteMetadata ?? undefined}
      />
    )
  }, [showSubscribeBox, siteUid, siteMetadata])

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
        })
      } else if (route.key === 'comments') {
        replaceRoute({...route, openComment: replyComment.id, isReplying: true, ...replyVersionData})
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
        replaceRoute({
          ...route,
          openComment: replyComment.id,
          isReplying: undefined,
          replyCommentVersion: undefined,
          rootReplyCommentVersion: undefined,
        })
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
    <WebSitePageShell liftForPageFooter={true} siteUid={docId.uid}>
      <CommentsProvider
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
        renderInlineEditor={renderWebInlineEditor}
      >
        <ResourcePage
          docId={docId}
          CommentEditor={CommentEditor}
          pageFooter={<PageFooter id={docId} hideDeviceLinkToast={true} />}
          onEditProfile={onEditProfile}
          profileHeaderButtons={profileHeaderButtons}
          onFollowClick={onFollowClick}
          rightActions={<WebHeaderActions siteUid={docId.uid} />}
          inlineInsert={inlineInsert}
        />
      </CommentsProvider>
      {editProfileDialog.content}
      {followAccountContent}
      {vaultSuccessContent}
    </WebSitePageShell>
  )
}

/** Web-specific wrapper for the dedicated inspector page. */
export function WebInspectorPage({docId}: {docId: UnpackedHypermediaId}) {
  return (
    <WebSitePageShell liftForPageFooter={true} siteUid={docId.uid}>
      <InspectorPage docId={docId} pageFooter={<PageFooter id={docId} hideDeviceLinkToast={true} />} />
    </WebSitePageShell>
  )
}

/** Web-specific wrapper for the dedicated inspector page. */
export function WebInspectorPage({docId}: {docId: UnpackedHypermediaId}) {
  return (
    <WebAccountFooter liftForPageFooter={true} siteUid={docId.uid}>
      <InspectorPage docId={docId} pageFooter={<PageFooter id={docId} hideDeviceLinkToast={true} />} />
    </WebAccountFooter>
  )
}
