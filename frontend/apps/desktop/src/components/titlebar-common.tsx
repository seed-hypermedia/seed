import {useAppContext} from '@/app-context'
import {useCopyReferenceUrl} from '@/components/copy-reference-url'
import {useDeleteDialog} from '@/components/delete-dialog'
import {domainResolver} from '@/grpc-client'
import {roleCanWrite, useSelectedAccountCapability} from '@/models/access-control'
import {useDraft} from '@/models/accounts'
import {useMyAccountIds} from '@/models/daemon'
import {useCreateDraft} from '@/models/documents'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useHostSession} from '@/models/host'
import {useNotificationInbox} from '@/models/notification-inbox'
import {isNotificationEventRead, useLocalNotificationReadState} from '@/models/notification-read-state'
import {resolveOmnibarUrlToRoute, selectValidatedOmnibarSiteUrl} from '@/omnibar-url'
import {useSelectedAccount, useSelectedAccountId} from '@/selected-account'
import {SidebarContext} from '@/sidebar-context'
import {convertBlocksToMarkdown} from '@/utils/blocks-to-markdown'
import {pathNameify} from '@/utils/path'
import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {hostnameStripProtocol, useUniversalAppContext} from '@shm/shared'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useAccounts, useDomain, useResource} from '@shm/shared/models/entity'
import {DocumentRoute, DraftRoute, FeedRoute, NavRoute} from '@shm/shared/routes'
import {useStream} from '@shm/shared/use-stream'
import {createWebHMUrl, displayHostname, hmId, routeToUrl, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useNavigationDispatch, useNavigationState, useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {HMIcon} from '@shm/ui/hm-icon'
import {Back, CloudOff, Download, Forward, Link, Trash, UploadCloud} from '@shm/ui/icons'
import {MenuItemType, OptionsDropdown} from '@shm/ui/options-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {TitlebarSection} from '@shm/ui/titlebar'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {
  ArrowLeftFromLine,
  ArrowRightFromLine,
  Bell,
  ChevronDown,
  ChevronUp,
  FilePlus,
  ForwardIcon,
  GitFork,
  Import,
  Lock,
  LogOut,
  Monitor,
  PanelLeft,
  Plus,
  Search,
  Settings,
  User,
  UserCog,
} from 'lucide-react'
import {ReactNode, useCallback, useContext, useMemo, useRef, useState} from 'react'
import {BookmarkButton} from './bookmarking'
import {BranchDialog} from './branch-dialog'
import {CopyReferenceButton} from './copy-reference-button'
import {useImportDialog, useImporting} from './import-doc-button'
import {MoveDialog} from './move-dialog'
import {dispatchOnboardingDialog} from './onboarding'
import {usePublishSite, useRemoveSiteDialog, useSeedHostDialog} from './publish-site'
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

export function DocOptionsButton({
  onPublishSite,
}: {
  onPublishSite: (input: {id: UnpackedHypermediaId; step?: 'seed-host-custom-domain'}) => void
}) {
  const route = useNavRoute()
  const dispatch = useNavigationDispatch()
  if (!isDocOptionsRoute(route)) throw new Error('DocOptionsButton must be used within a route that has an id')
  const id = route.id
  const {exportDocument, openDirectory} = useAppContext()
  const deleteEntity = useDeleteDialog()
  const gwUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL
  const resource = useResource(id)
  const doc = resource.data?.type === 'document' ? resource.data.document : undefined
  const rootEntity = useResource(hmId(id?.uid))
  const rootDocument = rootEntity.data?.type === 'document' ? rootEntity.data.document : undefined
  const siteUrl = rootDocument?.metadata.siteUrl
  // const copyLatest =
  //   route.id.latest || !route.id.version || doc?.version === route.id.version
  const [copyGatewayContent, onCopyGateway] = useCopyReferenceUrl(gwUrl)
  const [copySiteUrlContent, onCopySiteUrl] = useCopyReferenceUrl(siteUrl || gwUrl, siteUrl ? hmId(id?.uid) : undefined)
  // const  {
  //   ...route.id,
  //   latest: copyLatest,
  //   version: doc?.version || null,
  // }
  const removeSite = useRemoveSiteDialog()
  const capability = useSelectedAccountCapability(id || undefined)
  const canEditDoc = roleCanWrite(capability?.role)
  const seedHostDialog = useSeedHostDialog()
  const branchDialog = useAppDialog(BranchDialog)
  const moveDialog = useAppDialog(MoveDialog)
  const myAccountIds = useMyAccountIds()
  const pendingDomain = useHostSession().pendingDomains?.find((pending) => !!id && pending.siteUid === id.uid)
  const menuItems: MenuItemType[] = [
    {
      key: 'link',
      label: `Copy ${displayHostname(gwUrl)} Link`,
      icon: <Link className="size-4" />,
      onClick: () => {
        onCopyGateway(route)
      },
    },
    {
      key: 'export',
      label: 'Export Document',
      icon: <Download className="size-4" />,
      onClick: async () => {
        if (!doc) return
        const title = doc?.metadata.name || 'document'
        const blocks: HMBlockNode[] | undefined = doc?.content || undefined
        const editorBlocks = hmBlocksToEditorContent(blocks, {
          childrenType: 'Group',
        })
        const markdownWithFiles = await convertBlocksToMarkdown(editorBlocks, doc)
        const {markdownContent, mediaFiles} = markdownWithFiles
        exportDocument(title, markdownContent, mediaFiles)
          .then((res) => {
            const success = (
              <>
                <div className="flex max-w-[700px] flex-col gap-1.5">
                  <SizableText className="text-wrap break-all">
                    Successfully exported document "{title}" to: <b>{`${res}`}</b>.
                  </SizableText>
                  <SizableText
                    className="text-current underline"
                    onClick={() => {
                      // @ts-expect-error
                      openDirectory(res)
                    }}
                  >
                    Show directory
                  </SizableText>
                </div>
              </>
            )
            toast.success(success)
          })
          .catch((err) => {
            toast.error(err)
          })
      },
    },
  ]
  if (siteUrl) {
    menuItems.unshift({
      key: 'link-site',
      label: `Copy ${displayHostname(siteUrl)} Link`,
      icon: <Link className="size-4" />,
      onClick: () => {
        onCopySiteUrl(route)
      },
    })
  }
  if (!!id && !id?.path?.length && canEditDoc) {
    if (doc?.metadata?.siteUrl) {
      const siteHost = hostnameStripProtocol(doc?.metadata?.siteUrl)
      const gwHost = hostnameStripProtocol(gwUrl)
      if (siteHost.endsWith(gwHost) && !pendingDomain) {
        menuItems.push({
          key: 'publish-custom-domain',
          label: 'Publish Custom Domain',
          icon: <UploadCloud className="size-4" />,
          onClick: () => {
            onPublishSite({id: id, step: 'seed-host-custom-domain'})
          },
        })
      }
      menuItems.push({
        key: 'publish-site',
        label: 'Remove Site from Publication',
        icon: <CloudOff className="size-4" />,
        variant: 'destructive',
        onClick: () => {
          removeSite.open(id)
        },
      })
    } else
      menuItems.push({
        key: 'publish-site',
        label: 'Publish Site to Domain',
        icon: <UploadCloud className="size-4" />,
        onClick: () => {
          onPublishSite({id})
        },
      })
  }
  const createDraft = useCreateDraft({
    locationUid: id?.uid,
    locationPath: id?.path || undefined,
  })
  const importDialog = useImportDialog()
  const importing = useImporting(id)
  if (canEditDoc) {
    menuItems.push({
      key: 'create-draft',
      label: 'New Document...',
      icon: <FilePlus className="size-4" />,
      onClick: () => createDraft(),
    })
    menuItems.push({
      key: 'import',
      label: 'Import...',
      icon: <Import className="size-4" />,
      onClick: () => {
        importDialog.open({
          onImportFile: importing.importFile,
          onImportDirectory: importing.importDirectory,
          onImportLatexFile: importing.importLatexFile,
          onImportLatexDirectory: importing.importLatexDirectory,
          onImportWebSite: importing.importWebSite,
          onImportWordPress: importing.importWordPress,
        })
      },
    })
  }

  if (id && myAccountIds.data?.length) {
    menuItems.push({
      key: 'branch',
      label: 'Create Document Branch',
      icon: <GitFork className="size-4" />,
      onClick: () => {
        branchDialog.open(id)
      },
    })
  }

  if (canEditDoc && myAccountIds.data?.length && id?.path?.length) {
    menuItems.push({
      key: 'move',
      label: 'Move Document',
      icon: <ForwardIcon className="size-4" />,
      onClick: () => {
        moveDialog.open({
          id,
        })
      },
    })
  }

  if (doc && canEditDoc && id?.path?.length) {
    menuItems.push({
      key: 'delete',
      label: 'Delete Document',
      icon: <Trash className="size-4" />,
      onClick: () => {
        deleteEntity.open({
          id: id,
          onSuccess: () => {
            dispatch({
              type: 'backplace',
              route: {
                key: 'document',
                id: hmId(id.uid, {
                  path: id.path?.slice(0, -1),
                }),
              } as any,
            })
          },
        })
      },
    })
  }

  return (
    <>
      {copyGatewayContent}
      {copySiteUrlContent}
      {deleteEntity.content}
      {removeSite.content}
      {importDialog.content}
      {importing.content}
      {seedHostDialog.content}
      {branchDialog.content}
      {moveDialog.content}
      <OptionsDropdown className="window-no-drag" menuItems={menuItems} align="start" side="bottom" />
    </>
  )
}

function NotificationButton() {
  const navigate = useNavigate()
  const route = useNavRoute()
  const accountUid = useSelectedAccountId()
  const inbox = useNotificationInbox(accountUid)
  const readState = useLocalNotificationReadState(accountUid)
  const isActive = route.key === 'notifications'

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
        onClick={isActive ? undefined : () => navigate({key: 'notifications'})}
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

function AccountProfileButton() {
  const navigate = useNavigate()
  const accountUid = useSelectedAccountId()
  const selectedAccount = useSelectedAccount()
  const {selectedIdentity, setSelectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)
  const myAccountIds = useMyAccountIds()
  const accountQueries = useAccounts(myAccountIds.data || [])
  const [switcherOpen, setSwitcherOpen] = useState(false)

  const accountOptions = myAccountIds.data
    ?.map((uid, index) => {
      const accountData = accountQueries[index]?.data
      if (!accountData) return null
      return accountData
    })
    .filter((d) => !!d)

  if (!accountUid) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className="window-no-drag relative h-8 w-8 overflow-hidden rounded-full border-1 border-transparent p-0">
          <HMIcon
            id={hmId(accountUid)}
            name={selectedAccount?.metadata?.name}
            icon={selectedAccount?.metadata?.icon}
            size={32}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="end" className="w-[260px]">
        {/* Account header + switcher */}
        <div className="m-1 rounded-lg border border-black/10 p-1 dark:border-white/10">
          <button
            className="hover:bg-accent flex w-full items-center gap-3 rounded-md px-2 py-2"
            onClick={() => setSwitcherOpen(!switcherOpen)}
          >
            <HMIcon
              id={hmId(accountUid)}
              name={selectedAccount?.metadata?.name}
              icon={selectedAccount?.metadata?.icon}
              size={32}
            />
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
                className="hover:bg-accent flex w-full items-center gap-3 rounded-md px-2 py-2"
                onClick={() => dispatchOnboardingDialog(true)}
              >
                <div className="bg-muted flex h-8 w-8 items-center justify-center rounded-full">
                  <Plus className="size-4" />
                </div>
                <p className="text-sm">Create account</p>
              </button>
            </>
          )}
        </div>
        <DropdownMenuSeparator className="bg-black/10 dark:bg-white/10" />
        <DropdownMenuItem
          onClick={() => {
            navigate({key: 'profile', id: hmId(accountUid)})
          }}
        >
          <User className="size-4" />
          My Profile
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <UserCog className="size-4" />
          Manage account
        </DropdownMenuItem>
        <DropdownMenuItem disabled>
          <Monitor className="size-4" />
          Site settings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => navigate({key: 'settings'})}>
          <Settings className="size-4" />
          App settings
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-black/10 dark:bg-white/10" />
        <DropdownMenuItem variant="destructive" disabled>
          <LogOut className="size-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
    <div className="no-window-drag flex">
      <Button
        size="icon"
        onClick={() => dispatch({type: 'pop'})}
        variant="ghost"
        disabled={state.routeIndex <= 0}
        className="rounded-tl-0 rounded-bl-0"
      >
        <Back className="size-4" />
      </Button>

      <Button
        size="icon"
        onClick={() => dispatch({type: 'forward'})}
        disabled={state.routeIndex >= state.routes.length - 1}
        className="rounded-tr-0 rounded-br-0"
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
    <div className="ml-2 flex flex-1 items-center">
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
    case 'library':
      return 'Library'
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
    case 'preview':
      return 'Preview'
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

  // Get account entity to check for siteUrl
  const routeId = getRouteId(route)

  // For draft/preview routes, fetch draft data
  const draftId = route.key === 'draft' ? route.id : route.key === 'preview' ? route.draftId : undefined
  const draft = useDraft(draftId)
  const draftData = draft.data

  // Resolve uid for siteUrl lookup: route > draft data
  const draftEditUid = (route.key === 'draft' ? route.editUid : undefined) || draftData?.editUid
  const draftLocationUid = (route.key === 'draft' ? route.locationUid : undefined) || draftData?.locationUid
  const draftUid = draftEditUid || draftLocationUid
  const lookupUid = routeId?.uid || draftUid
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
    isDomainLoading: domainInfo.isLoading,
  })

  const draftTitle = draftData?.metadata?.name

  return useMemo(() => {
    // Handle draft/preview routes (routeToUrl doesn't support them)
    if (route.key === 'draft' || route.key === 'preview') {
      const hostname = validatedSiteUrl || gwUrl
      // Resolve edit/location from route or draft data
      const editUid = (route.key === 'draft' ? route.editUid : undefined) || draftData?.editUid
      const editPath = (route.key === 'draft' ? route.editPath : undefined) || draftData?.editPath
      const locationUid = (route.key === 'draft' ? route.locationUid : undefined) || draftData?.locationUid
      const locationPath = (route.key === 'draft' ? route.locationPath : undefined) || draftData?.locationPath

      if (editUid) {
        // Editing existing doc - show the doc's URL, copyable
        const url = createWebHMUrl(editUid, {
          path: editPath,
          hostname,
          originHomeId: validatedSiteUrl ? hmId(editUid) : undefined,
        })
        return {displayUrl: url, copyableUrl: url}
      }
      if (locationUid) {
        // New doc - use pathemified title or fallback to draft ID, NOT copyable
        const draftRouteId = route.key === 'draft' ? route.id : route.draftId
        const pathSegment = draftTitle?.trim() ? pathNameify(draftTitle) : draftRouteId
        const newPath = [...(locationPath || []), pathSegment]
        const url = createWebHMUrl(locationUid, {
          path: newPath,
          hostname,
          originHomeId: validatedSiteUrl ? hmId(locationUid) : undefined,
        })
        return {displayUrl: url, copyableUrl: null}
      }
      return {displayUrl: null, copyableUrl: null}
    }

    if (routeId || route.key === 'inspect-ipfs') {
      const url = routeToUrl(route, {
        hostname: validatedSiteUrl || gwUrl,
        // Only apply originHomeId optimization when the custom domain is still
        // resolving to the current route's account.
        originHomeId: validatedSiteUrl && routeId ? hmId(routeId.uid) : undefined,
      })
      return {displayUrl: url, copyableUrl: url}
    }

    return {displayUrl: null, copyableUrl: null}
  }, [routeId, route, validatedSiteUrl, gwUrl, draftTitle, draftData])
}

/**
 * Extract ID from route if applicable
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
    route.key === 'profile' ||
    route.key === 'contact' ||
    route.key === 'site-profile'
  ) {
    return route.id
  }
  // Draft editing existing doc - return the doc's ID for bookmark/copy buttons
  if (route.key === 'draft' && route.editUid) {
    return hmId(route.editUid, {path: route.editPath})
  }
  return null
}

/**
 * Check if route is a draft route
 */
function isDraftRoute(route: NavRoute): route is DraftRoute {
  return route.key === 'draft'
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
    route.key === 'site-profile'
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

  const {mode, inputValue, inputRef, focus, focusSearch, blur, handleInputChange} = useOmnibarState(copyableUrl)

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

  const isDraft = isDraftRoute(route)
  const isPrivate = isDraft && route.visibility === 'PRIVATE'
  const routeLabel = getRouteLabel(route)
  const displayText = displayUrl || routeLabel || ''
  const routeId = getRouteId(route)

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
          <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">{displayText}</span>
          {indicators}
        </div>
        {routeId ? (
          <div className="mr-1 flex shrink-0 items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
            <BookmarkButton id={routeId} className="size-6 min-w-6" />
            <CopyReferenceButton docId={routeId} isBlockFocused={false} latest className="size-6 min-w-6" />
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
            placeholder="Search documents..."
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
