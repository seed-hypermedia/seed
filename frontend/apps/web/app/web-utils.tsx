import {createInspectNavRouteFromRoute, hmId, useJoinSite, useRouteLink, useUniversalAppContext} from '@shm/shared'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useAccount} from '@shm/shared/models/entity'
import {isNotificationEventRead} from '@shm/shared/models/notification-read-logic'
import {displayHostname, routeToUrl} from '@shm/shared/utils/entity-id-url'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {ButtonLink} from '@shm/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {copyUrlToClipboardWithFeedback} from '@shm/ui/copy-to-clipboard'
import {HypermediaHostBanner} from '@shm/ui/hm-host-banner'
import {HMIcon} from '@shm/ui/hm-icon'
import {Link} from '@shm/ui/icons'
import {JoinButton} from '@shm/ui/join-button'
import {MobilePanelSheet} from '@shm/ui/mobile-panel-sheet'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useMedia} from '@shm/ui/use-media'
import {Bell, LogOut, Search, User, UserCog} from 'lucide-react'
import {ReactNode, useMemo, useState} from 'react'
import {LogoutDialog, useCreateAccount, useLocalKeyPair} from './auth'
import {getVaultAccountSettingsUrl} from './vault-links'
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
 * Site-header join button or avatar with notifications bell
 */
export function WebHeaderActions({siteUid}: {siteUid: string}) {
  const keyPair = useLocalKeyPair()
  const accountId = keyPair?.delegatedAccountUid ?? keyPair?.id
  const {content: createAccountContent, createAccount} = useCreateAccount({})
  const {isJoined, joinSite} = useJoinSite({siteUid})
  const logoutDialog = useAppDialog(LogoutDialog)

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

  const navigate = useNavigate()
  const vaultAccountSettingsUrl = getVaultAccountSettingsUrl({
    vaultUrl: keyPair?.vaultUrl,
    accountUid: keyPair?.delegatedAccountUid,
  })
  const media = useMedia()
  const isMobile = media.xs
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Show the join button if not joined the site
  if (!keyPair) {
    return (
      <>
        <JoinButton onClick={() => createAccount()} />
        {createAccountContent}
      </>
    )
  }

  if (!isJoined) {
    return (
      <>
        <JoinButton onClick={() => joinSite()} />
        {createAccountContent}
      </>
    )
  }

  // How the avatar and bell if joined.
  const avatarIcon = (
    <HMIcon
      id={account?.id ?? hmId(accountId!, {latest: true})}
      name={account?.metadata?.name}
      icon={account?.metadata?.icon}
      size={32}
    />
  )

  const menuItems = (
    <>
      <button
        className="hover:bg-accent flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => {
          if (accountId) {
            navigate({key: 'profile', id: hmId(accountId, {latest: true})})
          }
          setMobileMenuOpen(false)
        }}
      >
        <User className="size-5" />
        <span className="text-sm">My Profile</span>
      </button>
      <div className="bg-border mx-4 h-px" />
      <button
        className="hover:bg-accent flex w-full items-center gap-3 px-4 py-3 text-left disabled:opacity-50"
        onClick={() => {
          if (vaultAccountSettingsUrl) {
            window.open(vaultAccountSettingsUrl, '_blank')
          }
          setMobileMenuOpen(false)
        }}
        disabled={!vaultAccountSettingsUrl}
      >
        <UserCog className="size-5" />
        <span className="text-sm">Manage account</span>
      </button>
      <div className="bg-border mx-4 h-px" />
      <button
        className="text-destructive hover:bg-accent flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => {
          setMobileMenuOpen(false)
          logoutDialog.open({})
        }}
      >
        <LogOut className="size-5" />
        <span className="text-sm">Log out</span>
      </button>
    </>
  )

  return (
    <>
      {isMobile ? (
        <div className="flex items-center gap-2">
          <button className="flex cursor-pointer rounded-full shadow-lg" onClick={() => setMobileMenuOpen(true)}>
            {avatarIcon}
          </button>
          {keyPair.notifyServerUrl ? <NotifsButton /> : null}
          <MobilePanelSheet isOpen={mobileMenuOpen} title="" onClose={() => setMobileMenuOpen(false)}>
            <div className="flex items-center gap-3 px-4 py-4">
              {avatarIcon}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{account?.metadata?.name || 'Account'}</p>
              </div>
            </div>
            <div className="bg-border h-px" />
            {menuItems}
          </MobilePanelSheet>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex cursor-pointer rounded-full shadow-lg">{avatarIcon}</button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" className="min-w-[200px]">
              <div className="flex items-center gap-3 px-2 py-2">
                {avatarIcon}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{account?.metadata?.name || 'Account'}</p>
                </div>
              </div>
              <DropdownMenuSeparator className="bg-black/10 dark:bg-white/10" />
              <DropdownMenuItem
                onClick={() => {
                  if (accountId) {
                    navigate({key: 'profile', id: hmId(accountId, {latest: true})})
                  }
                }}
              >
                <User className="size-4" />
                My Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  if (vaultAccountSettingsUrl) {
                    window.open(vaultAccountSettingsUrl, '_blank')
                  }
                }}
                disabled={!vaultAccountSettingsUrl}
              >
                <UserCog className="size-4" />
                Manage account
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-black/10 dark:bg-white/10" />
              <DropdownMenuItem variant="destructive" onClick={() => logoutDialog.open({})}>
                <LogOut className="size-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {keyPair.notifyServerUrl ? <NotifsButton /> : null}
        </div>
      )}
      {logoutDialog.content}
      {createAccountContent}
    </>
  )
}

/**
 * Shared shell for site-scoped web pages that need consistent top-level chrome.
 */
export function WebSitePageShell({children, siteUid}: {children?: ReactNode; siteUid: string}) {
  const {origin, originHomeId} = useUniversalAppContext()
  const shouldShowHostBanner = origin && originHomeId && siteUid !== originHomeId.uid

  return (
    <>
      {shouldShowHostBanner ? <HypermediaHostBanner origin={origin} /> : null}
      {children}
    </>
  )
}

function NotifsButton() {
  const storedView = typeof window !== 'undefined' ? localStorage.getItem('seed-notifications-view') : null
  const linkProps = useRouteLink({key: 'notifications', view: storedView === 'unread' ? 'unread' : undefined})
  const {originHomeId} = useUniversalAppContext()
  const siteUid = originHomeId?.uid
  const inbox = useWebNotificationInbox(siteUid)
  const readState = useWebNotificationReadState(siteUid)

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
