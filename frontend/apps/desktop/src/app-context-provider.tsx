import {NavigationContainer} from '@/utils/navigation-container'
import {GRPCClient} from '@shm/shared/grpc-client'
import {queryClient} from '@shm/shared/models/query-client'
import {SpinnerWithText} from '@shm/ui/spinner'
import {QueryClientProvider} from '@tanstack/react-query'
import {ReactQueryDevtools} from '@tanstack/react-query-devtools'
import {ipcLink} from 'electron-trpc/renderer'
import {ReactNode, Suspense, useMemo} from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import superjson from 'superjson'
import {TamaguiProvider, TamaguiProviderProps, View} from 'tamagui'
import tamaguiConfig from '../tamagui.config'
import {AppContext, AppPlatform} from './app-context'
import {AppIPC} from './app-ipc'
import {RootAppError} from './components/app-error'
import {useExperiments} from './models/experiments'
import {WindowUtils} from './models/window-utils'
import {trpc} from './trpc'

// Props for the root AppContextProvider
export interface AppContextProviderProps {
  children: ReactNode
  platform: AppPlatform
  grpcClient: GRPCClient
  ipc: AppIPC
  externalOpen: (url: string) => Promise<void>
  openDirectory: (directory: string) => Promise<void>
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
  windowUtils: WindowUtils
  saveCidAsFile: (cid: string, name: string) => Promise<void>
  darkMode: boolean
  // @ts-expect-error
  initialNav?: typeof window.initNavState
}

export function AppContextProvider({
  children,
  platform,
  grpcClient,
  ipc,
  externalOpen,
  openDirectory,
  openMarkdownFiles,
  openMarkdownDirectories,
  readMediaFile,
  exportDocument,
  exportDocuments,
  windowUtils,
  saveCidAsFile,
  darkMode,
  initialNav,
}: AppContextProviderProps) {
  // Create TRPC client
  const trpcClient = useMemo(
    () =>
      trpc.createClient({
        links: [ipcLink()],
        transformer: superjson,
      }),
    [],
  )

  // Create app context value
  const appCtx = useMemo(
    () => ({
      platform,
      grpcClient,
      ipc,
      externalOpen,
      openDirectory,
      openMarkdownFiles,
      openMarkdownDirectories,
      readMediaFile,
      exportDocument,
      exportDocuments,
      windowUtils,
      saveCidAsFile,
    }),
    [],
  )

  return (
    <QueryClientProvider client={queryClient}>
      <trpc.Provider queryClient={queryClient} client={trpcClient}>
        <AppContext.Provider value={appCtx}>
          <StyleProvider darkMode={darkMode}>
            <NavigationContainer initialNav={initialNav}>
              <ErrorBoundary
                FallbackComponent={RootAppError}
                onReset={() => {
                  window.location.reload()
                }}
              >
                <Suspense fallback={<SpinnerWithText message="Loading..." />}>
                  {children}
                </Suspense>
              </ErrorBoundary>
            </NavigationContainer>
          </StyleProvider>
        </AppContext.Provider>
        <ReactQueryTools />
      </trpc.Provider>
    </QueryClientProvider>
  )
}

function ReactQueryTools() {
  const {data: experiments} = useExperiments()
  return experiments?.developerTools ? (
    <View userSelect="none">
      <ReactQueryDevtools />
    </View>
  ) : null
}

export function StyleProvider({
  children,
  darkMode,
  ...rest
}: Omit<TamaguiProviderProps, 'config'> & {darkMode: boolean}) {
  return (
    <TamaguiProvider
      // @ts-ignore
      config={tamaguiConfig}
      className={darkMode ? 'seed-app-dark' : 'seed-app-light'}
      defaultTheme={darkMode ? 'dark' : 'light'}
      {...rest}
    >
      {children}
    </TamaguiProvider>
  )
}
