import {AppWindowEvent} from '@/utils/window-events'
import '@sentry/electron/preload'
import {contextBridge, ipcRenderer} from 'electron'
import {exposeElectronTRPC} from 'electron-trpc/main'
// import directly from this deep path for shared/utils/stream! Bad things happen if you try to directly import from @shm/shared
import {eventStream, writeableStateStream} from '@shm/shared/utils/stream'
import type {
  OnboardingFormData,
  OnboardingState,
  OnboardingStep,
} from './app-onboarding'
import {GoDaemonState} from './daemon'
import {UpdateStatus} from './types/updater-types'

// Declare global window extension for TypeScript
declare global {
  interface Window {
    isWindowMaximized?: boolean
  }
}

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

// Add a state stream for window maximized state
const [updateWindowMaximizedState, windowMaximizedState] =
  writeableStateStream<boolean>(false)
contextBridge.exposeInMainWorld('windowMaximizedState', windowMaximizedState)

// Add listener for window-state-change event
ipcRenderer.addListener(
  'window-state-change',
  (info, state: {isMaximized: boolean}) => {
    dispatchAppWindow({type: 'window_state_changed'})
    // Update the window maximized state
    updateWindowMaximizedState(state.isMaximized)
    // Also expose the state directly
    if (typeof state === 'object' && state !== null && 'isMaximized' in state) {
      window.isWindowMaximized = state.isMaximized
    }
  },
)

contextBridge.exposeInMainWorld('ipc', {
  send: (cmd: string, args: any) => {
    ipcRenderer.send(cmd, args)
  },
  listen: async (cmd: string, handler: (event: any) => void) => {
    const innerHandler = (info: any, payload: any) => {
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
  broadcast: (event: any) => {
    ipcRenderer.send('broadcastWindowEvent', event)
  },
})

contextBridge.exposeInMainWorld('autoUpdate', {
  onUpdateStatus: (handler: (status: UpdateStatus) => void) => {
    ipcRenderer.on('auto-update:status', (_event, status: UpdateStatus) => {
      handler(status)
    })
  },
  setUpdateStatus: (status: UpdateStatus) => {
    ipcRenderer.send('auto-update:set-status', status)
  },
  checkForUpdates: () => {
    ipcRenderer.send('auto-update:check-for-updates')
  },
  downloadAndInstall: () => {
    ipcRenderer.send('auto-update:download-and-install')
  },
  releaseNotes: () => {
    ipcRenderer.send('auto-update:release-notes')
  },
})

// Expose onboarding methods
const onboarding = {
  getState: (): OnboardingState => ipcRenderer.sendSync('get-onboarding-state'),
  setCompleted: (value: boolean) =>
    ipcRenderer.send('set-onboarding-completed', value),
  setSkipped: (value: boolean) =>
    ipcRenderer.send('set-onboarding-skipped', value),
  setStep: (step: OnboardingStep) =>
    ipcRenderer.send('set-onboarding-step', step),
  setFormData: (data: Partial<OnboardingFormData>) =>
    ipcRenderer.send('set-onboarding-form-data', data),
  resetState: () => ipcRenderer.send('reset-onboarding-state'),
  setInitialAccountIdCount: (count: number) =>
    ipcRenderer.send('set-onboarding-initial-account-id-count', count),
}

contextBridge.exposeInMainWorld('onboarding', onboarding)
