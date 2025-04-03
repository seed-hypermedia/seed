import {AppContextProvider} from '@/app-context-provider'
import {useListenAppEvent} from '@/utils/window-events'
import type {StateStream} from '@shm/shared/utils/stream'
import {SpinnerWithText} from '@shm/ui/spinner'
import {toast, Toaster} from '@shm/ui/toast'
import {useStream} from '@shm/ui/use-stream'
import '@tamagui/core/reset.css'
import '@tamagui/font-inter/css/400.css'
import '@tamagui/font-inter/css/700.css'
import {onlineManager, QueryKey} from '@tanstack/react-query'
import copyTextToClipboard from 'copy-text-to-clipboard'
import React, {useEffect, useState} from 'react'
import ReactDOM from 'react-dom/client'
import {getOnboardingState} from './app-onboarding'
import {AppErrorContent} from './components/app-error'
import {
  Onboarding,
  OnboardingDebugBox,
  OnboardingDialog,
  ResetOnboardingButton,
} from './components/onboarding'
import type {GoDaemonState} from './daemon'
import {grpcClient} from './grpc-client'
import {ipc} from './ipc'
import Main from './pages/main'
import type {AppInfoType} from './preload'
import './root.css'
import {trpc} from './trpc'

import {AppIPC} from '@/app-ipc'
import {WindowUtils} from '@/models/window-utils'
import {
  onQueryCacheError,
  onQueryInvalidation,
  queryClient,
} from '@shm/shared/models/query-client'
import {labelOfQueryKey} from '@shm/shared/models/query-keys'
import {QueryClientProvider} from '@tanstack/react-query'
import {ipcLink} from 'electron-trpc/renderer'
import superjson from 'superjson'
import * as entities from './models/entities'
import * as search from './models/search'

// reference this to ensure dependency injection happens before the injected queries are used
search
entities

// @ts-expect-error
const daemonState: StateStream<GoDaemonState> = window.daemonState
// @ts-expect-error
const appInfo: AppInfoType = window.appInfo

// Custom hook to initialize query client settings
function useInitializeQueryClient() {
  useEffect(() => {
    // Initialize query client settings
    onQueryInvalidation((queryKey: QueryKey) => {
      // First invalidate locally
      queryClient.invalidateQueries(queryKey)
      // Then notify other windows through IPC
      ipc.send?.('invalidate_queries', queryKey)
    })

    onlineManager.setOnline(true)

    onQueryCacheError((error, query) => {
      const queryKey = query.queryKey as string[]
      const errorMessage = ((error as any)?.message || null) as string | null
      toast.error(`Failed to Load ${labelOfQueryKey(queryKey)}`, {
        onClick: () => {
          const detailString = JSON.stringify({queryKey, errorMessage}, null, 2)
          copyTextToClipboard(detailString)
          toast.success(`📋 Copied details to clipboard`)
        },
      })
    })
  }, [])
}

// Custom hooks for app functionality
function useGoDaemonState(): GoDaemonState | undefined {
  const [state, setState] = useState<GoDaemonState | undefined>(
    daemonState.get(),
  )

  useEffect(() => {
    const updateHandler = (value: GoDaemonState) => setState(value)
    if (daemonState.get() !== state) {
      setState(daemonState.get())
    }
    const sub = daemonState.subscribe(updateHandler)
    return () => sub()
  }, [])

  return state
}

// Window utilities hook
function useWindowUtils(ipc: AppIPC): WindowUtils {
  const [isMaximized, setIsMaximized] = useState<boolean | undefined>(false)

  return {
    maximize: () => {
      setIsMaximized(true)
      ipc.send('maximize_window')
    },
    unmaximize: () => {
      setIsMaximized(false)
      ipc.send('maximize_window')
    },
    close: () => {
      ipc.send('close_window')
    },
    minimize: () => {
      ipc.send('minimize_window')
    },
    hide: () => {
      toast.error('Not implemented')
    },
    isMaximized,
    quit: () => {
      ipc.send('quit_app')
    },
  }
}

function useInitialOnboardingState() {
  return useState(() => {
    const {
      hasCompletedOnboarding,
      hasSkippedOnboarding,
      initialAccountIdCount,
    } = getOnboardingState()
    const hasInitialAccountIds = initialAccountIdCount > 0
    return (
      !hasCompletedOnboarding && !hasSkippedOnboarding && !hasInitialAccountIds
    )
  })
}

// MainContent component
function MainContent({
  showOnboarding,
  onOnboardingComplete,
}: {
  showOnboarding: boolean
  onOnboardingComplete: () => void
}) {
  const darkMode = useStream<boolean>(window.darkMode)
  const utils = trpc.useUtils()

  // Handle query invalidation through TRPC subscription
  trpc.queryInvalidation.useSubscription(undefined, {
    enabled: !showOnboarding,
    onData: (value: unknown) => {
      if (!value || !Array.isArray(value)) return

      const invalidationMap: Record<string, () => void> = {
        'trpc.experiments.get': () => utils.experiments.get.invalidate(),
        'trpc.favorites.get': () => utils.favorites.get.invalidate(),
        'trpc.host.get': () => utils.host.get.invalidate(),
        'trpc.recentSigners.get': () => utils.recentSigners.get.invalidate(),
        'trpc.comments.getCommentDraft': () =>
          utils.comments.getCommentDraft.invalidate(),
        'trpc.gatewaySettings.getGatewayUrl': () =>
          utils.gatewaySettings.getGatewayUrl.invalidate(),
        'trpc.gatewaySettings.getPushOnCopy': () =>
          utils.gatewaySettings.getPushOnCopy.invalidate(),
        'trpc.gatewaySettings.getPushOnPublish': () =>
          utils.gatewaySettings.getPushOnPublish.invalidate(),
        'trpc.recents.getRecents': () => utils.recents.getRecents.invalidate(),
        'trpc.appSettings.getAutoUpdatePreference': () =>
          utils.appSettings.getAutoUpdatePreference.invalidate(),
        'trpc.drafts.get': () =>
          utils.drafts.get.invalidate(value[1] as string | undefined),
        'trpc.drafts.list': () => utils.drafts.list.invalidate(),
        'trpc.drafts.listAccount': () => utils.drafts.listAccount.invalidate(),
        'trpc.secureStorage.get': () => {
          utils.secureStorage.invalidate()
          utils.secureStorage.read.invalidate()
        },
      }

      const invalidateAction = invalidationMap[value[0] as string]
      if (invalidateAction) {
        invalidateAction()
      }
    },
  })

  if (showOnboarding) {
    return (
      <>
        <Onboarding onComplete={onOnboardingComplete} />
        {__SHOW_OB_RESET_BTN__ && <OnboardingDebugBox />}
      </>
    )
  }

  return (
    <>
      <OnboardingDialog />
      <Main className={darkMode ? 'seed-app-dark' : 'seed-app-light'} />
      {__SHOW_OB_RESET_BTN__ && <ResetOnboardingButton />}
      {__SHOW_OB_RESET_BTN__ && <OnboardingDebugBox />}
      <Toaster />
    </>
  )
}
__SHOW_OB_RESET_BTN__ = true

// MainApp component
function MainApp() {
  useInitializeQueryClient()

  useEffect(() => {
    // Make window visible immediately

    window.windowIsReady()
  }, [])

  const [showOnboarding, setShowOnboarding] = useInitialOnboardingState()
  const daemonState = useGoDaemonState()
  const windowUtils = useWindowUtils(ipc)

  const darkMode = useStream<boolean>(window.darkMode)

  useListenAppEvent('trigger_peer_sync', () => {
    grpcClient.daemon
      .forceSync({})
      .then(() => {
        toast.success('Peer Sync Started')
      })
      .catch((e) => {
        console.error('Failed to sync', e)
        toast.error('Sync failed!')
      })
  })

  const handleOnboardingComplete = () => {
    setShowOnboarding(false)
  }

  if (daemonState?.t === 'error') {
    return <AppErrorContent message={daemonState?.message} />
  }

  if (daemonState?.t !== 'ready') {
    return (
      <SpinnerWithText
        message={'We are doing some housekeeping.\nDo not close this window!'}
        delay={1000}
      />
    )
  }

  return (
    <AppContextProvider
      grpcClient={grpcClient}
      platform={appInfo.platform()}
      ipc={ipc}
      externalOpen={async (url: string) => {
        ipc.send?.('open-external-link', url)
      }}
      openDirectory={async (directory: string) => {
        ipc.send?.('open-directory', directory)
      }}
      saveCidAsFile={async (cid: string, name: string) => {
        ipc.send?.('save-file', {cid, name})
      }}
      openMarkdownFiles={(accountId: string) => {
        // @ts-ignore
        return window.docImport.openMarkdownFiles(accountId)
      }}
      openMarkdownDirectories={(accountId: string) => {
        // @ts-ignore
        return window.docImport.openMarkdownDirectories(accountId)
      }}
      readMediaFile={(filePath: string) => {
        // @ts-ignore
        return window.docImport.readMediaFile(filePath)
      }}
      exportDocument={async (
        title: string,
        markdownContent: string,
        mediaFiles: {url: string; filename: string; placeholder: string}[],
      ) => {
        // @ts-ignore
        return window.docExport.exportDocument(
          title,
          markdownContent,
          mediaFiles,
        )
      }}
      exportDocuments={async (
        documents: {
          title: string
          markdown: {
            markdownContent: string
            mediaFiles: {url: string; filename: string; placeholder: string}[]
          }
        }[],
      ) => {
        // @ts-ignore
        return window.docExport.exportDocuments(documents)
      }}
      windowUtils={windowUtils}
      darkMode={darkMode!}
      initialNav={window.initNavState}
    >
      <MainContent
        showOnboarding={showOnboarding}
        onOnboardingComplete={handleOnboardingComplete}
      />
    </AppContextProvider>
  )
}

// Create TRPC client
const trpcClient = trpc.createClient({
  links: [ipcLink()],
  transformer: superjson,
})

// Render app
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <trpc.Provider client={trpcClient} queryClient={queryClient}>
        <MainApp />
      </trpc.Provider>
    </QueryClientProvider>
  </React.StrictMode>,
)

declare global {
  interface Window {
    darkMode: import('@shm/shared/utils/stream').StateStream<boolean>
    windowIsReady: () => void
    initNavState: any
    docImport: {
      openMarkdownFiles: (accountId: string) => Promise<{
        documents: {
          markdownContent: string
          title: string
          directoryPath: string
        }[]
        docMap: Map<string, {name: string; path: string}>
      }>
      openMarkdownDirectories: (accountId: string) => Promise<{
        documents: {
          markdownContent: string
          title: string
          directoryPath: string
        }[]
        docMap: Map<string, {name: string; path: string}>
      }>
      readMediaFile: (filePath: string) => Promise<{
        filePath: string
        content: string
        mimeType: string
        fileName: string
      }>
    }
    docExport: {
      exportDocument: (
        title: string,
        markdownContent: string,
        mediaFiles: {url: string; filename: string; placeholder: string}[],
      ) => Promise<void>
      exportDocuments: (
        documents: {
          title: string
          markdown: {
            markdownContent: string
            mediaFiles: {url: string; filename: string; placeholder: string}[]
          }
        }[],
      ) => Promise<string>
    }
  }
}
