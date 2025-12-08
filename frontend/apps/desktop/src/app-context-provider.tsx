import {GRPCClient} from '@shm/shared/grpc-client'
import {TooltipProvider} from '@shm/ui/tooltip'
import {ReactNode, useEffect, useMemo} from 'react'
import {AppContext, AppPlatform} from './app-context'
import {AppIPC} from './app-ipc'
import {WindowUtils} from './models/window-utils'
import {useExperiments} from './models/experiments'

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
  const experiments = useExperiments().data
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
      experiments,
    }),
    [experiments],
  )
  return (
    <AppContext.Provider value={appCtx}>
      <StyleProvider darkMode={darkMode}>{children}</StyleProvider>
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
