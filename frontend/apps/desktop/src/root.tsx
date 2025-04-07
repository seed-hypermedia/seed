import {AppContextProvider, StyleProvider} from '@/app-context-provider'
import {AppIPC} from '@/app-ipc'
import {WindowUtils} from '@/models/window-utils'
import {NavigationContainer} from '@/utils/navigation-container'
import {useListenAppEvent} from '@/utils/window-events'
import {queryClient} from '@shm/shared/models/query-client'
import type {StateStream} from '@shm/shared/utils/stream'
import {Spinner} from '@shm/ui/spinner'
import {toast, Toaster} from '@shm/ui/toast'
import {useStream} from '@shm/ui/use-stream'
import '@tamagui/core/reset.css'
import '@tamagui/font-inter/css/400.css'
import '@tamagui/font-inter/css/700.css'
import {onlineManager, QueryKey} from '@tanstack/react-query'
import copyTextToClipboard from 'copy-text-to-clipboard'
import {ipcLink} from 'electron-trpc/renderer'
import React, {Suspense, useEffect, useMemo, useState} from 'react'
import ReactDOM from 'react-dom/client'
import {ErrorBoundary} from 'react-error-boundary'
import superjson from 'superjson'
import {SizableText, YStack} from 'tamagui'
import {getOnboardingState} from './app-onboarding'
import {AppErrorContent, RootAppError} from './components/app-error'
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
import './styles/tailwind.css'
import {client, trpc} from './trpc'

import {
  onQueryCacheError,
  onQueryInvalidation,
} from '@shm/shared/models/query-client'
import {labelOfQueryKey} from '@shm/shared/models/query-keys'
import * as entities from './models/entities'
import * as recents from './models/recents'
import * as search from './models/search'

// reference this to ensure dependency injection happens before the injected queries are used
search
entities
recents

const logger = {
  log: wrapLogger(console.log),
  error: wrapLogger(console.error),
}

function wrapLogger(logFn: (...args: any[]) => void) {
  return (...input: any[]) => {
    logFn(
      ...input.map((item) => {
        if (typeof item === 'string') return item
        try {
          return JSON.stringify(item, null, 2)
        } catch {}
        return item // on main thread this will likely be rendered as [object Object]
      }),
    )
  }
}

const securitySensitiveMethods = new Set([
  'Daemon.Register',
  'Daemon.GenMnemonic',
])
const enabledLogMessages = new Set<string>([
  // 'Accounts.ListAccounts',
  // 'Comments.ListComments',
  // etc.. add the messages you need to see here, please comment out before committing!
])
const hiddenLogMessages = new Set<string>([
  'Daemon.GetInfo',
  'Networking.GetPeerInfo',
])
// const loggingInterceptor: Interceptor = (next) => async (req) => {
//   const serviceLabel = req.service.typeName.split('.').at(-1)
//   const methodFullname = `${serviceLabel}.${req.method.name}`
//   const isSensitive = securitySensitiveMethods.has(methodFullname)
//   try {
//     const result = await next(req)
//     if (
//       enabledLogMessages.has(methodFullname) &&
//       !hiddenLogMessages.has(methodFullname)
//     ) {
//       const request = req.message
//       const response = result?.message
//       logger.log(`🔃 to ${methodFullname}`, request, response)
//     } else if (!hiddenLogMessages.has(methodFullname)) {
//       logger.log(`🔃 to ${methodFullname}`)
//     }
//     return result
//   } catch (e) {
//     let error = e
//     if (e.message.match('stream.getReader is not a function')) {
//       error = new Error('RPC broken, try running yarn and ./dev gen')
//     }
//     if (isSensitive) {
//       logger.error(`🚨 to ${methodFullname} `, 'HIDDEN FROM LOGS', error)
//       throw error
//     }
//     logger.error(`🚨 to ${methodFullname} `, req.message, error)
//     throw error
//   }
// }

function useWindowUtils(ipc: AppIPC): WindowUtils {
  // const win = getCurrent()
  const [isMaximized, setIsMaximized] = useState<boolean | undefined>(false)
  const windowUtils = {
    maximize: () => {
      // toast.error('Not implemented maximize')
      setIsMaximized(true)
      ipc.send('maximize_window')
      // win.maximize()
    },
    unmaximize: () => {
      // toast.error('Not implemented')
      setIsMaximized(false)
      ipc.send('maximize_window')
      // win.unmaximize()
    },
    close: () => {
      // toast.error('Not implemented')
      ipc.send('close_window')
      // win.close()
    },
    minimize: () => {
      // toast.error('Not implemented')
      ipc.send('minimize_window')
      // win.minimize()
    },
    hide: () => {
      toast.error('Not implemented')
      // win.hide()
    },
    isMaximized,
    quit: () => {
      ipc.send('quit_app')
    },
  }
  return windowUtils
}

// @ts-expect-error
const daemonState: StateStream<GoDaemonState> = window.daemonState
// @ts-expect-error
const appInfo: AppInfoType = window.appInfo

function useGoDaemonState(): GoDaemonState | undefined {
  const [state, setState] = useState<GoDaemonState | undefined>(
    daemonState.get(),
  )

  useEffect(() => {
    const updateHandler = (value: GoDaemonState) => {
      setState(value)
    }
    if (daemonState.get() !== state) {
      // this is hacky and shouldn't be needed but this fixes some race where daemonState has changed already
      setState(daemonState.get())
    }
    const sub = daemonState.subscribe(updateHandler)

    return () => {
      sub()
    }
  }, [])

  return state
}

// on desktop we handle query invalidation by sending it through IPC so it is sent to all windows
onQueryInvalidation((queryKey: QueryKey) => {
  ipc.send?.('invalidate_queries', queryKey)
})

// RQ will refuse to run mutations if !isOnline
onlineManager.setOnline(true)

// toast when a query error happens. we set this up here because web doesn't have this feature yet
onQueryCacheError((error, query) => {
  const queryKey = query.queryKey as string[]
  const errorMessage = ((error as any)?.message || null) as string | null // todo: repent for my sins
  toast.error(`Failed to Load ${labelOfQueryKey(queryKey)}`, {
    onClick: () => {
      const detailString = JSON.stringify({queryKey, errorMessage}, null, 2)
      copyTextToClipboard(detailString)
      toast.success(`📋 Copied details to clipboard`)
    },
  })
})

function MainApp({}: {}) {
  // Make window visible immediately - this should be the very first thing
  useEffect(() => {
    console.log('Making window visible immediately')
    // @ts-expect-error
    window.windowIsReady()
  }, [])

  const darkMode = useStream<boolean>(window.darkMode)
  const daemonState = useGoDaemonState()
  const windowUtils = useWindowUtils(ipc)
  const utils = trpc.useUtils()

  // Initialize showOnboarding state with all checks to avoid flashing
  const [showOnboarding, setShowOnboarding] = useState(() => {
    const {
      hasCompletedOnboarding,
      hasSkippedOnboarding,
      initialAccountIdCount,
    } = getOnboardingState()
    // Don't show onboarding if it's already completed, skipped, or if there are accounts
    const hasInitialAccountIds = initialAccountIdCount > 0
    const shouldShowOnboarding =
      !hasCompletedOnboarding && !hasSkippedOnboarding && !hasInitialAccountIds
    return shouldShowOnboarding
  })

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
  useEffect(() => {
    const sub = client.queryInvalidation.subscribe(undefined, {
      // called when invalidation happens in any window (including this one), here we are performing the local invalidation
      onData: (value: unknown[]) => {
        if (!value) return
        if (value[0] === 'trpc.experiments.get') {
          utils.experiments.get.invalidate()
        } else if (value[0] === 'trpc.favorites.get') {
          utils.favorites.get.invalidate()
        } else if (value[0] === 'trpc.host.get') {
          utils.host.get.invalidate()
        } else if (value[0] === 'trpc.recentSigners.get') {
          utils.recentSigners.get.invalidate()
        } else if (value[0] === 'trpc.comments.getCommentDraft') {
          utils.comments.getCommentDraft.invalidate()
        } else if (value[0] === 'trpc.gatewaySettings.getGatewayUrl') {
          utils.gatewaySettings.getGatewayUrl.invalidate()
        } else if (value[0] === 'trpc.gatewaySettings.getPushOnCopy') {
          utils.gatewaySettings.getPushOnCopy.invalidate()
        } else if (value[0] === 'trpc.gatewaySettings.getPushOnPublish') {
          utils.gatewaySettings.getPushOnPublish.invalidate()
          // } else if (value[0] === queryKeys.RECENTS) {
          //   console.log('~~ invalidateRecents', value)
          //   utils.recents.getRecents.invalidate()
        } else if (value[0] === 'trpc.appSettings.getAutoUpdatePreference') {
          utils.appSettings.getAutoUpdatePreference.invalidate()
        } else if (value[0] == 'trpc.drafts.get') {
          utils.drafts.get.invalidate(value[1] as string | undefined)
        } else if (value[0] == 'trpc.drafts.list') {
          utils.drafts.list.invalidate()
        } else if (value[0] == 'trpc.drafts.listAccount') {
          utils.drafts.listAccount.invalidate()
        } else if (value[0] == 'trpc.secureStorage.get') {
          utils.secureStorage.invalidate()

          utils.secureStorage.read.invalidate()
        } else {
          queryClient.invalidateQueries(value)
        }
      },
    })
    return () => {
      sub.unsubscribe()
    }
  }, [utils, showOnboarding])

  let mainContent = showOnboarding ? (
    <>
      <Onboarding onComplete={handleOnboardingComplete} />
      {__SHOW_OB_RESET_BTN__ && <OnboardingDebugBox />}
    </>
  ) : (
    <>
      <OnboardingDialog />
      <Main
        className={
          // this is used by editor.css which doesn't know tamagui styles, boooo!
          darkMode ? 'seed-app-dark' : 'seed-app-light'
        }
      />
      {__SHOW_OB_RESET_BTN__ && <ResetOnboardingButton />}
      {__SHOW_OB_RESET_BTN__ && <OnboardingDebugBox />}
      <Toaster />
    </>
  )

  // const openMarkdownFiles = () => {
  //   // @ts-ignore
  //   return window.docImport.openMarkdownFiles()
  // }
  // const openMarkdownDirectories = () => {
  //   // @ts-ignore
  //   return window.docImport.openMarkdownDirectories()
  // }

  // const readMediaFile = (filePath: string) => {
  //   // @ts-ignore
  //   return window.docImport.readMediaFile(filePath)
  // }

  if (daemonState?.t == 'ready') {
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
              mediaFiles: {
                url: string
                filename: string
                placeholder: string
              }[]
            }
          }[],
        ) => {
          // @ts-ignore
          return window.docExport.exportDocuments(documents)
        }}
        windowUtils={windowUtils}
        darkMode={darkMode!}
      >
        <Suspense fallback={<SpinnerWithText message="" />}>
          <ErrorBoundary
            FallbackComponent={RootAppError}
            onReset={() => {
              window.location.reload()
            }}
          >
            <NavigationContainer
              initialNav={
                // @ts-expect-error
                window.initNavState
              }
            >
              {mainContent}
              {__SHOW_OB_RESET_BTN__ && <ResetOnboardingButton />}
            </NavigationContainer>
            <Toaster
            // position="bottom-center"
            // toastOptions={{className: 'toaster'}}
            />
          </ErrorBoundary>
        </Suspense>
      </AppContextProvider>
    )
  } else if (daemonState?.t == 'error') {
    console.error('Daemon error', daemonState?.message)
    return (
      <StyleProvider darkMode={darkMode!}>
        <AppErrorContent message={daemonState?.message} />
      </StyleProvider>
    )
  } else {
    return (
      <StyleProvider darkMode={darkMode!}>
        <SpinnerWithText
          message={'We are doing some housekeeping.\nDo not close this window!'}
          delay={1000}
        />
      </StyleProvider>
    )
  }
}

function SpinnerWithText(props: {message: string; delay?: number}) {
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!props.delay) {
      setMessage(props.message)
      return () => {}
    }

    const timer = setTimeout(() => {
      setMessage(props.message)
    }, props.delay)

    return () => clearTimeout(timer)
  }, [])

  return (
    <YStack fullscreen ai="center" jc="center" gap="$4" className="window-drag">
      <Spinner />
      <SizableText
        opacity={message ? 1 : 0}
        animation="slow"
        size="$5"
        color="$color9"
        fontWeight="300"
        textAlign="center"
        minHeight="$4"
      >
        {message}
      </SizableText>
    </YStack>
  )
}

function ElectronApp() {
  const trpcClient = useMemo(
    () =>
      trpc.createClient({
        links: [ipcLink()],
        transformer: superjson,
      }),
    [],
  )

  return (
    <trpc.Provider queryClient={queryClient} client={trpcClient}>
      <MainApp />
    </trpc.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ElectronApp />
  </React.StrictMode>,
)
