import {useAppContext} from '@/app-context'
import {useCopyReferenceUrl} from '@/components/copy-reference-url'
import {useDeleteDialog} from '@/components/delete-dialog'
import {
  roleCanWrite,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useMyAccountIds} from '@/models/daemon'
import {useCreateDraft} from '@/models/documents'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useHostSession} from '@/models/host'
import {SidebarContext} from '@/sidebar-context'
import {convertBlocksToMarkdown} from '@/utils/blocks-to-markdown'
import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {hostnameStripProtocol} from '@shm/shared'
import {hmBlocksToEditorContent} from '@shm/shared/client/hmblock-to-editorblock'
import {DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {HMBlockNode, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {resolveHypermediaUrl} from '@shm/shared/resolve-hm'
import {
  DocumentRoute,
  DraftRoute,
  FeedRoute,
  NavRoute,
} from '@shm/shared/routes'
import {useStream} from '@shm/shared/use-stream'
import {
  createSiteUrl,
  createWebHMUrl,
  displayHostname,
  extractViewTermFromUrl,
  hmId,
  latestId,
  unpackHmId,
  viewTermToRouteKey,
} from '@shm/shared/utils/entity-id-url'
import {
  appRouteOfId,
  useNavRoute,
  useNavigationDispatch,
  useNavigationState,
} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@shm/ui/components/popover'
import {DraftBadge} from '@shm/ui/draft-badge'
import {
  ArrowRight,
  Back,
  CloudOff,
  Download,
  Forward,
  Link,
  Trash,
  UploadCloud,
} from '@shm/ui/icons'
import {MenuItemType, OptionsDropdown} from '@shm/ui/options-dropdown'
import {SizableText} from '@shm/ui/text'
import {TitlebarSection} from '@shm/ui/titlebar'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {cn} from '@shm/ui/utils'
import {
  ArrowLeftFromLine,
  ArrowRightFromLine,
  FilePlus,
  ForwardIcon,
  GitFork,
  Import,
  Lock,
  PanelLeft,
  Search,
} from 'lucide-react'
import {
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {BranchDialog} from './branch-dialog'
import {useImportDialog, useImporting} from './import-doc-button'
import {MoveDialog} from './move-dialog'
import {
  usePublishSite,
  useRemoveSiteDialog,
  useSeedHostDialog,
} from './publish-site'
import {SearchInput, SearchInputHandle} from './search-input'
import {SubscriptionButton} from './subscription'
import {TitleBarProps} from './titlebar'
import {TitleContent} from './titlebar-title'

export function DocOptionsButton({
  onPublishSite,
}: {
  onPublishSite: (input: {
    id: UnpackedHypermediaId
    step?: 'seed-host-custom-domain'
  }) => void
}) {
  const route = useNavRoute()
  const dispatch = useNavigationDispatch()
  if (route.key !== 'document' && route.key !== 'feed')
    throw new Error(
      'DocOptionsButton can only be rendered on publication route',
    )
  const {exportDocument, openDirectory} = useAppContext()
  const deleteEntity = useDeleteDialog()
  const gwUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL
  const resource = useResource(route.id)
  const doc =
    resource.data?.type === 'document' ? resource.data.document : undefined
  const rootEntity = useResource(hmId(route.id.uid))
  const rootDocument =
    rootEntity.data?.type === 'document' ? rootEntity.data.document : undefined
  const siteUrl = rootDocument?.metadata.siteUrl
  // const copyLatest =
  //   route.id.latest || !route.id.version || doc?.version === route.id.version
  const [copyGatewayContent, onCopyGateway] = useCopyReferenceUrl(gwUrl)
  const [copySiteUrlContent, onCopySiteUrl] = useCopyReferenceUrl(
    siteUrl || gwUrl,
    siteUrl ? hmId(route.id.uid) : undefined,
  )
  // const  {
  //   ...route.id,
  //   latest: copyLatest,
  //   version: doc?.version || null,
  // }
  const removeSite = useRemoveSiteDialog()
  const capability = useSelectedAccountCapability(route.id)
  const canEditDoc = roleCanWrite(capability?.role)
  const seedHostDialog = useSeedHostDialog()
  const branchDialog = useAppDialog(BranchDialog)
  const moveDialog = useAppDialog(MoveDialog)
  const myAccountIds = useMyAccountIds()
  const pendingDomain = useHostSession().pendingDomains?.find(
    (pending) => pending.siteUid === route.id.uid,
  )
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
        const markdownWithFiles = await convertBlocksToMarkdown(
          editorBlocks,
          doc,
        )
        const {markdownContent, mediaFiles} = markdownWithFiles
        exportDocument(title, markdownContent, mediaFiles)
          .then((res) => {
            const success = (
              <>
                <div className="flex max-w-[700px] flex-col gap-1.5">
                  <SizableText className="text-wrap break-all">
                    Successfully exported document "{title}" to:{' '}
                    <b>{`${res}`}</b>.
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
  if (doc && canEditDoc && route.id.path?.length) {
    menuItems.push({
      key: 'delete',
      label: 'Delete Document',
      icon: <Trash className="size-4" />,
      onClick: () => {
        deleteEntity.open({
          id: route.id,
          onSuccess: () => {
            dispatch({
              type: 'backplace',
              route: {
                key: 'document',
                id: hmId(route.id.uid, {
                  path: route.id.path?.slice(0, -1),
                }),
              } as any,
            })
          },
        })
      },
    })
  }
  if (!route.id.path?.length && canEditDoc) {
    if (doc?.metadata?.siteUrl) {
      const siteHost = hostnameStripProtocol(doc?.metadata?.siteUrl)
      const gwHost = hostnameStripProtocol(gwUrl)
      if (siteHost.endsWith(gwHost) && !pendingDomain) {
        menuItems.push({
          key: 'publish-custom-domain',
          label: 'Publish Custom Domain',
          icon: <UploadCloud className="size-4" />,
          onClick: () => {
            onPublishSite({id: route.id, step: 'seed-host-custom-domain'})
          },
        })
      }
      menuItems.push({
        key: 'publish-site',
        label: 'Remove Site from Publication',
        icon: <CloudOff className="size-4" />,
        color: '$red10',
        onClick: () => {
          removeSite.open(route.id)
        },
      })
    } else
      menuItems.push({
        key: 'publish-site',
        label: 'Publish Site to Domain',
        icon: <UploadCloud className="size-4" />,
        onClick: () => {
          onPublishSite({id: route.id})
        },
      })
  }
  const createDraft = useCreateDraft({
    locationUid: route.id.uid,
    locationPath: route.id.path || undefined,
  })
  const importDialog = useImportDialog()
  const importing = useImporting(route.id)
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
        })
      },
    })
  }

  if (myAccountIds.data?.length) {
    menuItems.push({
      key: 'branch',
      label: 'Create Document Branch',
      icon: <GitFork className="size-4" />,
      onClick: () => {
        branchDialog.open(route.id)
      },
    })
  }

  if (canEditDoc && myAccountIds.data?.length && route.id.path?.length) {
    menuItems.push({
      key: 'move',
      label: 'Move Document',
      icon: <ForwardIcon className="size-4" />,
      onClick: () => {
        moveDialog.open({
          id: route.id,
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
      <OptionsDropdown
        className="window-no-drag"
        menuItems={menuItems}
        align="start"
        side="bottom"
      />
    </>
  )
}

export function PageActionButtons(props: TitleBarProps) {
  const route = useNavRoute()
  if (route.key == 'document' || route.key == 'feed') {
    return <DocumentTitlebarButtons route={route} />
  }
  return null
}

function DocumentTitlebarButtons({route}: {route: DocumentRoute | FeedRoute}) {
  const {id} = route
  const latestDoc = useResource(latestId(id), {subscribed: true})

  // Determine if we're viewing the latest version
  // Only consider it "latest" if we can confirm it (to avoid button flashing during load)
  const isLatest =
    !route.id.version ||
    route.id.latest ||
    // Only hide the button if we've loaded the latest doc and versions match
    (latestDoc.data?.id?.version != null &&
      // @ts-ignore
      latestDoc.data?.id?.version == route.id.version)

  const publishSite = usePublishSite()
  const isHomeDoc = !id.path?.length
  const capability = useSelectedAccountCapability(id)
  const canEditDoc = roleCanWrite(capability?.role)
  const entity = useResource(id)
  const showPublishSiteButton =
    isHomeDoc &&
    canEditDoc &&
    entity.data?.type == 'document' &&
    !entity.data.document?.metadata.siteUrl
  return (
    <TitlebarSection>
      {showPublishSiteButton ? (
        <Button
          variant="default"
          onClick={() => publishSite.open({id})}
          size="sm"
        >
          Publish to Web Domain
          <UploadCloud className="size-4" />
        </Button>
      ) : null}
      <SubscriptionButton id={route.id} />
      {isLatest ? null : <GoToLatestVersionButton route={route} />}
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
    icon = !isLocked ? (
      <ArrowRightFromLine className="size-4" />
    ) : (
      <ArrowLeftFromLine className="size-4" />
    )
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

function GoToLatestVersionButton({route}: {route: DocumentRoute | FeedRoute}) {
  const navigate = useNavigate('push')

  return (
    <Button
      variant="secondary"
      size="xs"
      onClick={() => {
        navigate({
          key: 'document',
          id: {...route.id, version: null, latest: true},
          panel: route.panel,
        })
      }}
    >
      Latest Version
      <ArrowRight className="size-4" />
    </Button>
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

/**
 * Get view term suffix for route (e.g., /:discussions, /:activity)
 */
function getViewTermForRoute(route: NavRoute): string | null {
  // First-class view routes
  if (route.key === 'activity') return '/:activity'
  if (route.key === 'discussions') return '/:discussions'
  if (route.key === 'collaborators') return '/:collaborators'
  if (route.key === 'directory') return '/:directory'

  // Document routes with panel
  if (route.key === 'document' && route.panel) {
    const panelKey = route.panel.key
    if (panelKey === 'activity') return '/:activity'
    if (panelKey === 'discussions') return '/:discussions'
    if (panelKey === 'collaborators') return '/:collaborators'
    if (panelKey === 'directory') return '/:directory'
  }

  return null
}

/**
 * Hook to construct displayable URL from current route
 * Priority: siteUrl > gatewayUrl (never hm://)
 * Includes view term suffix for panel routes (e.g., /:discussions)
 */
function useCurrentRouteUrl(): string | null {
  const route = useNavRoute()
  const gwUrl = useGatewayUrl().data || DEFAULT_GATEWAY_URL

  // Get account entity to check for siteUrl
  const routeId = getRouteId(route)
  const accountEntity = useResource(routeId ? hmId(routeId.uid) : null)
  const siteHostname =
    accountEntity.data?.type === 'document'
      ? accountEntity.data.document?.metadata?.siteUrl
      : null

  return useMemo(() => {
    if (!routeId) return null

    // Get view term suffix if applicable
    const viewTerm = getViewTermForRoute(route)

    let baseUrl: string
    // Use siteUrl if available, otherwise gateway URL
    if (siteHostname) {
      baseUrl = createSiteUrl({
        hostname: siteHostname,
        path: routeId.path,
        version: routeId.version,
        latest: routeId.latest ?? undefined,
        blockRef: routeId.blockRef,
        blockRange: routeId.blockRange,
      })
    } else {
      baseUrl = createWebHMUrl(routeId.uid, {
        hostname: gwUrl,
        path: routeId.path,
        version: routeId.version,
        latest: routeId.latest ?? undefined,
        blockRef: routeId.blockRef,
        blockRange: routeId.blockRange,
      })
    }

    // Append view term before query string if present
    if (viewTerm) {
      const queryIndex = baseUrl.indexOf('?')
      if (queryIndex !== -1) {
        return (
          baseUrl.slice(0, queryIndex) + viewTerm + baseUrl.slice(queryIndex)
        )
      }
      const hashIndex = baseUrl.indexOf('#')
      if (hashIndex !== -1) {
        return baseUrl.slice(0, hashIndex) + viewTerm + baseUrl.slice(hashIndex)
      }
      return baseUrl + viewTerm
    }

    return baseUrl
  }, [routeId, route, siteHostname, gwUrl])
}

/**
 * Extract ID from route if applicable
 */
function getRouteId(route: NavRoute): UnpackedHypermediaId | null {
  if (
    route.key === 'document' ||
    route.key === 'feed' ||
    route.key === 'activity' ||
    route.key === 'directory' ||
    route.key === 'collaborators' ||
    route.key === 'discussions'
  ) {
    return route.id
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
    route.key === 'activity' ||
    route.key === 'directory' ||
    route.key === 'collaborators' ||
    route.key === 'discussions'
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

        if (!looksLikeUrl && value.length > 0) {
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
  const currentUrl = useCurrentRouteUrl()
  const publishSite = usePublishSite()
  const searchInputRef = useRef<SearchInputHandle>(null)

  const {
    mode,
    inputValue,
    inputRef,
    focus,
    focusSearch,
    blur,
    handleInputChange,
  } = useOmnibarState(currentUrl)

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
      // Extract view term (e.g., /:activity) from URL before processing
      const {url: cleanUrl, viewTerm} = extractViewTermFromUrl(url)
      const routeKey = viewTermToRouteKey(viewTerm)

      // Helper to apply view term to route
      const applyViewTerm = (route: NavRoute): NavRoute => {
        if (!routeKey) return route
        if (route.key === 'document') {
          // Return first-class page route instead of document
          return {key: routeKey, id: route.id}
        }
        return route
      }

      // First try to parse as hm:// URL (synchronous)
      const unpacked = unpackHmId(cleanUrl)
      if (unpacked) {
        const navRoute = appRouteOfId(unpacked)
        if (navRoute) {
          navigate(applyViewTerm(navRoute))
          return true
        }
      }

      // If it looks like an HTTP URL, try to resolve it (async)
      if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
        try {
          const result = await resolveHypermediaUrl(cleanUrl)
          if (result?.hmId) {
            const navRoute = appRouteOfId(result.hmId)
            if (navRoute) {
              navigate(applyViewTerm(navRoute))
              return true
            }
          }
        } catch (error) {
          console.error('Failed to resolve URL:', error)
        }
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
            const isHttpUrl =
              url.startsWith('http://') || url.startsWith('https://')
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

  // Render indicators on the right (draft badge is handled by TitleContent/BreadcrumbTitle)
  const indicators = isPrivate ? (
    <div className="flex shrink-0 items-center gap-1 px-2">
      <div className="bg-muted text-muted-foreground flex items-center gap-1 rounded-full px-2 py-0.5 text-xs">
        <Lock className="size-3" />
        <span>Private</span>
      </div>
    </div>
  ) : null

  // Idle state - show breadcrumbs with smaller text
  if (mode === 'idle') {
    return (
      <div
        className={cn(
          'no-window-drag border-border flex min-w-0 flex-1 cursor-text items-center gap-2 overflow-hidden rounded-full rounded-md border-2 pl-2',
          'hover:border-border hover:bg-muted/50',
          'transition-colors',
        )}
        onClick={handleContainerClick}
      >
        {/* <Search className="text-muted-foreground size-3.5 shrink-0" /> */}
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          <div className="min-w-0 flex-1 truncate text-xs">
            <TitleContent size="$3" onPublishSite={publishSite.open} />
          </div>
          {indicators}
        </div>
        {publishSite.content}
      </div>
    )
  }

  // Focused URL state - show editable URL input
  if (mode === 'focused') {
    return (
      <div
        className={cn(
          'no-window-drag flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-full border py-1 pl-2',
          'border-primary bg-background',
          'focus-within:ring-primary focus-within:ring-1',
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
            'min-w-0 flex-1 truncate border-none bg-transparent text-xs outline-none',
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
            'no-window-drag flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-full border py-1 pl-2',
            'border-primary bg-background',
            'focus-within:ring-primary focus-within:ring-1',
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
              'min-w-0 flex-1 truncate border-none bg-transparent text-xs outline-none',
              'placeholder:text-muted-foreground',
            )}
            placeholder="Search documents..."
            autoFocus
          />
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
