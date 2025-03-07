import {GRPCClient} from '@shm/shared/grpc-client'
import {createContext, useContext, useEffect} from 'react'

import {AppIPC, Event, EventCallback} from './app-ipc'

import {WindowUtils} from './models/window-utils'

export type AppPlatform = typeof process.platform

export type AppContext = {
  platform: AppPlatform
  grpcClient: GRPCClient
  ipc: AppIPC
  externalOpen: (url: string) => Promise<void>
  openDirectory: (directory: string) => Promise<void>
  openMarkdownDirectories: (accountId: string) => Promise<{
    documents: {
      markdownContent: string
      title: string
      directoryPath: string
    }[]
    docMap: Map<string, {name: string; path: string}>
  }>
  openMarkdownFiles: (accountId: string) => Promise<{
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
}

export const AppContext = createContext<AppContext | null>(null)

export function useAppContext() {
  const context = useContext(AppContext)
  if (!context)
    throw new Error('useAppContext must be used within a AppContextProvider')

  return context
}

export function useIPC(): AppIPC {
  const context = useContext(AppContext)
  if (!context)
    throw new Error('useIPC must be used within a AppContextProvider')

  return context.ipc
}

export function useWindowUtils(): WindowUtils {
  const context = useContext(AppContext)
  if (!context)
    throw new Error('useWindowUtils must be used within a AppContextProvider')

  return context.windowUtils
}

export function useListen<T = unknown>(
  cmd: string,
  handler: EventCallback<T>,
  deps: React.DependencyList = [],
) {
  const {listen} = useIPC()
  useEffect(() => {
    if (!listen) {
      throw new Error('useListen called before listen is defined')
    }
    let isSubscribed = true
    let unlisten: () => void

    listen(cmd, (event: Event<T>) => {
      if (!isSubscribed) {
        return unlisten()
      }

      handler(event)
    }).then((_unlisten) => (unlisten = _unlisten))

    return () => {
      isSubscribed = false
    }
  }, deps)
}
