import {useAppContext, useListen} from '@/app-context'

import {LinkDeviceDialog} from '@/components/link-device-dialog'
import {CloseButton} from '@/components/window-controls'
import appError from '@/errors'
import {ipc} from '@/ipc'
import {useAIProviders} from '@/models/ai-config'
import {useConnectPeer} from '@/models/contacts'
import {useMyAccountIds} from '@/models/daemon'
import {SidebarContextProvider, useSidebarContext} from '@/sidebar-context'
import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {getWindowType} from '@/utils/window-types'
import {useAccounts} from '@shm/shared/models/entity'
import {NavRoute} from '@shm/shared/routes'
import {useStream} from '@shm/shared/use-stream'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {DialogTitle} from '@shm/ui/components/dialog'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {windowContainerStyles} from '@shm/ui/container'
import {HMIcon} from '@shm/ui/hm-icon'
import {Spinner} from '@shm/ui/spinner'
import {TitlebarWrapper, TitleText} from '@shm/ui/titlebar'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {lazy, ReactElement, ReactNode, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {ImperativePanelGroupHandle, Panel, PanelGroup, PanelResizeHandle} from 'react-resizable-panels'
import {AppErrorPage, RootAppError} from '../components/app-error'
import {AssistantPanel} from '../components/assistant-panel'
import {AutoUpdater} from '../components/auto-updater'
import Footer from '../components/footer'
import {HypermediaHighlight} from '../components/hypermedia-highlight'
import {AppSidebar} from '../components/sidebar'
import {TitleBar} from '../components/titlebar'
import {BaseLoading, NotFoundPage} from './base'
import {DocumentPlaceholder} from './document-placeholder'
import './polyfills'

var Settings = lazy(() => import('./settings'))
var Contacts = lazy(() => import('./contacts-page'))
var Contact = lazy(() => import('./contact-page'))
var Document = lazy(() => import('./desktop-resource'))
var Feed = lazy(() => import('./desktop-feed'))
var InspectResource = lazy(() => import('./inspect-resource'))
var InspectIpfs = lazy(() => import('./inspect-ipfs'))
var Draft = lazy(() => import('./draft'))
var Library = lazy(() => import('./library'))
var DeletedContent = lazy(() => import('./deleted-content'))
var ApiInspector = lazy(() => import('./api-inspector'))
var Drafts = lazy(() => import('./drafts'))
var Profile = lazy(() => import('./profile'))
var Preview = lazy(() => import('./preview'))
var Notifications = lazy(() => import('./notifications'))

/** Renders the main desktop app window and optional assistant sidebar. */
export default function Main({className}: {className?: string}) {
  const navR = useNavRoute()
  const navigate = useNavigate()
  const initNavState = (window as any).initNavState
  const [assistantOpen, setAssistantOpen] = useState(initNavState?.assistantOpen || false)
  const [assistantSessionId, setAssistantSessionId] = useState<string | null>(initNavState?.assistantSessionId || null)
  const [assistantNewChatRequest, setAssistantNewChatRequest] = useState(0)
  const providers = useAIProviders()
  const hasAssistantProviders = (providers.data?.length || 0) > 0
  const shouldRenderAssistantPanel = assistantOpen && (hasAssistantProviders || !providers.isSuccess)

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

  const handleNewAssistantChat = useCallback(() => {
    if (!hasAssistantProviders) {
      return
    }

    setAssistantOpen((prev: boolean) => {
      if (!prev) {
        sendAssistantState(true, assistantSessionId)
      }
      return true
    })
    setAssistantNewChatRequest((prev) => prev + 1)
  }, [assistantSessionId, hasAssistantProviders, sendAssistantState])

  const handleSessionChange = useCallback(
    (sessionId: string | null) => {
      setAssistantSessionId(sessionId)
      sendAssistantState(assistantOpen, sessionId)
    },
    [assistantOpen, sendAssistantState],
  )

  useEffect(() => {
    if (providers.isSuccess && !hasAssistantProviders && assistantOpen) {
      setAssistantOpen(false)
      sendAssistantState(false, assistantSessionId)
    }
  }, [assistantOpen, assistantSessionId, hasAssistantProviders, providers.isSuccess, sendAssistantState])

  const {platform} = useAppContext()
  const {PageComponent, Fallback} = useMemo(() => getPageComponent(navR), [navR])
  const routeKey = useMemo(() => getRouteKey(navR), [navR])
  useListen<NavRoute>(
    'open_route',
    (event) => {
      const route = event.payload
      navigate(route)
    },
    [navigate],
  )
  const windowType = getWindowType()
  let titlebar: ReactElement | null = null
  let sidebar: ReactElement | null = null
  if (windowType === 'main') {
    titlebar = <TitleBar />
    sidebar = <AppSidebar />
  } else if (windowType === 'settings') {
    titlebar = (
      <TitlebarWrapper className="bg-background h-6 min-h-6 dark:bg-black">
        <div className="window-drag flex w-full items-center justify-center">
          <TitleText className="text-center font-bold">Settings</TitleText>
          {platform !== 'darwin' && <WindowClose />}
        </div>
      </TitlebarWrapper>
    )
    return (
      <div className={cn(windowContainerStyles, 'p-0', className)}>
        <ErrorBoundary
          key={routeKey}
          FallbackComponent={AppErrorPage}
          onReset={() => {
            window.location.reload()
          }}
        >
          {titlebar}
          <PageComponent />
        </ErrorBoundary>
      </div>
    )
  } else if (windowType === 'deleted-content') {
    titlebar = (
      <TitlebarWrapper className="bg-background h-6 min-h-6 dark:bg-black">
        <div className="window-drag flex w-full items-center justify-center">
          <TitleText className="text-center font-bold">Review Deleted Content</TitleText>
          {platform !== 'darwin' && <WindowClose />}
        </div>
      </TitlebarWrapper>
    )
  }

  return (
    <div className={cn(windowContainerStyles, 'p-0', className)}>
      <PanelGroup direction="horizontal" autoSaveId="main-assistant">
        <Panel id="app-content" order={1}>
          <div className="flex h-full flex-col">
            <SidebarContextProvider>
              {titlebar}
              <PanelContent>
                {sidebar}
                <Panel id="page" order={2} className="pl-1">
                  <ErrorBoundary
                    key={routeKey}
                    FallbackComponent={RootAppError}
                    onReset={() => {
                      window.location.reload()
                    }}
                  >
                    <PageComponent />
                  </ErrorBoundary>
                </Panel>
              </PanelContent>

              <Footer
                assistantOpen={assistantOpen}
                onNewAssistantChat={hasAssistantProviders ? handleNewAssistantChat : undefined}
                onToggleAssistant={hasAssistantProviders ? handleToggleAssistant : undefined}
              />

              <AutoUpdater />
              <ConfirmConnectionDialog />
              <DeviceLinkHandler />
              <HypermediaHighlight />
            </SidebarContextProvider>
          </div>
        </Panel>
        {shouldRenderAssistantPanel && (
          <>
            <PanelResizeHandle className="panel-resize-handle" />
            <Panel id="assistant" order={2} minSize={15} maxSize={40} defaultSize={25} className="border-l">
              <AssistantPanel
                initialSessionId={assistantSessionId}
                newChatRequest={assistantNewChatRequest}
                onSessionChange={handleSessionChange}
              />
            </Panel>
          </>
        )}
      </PanelGroup>
    </div>
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

function PanelContent({children}: {children: ReactNode}) {
  const ctx = useSidebarContext()
  const isLocked = useStream(ctx.isLocked)
  const sidebarWidth = useStream(ctx.sidebarWidth)
  const ref = useRef<ImperativePanelGroupHandle>(null)

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

  useEffect(() => {
    const panelGroup = ref.current
    if (panelGroup) {
      if (isLocked && sidebarWidth && sidebarWidth > 0) {
        panelGroup.setLayout([sidebarWidth, 100 - sidebarWidth])
      } else {
        if (isLocked && sidebarWidth && sidebarWidth === 0) {
          panelGroup.setLayout([15, 85])
        } else {
          panelGroup.setLayout([0, 100])
        }
      }
    }
  }, [sidebarWidth, isLocked])

  return (
    <PanelGroup
      ref={ref}
      direction="horizontal"
      className={cn('flex flex-1 overflow-hidden px-2')}
      autoSaveId="main"
      storage={ctx.widthStorage}
    >
      {children}
    </PanelGroup>
  )
}

function getPageComponent(navRoute: NavRoute) {
  switch (navRoute.key) {
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
      return {
        PageComponent: Document,
        Fallback: DocumentPlaceholder,
      }
    case 'draft':
      return {
        PageComponent: Draft,
        Fallback: DocumentPlaceholder,
      }
    case 'settings':
      return {
        PageComponent: Settings,
        Fallback: BaseLoading,
      }
    case 'library': {
      return {
        PageComponent: Library,
        Fallback: BaseLoading,
      }
    }
    case 'deleted-content':
      return {
        PageComponent: DeletedContent,
        Fallback: BaseLoading,
      }
    case 'api-inspector':
      return {
        PageComponent: ApiInspector,
        Fallback: BaseLoading,
      }
    case 'drafts':
      return {
        PageComponent: Drafts,
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
    case 'preview':
      return {
        PageComponent: Preview,
        Fallback: DocumentPlaceholder,
      }
    case 'notifications':
      return {
        PageComponent: Notifications,
        Fallback: BaseLoading,
      }
    default:
      return {
        PageComponent: NotFoundPage,
        Fallback: BaseLoading,
      }
  }
}

function DeviceLinkHandler() {
  const [origin, setOrigin] = useState<string | undefined>(undefined)
  const [selectedAccount, setSelectedAccount] = useState<{
    accountUid: string
    accountName: string
  } | null>(null)
  const accountSelectorDialog = useAppDialog(AccountSelectorDialogContent)
  const linkDeviceDialog = useAppDialog(LinkDeviceDialog)

  useListenAppEvent('deviceLink', (payload) => {
    setOrigin(payload.origin)
    setSelectedAccount(null)
    accountSelectorDialog.open({
      origin: payload.origin,
      onAccountSelected: (accountUid: string, accountName: string) => {
        setSelectedAccount({accountUid, accountName})
      },
    })
  })

  useEffect(() => {
    if (selectedAccount) {
      linkDeviceDialog.open({
        ...selectedAccount,
        origin,
      })
      setSelectedAccount(null)
    }
  }, [selectedAccount, origin])

  return (
    <>
      {accountSelectorDialog.content}
      {linkDeviceDialog.content}
    </>
  )
}

function AccountSelectorDialogContent({
  input,
  onClose,
}: {
  input: {
    origin?: string
    onAccountSelected: (accountUid: string, accountName: string) => void
  }
  onClose: () => void
}) {
  const myAccountIds = useMyAccountIds()
  const accountQueries = useAccounts(myAccountIds.data || [])
  const [selectedAccountUid, setSelectedAccountUid] = useState<string | null>(null)

  const accountOptions = accountQueries.map((q) => q.data).filter((d) => !!d)

  const selectedAccountData = accountOptions.find((a) => a.id.uid === selectedAccountUid)

  return (
    <>
      <DialogTitle>Select Account to Link</DialogTitle>
      {input.origin && <p className="text-sm font-medium text-gray-600">Origin: {input.origin}</p>}
      <p className="text-sm text-gray-600">Choose which account you want to link to the web browser.</p>
      <ScrollArea className="h-full max-h-[300px] flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2">
          {accountOptions?.map((option) =>
            option ? (
              <div
                key={option.id.uid}
                className={cn(
                  'hover:bg-sidebar-accent flex cursor-pointer flex-row items-center gap-4 rounded-md p-3',
                  selectedAccountUid === option.id.uid ? 'bg-sidebar-accent' : '',
                )}
                onClick={() => setSelectedAccountUid(option.id.uid)}
              >
                {option.id ? (
                  <HMIcon id={option?.id} name={option?.metadata?.name} icon={option?.metadata?.icon} />
                ) : null}
                <span className="flex-1">{option.metadata?.name || `?${option.id.uid?.slice(-8)}`}</span>
              </div>
            ) : null,
          )}
        </div>
      </ScrollArea>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose} className="flex-1">
          Cancel
        </Button>
        <Button
          variant="default"
          disabled={!selectedAccountUid}
          onClick={() => {
            if (selectedAccountUid) {
              const accountName = selectedAccountData?.metadata?.name || 'Account'
              input.onAccountSelected(selectedAccountUid, accountName)
              onClose()
            }
          }}
          className="flex-1"
        >
          Continue
        </Button>
      </div>
    </>
  )
}

function WindowClose() {
  return (
    <div className="no-window-drag absolute top-0 right-0 size-[26px] items-center justify-center">
      <CloseButton />
    </div>
  )
}
