import {GRPCClient} from '@shm/shared/grpc-client'
import {queryClient} from '@shm/shared/models/query-client'
import {TooltipProvider} from '@shm/ui/tooltip'
import {QueryClientProvider} from '@tanstack/react-query'
import {ReactNode, useMemo} from 'react'
import {TamaguiProvider, TamaguiProviderProps} from 'tamagui'
import tamaguiConfig from '../tamagui.config'
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
        <StyleProvider darkMode={darkMode}>{children}</StyleProvider>
      </QueryClientProvider>
    </AppContext.Provider>
  )
}

export function StyleProvider({
  children,
  darkMode,
  ...rest
}: Omit<TamaguiProviderProps, 'config'> & {darkMode: boolean}) {
  return (
    <TooltipProvider>
      <TamaguiProvider
        // @ts-ignore
        config={tamaguiConfig}
        // TODO: find a way to add this props without breaking all the styles
        // disableInjectCSS
        // disableRootThemeClass
        className={darkMode ? 'seed-app-dark' : 'seed-app-light'}
        defaultTheme={darkMode ? 'dark' : 'light'}
        {...rest}
      >
        {children}
      </TamaguiProvider>
    </TooltipProvider>
  )
}
