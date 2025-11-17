import {GraphQLProvider} from '@shm/graphql'
import {GRPCClient} from '@shm/shared/grpc-client'
import {DESKTOP_GRAPHQL_URL} from '@shm/shared/constants'
import {queryClient} from '@shm/shared/models/query-client'
import {TooltipProvider} from '@shm/ui/tooltip'
import {QueryClientProvider} from '@tanstack/react-query'
import {ReactNode, useEffect, useMemo} from 'react'
import {AppContext, AppPlatform} from './app-context'
import {AppIPC} from './app-ipc'
import {WindowUtils} from './models/window-utils'

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
}: {
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
}) {
  const appCtx = useMemo(
    () => ({
      // platform: 'win32', // to test from macOS
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
    <AppContext.Provider value={appCtx}>
      <QueryClientProvider client={queryClient}>
        <GraphQLProvider
          options={{
            url: DESKTOP_GRAPHQL_URL,
          }}
        >
          <StyleProvider darkMode={darkMode}>{children}</StyleProvider>
        </GraphQLProvider>
      </QueryClientProvider>
    </AppContext.Provider>
  )
}

export function StyleProvider({
  children,
  darkMode,
}: {
  children: ReactNode
  darkMode: boolean
}) {
  // Update document class when darkMode changes
  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (darkMode) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
    }
  }, [darkMode])

  return <TooltipProvider>{children}</TooltipProvider>
}
