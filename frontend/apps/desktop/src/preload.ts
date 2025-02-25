import {AppWindowEvent} from '@/utils/window-events'
import '@sentry/electron/preload'
import {contextBridge, ipcRenderer} from 'electron'
import {exposeElectronTRPC} from 'electron-trpc/main'
// import directly from this deep path for shared/utils/stream! Bad things happen if you try to directly import from @shm/shared
import {eventStream, writeableStateStream} from '@shm/shared/utils/stream'
import {GoDaemonState} from './daemon'

process.once('loaded', async () => {
  exposeElectronTRPC()
})

// const [updateInitNavState, initNavState] =
//   writeableStateStream<NavState | null>(null)

const [dispatchAppWindow, appWindowEvents] = eventStream<AppWindowEvent>()

contextBridge.exposeInMainWorld('appWindowEvents', appWindowEvents)

const AppInfo = {
  platform: () => process.platform,
  arch: () => process.arch,
} as const
export type AppInfoType = typeof AppInfo
contextBridge.exposeInMainWorld('appInfo', AppInfo)

// let windowId: string | null = null
// console.log('---preloooadddd')
// ipcRenderer.addListener('initWindow', (info, event) => {
//   console.log('💡 Init Window', event)
//   windowId = event.windowId
//   updateInitNavState({
//     routes: event.routes,
//     routeIndex: event.routeIndex,
//     lastAction: 'replace',
//   })
//   updateDaemonState(event.daemonState)
// })

const windowInfo = ipcRenderer.sendSync('initWindow')

contextBridge.exposeInMainWorld('windowId', windowInfo.windowId)
contextBridge.exposeInMainWorld('windowType', windowInfo.windowType)
contextBridge.exposeInMainWorld('initNavState', windowInfo.navState)

const [updateDarkMode, darkMode] = writeableStateStream<GoDaemonState>(
  windowInfo.darkMode,
)
contextBridge.exposeInMainWorld('darkMode', darkMode)

const [updateDaemonState, daemonState] = writeableStateStream<GoDaemonState>(
  windowInfo.daemonState,
)
contextBridge.exposeInMainWorld('daemonState', daemonState)

contextBridge.exposeInMainWorld('windowIsReady', () => {
  ipcRenderer.send('windowIsReady')
})
const routeHandlers = new Set<(route: any) => void>()

contextBridge.exposeInMainWorld('routeHandlers', routeHandlers)

contextBridge.exposeInMainWorld('docImport', {
  openMarkdownDirectories: (accountId: string) => {
    return new Promise((resolve, reject) => {
      ipcRenderer.once('directories-content-response', (event, response) => {
        if (response.success) {
          resolve(response.result)
        } else {
          reject(response.error)
        }
      })

      ipcRenderer.send('open-markdown-directory', accountId)
    })
  },

  openMarkdownFiles: (accountId: string) => {
    return new Promise((resolve, reject) => {
      ipcRenderer.once('files-content-response', (event, response) => {
        if (response.success) {
          resolve(response.result)
        } else {
          reject(response.error)
        }
      })

      ipcRenderer.send('open-markdown-file', accountId)
    })
  },

  readMediaFile: (filePath: string) => {
    return new Promise((resolve, reject) => {
      ipcRenderer.once('media-file-content', (event, response) => {
        if (response.success) {
          resolve(response)
        } else {
          reject(response.error)
        }
      })
      ipcRenderer.send('read-media-file', filePath)
    })
  },
})

contextBridge.exposeInMainWorld('docExport', {
  exportDocument: async (
    title: string,
    markdownContent: string,
    mediaFiles: {url: string; filename: string; placeholder: string}[],
  ) => {
    return new Promise((resolve, reject) => {
      ipcRenderer.once('export-completed', (event, response) => {
        if (response.success) {
          resolve(response.message)
        } else {
          reject(response.message)
        }
      })

      ipcRenderer.send('export-document', {title, markdownContent, mediaFiles})
    })
  },

  exportDocuments: async (
    documents: {
      title: string
      markdown: {
        markdownContent: string
        mediaFiles: {url: string; filename: string; placeholder: string}[]
      }
    }[],
  ) => {
    return new Promise((resolve, reject) => {
      ipcRenderer.once('export-completed', (event, response) => {
        if (response.success) {
          resolve(response.message)
        } else {
          reject(response.message)
        }
      })

      ipcRenderer.send('export-multiple-documents', documents)
    })
  },
})

ipcRenderer.addListener('openRoute', (info, route) => {
  routeHandlers.forEach((handler) => handler(route))
})

ipcRenderer.addListener('goDaemonState', (info, state) => {
  updateDaemonState(state)
})

ipcRenderer.addListener('darkMode', (info, state) => {
  updateDarkMode(state)
})

ipcRenderer.addListener('appWindowEvent', (info, event) => {
  dispatchAppWindow(event)
})

ipcRenderer.addListener('find_in_page', (info, event) => {
  dispatchAppWindow(event)
})

contextBridge.exposeInMainWorld('ipc', {
  send: (cmd, args) => {
    ipcRenderer.send(cmd, args)
  },
  listen: async (cmd: string, handler: (event: any) => void) => {
    const innerHandler = (info, payload: any) => {
      handler({info, payload})
    }
    ipcRenderer.addListener(cmd, innerHandler)
    return () => {
      ipcRenderer.removeListener(cmd, innerHandler)
    }
  },
  versions: () => {
    return process.versions
  },
})

contextBridge.exposeInMainWorld('autoUpdate', {
  onCheckForUpdates: (handler: (event: any) => void) => {
    ipcRenderer.on('auto-update:check-for-updates', (_event, value) => {
      handler(value)
    })
  },
  onUpdateAvailable: (handler: (updateInfo: any) => void) => {
    ipcRenderer.on('auto-update:update-available', (_event, updateInfo) => {
      handler(updateInfo)
    })
  },
  downloadAndInstall: () => {
    ipcRenderer.send('auto-update:download-and-install')
  },
  onDownloadProgress: (handler: (progress: number) => void) => {
    ipcRenderer.on('auto-update:download-progress', (_event, progress) => {
      handler(progress)
    })
  },
})
