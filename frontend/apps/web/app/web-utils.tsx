import {editorBlocksToHMBlockNodes} from '@seed-hypermedia/client'
import type {HMResourceVisibility, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  createInspectNavRouteFromRoute,
  hmId,
  routeToUrl,
  useJoinSite,
  useRouteLink,
  useUniversalAppContext,
  useUniversalClient,
} from '@shm/shared'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useIsSiteOwner} from '@shm/shared/models/capabilities'
import {createDefaultFolderQueryBlock} from '@shm/shared/models/document-machine'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {isNotificationEventRead} from '@shm/shared/models/notification-read-logic'
import {hmIdToURL} from '@shm/shared/utils/entity-id-url'
import {useNavigate, useNavRoute} from '@shm/shared/utils/navigation'
import {ButtonLink} from '@shm/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {createCopyLinkMenuItem} from '@shm/ui/copy-link-menu'
import {copyUrlToClipboardWithFeedback} from '@shm/ui/copy-to-clipboard'
import {createDocumentVersionsPanelRoute} from '@shm/ui/document-versions-panel'
import {HypermediaHostBanner} from '@shm/ui/hm-host-banner'
import {HMIcon} from '@shm/ui/hm-icon'
import {Add} from '@shm/ui/icons'
import {JoinButton} from '@shm/ui/join-button'
import {MobilePanelSheet} from '@shm/ui/mobile-panel-sheet'
import {useAssistantAutoOpen, useAssistantPanel} from '@/assistant-panel-state'
import {MenuItemType} from '@shm/ui/options-dropdown'
import {createEmailSubscribersMenuItem} from '@shm/ui/site-email-subscribers'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useMedia} from '@shm/ui/use-media'
import {cn} from '@shm/ui/utils'
import {parseSpaceAgentIds} from '@shm/ui/agents/space-agents'
import {
  Bell,
  Bot,
  ExternalLink,
  FilePlus2,
  LibraryBig,
  Globe,
  History,
  Import as ImportIcon,
  Layers,
  LayoutList,
  Lock,
  LogOut,
  Plus,
  Search,
  User,
  UserCog,
} from 'lucide-react'
import {nanoid} from 'nanoid'
import {ReactNode, useCallback, useMemo, useRef, useState} from 'react'
import {LogoutDialog, useCreateAccount, useLocalKeyPair} from './auth'
import {createWebDocumentDraft, createWebDocumentDraftFromMarkdownFile} from './document-edit/web-create-draft'
import {buildFolderDraftSeed} from '@shm/shared/folder'
import {getVaultAccountSettingsUrl} from './vault-links'
import {useCreateSpaceDialog, useHasExistingSpace} from './web-create-space-dialog'
import {useWebNotificationInbox, useWebNotificationReadState} from './web-notifications'

export function useWebMenuItems(docId: UnpackedHypermediaId, options?: {includeInspect?: boolean}): MenuItemType[] {
  const route = useNavRoute()
  const navigate = useNavigate()
  const {onCopyReference, onPushReference, origin, originHomeId, experiments} = useUniversalAppContext()
  const includeInspect = options?.includeInspect !== false
  // Email subscribers is offered on the home document for the site owner,
  // matching the desktop document options menu.
  const {isSiteOwner} = useIsSiteOwner(docId.path?.length ? undefined : docId.uid)
  const inspectRoute = useMemo(() => {
    if (!includeInspect) return null
    const wrappedRoute = createInspectNavRouteFromRoute(route)
    return wrappedRoute?.key === 'inspect' ? wrappedRoute : null
  }, [includeInspect, route])
  const allDocumentsId = originHomeId ? hmId(originHomeId.uid) : hmId(docId.uid)

  return useMemo(
    () => [
      createCopyLinkMenuItem({
        advanced: experiments?.advancedCopyLinkOptions,
        canonical: {
          copy:
            (onCopyReference ? () => onCopyReference(docId) : null) ??
            (typeof window !== 'undefined' ? () => copyUrlToClipboardWithFeedback(window.location.href, 'Link') : null),
        },
        gateway: {
          copy: async () => {
            const url = routeToUrl(route, {hostname: origin ?? DEFAULT_GATEWAY_URL, originHomeId})
            if (url) await copyUrlToClipboardWithFeedback(url, 'Gateway')
            onPushReference?.(docId)
          },
        },
        hypermedia: {
          copy: () => copyUrlToClipboardWithFeedback(hmIdToURL(docId), 'Hypermedia'),
        },
      }),
      {
        key: 'versions',
        label: 'Versions history',
        icon: <History className="size-4" />,
        onClick: () => {
          navigate({
            key: 'document',
            id: docId,
            panel: createDocumentVersionsPanelRoute(docId),
          })
        },
      },
      {
        key: 'directory',
        label: 'Sub documents',
        icon: <Layers className="size-4" />,
        onClick: () => navigate({key: 'directory', id: docId}),
      },
      {
        key: 'all-documents',
        label: 'All Documents',
        icon: <LayoutList className="size-4" />,
        onClick: () => navigate({key: 'all-documents', id: allDocumentsId}),
      },
      ...(isSiteOwner ? [createEmailSubscribersMenuItem({navigate})] : []),
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
    ],
    [
      allDocumentsId,
      docId,
      inspectRoute,
      isSiteOwner,
      navigate,
      onCopyReference,
      onPushReference,
      origin,
      originHomeId,
      route,
      experiments?.advancedCopyLinkOptions,
    ],
  )
}

/** Builds the web document creation submenu item for the document options menu. */
export function useWebCreateDocumentMenuItem({
  locationId,
  signingAccountId,
  canCreate,
  canCreateChildren = true,
  capabilityCid,
}: {
  locationId: UnpackedHypermediaId
  signingAccountId?: string
  canCreate: boolean
  canCreateChildren?: boolean
  capabilityCid?: string
}): {
  menuItem: MenuItemType | null
  content: ReactNode
} {
  const navigate = useNavigate()
  const importInputRef = useRef<HTMLInputElement>(null)

  const createDraft = useCallback(
    (visibility?: HMResourceVisibility, folder = false) => {
      if (!signingAccountId) return
      console.log('[web-create-doc] menu createDraft', {
        locationId: locationId.id,
        visibility,
        signingAccountId,
      })
      const seed = folder ? buildFolderDraftSeed(crypto.randomUUID()) : null
      void createWebDocumentDraft({
        locationId,
        signingAccountId,
        visibility,
        metadata: seed?.metadata,
        content: seed ? editorBlocksToHMBlockNodes(seed.content) : undefined,
        capabilityCid,
        persist: false,
        ...(folder
          ? {content: editorBlocksToHMBlockNodes([createDefaultFolderQueryBlock(nanoid(8))]), persist: true}
          : {}),
        navigate: (route) => navigate(route),
      })
    },
    [capabilityCid, locationId, navigate, signingAccountId],
  )

  const menuItem = useMemo<MenuItemType | null>(() => {
    if (!canCreate || !canCreateChildren || !signingAccountId) return null
    return {
      key: 'new',
      label: 'New',
      icon: <Add className="size-4" />,
      children: [
        {
          key: 'new-document',
          label: 'Document',
          icon: <FilePlus2 className="size-4" />,
          onClick: () => createDraft('PUBLIC'),
        },
        {
          key: 'new-folder',
          label: 'Folder',
          icon: <LibraryBig className="size-4" />,
          onClick: () => createDraft('PUBLIC', true),
        },
        {
          key: 'new-private-document',
          label: 'Private',
          icon: <Lock className="size-4" />,
          onClick: () => createDraft('PRIVATE'),
        },
        {
          key: 'import',
          label: 'Import Markdown File',
          icon: <ImportIcon className="size-4" />,
          onClick: () => importInputRef.current?.click(),
        },
      ],
    }
  }, [canCreate, canCreateChildren, createDraft, signingAccountId])

  return {
    menuItem,
    content:
      canCreate && canCreateChildren && signingAccountId ? (
        <input
          ref={importInputRef}
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          className="hidden"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            event.currentTarget.value = ''
            if (!file) return
            toast.promise(
              createWebDocumentDraftFromMarkdownFile({
                file,
                locationId,
                signingAccountId,
                capabilityCid,
                navigate: (route) => navigate(route),
              }),
              {
                loading: 'Importing Markdown…',
                success: 'Markdown imported.',
                error: 'Failed to import Markdown.',
              },
            )
          }}
        />
      ) : null,
  }
}

function PlaceholderAvatar({onClick}: {onClick: () => void}) {
  return (
    <button
      onClick={onClick}
      className="flex size-8 cursor-pointer items-center justify-center rounded-full border border-dashed border-gray-400"
    >
      <User className="size-4 text-gray-400" />
    </button>
  )
}

/**
 * Site-header join button or avatar with notifications bell
 */
/**
 * The agents server this space names for its readers, if any.
 *
 * Read straight from the home document rather than through `useSiteAdvertisedAgentServerUrl`: that
 * lives in the agents models, and importing them here would pull the whole agents chunk — editor
 * included — into the initial bundle, which the assistant panel and the /hm/agents pages go out of
 * their way to avoid. `useResource` is already here via `useAccount`, so this costs nothing.
 */
function useSiteAgents(siteUid: string): {serverUrl: string | null; publishesAgents: boolean} {
  const home = useResource(hmId(siteUid))
  const metadata = home.data?.type === 'document' ? home.data.document?.metadata : undefined
  const raw = metadata?.agentServerUrl
  return {
    serverUrl: typeof raw === 'string' && raw ? raw : null,
    publishesAgents: parseSpaceAgentIds(metadata?.spaceAgents).length > 0,
  }
}

export function WebHeaderActions({siteUid}: {siteUid: string}) {
  const keyPair = useLocalKeyPair()
  const accountId = keyPair?.delegatedAccountUid ?? keyPair?.id
  const {content: createAccountContent, createAccount} = useCreateAccount({})
  const {isJoined, joinSite} = useJoinSite({siteUid})
  const logoutDialog = useAppDialog(LogoutDialog, {showCloseButton: false})
  const {open: openCreateSpaceDialog, content: createSpaceDialogContent} = useCreateSpaceDialog()
  const universalClient = useUniversalClient()
  const {data: existingSpace} = useHasExistingSpace(accountId, universalClient)
  const canCreateSpace = !existingSpace?.exists

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
  const assistantPanel = useAssistantPanel()
  // A space that names no agents server has nothing for its readers to talk to, so the entry point
  // is not offered while browsing it. It stays absent until the home document has loaded, so the
  // item appears late rather than appearing and then vanishing.
  const siteAgents = useSiteAgents(siteUid)
  const hasSiteAgents = !!siteAgents.serverUrl
  // First arrival: a signed-in reader of a space that publishes agents finds the panel already
  // open, once, on a viewport wide enough to show it beside the page. Closing it is remembered.
  useAssistantAutoOpen(!!keyPair && hasSiteAgents && siteAgents.publishesAgents && !isMobile)

  // Show the join button if not joined the site
  if (!keyPair) {
    return (
      <>
        <div className="flex items-center gap-2">
          <PlaceholderAvatar onClick={() => createAccount({source: 'login'})} />
          <JoinButton onClick={() => createAccount({source: 'join'})} />
        </div>
        {createAccountContent}
      </>
    )
  }

  const joinButton = !isJoined ? <JoinButton onClick={() => joinSite()} /> : null

  // Show the avatar and bell when logged in.
  const avatarIcon = (
    <HMIcon
      id={account?.id ?? hmId(accountId!, {latest: true})}
      name={account?.metadata?.name}
      icon={account?.metadata?.icon}
      size={32}
    />
  )

  // When the account already has a site, the dropdown shows a link to it.
  const mySiteUrl = account?.metadata?.siteUrl || null
  const mySiteLabel = mySiteUrl
    ? mySiteUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '')
    : account?.metadata?.name || 'My space'
  const goToMySite = () => {
    if (mySiteUrl) window.open(mySiteUrl, '_blank', 'noopener,noreferrer')
    else if (accountId) navigate({key: 'document', id: hmId(accountId, {latest: true})})
  }

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
      {hasSiteAgents ? (
        <>
          <div className="bg-border mx-4 h-px" />
          <button
            className="hover:bg-accent flex w-full items-center gap-3 px-4 py-3 text-left"
            onClick={() => {
              setMobileMenuOpen(false)
              assistantPanel.toggle()
            }}
          >
            <Bot className="size-5" />
            <span className="text-sm">{assistantPanel.isOpen ? 'Close Agents' : 'Agents'}</span>
          </button>
        </>
      ) : null}
      <div className="bg-border mx-4 h-px" />
      {canCreateSpace ? (
        <button
          className="hover:bg-accent flex w-full items-center gap-3 px-4 py-3 text-left text-green-600 dark:text-green-500"
          onClick={() => {
            setMobileMenuOpen(false)
            openCreateSpaceDialog()
          }}
        >
          <Plus className="size-5" />
          <span className="text-sm">Create my space</span>
        </button>
      ) : (
        <>
          <div className="text-muted-foreground px-4 pt-2 pb-1 text-xs">My space</div>
          <button
            className="hover:bg-accent flex w-full items-center gap-3 px-4 py-3 text-left"
            onClick={() => {
              setMobileMenuOpen(false)
              goToMySite()
            }}
          >
            <Globe className="size-5" />
            <span className="flex-1 truncate text-sm">{mySiteLabel}</span>
            {mySiteUrl ? <ExternalLink className="text-muted-foreground size-4" /> : null}
          </button>
        </>
      )}
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
          {keyPair.notifyServerUrl ? <NotifsButton /> : null}
          <button className="flex cursor-pointer rounded-full shadow-lg" onClick={() => setMobileMenuOpen(true)}>
            {avatarIcon}
          </button>
          {joinButton}
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
          {keyPair.notifyServerUrl ? <NotifsButton /> : null}
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
              {hasSiteAgents ? (
                <>
                  <DropdownMenuSeparator className="bg-black/10 dark:bg-white/10" />
                  <DropdownMenuItem onClick={assistantPanel.toggle}>
                    <Bot className="size-4" />
                    {assistantPanel.isOpen ? 'Close Agents' : 'Agents'}
                  </DropdownMenuItem>
                </>
              ) : null}
              <DropdownMenuSeparator className="bg-black/10 dark:bg-white/10" />
              {canCreateSpace ? (
                <DropdownMenuItem
                  onClick={openCreateSpaceDialog}
                  className="text-green-600 focus:text-green-600 dark:text-green-500 dark:focus:text-green-500"
                >
                  <Plus className="size-4 text-green-600 dark:text-green-500" />
                  Create my space
                </DropdownMenuItem>
              ) : (
                <>
                  <div className="text-muted-foreground px-2 pt-1 pb-0.5 text-xs">My space</div>
                  <DropdownMenuItem onClick={goToMySite}>
                    <Globe className="size-4" />
                    <span className="flex-1 truncate">{mySiteLabel}</span>
                    {mySiteUrl ? <ExternalLink className="text-muted-foreground size-3.5" /> : null}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator className="bg-black/10 dark:bg-white/10" />
              <DropdownMenuItem variant="destructive" onClick={() => logoutDialog.open({})}>
                <LogOut className="size-4" />
                Log out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {joinButton}
        </div>
      )}
      {logoutDialog.content}
      {createAccountContent}
      {createSpaceDialogContent}
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
  const route = useNavRoute()
  const isActive = route.key === 'notifications'
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
    <Tooltip content="Notifications" asChild>
      <ButtonLink
        className={cn(
          'relative h-8 rounded-full border-1 border-transparent p-0',
          isActive && 'dark:bg-muted bg-black/5',
        )}
        variant="ghost"
        size="icon"
        aria-current={isActive ? 'page' : undefined}
        {...linkProps}
      >
        <Bell className="size-4" />
        {unreadCount > 0 ? (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-lg bg-red-500 px-1 text-[12px] font-bold text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </ButtonLink>
    </Tooltip>
  )
}
