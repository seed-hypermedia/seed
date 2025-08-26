import {useAppContext, useListen} from '@/app-context'

import {CloseButton} from '@/components/window-controls'
import appError from '@/errors'
import {useConnectPeer} from '@/models/contacts'
import {SidebarContextProvider, useSidebarContext} from '@/sidebar-context'
import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {getWindowType} from '@/utils/window-types'
import {NavRoute} from '@shm/shared/routes'
import {getRouteKey, useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {DialogTitle} from '@shm/ui/components/dialog'
import {windowContainerStyles} from '@shm/ui/container'
import {Spinner} from '@shm/ui/spinner'
import {TitlebarWrapper, TitleText} from '@shm/ui/titlebar'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useStream} from '@shm/ui/use-stream'
import {cn} from '@shm/ui/utils'
import {lazy, ReactElement, ReactNode, useEffect, useMemo, useRef} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {
  ImperativePanelGroupHandle,
  Panel,
  PanelGroup,
} from 'react-resizable-panels'
import {AppErrorPage} from '../components/app-error'
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
var Document = lazy(() => import('./document'))
var Draft = lazy(() => import('./draft'))
var Library = lazy(() => import('./library'))
var DeletedContent = lazy(() => import('./deleted-content'))
var Drafts = lazy(() => import('./drafts'))

export default function Main({className}: {className?: string}) {
  const navR = useNavRoute()
  const navigate = useNavigate()

  const {platform} = useAppContext()
  const {PageComponent, Fallback} = useMemo(
    () => getPageComponent(navR),
    [navR],
  )
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
          <TitleText>Settings</TitleText>
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
          <TitleText>Review Deleted Content</TitleText>
          {platform !== 'darwin' && <WindowClose />}
        </div>
      </TitlebarWrapper>
    )
  }

  return (
    <div className={cn(windowContainerStyles, 'p-0', className)}>
      <SidebarContextProvider>
        <ErrorBoundary
          key={routeKey}
          FallbackComponent={AppErrorPage}
          onReset={() => {
            window.location.reload()
          }}
        >
          {titlebar}

          <PanelContent>
            {sidebar}
            <Panel id="page" order={2}>
              <PageComponent />
            </Panel>
          </PanelContent>

          <Footer />
          <AutoUpdater />
          <ConfirmConnectionDialog />
          <HypermediaHighlight />
        </ErrorBoundary>
      </SidebarContextProvider>
    </div>
  )
}

function ConfirmConnectionDialogContent({
  input,
  onClose,
}: {
  input: string
  onClose: () => void
}) {
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
    if (typeof payload === 'object' && payload.key === 'connectPeer') {
      dialog.open(payload.connectionUrl)
    }
  })
  return dialog.content
}

function PanelContent({children}: {children: ReactNode}) {
  const ctx = useSidebarContext()
  const isLocked = useStream(ctx.isLocked)
  const sidebarWidth = useStream(ctx.sidebarWidth)
  const ref = useRef<ImperativePanelGroupHandle>(null)

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
  }, [sidebarWidth])

  return (
    <PanelGroup
      ref={ref}
      direction="horizontal"
      className={cn('flex flex-1 overflow-hidden', isLocked ? '' : 'pl-1')}
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
    case 'drafts':
      return {
        PageComponent: Drafts,
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
