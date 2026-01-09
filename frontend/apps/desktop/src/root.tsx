import {AppContextProvider} from '@/app-context-provider'
import {AppIPC} from '@/app-ipc'
import {WindowUtils} from '@/models/window-utils'
import {NavigationContainer} from '@/utils/navigation-container'
import {useListenAppEvent} from '@/utils/window-events'
import {IS_PROD_DESKTOP} from '@shm/shared/constants'
import {queryClient} from '@shm/shared/models/query-client'
import type {StateStream} from '@shm/shared/utils/stream'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast, Toaster} from '@shm/ui/toast'
import {
  onlineManager,
  QueryClientProvider,
  QueryKey,
} from '@tanstack/react-query'
import React, {Suspense, useEffect, useState} from 'react'
import ReactDOM from 'react-dom/client'
import {ErrorBoundary} from 'react-error-boundary'
import {getOnboardingState} from './app-onboarding'
import {RootAppError} from './components/app-error'
import {DebugDialogs} from './components/debug-dialogs'
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
import './tailwind.css'
import {client} from './trpc'

import {AppWindowEvent} from '@/utils/window-events'
import {
  onQueryCacheError,
  onQueryInvalidation,
} from '@shm/shared/models/query-client'
import {labelOfQueryKey} from '@shm/shared/models/query-keys'
import {Button} from '@shm/ui/button'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {panelContainerStyles, windowContainerStyles} from '@shm/ui/container'
import {cn} from '@shm/ui/utils'

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

  // Listen for window state changes
  useEffect(() => {
    const unsubscribe = window.appWindowEvents?.subscribe(
      (event: AppWindowEvent) => {
        if (event.type === 'window_state_changed') {
          // Get the actual window state from the exposed windowMaximizedState
          if (window.windowMaximizedState) {
            const currentState = window.windowMaximizedState.get()
            setIsMaximized(currentState)
          }
        }
      },
    )

    // Also initialize from current window state if available
    if (window.windowMaximizedState) {
      setIsMaximized(window.windowMaximizedState.get())
    }

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  const windowUtils = {
    maximize: () => {
      // No longer immediately set the state here, let the event handler do it
      ipc.send('maximize_window', {forceMaximize: true})
    },
    unmaximize: () => {
      // No longer immediately set the state here, let the event handler do it
      ipc.send('maximize_window', {forceUnmaximize: true})
    },
    close: () => {
      ipc.send('close_window')
    },
    minimize: () => {
      // toast.error('Not implemented')
      ipc.send('minimize_window')
      // win.minimize()
    },
    hide: () => {
      ipc.send('hide_window')
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
const darkMode: StateStream<boolean> = window.darkMode

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

function useDarkMode(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => {
    const initialValue = darkMode.get()
    // Apply initial CSS classes immediately
    if (initialValue) {
      document.documentElement.classList.add('dark')
      document.documentElement.classList.remove('light')
    } else {
      document.documentElement.classList.add('light')
      document.documentElement.classList.remove('dark')
    }
    return initialValue
  })

  useEffect(() => {
    const updateHandler = (value: boolean) => {
      setIsDark(value)
      // Apply the dark/light class to the document element for Tailwind CSS
      if (value) {
        document.documentElement.classList.add('dark')
        document.documentElement.classList.remove('light')
      } else {
        document.documentElement.classList.add('light')
        document.documentElement.classList.remove('dark')
      }
    }

    const sub = darkMode.subscribe(updateHandler)

    return () => {
      sub()
    }
  }, [])

  return isDark
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
  toast.error(
    `Failed to Load ${labelOfQueryKey(queryKey)}. Click to copy details`,
    {
      action: {
        label: 'Copy Details',
        onClick: () => {
          const detailString = JSON.stringify({queryKey, errorMessage}, null, 2)
          copyTextToClipboard(detailString)
          toast.success(`📋 Copied details to clipboard`)
        },
      },
    },
  )
})

// Add window interface extension
declare global {
  interface Window {
    appWindowEvents?: {
      subscribe: (handler: (event: AppWindowEvent) => void) => () => void
    }
    windowMaximizedState?: {
      get: () => boolean
    }
    darkMode?: any
    initNavState?: any
    windowType?: any
    windowId?: string
  }
}

function DaemonErrorContent({message}: {message: string}) {
  return (
    <div className={windowContainerStyles}>
      <div className={cn(panelContainerStyles)}>
        <div className="flex flex-1 items-start justify-center px-4 py-12">
          <div
            role="alertdialog"
            className="m-8 flex w-full max-w-2xl flex-1 flex-none flex-col shadow-lg"
          >
            <div className="rounded-t bg-red-500 px-4 py-2">
              <h2 className="text-xl font-bold text-white">
                Something went wrong
              </h2>
            </div>
            <div className="max-h-50 gap-4 rounded-b border border-t-0 border-red-400 bg-red-100 px-4 py-3">
              <ScrollArea>
                <pre className="p-4 text-sm break-all whitespace-pre-wrap text-red-700">
                  {message}
                </pre>
              </ScrollArea>
              <Button
                variant="destructive"
                onClick={() => window.location.reload()}
              >
                Try again
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function MainApp({}: {}) {
  // Make window visible immediately - this should be the very first thing
  useEffect(() => {
    // @ts-expect-error
    window.windowIsReady()
  }, [])

  const daemonState = useGoDaemonState()
  const isDarkMode = useDarkMode()
  const windowUtils = useWindowUtils(ipc)

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

  useListenAppEvent('trigger_database_reindex', () => {
    toast.promise(grpcClient.daemon.forceReindex({}), {
      loading: 'Reindexing the database...',
      success: () => {
        return 'Database reindexed'
      },
      error: 'Reindex failed!',
    })
  })

  const handleOnboardingComplete = () => {
    setShowOnboarding(false)
  }
  useEffect(() => {
    const sub = client.queryInvalidation.subscribe(undefined, {
      // called when invalidation happens in any window (including this one), here we are performing the local invalidation
      onData: (value: unknown) => {
        const queryKey = value as QueryKey
        if (!queryKey) return
        // All queries now use queryKeys constants, so we can just invalidate directly
        queryClient.invalidateQueries({queryKey})
      },
    })
    return () => {
      sub.unsubscribe()
    }
  }, [showOnboarding])

  let mainContent = showOnboarding ? (
    <>
      <div className="fixed inset-0 size-full overflow-hidden overflow-y-scroll bg-red-500">
        <Onboarding modal={false} onComplete={handleOnboardingComplete} />
      </div>
      {__SHOW_OB_RESET_BTN__ && <OnboardingDebugBox />}
      {__SHOW_OB_RESET_BTN__ && <ResetOnboardingButton />}
    </>
  ) : (
    <>
      <OnboardingDialog />
      <Main />
      {__SHOW_OB_RESET_BTN__ && <ResetOnboardingButton />}
      {__SHOW_OB_RESET_BTN__ && <OnboardingDebugBox />}
      {!IS_PROD_DESKTOP && false && <DebugDialogs />}
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
      <QueryClientProvider client={queryClient}>
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
          openLatexFiles={(accountId: string) => {
            // @ts-ignore
            return window.docImport.openLatexFiles(accountId)
          }}
          openLatexDirectories={(accountId: string) => {
            // @ts-ignore
            return window.docImport.openLatexDirectories(accountId)
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
          darkMode={isDarkMode}
        >
          <Suspense fallback={<SpinnerWithText message="" />}>
            <ErrorBoundary
              FallbackComponent={RootAppError}
              onReset={() => {
                window.location.reload()
              }}
            >
              <NavigationContainer>
                {mainContent}
                {__SHOW_OB_RESET_BTN__ && <ResetOnboardingButton />}
              </NavigationContainer>

              <Toaster />

              {/* Dev tool: floating button to test loading window */}
              {/* {!IS_PROD_DESKTOP && <LoadingWindowTestButton />} */}
            </ErrorBoundary>
          </Suspense>
        </AppContextProvider>
      </QueryClientProvider>
    )
  } else if (daemonState?.t == 'error') {
    console.error('Daemon error', daemonState?.message)
    return <DaemonErrorContent message={daemonState?.message} />
  } else {
    return (
      <SpinnerWithText
        message={'We are doing some housekeeping.\nDo not close this window!'}
        delay={1000}
      />
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
    <div
      className={cn(
        windowContainerStyles,
        'window-drag items-center justify-center gap-4 p-8',
      )}
    >
      <Spinner />
      <SizableText
        size="md"
        color="muted"
        weight="normal"
        className="min-h-4 text-center"
        style={{opacity: message ? 1 : 0}}
      >
        {message}
      </SizableText>
    </div>
  )
}

function LoadingWindowTestButton() {
  const handleOpen = () => {
    ipc.send?.('open_loading_window', null)
  }

  const handleClose = () => {
    ipc.send?.('close_loading_window', null)
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        display: 'flex',
        gap: '0.5rem',
        zIndex: 9999,
      }}
    >
      <button
        onClick={handleOpen}
        style={{
          padding: '0.75rem 1rem',
          backgroundColor: '#3b82f6',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '0.875rem',
          fontWeight: '600',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        Open Loading
      </button>
      <button
        onClick={handleClose}
        style={{
          padding: '0.75rem 1rem',
          backgroundColor: '#ef4444',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontSize: '0.875rem',
          fontWeight: '600',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        Close Loading
      </button>
    </div>
  )
}

function ElectronApp() {
  return <MainApp />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ElectronApp />
  </React.StrictMode>,
)
