import {domainResolver} from '@/grpc-client'
import {roleCanWrite, useSelectedAccountCapability} from '@/models/access-control'
import {DEFAULT_AGENT_SERVER_URL, useAgentSession} from '@/models/agents'
import {useForceVaultSync, useLogout, useMyAccountIds, useVaultStatus} from '@/models/daemon'
import {useExistingDraft} from '@/models/drafts'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useNotificationInbox} from '@/models/notification-inbox'
import {isNotificationEventRead, useLocalNotificationReadState} from '@/models/notification-read-state'
import {
  agentSessionUrl,
  agentTriggerUrl,
  agentUrl,
  resolveOmnibarUrlToRoute,
  selectValidatedOmnibarSiteUrl,
} from '@/omnibar-url'
import {useSelectedAccount, useSelectedAccountId} from '@/selected-account'
import {SidebarContext} from '@/sidebar-context'
import {client} from '@/trpc'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useUniversalAppContext} from '@shm/shared'
import {VaultBackendMode, VaultConnectionStatus} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useAccounts, useDomain, useResource} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import {DocumentRoute, FeedRoute, NavRoute} from '@shm/shared/routes'
import {useStream} from '@shm/shared/use-stream'
import {createWebHMUrl, hmId, routeToUrl, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useNavigationDispatch, useNavigationState, useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {AlertDialogDescription, AlertDialogFooter, AlertDialogTitle} from '@shm/ui/components/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {HMIcon} from '@shm/ui/hm-icon'
import {Back, Forward, UploadCloud} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {TitlebarSection} from '@shm/ui/titlebar'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {useQuery} from '@tanstack/react-query'
import {
  ArrowLeftFromLine,
  ArrowRightFromLine,
  Bell,
  ChevronDown,
  ChevronUp,
  Lock,
  LogIn,
  LogOut,
  PanelLeft,
  Plus,
  Search,
  Settings,
  User,
} from 'lucide-react'
import {ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react'
import {BookmarkButton} from './bookmarking'
import {CopyReferenceButton} from './copy-reference-button'
import {useCreateAccountDialog} from './create-account'
import {useDesktopAuthDialog} from './desktop-auth-dialog'
import {usePublishSite} from './publish-site'
import {SearchInput, SearchInputHandle} from './search-input'
import {TitleBarProps} from './titlebar'

// Route keys that have an id and support DocOptionsButton
const DOC_OPTIONS_ROUTE_KEYS = [
  'document',
  'feed',
  'activity',
  'comments',
  'directory',
  'collaborators',
  'inspect',
  'all-documents',
] as const

type DocOptionsRouteKey = (typeof DOC_OPTIONS_ROUTE_KEYS)[number]

const OMNIBAR_DOMAIN_STALE_TIME_MS = 3 * 60 * 60 * 1000

function getUrlHostname(url?: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname || null
  } catch {
    return null
  }
}

function isDocOptionsRoute(route: NavRoute): route is NavRoute & {key: DocOptionsRouteKey; id: UnpackedHypermediaId} {
  return DOC_OPTIONS_ROUTE_KEYS.includes(route.key as DocOptionsRouteKey) && 'id' in route
}

export function DocOptionsButton(_props: {
  onPublishSite: (input: {id: UnpackedHypermediaId; step?: 'seed-host-custom-domain'}) => void
}) {
  return null
}

function NotificationButton() {
  const accountUid = useSelectedAccountId()
  if (!accountUid) return null
  return <NotificationButtonForAccount accountUid={accountUid} />
}

function NotificationButtonForAccount({accountUid}: {accountUid: string}) {
  const navigate = useNavigate()
  const route = useNavRoute()
  const inbox = useNotificationInbox(accountUid)
  const readState = useLocalNotificationReadState(accountUid)
  const isActive = route.key === 'notifications'
  const persistedView = useQuery({
    queryKey: [queryKeys.SETTINGS, 'notifications-view'],
    queryFn: () => client.appSettings.getSetting.query('notifications-view'),
  })

  const unreadCount = useMemo(() => {
    if (!inbox.data || !readState.data) return 0
    return inbox.data.filter(
      (item) =>
        !isNotificationEventRead({
          readState: readState.data,
          eventId: item.feedEventId,
          eventAtMs: item.eventAtMs,
        }),
    ).length
  }, [inbox.data, readState.data])

  return (
    <Tooltip content="Notifications" asChild>
      <Button
        className={cn(
          'window-no-drag relative h-8 rounded-full border-1 p-0',
          isActive
            ? 'cursor-default border-black/15 bg-black/10 shadow-xs hover:border-black/20 hover:bg-black/15 dark:border-white/15 dark:bg-white/10 dark:hover:border-white/20 dark:hover:bg-white/15'
            : 'border-transparent',
        )}
        aria-current={isActive ? 'page' : undefined}
        aria-disabled={isActive || undefined}
        onClick={
          isActive
            ? undefined
            : () => {
                const view = persistedView.data === 'unread' ? ('unread' as const) : undefined
                navigate({key: 'notifications', view})
              }
        }
      >
        <Bell className="size-4" />
        {unreadCount > 0 ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-lg bg-red-500 px-1 text-[12px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </Button>
    </Tooltip>
  )
}

function LogoutConfirmationDialog({onClose, input}: {onClose: () => void; input: {onSuccess: () => void}}) {
  const logout = useLogout({
    onSuccess: () => {
      onClose()
      input.onSuccess()
      toast.success('Logged out')
    },
    onError: (error) => {
      toast.error('Failed to log out: ' + (error instanceof Error ? error.message : String(error)))
    },
  })

  return (
    <>
      <AlertDialogTitle>Log out?</AlertDialogTitle>
      <AlertDialogDescription>
        This will disconnect the remote vault and delete all local vault keys from this device.
      </AlertDialogDescription>
      <AlertDialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="destructive" disabled={logout.isLoading} onClick={() => logout.mutate()}>
          {logout.isLoading ? 'Logging out…' : 'Log out'}
        </Button>
      </AlertDialogFooter>
    </>
  )
}

export function AccountProfileButton() {
  const navigate = useNavigate()
  const accountUid = useSelectedAccountId()
  const selectedAccount = useSelectedAccount()
  const {selectedIdentity, setSelectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)
  const myAccountIds = useMyAccountIds()
  const accountQueries = useAccounts(myAccountIds.data || [])
  const vaultStatus = useVaultStatus()
  const {isPending: isForceVaultSyncPending, mutate: forceVaultSync} = useForceVaultSync()
  const remoteVaultConnected = vaultStatus.data?.connectionStatus === VaultConnectionStatus.CONNECTED
  const canLogOut = vaultStatus.data?.backendMode === VaultBackendMode.REMOTE
  const [menuOpen, setMenuOpen] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const requestedSyncForMenuOpen = useRef(false)
  const createAccountDialog = useCreateAccountDialog()
  const authDialog = useDesktopAuthDialog()
  const logoutDialog = useAppDialog(LogoutConfirmationDialog, {isAlert: true})

  const accountOptions = myAccountIds.data
    ?.map((uid, index) => {
      const accountData = accountQueries[index]?.data
      if (!accountData) return null
      return accountData
    })
    .filter((d) => !!d)
  const hasAccounts = !!myAccountIds.data?.length

  useEffect(() => {
    if (myAccountIds.data?.length === 0 && selectedIdentityValue) {
      setSelectedIdentity?.(null)
    }
  }, [myAccountIds.data, selectedIdentityValue, setSelectedIdentity])

  useEffect(() => {
    if (!menuOpen) {
      requestedSyncForMenuOpen.current = false
      return
    }
    if (!remoteVaultConnected || isForceVaultSyncPending || requestedSyncForMenuOpen.current) return

    requestedSyncForMenuOpen.current = true

    forceVaultSync(undefined, {
      onError: () => {
        // Best-effort refresh when the account switcher opens.
      },
    })
  }, [forceVaultSync, isForceVaultSyncPending, menuOpen, remoteVaultConnected])

  if (!hasAccounts) {
    return (
      <>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="window-no-drag relative size-8 overflow-hidden rounded-full border-1 border-transparent p-0">
              <div className="bg-muted flex size-8 items-center justify-center rounded-full">
                <User className="text-muted-foreground size-4" />
              </div>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="bottom" align="end" className="w-[320px] rounded-2xl p-0">
            <DropdownMenuItem
              className="cursor-pointer gap-3 rounded-none px-4 py-3"
              onClick={() => authDialog.open({initialSubmit: {type: 'login'}})}
            >
              <div className="flex size-11 items-center justify-center rounded-full border border-black/10 bg-white dark:border-white/10 dark:bg-black/10">
                <LogIn className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-tight font-medium">Sign in</p>
                <p className="text-muted-foreground mt-1 text-sm leading-tight">I already have a Hypermedia identity</p>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-0 bg-black/10 dark:bg-white/10" />
            <DropdownMenuItem
              className="cursor-pointer gap-3 rounded-none px-4 py-3"
              onClick={() => authDialog.open({initialSubmit: {type: 'register'}})}
            >
              <div className="bg-muted flex size-11 items-center justify-center rounded-full dark:bg-black/20">
                <Plus className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-tight font-medium">Create my identity</p>
                <p className="text-muted-foreground mt-1 text-sm leading-tight">New to Seed Hypermedia</p>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-0 bg-black/10 dark:bg-white/10" />
            <DropdownMenuItem
              className="text-muted-foreground cursor-pointer rounded-none px-4 py-3 text-sm"
              onClick={() => authDialog.open({initialStep: 'custom-identity'})}
            >
              I have a different identity domain
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-0 bg-black/10 dark:bg-white/10" />
            <DropdownMenuItem
              className="cursor-pointer gap-3 rounded-none px-4 py-3 text-sm"
              onClick={() => navigate({key: 'settings'})}
            >
              <Settings className="size-4" />
              App settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {authDialog.content}
      </>
    )
  }

  return (
    <>
      <DropdownMenu
        onOpenChange={(open) => {
          setMenuOpen(open)
          if (!open) setSwitcherOpen(false)
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button className="window-no-drag relative size-8 overflow-hidden rounded-full border-1 border-transparent p-0">
            {accountUid ? (
              <HMIcon
                id={hmId(accountUid)}
                name={selectedAccount?.metadata?.name}
                icon={selectedAccount?.metadata?.icon}
                size={32}
              />
            ) : (
              <div className="bg-muted flex size-8 items-center justify-center rounded-full">
                <User className="text-muted-foreground size-4" />
              </div>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom" align="end" className="w-[260px]">
          {/* Account header + switcher */}
          <div className="m-1 rounded-lg border border-black/10 p-1 dark:border-white/10">
            <button
              className="hover:bg-accent flex w-full items-center gap-3 rounded-md px-2 py-2"
              onClick={() => setSwitcherOpen(!switcherOpen)}
            >
              {accountUid ? (
                <HMIcon
                  id={hmId(accountUid)}
                  name={selectedAccount?.metadata?.name}
                  icon={selectedAccount?.metadata?.icon}
                  size={32}
                />
              ) : (
                <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-full">
                  <User className="text-muted-foreground size-4" />
                </div>
              )}
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium">{selectedAccount?.metadata?.name || 'Account'}</p>
              </div>
              {switcherOpen ? <ChevronUp className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
            </button>
            {switcherOpen && (
              <>
                <div
                  className="max-h-[200px] overflow-y-auto"
                  style={{
                    background: [
                      'linear-gradient(var(--popover) 33%, transparent) center top',
                      'linear-gradient(transparent, var(--popover) 66%) center bottom',
                      'radial-gradient(farthest-side at 50% 0, oklch(0 0 0 / 0.12), transparent) center top',
                      'radial-gradient(farthest-side at 50% 100%, oklch(0 0 0 / 0.12), transparent) center bottom',
                    ].join(', '),
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '100% 40px, 100% 40px, 100% 6px, 100% 6px',
                    backgroundAttachment: 'local, local, scroll, scroll',
                  }}
                >
                  {accountOptions?.map((option) =>
                    option ? (
                      <button
                        key={option.id.uid}
                        className={cn(
                          'hover:bg-accent flex w-full items-center gap-3 rounded-md px-2 py-2',
                          selectedIdentityValue === option.id.uid ? 'bg-accent' : '',
                        )}
                        onClick={() => {
                          setSelectedIdentity?.(option.id.uid || null)
                          setSwitcherOpen(false)
                        }}
                      >
                        <HMIcon id={option.id} name={option.metadata?.name} icon={option.metadata?.icon} size={32} />
                        <p className="min-w-0 truncate text-sm">
                          {option.metadata?.name || `?${option.id.uid?.slice(-8)}`}
                        </p>
                      </button>
                    ) : null,
                  )}
                </div>
                <button
                  className="hover:bg-accent flex w-full items-center gap-3 rounded-md px-2 py-2 disabled:opacity-60"
                  onClick={() => {
                    setMenuOpen(false)
                    createAccountDialog.open({})
                  }}
                >
                  <div className="bg-muted flex size-8 items-center justify-center rounded-full">
                    <Plus className="size-4" />
                  </div>
                  <p className="text-sm">Create account</p>
                </button>
              </>
            )}
          </div>
          <DropdownMenuSeparator className="bg-black/10 dark:bg-white/10" />
          {accountUid && (
            <DropdownMenuItem
              onClick={() => {
                navigate({key: 'profile', id: hmId(accountUid)})
              }}
            >
              <User className="size-4" />
              My Profile
            </DropdownMenuItem>
          )}
          {/* <DropdownMenuItem disabled>
            <UserCog className="size-4" />
            Manage account
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Monitor className="size-4" />
            Site settings
          </DropdownMenuItem> */}
          <DropdownMenuItem onClick={() => navigate({key: 'settings'})}>
            <Settings className="size-4" />
            App settings
          </DropdownMenuItem>
          {canLogOut ? (
            <>
              <DropdownMenuSeparator className="bg-black/10 dark:bg-white/10" />
              <DropdownMenuItem
                variant="destructive"
                onClick={() => {
                  setMenuOpen(false)
                  logoutDialog.open({
                    onSuccess: () => {
                      authDialog.close()
                      setSelectedIdentity?.(null)
                      navigate({key: 'onboarding'})
                    },
                  })
                }}
              >
                <LogOut className="size-4" />
                Log out
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {logoutDialog.content}
      {authDialog.content}
      {createAccountDialog.content}
    </>
  )
}

export function PageActionButtons(props: TitleBarProps) {
  const route = useNavRoute()
  return (
    <TitlebarSection>
      {route.key == 'document' || route.key == 'feed' ? <DocumentTitlebarButtons route={route} /> : null}
      <NotificationButton />
      <AccountProfileButton />
    </TitlebarSection>
  )
}

function DocumentTitlebarButtons({route}: {route: DocumentRoute | FeedRoute}) {
  const {id} = route

  const publishSite = usePublishSite()
  const isHomeDoc = !id.path?.length
  const capability = useSelectedAccountCapability(id)
  const canEditDoc = roleCanWrite(capability?.role)
  const entity = useResource(id)
  const showPublishSiteButton =
    isHomeDoc && canEditDoc && entity.data?.type == 'document' && !entity.data.document?.metadata.siteUrl
  return (
    <TitlebarSection>
      {showPublishSiteButton ? (
        <Button variant="default" onClick={() => publishSite.open({id})} size="sm">
          Publish to Web Domain
          <UploadCloud className="size-4" />
        </Button>
      ) : null}
      {publishSite.content}
    </TitlebarSection>
  )
}
export function NavigationButtons() {
  const state = useNavigationState()
  const dispatch = useNavigationDispatch()
  if (!state) return null
  return (
    <div className="no-window-drag flex shrink-0">
      <Button
        size="icon"
        onClick={() => dispatch({type: 'pop'})}
        variant="ghost"
        disabled={state.routeIndex <= 0}
        className="rounded-tl-0 rounded-bl-0 shrink-0"
      >
        <Back className="size-4" />
      </Button>

      <Button
        size="icon"
        onClick={() => dispatch({type: 'forward'})}
        disabled={state.routeIndex >= state.routes.length - 1}
        className="rounded-tr-0 rounded-br-0 shrink-0"
      >
        <Forward className="size-4" />
      </Button>
    </div>
  )
}

export function NavMenuButton({left}: {left?: ReactNode}) {
  const ctx = useContext(SidebarContext)
  const isLocked = useStream(ctx?.isLocked)
  const isHoverVisible = useStream(ctx?.isHoverVisible)
  let icon = <PanelLeft className="size-4" />
  let tooltip = 'Lock Sidebar Open'
  let onPress = ctx?.onLockSidebarOpen
  let key = 'lock'
  let color: undefined | string = undefined

  if (isLocked) {
    tooltip = 'Close Sidebar'
    onPress = ctx?.onCloseSidebar
    key = 'close'
    color = 'text-muted'
  }

  if (isHoverVisible) {
    icon = !isLocked ? <ArrowRightFromLine className="size-4" /> : <ArrowLeftFromLine className="size-4" />
  }

  // Add a state to track the last click time to debounce clicks
  const lastClickTime = useRef(0)

  const handleClick = () => {
    if (onPress) {
      const now = Date.now()
      // Only process click if it's been more than 300ms since the last click
      if (now - lastClickTime.current > 300) {
        onPress()
        lastClickTime.current = now
      }
    }
  }

  return (
    <div className="flex shrink-0 items-center">
      {left || <div />}
      {ctx && (
        <div className="no-window-drag relative z-10">
          <Tooltip
            content={tooltip}
            key={key} // use this key to make sure the component is unmounted when changes, to blur the button and make tooltip disappear
          >
            <Button
              size="icon"
              key={key}
              aria-label={tooltip}
              className="shrink-0"
              // onMouseEnter={ctx.onMenuHover}
              // onMouseLeave={ctx.onMenuHoverLeave}
              onClick={handleClick}
            >
              {icon}
            </Button>
          </Tooltip>
        </div>
      )}
    </div>
  )
}

export function TitlebarTitle() {
  const route = useNavRoute()
  if (route.key !== 'document') return null
  return (
    // @ts-expect-error
    <View userSelect="none" minWidth={100}>
      {/* @ts-expect-error */}
      <DocumentTitle
        id={hmId(route.id.uid, {
          path: route.id.path,
        })}
      />
      {/* @ts-expect-error */}
    </View>
  )
}

// =============================================================================
// OMNIBAR COMPONENT
// =============================================================================

type OmnibarMode = 'idle' | 'focused' | 'search'

/** Label for non-document routes */
function getRouteLabel(route: NavRoute): string | null {
  switch (route.key) {
    case 'onboarding':
      return 'Welcome to Seed Hypermedia'
    case 'library':
      return 'Library'
    case 'agents':
      return 'Agents'
    case 'drafts':
      return 'Drafts'
    case 'contacts':
      return 'Contacts'
    case 'bookmarks':
      return 'Bookmarks'
    case 'settings':
      return 'Settings'
    case 'api-inspector':
      return 'API Inspector'
    case 'notifications':
      return 'Notifications'
    case 'draft':
      return 'Draft'
    default:
      return null
  }
}

/**
 * Hook to construct displayable URL from current route
 * Priority: validated custom siteUrl > gatewayUrl (never hm://)
 * Returns displayUrl (always shown) and copyableUrl (null for new doc drafts)
 */
function useCurrentRouteUrl(): {
  displayUrl: string | null
  copyableUrl: string | null
} {
  const route = useNavRoute()
  const gwUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL
  const accountUid = useSelectedAccountId()
  const agentSession = useAgentSession(
    route.key === 'agent-session' ? route.serverUrl || DEFAULT_AGENT_SERVER_URL : undefined,
    accountUid,
    route.key === 'agent-session' ? route.sessionId : undefined,
  )

  // Get account entity to check for siteUrl
  const routeId = getRouteId(route)

  // Resolve draft (if any) attached to this route. `useExistingDraft` matches
  // listed drafts against the document route id (post-DraftRouteRedirect every
  // route is `key: 'document'`).
  const existingDraft = useExistingDraft(route)
  const draft = existingDraft || null

  // Resolve uid for siteUrl lookup: route > draft fields
  const lookupUid = routeId?.uid || draft?.editUid || draft?.locationUid
  const accountEntity = useResource(lookupUid ? hmId(lookupUid) : null)
  const entitySiteUrl = accountEntity.data?.type === 'document' ? accountEntity.data.document?.metadata?.siteUrl : null
  // Entity metadata is authoritative; otherwise consider the hostname from the current route.
  const candidateSiteUrl = entitySiteUrl || routeId?.hostname || null
  const candidateSiteHostname = getUrlHostname(candidateSiteUrl)
  const gatewayHostname = getUrlHostname(gwUrl)
  const shouldValidateSiteUrl =
    !!candidateSiteHostname && !!lookupUid && candidateSiteHostname !== gatewayHostname && candidateSiteUrl !== gwUrl
  const domainInfo = useDomain(shouldValidateSiteUrl ? candidateSiteHostname : null, {
    enabled: shouldValidateSiteUrl,
    forceCheck: true,
    retry: false,
    staleTime: OMNIBAR_DOMAIN_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  })
  const validatedSiteUrl = selectValidatedOmnibarSiteUrl({
    candidateSiteUrl,
    gatewayUrl: gwUrl,
    accountUid: lookupUid,
    registeredAccountUid: domainInfo.data?.registeredAccountUid,
    domainStatus: domainInfo.data?.status,
    isDomainLoading: domainInfo.isLoading,
  })

  // Resource lookup for the current route id. The resource type tells us
  // whether a published document actually exists at this path — anything other
  // than `'document'` means the URL must not be copyable yet.
  const routeResource = useResource(routeId)
  const hasPublishedResource = routeResource.data?.type === 'document'

  // Location-only draft (no `editUid`) = unpublished new doc. We use this even
  // while `useResource` is still loading so the copy button never flashes on
  // for a placeholder path.
  const isLocationOnlyDraft = !!draft && !draft.editUid

  const draftTitle = draft?.metadata?.name

  return useMemo(() => {
    if (route.key === 'draft') {
      const hostname = validatedSiteUrl || gwUrl
      if (route.editUid) {
        const url = createWebHMUrl(route.editUid, {
          path: route.editPath,
          hostname,
          originHomeId: validatedSiteUrl ? hmId(route.editUid) : undefined,
        })
        return {displayUrl: url, copyableUrl: url}
      }
      if (route.locationUid) {
        const pathSegment = draftTitle?.trim() ? pathNameify(draftTitle) : route.id
        const newPath = [...(route.locationPath || []), pathSegment]
        const url = createWebHMUrl(route.locationUid, {
          path: newPath,
          hostname,
          originHomeId: validatedSiteUrl ? hmId(route.locationUid) : undefined,
        })
        return {displayUrl: url, copyableUrl: null}
      }
      return {displayUrl: null, copyableUrl: null}
    }

    if (route.key === 'agent-server') {
      const url = `${route.serverUrl}/agents`
      return {displayUrl: url, copyableUrl: url}
    }

    if (route.key === 'agent') {
      const url =
        route.tab === 'triggers' && route.triggerId
          ? agentTriggerUrl(route.serverUrl || DEFAULT_AGENT_SERVER_URL, route.agentId, route.triggerId)
          : agentUrl(route.serverUrl || DEFAULT_AGENT_SERVER_URL, route.agentId)
      return {displayUrl: url, copyableUrl: url}
    }

    if (route.key === 'agent-session') {
      const agentId = route.agentId || agentSession.data?.session.agentId
      if (agentId) {
        const url = agentSessionUrl(route.serverUrl || DEFAULT_AGENT_SERVER_URL, agentId, route.sessionId)
        return {displayUrl: url, copyableUrl: url}
      }
      return {displayUrl: null, copyableUrl: null}
    }

    if (routeId) {
      // Unpublished new doc with a location-only draft attached — show
      // slugified preview URL, never copyable.
      if (!hasPublishedResource && isLocationOnlyDraft && draft) {
        const hostname = validatedSiteUrl || gwUrl
        const pathSegment = draftTitle?.trim() ? pathNameify(draftTitle) : draft.id
        const parentPath = routeId.path?.slice(0, -1) ?? []
        const newPath = [...parentPath, pathSegment]
        const url = createWebHMUrl(routeId.uid, {
          path: newPath,
          hostname,
          originHomeId: validatedSiteUrl ? hmId(routeId.uid) : undefined,
        })
        return {displayUrl: url, copyableUrl: null}
      }

      // Standard route URL. Only mark copyable once we've confirmed a published
      // document exists at this id — guards against copying placeholder URLs
      // while drafts/resources are still loading.
      const url = routeToUrl(route, {
        hostname: validatedSiteUrl || gwUrl,
        originHomeId: validatedSiteUrl ? hmId(routeId.uid) : undefined,
      })
      return {displayUrl: url, copyableUrl: hasPublishedResource ? url : null}
    }

    if (route.key === 'inspect-ipfs') {
      const url = routeToUrl(route, {hostname: validatedSiteUrl || gwUrl})
      return {displayUrl: url, copyableUrl: url}
    }

    return {displayUrl: null, copyableUrl: null}
  }, [
    routeId,
    route,
    validatedSiteUrl,
    gwUrl,
    draftTitle,
    draft,
    isLocationOnlyDraft,
    hasPublishedResource,
    agentSession.data,
  ])
}

/**
 * Extract ID from route if applicable. After `DraftRouteRedirect`, drafts are
 * served on the `document` route, so we no longer special-case `key: 'draft'`
 * here; unpublished drafts surface via `useResource(routeId)` being not-found.
 */
function getRouteId(route: NavRoute): UnpackedHypermediaId | null {
  if (
    route.key === 'document' ||
    route.key === 'feed' ||
    route.key === 'inspect' ||
    route.key === 'activity' ||
    route.key === 'directory' ||
    route.key === 'collaborators' ||
    route.key === 'comments' ||
    route.key === 'all-documents' ||
    route.key === 'profile' ||
    route.key === 'contact' ||
    route.key === 'site-profile'
  ) {
    return route.id
  }
  if (route.key === 'site-settings-emails') {
    return route.accountUid ? hmId(route.accountUid) : null
  }
  return null
}

/**
 * Check if current route has a document that can show URL
 */
function isUrlDisplayableRoute(route: NavRoute): boolean {
  return (
    route.key === 'document' ||
    route.key === 'feed' ||
    route.key === 'inspect' ||
    route.key === 'inspect-ipfs' ||
    route.key === 'activity' ||
    route.key === 'directory' ||
    route.key === 'collaborators' ||
    route.key === 'comments' ||
    route.key === 'all-documents' ||
    route.key === 'site-profile' ||
    route.key === 'site-settings-emails'
  )
}

/**
 * Hook to manage omnibar state machine
 */
function useOmnibarState(currentUrl: string | null) {
  const [mode, setMode] = useState<OmnibarMode>('idle')
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const focus = useCallback(
    (selectAll: boolean = true) => {
      if (currentUrl) {
        setInputValue(currentUrl)
        setMode('focused')
        // Select all text after a tick
        setTimeout(() => {
          if (inputRef.current && selectAll) {
            inputRef.current.select()
          }
        }, 0)
      } else {
        setInputValue('')
        setMode('search')
      }
    },
    [currentUrl],
  )

  const focusSearch = useCallback(() => {
    setInputValue('')
    setMode('search')
    setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
  }, [])

  const blur = useCallback(() => {
    setMode('idle')
    setInputValue('')
  }, [])

  const handleInputChange = useCallback(
    (value: string) => {
      setInputValue(value)
      // If user clears URL content and starts typing non-URL text, switch to search
      if (mode === 'focused' && value !== currentUrl) {
        // Check if it looks like a URL
        const looksLikeUrl =
          value.startsWith('http://') ||
          value.startsWith('https://') ||
          value.startsWith('hm://') ||
          (value.includes('.') && !value.includes(' '))

        if (!looksLikeUrl) {
          setMode('search')
        }
      }
    },
    [mode, currentUrl],
  )

  return {
    mode,
    setMode,
    inputValue,
    setInputValue,
    inputRef,
    focus,
    focusSearch,
    blur,
    handleInputChange,
  }
}

/**
 * Main Omnibar component - browser-like address/search bar
 */
export function Omnibar() {
  const route = useNavRoute()
  const navigate = useNavigate()
  const {displayUrl, copyableUrl} = useCurrentRouteUrl()
  const publishSite = usePublishSite()
  const searchInputRef = useRef<SearchInputHandle>(null)
  const [isSearchLoading, setIsSearchLoading] = useState(false)

  const routeId = getRouteId(route)
  const existingDraft = useExistingDraft(route)
  // Location-only draft (no `editUid`) means an unpublished new doc.
  const isNewDraft = !!(existingDraft && !existingDraft.editUid)
  const isUnsharable = !copyableUrl || isNewDraft

  // Pass null to the omnibar state when the URL isn't shareable so the focused
  // input doesn't prefill with it.
  const {mode, inputValue, inputRef, focus, focusSearch, blur, handleInputChange} = useOmnibarState(
    isUnsharable ? null : copyableUrl,
  )

  // Listen for keyboard shortcuts
  useListenAppEvent('focus_omnibar', (event) => {
    if (event.mode === 'url') {
      focus(true)
    } else {
      focusSearch()
    }
  })

  // Also listen for legacy open_launcher event
  useListenAppEvent('open_launcher', () => {
    focusSearch()
  })

  // Handle URL navigation - returns true if navigation was synchronous
  const handleUrlNavigation = useCallback(
    async (url: string): Promise<boolean> => {
      const route = await resolveOmnibarUrlToRoute(url, {domainResolver})
      if (route) {
        navigate(route)
        return true
      }
      return false
    },
    [navigate],
  )

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        blur()
      } else if (e.key === 'Enter') {
        if (mode === 'focused') {
          e.preventDefault()
          const url = inputValue.trim()
          if (url) {
            // Check if it's an HTTP URL that needs async resolution
            const isHttpUrl = url.startsWith('http://') || url.startsWith('https://')
            const unpacked = unpackHmId(url)

            if (unpacked) {
              // Sync navigation - blur immediately
              handleUrlNavigation(url)
              blur()
            } else if (isHttpUrl) {
              // Async resolution - blur after navigation completes
              handleUrlNavigation(url).then(() => blur())
            } else {
              blur()
            }
          } else {
            blur()
          }
        } else if (mode === 'search') {
          e.preventDefault()
          searchInputRef.current?.handleEnter()
        }
      } else if (e.key === 'ArrowUp' && mode === 'search') {
        e.preventDefault()
        searchInputRef.current?.handleArrowUp()
      } else if (e.key === 'ArrowDown' && mode === 'search') {
        e.preventDefault()
        searchInputRef.current?.handleArrowDown()
      }
    },
    [blur, mode, inputValue, handleUrlNavigation],
  )

  // Handle click on idle state to focus
  const handleContainerClick = useCallback(() => {
    if (mode === 'idle') {
      focus(true)
    }
  }, [mode, focus])

  // Handle blur for focused URL mode only
  const handleInputBlur = useCallback(() => {
    // Small delay to allow clicks to register
    setTimeout(() => {
      if (mode === 'focused') {
        blur()
      }
    }, 150)
  }, [mode, blur])

  // Private drafts surface via the existing draft record, not the route schema —
  // post-DraftRouteRedirect the route is `document` even for unpublished drafts.
  const isPrivate = !!(existingDraft && existingDraft.visibility === 'PRIVATE')
  const routeLabel = getRouteLabel(route)
  const displayText = displayUrl || routeLabel || ''

  // Render indicators on the right
  const indicators = isPrivate ? (
    <div className="flex shrink-0 items-center gap-1 px-2">
      <div className="bg-muted text-muted-foreground flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
        <Lock className="size-3" />
        <span>Private</span>
      </div>
    </div>
  ) : null

  // Idle state - show URL
  if (mode === 'idle') {
    return (
      <div
        className={cn(
          'no-window-drag border-border flex min-w-0 flex-1 cursor-text items-center gap-2 overflow-hidden rounded-full border-2 pl-2',
          'hover:border-border hover:bg-muted/50 bg-white dark:bg-black',
          'transition-colors',
          'max-w-2xl',
          routeId ? 'py-0' : 'py-1',
        )}
        onClick={handleContainerClick}
      >
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          <span
            className={cn(
              'text-muted-foreground min-w-0 flex-1 truncate text-xs',
              // Drafts that haven't been published yet have no shareable URL
              isUnsharable && 'select-none',
            )}
            style={isUnsharable ? {userSelect: 'none', WebkitUserSelect: 'none'} : undefined}
            onCopy={
              isUnsharable
                ? (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                  }
                : undefined
            }
          >
            {displayText}
          </span>
          {indicators}
        </div>
        {routeId ? (
          <div className="mr-1 flex shrink-0 items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
            <BookmarkButton id={routeId} className="size-6 min-w-6" />
            {/* Hide copy-reference when
                the doc's URL isn't shareable */}
            {!isUnsharable && (
              <CopyReferenceButton docId={routeId} isBlockFocused={false} latest className="size-6 min-w-6" />
            )}
          </div>
        ) : null}
        {publishSite.content}
      </div>
    )
  }

  // Focused URL state - show editable URL input
  if (mode === 'focused') {
    return (
      <div
        className={cn(
          'no-window-drag flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-full border px-2 py-1',
          'border-primary bg-white dark:bg-black',
          'focus-within:ring-primary focus-within:ring-1',
          'max-w-2xl',
        )}
      >
        <Search className="text-muted-foreground size-3.5 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleInputBlur}
          className={cn(
            'min-w-0 flex-1 truncate border-none! bg-transparent text-xs outline-none',
            'placeholder:text-muted-foreground',
          )}
          autoFocus
        />
        {indicators}
      </div>
    )
  }

  // Search state - input in titlebar, results in dropdown
  return (
    <Popover open={true} onOpenChange={(open) => !open && blur()}>
      <PopoverTrigger asChild>
        <div
          className={cn(
            'no-window-drag flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-full border px-2 py-1',
            'border-primary bg-white dark:bg-black',
            'focus-within:ring-primary focus-within:ring-1',
            'max-w-2xl',
          )}
        >
          <Search className="text-muted-foreground size-3.5 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              'min-w-0 flex-1 truncate border-none! bg-transparent text-xs outline-none',
              'placeholder:text-muted-foreground',
            )}
            placeholder="Search documents or paste a URL…"
            autoFocus
          />
          {isSearchLoading ? <Spinner className="text-muted-foreground size-3.5 shrink-0" /> : null}
          {indicators}
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        className="no-window-drag w-[var(--radix-popover-trigger-width)] min-w-[400px] border-0 bg-transparent p-0 shadow-none"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="dark:bg-background border-border max-h-[280px] overflow-hidden rounded-md border bg-white p-2 shadow-2xl">
          <SearchInput
            ref={searchInputRef}
            onClose={blur}
            externalSearch={inputValue}
            onExternalSearchChange={handleInputChange}
            hideInput={true}
            onLoadingChange={setIsSearchLoading}
            onSelect={({id, route: selectedRoute}) => {
              if (selectedRoute) {
                navigate(selectedRoute)
              } else if (id) {
                toast.error('Failed to open selected item: ' + id)
              }
              blur()
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
