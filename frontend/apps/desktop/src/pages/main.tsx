import {ActivityPanelProvider, ActivityPanelOutlet} from '@shm/ui/activity-panel-layout'
import {useAppContext, useListen} from '@/app-context'

import {BookmarksPanel, BookmarksPanelProvider, useBookmarksPanel} from '@/components/bookmarks-panel'
import {CloseButton} from '@/components/window-controls'
import appError from '@/errors'
import {ipc} from '@/ipc'
import {useDraft} from '@/models/accounts'
import {useConnectPeer} from '@/models/contacts'
import {useCreateDraft} from '@/models/documents'
import {useLocalAgentsServerMigration} from '@/models/local-agents-server'
import {useEnsureLocalAssistantAgent} from '@/models/local-assistant'
import {useSelectedAccountId} from '@/selected-account'
import {SidebarContextProvider, useSidebarContext} from '@/sidebar-context'
import {draftDocumentRouteId} from '@/utils/draft-route'
import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {getWindowType} from '@/utils/window-types'
import {hmId} from '@shm/shared'
import {defaultRoute, getRoutePanel, NavRoute} from '@shm/shared/routes'
import {useStream} from '@shm/shared/use-stream'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'
import {NotificationInboxProvider} from '@shm/ui/activity-panel'
import {AssistantPanel} from '@shm/ui/agents/assistant-panel'
import {useAgentServerUrls, useHasAnyAgent} from '@shm/ui/agents/models'
import {AssistantPanelToggleContext, type AssistantPanelToggle} from '@shm/ui/assistant-panel-toggle'
import {Button} from '@shm/ui/button'
import {DialogTitle} from '@shm/ui/components/dialog'
import {windowContainerStyles} from '@shm/ui/container'
import {AnimatedPanel, PanelSeparator, useSavedPanelLayout} from '@shm/ui/resizable-panels'
import {SidePanelSlotContent, useSidePanelSlot} from '@shm/ui/side-panel-slot'
import {Spinner} from '@shm/ui/spinner'
import {TitlebarWrapper, TitleText} from '@shm/ui/titlebar'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {lazy, ReactElement, ReactNode, Suspense, useCallback, useEffect, useMemo, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {Group, Panel} from 'react-resizable-panels'
import {AppErrorPage, RootAppError} from '../components/app-error'
import {AutoUpdater} from '../components/auto-updater'
import {DesktopNotificationInbox} from '../components/desktop-notification-inbox'
import Footer from '../components/footer'
import {HypermediaHighlight} from '../components/hypermedia-highlight'
import {AppSidebar} from '../components/sidebar'
import {TitleBar} from '../components/titlebar'
import {WindowTitle} from '../components/window-title'
import {BaseLoading, NotFoundPage} from './base'
import {DocumentPlaceholder} from './document-placeholder'
import './polyfills'

const WebBrowser = lazy(() => import('./web-browser').then((module) => ({default: module.WebBrowser})))

var Onboarding = lazy(() => import('./onboarding'))
var Settings = lazy(() => import('./settings'))
var AccountSettings = lazy(() => import('./account-settings'))
var SiteSettings = lazy(() => import('./site-settings'))
var Contacts = lazy(() => import('./contacts-page'))
var Contact = lazy(() => import('./contact-page'))
var Document = lazy(() => import('./desktop-resource'))
var Feed = lazy(() => import('./desktop-feed'))
var InspectResource = lazy(() => import('./inspect-resource'))
var InspectIpfs = lazy(() => import('./inspect-ipfs'))
var SchemaBrowser = lazy(() => import('./schema'))
var ApiInspector = lazy(() => import('./api-inspector'))
var QueryDocuments = lazy(() => import('./query-documents'))
var Drafts = lazy(() => import('./drafts'))
var Explore = lazy(() => import('./explore'))
var AgentDetail = lazy(() => import('@shm/ui/agents/detail'))
var AgentSession = lazy(() => import('@shm/ui/agents/session'))
var AgentRun = lazy(() => import('@shm/ui/agents/run'))
var Profile = lazy(() => import('./profile'))
var SiteSettingsEmails = lazy(() => import('./site-settings-emails'))

/**
 * Redirect persisted `key: 'draft'` routes (from before draft-route removal)
 * onto the unified document route. Looks up the listed draft to recover
 * editUid/editPath (or locationUid/locationPath) and replaces the route.
 */
function DraftRouteRedirect() {
  const route = useNavRoute()
  const replace = useNavigate('replace')
  const draftId = route.key === 'draft' ? route.id : undefined
  const draftQuery = useDraft(draftId)
  useEffect(() => {
    if (route.key !== 'draft') return
    const inlineUid = route.editUid || route.locationUid
    if (inlineUid) {
      const inlinePath = route.editUid ? route.editPath : route.locationPath
      replace({key: 'document', id: hmId(inlineUid, {path: inlinePath ?? []})})
      return
    }
    if (draftQuery.isLoading) return
    const draft = draftQuery.data
    if (!draft) {
      replace(defaultRoute)
      return
    }
    const targetId = draftDocumentRouteId(draft)
    if (!targetId) {
      replace(defaultRoute)
      return
    }
    replace({key: 'document', id: targetId})
  }, [route, draftQuery.isLoading, draftQuery.data, replace])
  return <DocumentPlaceholder />
}

/** The window's assistant state, shown in the shared accessory slot. */
type AccessoryAssistant = {
  /** Agents exist (or are still loading), so the panel may be shown. */
  available: boolean
  /** The user has the assistant open (`shouldRenderAssistantPanel`). */
  open: boolean
  sessionId: string | null
  onSessionChange: (sessionId: string | null) => void
  onClose: () => void
}

/** Renders the main desktop app window; Agents, Bookmarks and Activity share one side panel. */
export default function Main({className}: {className?: string}) {
  const navR = useNavRoute()
  const navigate = useNavigate()
  const replaceRemovedRoute = useNavigate('replace')
  useEffect(() => {
    if (navR.key === 'library') {
      replaceRemovedRoute(defaultRoute)
    }
  }, [navR.key, replaceRemovedRoute])
  const selectedAccountId = useSelectedAccountId()
  const createNewDocument = useCreateDraft({
    locationUid: selectedAccountId ?? undefined,
    locationPath: [],
  })
  useListenAppEvent('create_new_document', () => {
    void createNewDocument()
  })
  const initNavState = (window as any).initNavState
  const [assistantOpen, setAssistantOpen] = useState(initNavState?.assistantOpen || false)
  const [assistantSessionId, setAssistantSessionId] = useState<string | null>(initNavState?.assistantSessionId || null)
  // The assistant sidebar is a view over the Agents service, so its entry points depend on there
  // being an agent to talk to — not merely a server. The desktop always runs a local server, so
  // server availability is always true and would leave the controls visible with nothing to chat
  // with. While the agent lists are still resolving we treat the assistant as available so a
  // restored sidebar is not torn down on every launch.
  const agentServerUrls = useAgentServerUrls()
  // On a fresh install the local server has no agents, which would keep the assistant hidden
  // forever — provision the built-in Assistant as soon as a model provider exists.
  useEnsureLocalAssistantAgent(selectedAccountId)
  // After an upgrade, decides whether the bundled local server stays on (it holds agents) or goes.
  useLocalAgentsServerMigration()
  const {hasAgents, isSettled: agentsSettled} = useHasAnyAgent(agentServerUrls.data, selectedAccountId)
  const isAssistantAvailable = hasAgents || !agentsSettled
  const shouldRenderAssistantPanel = assistantOpen && isAssistantAvailable

  const sendAssistantState = useCallback((open: boolean, sessionId: string | null) => {
    ipc.send('windowAssistantState', {assistantOpen: open, assistantSessionId: sessionId})
  }, [])

  const handleToggleAssistant = useCallback(() => {
    setAssistantOpen((prev: boolean) => {
      const next = !prev
      sendAssistantState(next, assistantSessionId)
      return next
    })
  }, [assistantSessionId, sendAssistantState])

  const handleCloseAssistant = useCallback(() => {
    setAssistantOpen(false)
    sendAssistantState(false, assistantSessionId)
  }, [assistantSessionId, sendAssistantState])

  const assistantPanelToggle = useMemo<AssistantPanelToggle | null>(
    () => (isAssistantAvailable ? {isOpen: assistantOpen, toggle: handleToggleAssistant} : null),
    [isAssistantAvailable, assistantOpen, handleToggleAssistant],
  )

  const handleSessionChange = useCallback(
    (sessionId: string | null) => {
      setAssistantSessionId(sessionId)
      sendAssistantState(assistantOpen, sessionId)
    },
    [assistantOpen, sendAssistantState],
  )

  useEffect(() => {
    if (agentsSettled && !hasAgents && assistantOpen) {
      setAssistantOpen(false)
      sendAssistantState(false, assistantSessionId)
    }
  }, [assistantOpen, assistantSessionId, agentsSettled, hasAgents, sendAssistantState])

  const {platform} = useAppContext()
  const {PageComponent, Fallback} = useMemo(() => getPageComponent(navR), [navR])
  const [browserMounted, setBrowserMounted] = useState(navR.key === 'web')
  useEffect(() => {
    if (navR.key === 'web') setBrowserMounted(true)
  }, [navR.key])
  // Reset route-scoped crashes on navigation without forcing the entire page tree
  // to unmount. Document routes share a single page component and rely on staying
  // mounted so the site header and editor state do not flash between navigations.
  const routeKey = useMemo(() => getRouteKey(navR), [navR])
  useListen<NavRoute>(
    'open_route',
    (event) => {
      const route = event.payload
      navigate(route)
    },
    [navigate],
  )
  const accessoryAssistant = useMemo<AccessoryAssistant>(
    () => ({
      available: isAssistantAvailable,
      open: shouldRenderAssistantPanel,
      sessionId: assistantSessionId,
      onSessionChange: handleSessionChange,
      onClose: handleCloseAssistant,
    }),
    [isAssistantAvailable, shouldRenderAssistantPanel, assistantSessionId, handleSessionChange, handleCloseAssistant],
  )
  const windowType = getWindowType()
  let titlebar: ReactElement | null = null
  let sidebar: ReactElement | null = null
  if (windowType === 'main') {
    titlebar = <TitleBar />
    sidebar = <AppSidebar />
  } else if (windowType === 'settings') {
    titlebar = (
      <TitlebarWrapper className="bg-background h-8 min-h-8 dark:bg-black">
        <div className="window-drag flex w-full items-center justify-center">
          <TitleText className="text-center font-bold">Settings</TitleText>
          {platform !== 'darwin' && <WindowClose />}
        </div>
      </TitlebarWrapper>
    )
    return (
      <div className={cn(windowContainerStyles, 'p-0', className)}>
        <WindowTitle />
        <ErrorBoundary
          resetKeys={[routeKey]}
          FallbackComponent={AppErrorPage}
          onReset={() => {
            window.location.reload()
          }}
        >
          {titlebar}
          <Suspense fallback={<Fallback />}>
            <PageComponent />
          </Suspense>
        </ErrorBoundary>
      </div>
    )
  } else if (windowType === 'inspect-ipfs') {
    // Chromeless: no sidebar, no omnibar. The page renders its own slim top bar
    // (read-only ipfs:// URL + copy + "…" menu) as the window's title bar.
    return (
      <div className={cn(windowContainerStyles, 'p-0', className)}>
        <WindowTitle />
        <ErrorBoundary
          resetKeys={[routeKey]}
          FallbackComponent={AppErrorPage}
          onReset={() => {
            window.location.reload()
          }}
        >
          <Suspense fallback={<Fallback />}>
            <PageComponent />
          </Suspense>
        </ErrorBoundary>
      </div>
    )
  }

  return (
    <div className={cn(windowContainerStyles, 'p-0', className)}>
      <WindowTitle />
      <div className="min-h-0 flex-1">
        <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[auto_minmax(0,1fr)_auto]">
          <ActivityPanelProvider>
            <BookmarksPanelProvider>
              <SidebarContextProvider>
                {titlebar}
                <PanelContent assistant={accessoryAssistant}>
                  {sidebar}
                  <Panel id="page">
                    <div className="flex h-full min-h-0 flex-col">
                      <div className="min-h-0 flex-1">
                        <ErrorBoundary
                          resetKeys={[routeKey]}
                          FallbackComponent={RootAppError}
                          onReset={() => {
                            window.location.reload()
                          }}
                        >
                          {/* Route-scoped suspense: a page chunk still loading shows its own placeholder
                        inside the panel. Without this, the lazy import suspends all the way to the
                        root boundary and the whole window — chrome included — becomes a spinner. */}
                          <Suspense fallback={<Fallback />}>
                            {(browserMounted || navR.key === 'web') && <WebBrowser />}
                            {navR.key !== 'web' && (
                              <AssistantPanelToggleContext.Provider value={assistantPanelToggle}>
                                <NotificationInboxProvider value={DesktopNotificationInbox}>
                                  <PageComponent />
                                </NotificationInboxProvider>
                              </AssistantPanelToggleContext.Provider>
                            )}
                          </Suspense>
                        </ErrorBoundary>
                      </div>
                    </div>
                  </Panel>
                  <DesktopAccessoryPanel assistant={accessoryAssistant} />
                </PanelContent>

                <Footer />

                <AutoUpdater />
                <ConfirmConnectionDialog />
                <HypermediaHighlight />
              </SidebarContextProvider>
            </BookmarksPanelProvider>
          </ActivityPanelProvider>
        </div>
      </div>
    </div>
  )
}

function DesktopAccessoryPanel({assistant}: {assistant: AccessoryAssistant}) {
  const saved = useSavedPanelLayout('desktop-accessory', ['page', 'bookmarks'])
  const bookmarks = useBookmarksPanel()
  const route = useNavRoute()
  const navigate = useNavigate()
  const replaceNavigate = useNavigate('replace')
  const activityOpen = getRoutePanel(route)?.key === 'feed'
  // Agents, Bookmarks and Activity share one slot: whichever opens last closes the others.
  const active = useSidePanelSlot([
    [
      'activity',
      {
        open: activityOpen,
        close: () => {
          if ('panel' in route) replaceNavigate({...route, panel: null})
        },
      },
    ],
    ['bookmarks', {open: bookmarks.isOpen, close: bookmarks.close}],
    ['assistant', {open: assistant.open, close: assistant.onClose}],
  ])
  const close = () => {
    if (activityOpen && 'panel' in route) navigate({...route, panel: null})
    else if (bookmarks.isOpen) bookmarks.close()
    else assistant.onClose()
  }
  return (
    <>
      <PanelSeparator open={active !== null} onCollapse={close} />
      <AnimatedPanel
        id="bookmarks"
        open={active !== null}
        keepMounted={assistant.available}
        minSize="240px"
        maxSize="45%"
        defaultSize={saved.expanded?.bookmarks ? `${saved.expanded.bookmarks}%` : '320px'}
        className="border-border overflow-hidden rounded-lg border"
      >
        <SidePanelSlotContent
          active={active}
          panels={{
            activity: {render: () => <ActivityPanelOutlet />},
            bookmarks: {render: () => <BookmarksPanel />},
            // The assistant stays mounted once opened so its chat survives switching to
            // Bookmarks or Activity.
            assistant: {
              keepMounted: true,
              render: () =>
                assistant.available ? (
                  <AssistantPanel
                    initialSessionId={assistant.sessionId}
                    visible={active === 'assistant'}
                    onSessionChange={assistant.onSessionChange}
                    onClose={assistant.onClose}
                  />
                ) : null,
            },
          }}
        />
      </AnimatedPanel>
    </>
  )
}

function ConfirmConnectionDialogContent({input, onClose}: {input: string; onClose: () => void}) {
  const connect = useConnectPeer({
    onSuccess: () => {
      onClose()
      toast.success('Connection Added')
    },
    onError: (error) => {
      // @ts-expect-error
      appError(`Connect to peer error: ${error?.rawMessage}`, {error})
    },
  })
  return (
    <>
      <DialogTitle>Confirm Connection</DialogTitle>
      {connect.isLoading ? (
        <div className="flex items-center justify-center">
          <Spinner />
        </div>
      ) : null}
      <Button
        variant="brand"
        onClick={() => {
          console.log('Will attempt connection:', input)
          connect.mutate(input)
        }}
      >
        Connect Peer
      </Button>
    </>
  )
}

function ConfirmConnectionDialog() {
  const dialog = useAppDialog(ConfirmConnectionDialogContent)
  useListenAppEvent('connectPeer', (payload) => {
    dialog.open(payload.connectionUrl)
  })
  return dialog.content
}

function PanelContent({children, assistant}: {children: ReactNode; assistant: AccessoryAssistant}) {
  const saved = useSavedPanelLayout('desktop-accessory', ['page', 'bookmarks'])
  const ctx = useSidebarContext()
  const bookmarksPanel = useBookmarksPanel()
  const route = useNavRoute()
  const navigate = useNavigate()
  const activityOpen = getRoutePanel(route)?.key === 'feed'
  const isSidebarLocked = useStream(ctx.isLocked)

  useListenAppEvent('toggle_sidebar', () => {
    const activeEl = document.activeElement
    const pmEl = activeEl?.closest?.('.ProseMirror') as HTMLElement | null
    const tiptapEditor = pmEl && (pmEl as any).editor
    console.log('[Cmd+B]', {
      activeEl: activeEl?.tagName,
      hasPM: !!pmEl,
      isFocused: tiptapEditor?.isFocused,
      isEditable: tiptapEditor?.isEditable,
    })
    if (tiptapEditor?.isFocused && tiptapEditor?.isEditable) {
      tiptapEditor.commands.toggleBold()
      return
    }
    ctx.onToggleMenuLock()
  })

  return (
    <Group
      orientation="horizontal"
      className={cn('flex min-h-0 overflow-hidden pr-2', !isSidebarLocked && 'pl-2')}
      onLayoutChanged={(layout, meta) => {
        if (!meta.isUserInteraction) return
        const accessoryWidth = (meta.requestedLayout ?? layout).bookmarks ?? 0
        // Store the accessory share independently of the optional app sidebar.
        saved.onLayoutChanged(
          {page: 100 - accessoryWidth, bookmarks: accessoryWidth},
          {...meta, requestedLayout: undefined},
        )
        if (layout.bookmarks === 0) {
          if (activityOpen && 'panel' in route) navigate({...route, panel: null})
          else if (bookmarksPanel.isOpen) bookmarksPanel.close()
          else if (assistant.open) assistant.onClose()
        }
        const width = (meta.requestedLayout ?? layout).sidebar
        if (width && width > 0) ctx.onSidebarResize(width)
        if (layout.sidebar === 0) ctx.onCloseSidebar()
        else ctx.onLockSidebarOpen()
      }}
    >
      {children}
    </Group>
  )
}

function getPageComponent(navRoute: NavRoute) {
  switch (navRoute.key) {
    case 'onboarding':
      return {
        PageComponent: Onboarding,
        Fallback: BaseLoading,
      }
    case 'contacts':
      return {
        PageComponent: Contacts,
        Fallback: BaseLoading,
      }
    case 'contact':
      return {
        PageComponent: Contact,
        Fallback: BaseLoading,
      }
    case 'document':
    case 'all-documents':
      return {
        PageComponent: Document,
        Fallback: DocumentPlaceholder,
      }
    case 'draft':
      return {
        PageComponent: DraftRouteRedirect,
        Fallback: DocumentPlaceholder,
      }
    case 'settings':
      return {
        PageComponent: Settings,
        Fallback: BaseLoading,
      }
    case 'account-settings':
      return {
        PageComponent: AccountSettings,
        Fallback: BaseLoading,
      }
    case 'site-settings':
      return {
        PageComponent: SiteSettings,
        Fallback: BaseLoading,
      }
    case 'api-inspector':
      return {
        PageComponent: ApiInspector,
        Fallback: BaseLoading,
      }
    case 'query-documents':
      return {
        PageComponent: QueryDocuments,
        Fallback: BaseLoading,
      }
    case 'drafts':
      return {PageComponent: Drafts, Fallback: BaseLoading}
    case 'explore':
      return {
        PageComponent: Explore,
        Fallback: BaseLoading,
      }
    case 'agent':
      return {
        PageComponent: AgentDetail,
        Fallback: BaseLoading,
      }
    case 'agent-session':
      return {
        PageComponent: AgentSession,
        Fallback: BaseLoading,
      }
    case 'agent-run':
      return {
        PageComponent: AgentRun,
        Fallback: BaseLoading,
      }
    case 'feed':
      return {
        PageComponent: Feed,
        Fallback: DocumentPlaceholder,
      }
    case 'directory':
      return {
        PageComponent: Document,
        Fallback: DocumentPlaceholder,
      }
    case 'inspect':
      return {
        PageComponent: InspectResource,
        Fallback: DocumentPlaceholder,
      }
    case 'inspect-ipfs':
      return {
        PageComponent: InspectIpfs,
        Fallback: DocumentPlaceholder,
      }
    case 'schema':
      return {
        PageComponent: SchemaBrowser,
        Fallback: DocumentPlaceholder,
      }
    case 'collaborators':
      return {
        PageComponent: Document,
        Fallback: DocumentPlaceholder,
      }
    case 'activity':
      return {
        PageComponent: Document,
        Fallback: DocumentPlaceholder,
      }
    case 'comments':
      return {
        PageComponent: Document,
        Fallback: DocumentPlaceholder,
      }
    case 'metadata':
      return {
        PageComponent: Document,
        Fallback: DocumentPlaceholder,
      }
    case 'profile':
      return {
        PageComponent: Profile,
        Fallback: BaseLoading,
      }
    case 'site-profile':
      return {
        PageComponent: Document,
        Fallback: DocumentPlaceholder,
      }
    case 'site-settings-emails':
      return {
        PageComponent: SiteSettingsEmails,
        Fallback: BaseLoading,
      }
    default:
      return {
        PageComponent: NotFoundPage,
        Fallback: BaseLoading,
      }
  }
}

function WindowClose() {
  return (
    <div className="no-window-drag absolute top-0 right-0 size-[26px] items-center justify-center">
      <CloseButton />
    </div>
  )
}
