import {useAppContext, useListen} from '@/app-context'

import {CloseButton} from '@/components/window-controls'
import {LinkDeviceDialog} from '@/components/link-device-dialog'
import appError from '@/errors'
import {useConnectPeer} from '@/models/contacts'
import {useMyAccounts} from '@/models/daemon'
import {SidebarContextProvider, useSidebarContext} from '@/sidebar-context'
import {useNavigate} from '@/utils/useNavigate'
import {useListenAppEvent} from '@/utils/window-events'
import {getWindowType} from '@/utils/window-types'
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
import {
  lazy,
  ReactElement,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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
var Feed = lazy(() => import('./feed'))
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
          <TitleText className="text-center font-bold">
            Review Deleted Content
          </TitleText>
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
            <Panel id="page" order={2} className="pl-1">
              <PageComponent />
            </Panel>
          </PanelContent>

          <Footer />
          <AutoUpdater />
          <ConfirmConnectionDialog />
          <DeviceLinkHandler />
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
    dialog.open(payload.connectionUrl)
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
  const myAccounts = useMyAccounts()
  const [selectedAccountUid, setSelectedAccountUid] = useState<string | null>(
    null,
  )

  const accountOptions = myAccounts
    ?.map((a) => {
      const id = a.data?.id
      const doc = a.data?.type === 'document' ? a.data.document : undefined
      if (id) {
        return {
          id,
          metadata: doc?.metadata,
        }
      }
      return null
    })
    .filter((d) => {
      if (!d) return false
      if (typeof d.metadata === 'undefined') return false
      return true
    })

  const selectedAccount = myAccounts?.find(
    (a) => a.data?.id?.uid === selectedAccountUid,
  )
  const selectedAccountDoc =
    selectedAccount?.data?.type === 'document'
      ? selectedAccount.data.document
      : undefined

  return (
    <>
      <DialogTitle>Select Account to Link</DialogTitle>
      {input.origin && (
        <p className="text-sm font-medium text-gray-600">
          Origin: {input.origin}
        </p>
      )}
      <p className="text-sm text-gray-600">
        Choose which account you want to link to the web browser.
      </p>
      <ScrollArea className="h-full max-h-[300px] flex-1 overflow-y-auto">
        <div className="flex flex-col gap-2">
          {accountOptions?.map((option) =>
            option ? (
              <div
                key={option.id.uid}
                className={cn(
                  'hover:bg-sidebar-accent flex cursor-pointer flex-row items-center gap-4 rounded-md p-3',
                  selectedAccountUid === option.id.uid
                    ? 'bg-sidebar-accent'
                    : '',
                )}
                onClick={() => setSelectedAccountUid(option.id.uid)}
              >
                {option.id ? (
                  <HMIcon
                    id={option?.id}
                    name={option?.metadata?.name}
                    icon={option?.metadata?.icon}
                  />
                ) : null}
                <span className="flex-1">{option.metadata?.name}</span>
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
              const accountName =
                selectedAccountDoc?.metadata?.name || 'Account'
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
