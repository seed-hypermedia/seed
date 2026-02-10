import {
  hmId,
  UnpackedHypermediaId,
  useRouteLink,
  useUniversalAppContext,
} from '@shm/shared'
import {
  CommentsProvider,
  isRouteEqualToCommentTarget,
} from '@shm/shared/comments-service-provider'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {HMComment} from '@shm/shared/hm-types'
import {useAccount} from '@shm/shared/models/entity'
import {createWebHMUrl, displayHostname} from '@shm/shared/utils/entity-id-url'
import {useNavRoute, useNavigate} from '@shm/shared/utils/navigation'
import {copyUrlToClipboardWithFeedback} from '@shm/ui/copy-to-clipboard'
import {HistoryIcon} from '@shm/ui/icons'
import {HypermediaHostBanner} from '@shm/ui/hm-host-banner'
import {HMIcon} from '@shm/ui/hm-icon'
import {Link} from '@shm/ui/icons'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {CommentEditorProps, ResourcePage} from '@shm/ui/resource-page-common'
import {CircleUser, Folder} from 'lucide-react'
import {useCallback, useMemo} from 'react'
import {useCreateAccount, useLocalKeyPair} from './auth'

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

  const {accountButton, extraContent} = useWebAccountButton()

  // Show banner when viewing content from a different site than the host
  const siteUid = docId.uid
  const showBanner = origin && originHomeId && siteUid !== originHomeId.uid

  const gwUrl = DEFAULT_GATEWAY_URL
  const gatewayLink = useMemo(
    () =>
      createWebHMUrl(docId.uid, {
        path: docId.path,
        hostname: gwUrl,
      }),
    [docId.uid, docId.path, gwUrl],
  )

  const menuItems: MenuItemType[] = useMemo(
    () => [
      {
        key: 'copy-link',
        label: 'Copy Link',
        icon: <Link className="size-4" />,
        onClick: () => {
          if (typeof window !== 'undefined') {
            copyUrlToClipboardWithFeedback(window.location.href, 'Link')
          }
        },
      },
      {
        key: 'copy-gateway-link',
        label: `Copy ${displayHostname(gwUrl)} Link`,
        icon: <Link className="size-4" />,
        onClick: () => {
          if (gatewayLink) {
            copyUrlToClipboardWithFeedback(gatewayLink, 'Link')
          }
        },
      },
      {
        key: 'versions',
        label: 'Document Versions',
        icon: <HistoryIcon className="size-4" />,
        onClick: () => {
          replaceRoute({
            key: 'document',
            id: docId,
            panel: {key: 'activity', id: docId, filterEventType: ['Ref']},
          } as any)
        },
      },
      {
        key: 'directory',
        label: 'Directory',
        icon: <Folder className="size-4" />,
        onClick: () => {
          navigate({key: 'directory', id: docId})
        },
      },
    ],
    [gwUrl, gatewayLink, docId, replaceRoute, navigate],
  )

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
    <>
      {showBanner && <HypermediaHostBanner origin={origin} />}
      <CommentsProvider
        onReplyClick={onReplyClick}
        onReplyCountClick={onReplyCountClick}
      >
        <ResourcePage
          docId={docId}
          CommentEditor={CommentEditor}
          optionsMenuItems={menuItems}
        />
      </CommentsProvider>
      <div className="fixed bottom-4 left-4 z-30">{accountButton}</div>
      {extraContent}
    </>
  )
}

function useWebAccountButton() {
  const keyPair = useLocalKeyPair()

  const myAccount = useAccount(keyPair?.id || undefined, {
    retry: 3,
    retryDelay: (attemptIndex: number) =>
      Math.min(1000 * 2 ** attemptIndex, 30000),
    refetchOnWindowFocus: false,
  })

  const {content: createAccountContent, createAccount} = useCreateAccount({
    onClose: () => {
      setTimeout(() => {
        myAccount.refetch()
      }, 500)
    },
  })

  const account = useMemo(() => {
    if (!myAccount.data?.id) return null
    return {
      id: hmId(myAccount.data.id.uid, {latest: true}),
      metadata: myAccount.data.metadata ?? undefined,
    }
  }, [myAccount.data])

  const profileLinkProps = useRouteLink(
    keyPair
      ? {
          key: 'profile',
          id: hmId(keyPair.id, {latest: true}),
        }
      : null,
  )

  const accountButton = account?.id ? (
    <a {...profileLinkProps} className="flex rounded-full shadow-lg">
      <HMIcon
        id={account.id}
        name={account.metadata?.name}
        icon={account.metadata?.icon}
        size={32}
      />
    </a>
  ) : (
    <button
      className="flex items-center gap-2 rounded-lg bg-white p-2 font-bold shadow-lg transition-colors hover:bg-gray-100 dark:bg-gray-800"
      onClick={() => createAccount()}
    >
      <CircleUser className="size-4" />
      Join
    </button>
  )

  return {
    accountButton,
    extraContent: createAccountContent,
  }
}
