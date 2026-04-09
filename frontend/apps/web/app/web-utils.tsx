import {createInspectNavRouteFromRoute, hmId, useJoinSite, useRouteLink} from '@shm/shared'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useAccount} from '@shm/shared/models/entity'
import {isNotificationEventRead} from '@shm/shared/models/notification-read-logic'
import {displayHostname, routeToUrl} from '@shm/shared/utils/entity-id-url'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {ButtonLink} from '@shm/ui/button'
import {copyUrlToClipboardWithFeedback} from '@shm/ui/copy-to-clipboard'
import {FloatingAccountFooter} from '@shm/ui/floating-account-footer'
import {HMIcon} from '@shm/ui/hm-icon'
import {Link} from '@shm/ui/icons'
import {JoinButton} from '@shm/ui/join-button'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {Bell, Search} from 'lucide-react'
import {ReactNode, useMemo} from 'react'
import {useCreateAccount, useLocalKeyPair} from './auth'
import {useWebNotificationInbox, useWebNotificationReadState} from './web-notifications'

export function useWebMenuItems(): MenuItemType[] {
  const route = useNavRoute()
  const navigate = useNavigate()
  const gwUrl = DEFAULT_GATEWAY_URL
  const gatewayLink = useMemo(() => routeToUrl(route, {hostname: gwUrl}), [route, gwUrl])
  const inspectRoute = useMemo(() => {
    const wrappedRoute = createInspectNavRouteFromRoute(route)
    return wrappedRoute?.key === 'inspect' ? wrappedRoute : null
  }, [route])

  return useMemo(
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
      ...(inspectRoute
        ? [
            {
              key: 'inspect',
              label: 'Inspect Document',
              icon: <Search className="size-4" />,
              onClick: () => {
                navigate(inspectRoute)
              },
            } satisfies MenuItemType,
          ]
        : []),
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
    ],
    [gwUrl, gatewayLink, inspectRoute, navigate],
  )
}

/**
 * Join button for the site header
 */
export function WebHeaderActions({siteUid}: {siteUid: string}) {
  const keyPair = useLocalKeyPair()

  const {content: createAccountContent, createAccount} = useCreateAccount({})

  const {isJoined, joinSite} = useJoinSite({siteUid})

  let joinButton = null
  if (keyPair) {
    if (!isJoined) {
      joinButton = <JoinButton onClick={() => joinSite()} />
    }
  } else {
    joinButton = <JoinButton onClick={() => createAccount()} />
  }

  return (
    <>
      {joinButton}
      {createAccountContent}
    </>
  )
}

/**
 * Wrapper for web pages that shows the floating account avatar in the bottom-left.
 */
export function WebAccountFooter({
  children,
  siteUid,
  liftForPageFooter = false,
}: {
  children?: ReactNode
  siteUid: string
  liftForPageFooter?: boolean
}) {
  const keyPair = useLocalKeyPair()
  const accountId = keyPair?.delegatedAccountUid ?? keyPair?.id

  const myAccount = useAccount(accountId || undefined, {
    retry: 3,
    retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
    refetchOnWindowFocus: false,
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
          key: 'site-profile',
          id: hmId(siteUid, {latest: true}),
          accountUid: accountId!,
          tab: 'profile' as const,
        }
      : null,
  )

  const accountButton = keyPair ? (
    <div className="flex items-center gap-2 rounded-full bg-white p-1 dark:bg-black">
      <a {...profileLinkProps} className="flex rounded-full shadow-lg">
        <HMIcon
          id={account?.id ?? hmId(accountId!, {latest: true})}
          name={account?.metadata?.name}
          icon={account?.metadata?.icon}
          size={32}
        />
      </a>
      <NotifsButton />
    </div>
  ) : null

  return (
    <FloatingAccountFooter floatingButton={accountButton} liftForPageFooter={liftForPageFooter}>
      {children}
    </FloatingAccountFooter>
  )
}

function NotifsButton() {
  const linkProps = useRouteLink({key: 'notifications'})
  const inbox = useWebNotificationInbox()
  const readState = useWebNotificationReadState()

  const unreadCount = useMemo(() => {
    const notifications = inbox.data?.notifications ?? []
    if (!notifications.length || !readState.data) return 0
    return notifications.filter(
      (item) =>
        !isNotificationEventRead({
          readState: readState.data,
          eventId: item.feedEventId,
          eventAtMs: item.eventAtMs,
        }),
    ).length
  }, [inbox.data, readState.data])

  return (
    <ButtonLink
      className="relative h-8 rounded-full border-1 border-transparent p-0"
      variant="ghost"
      size="icon"
      {...linkProps}
    >
      <Bell className="size-4" />
      {unreadCount > 0 ? (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-lg bg-red-500 px-1 text-[12px] font-bold text-white">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      ) : null}
    </ButtonLink>
  )
}
