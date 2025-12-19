import {contextBridge, ipcRenderer} from 'electron'

// Minimal local type definitions
type GoDaemonState =
  | {t: 'startup'}
  | {t: 'ready'}
  | {t: 'error'; message: string}
  | {t: 'migrating'; completed: number; total: number}

// Minimal state stream implementation (no dependencies)
function createSimpleStream<T>(initialValue: T) {
  let currentValue = initialValue
  const listeners = new Set<(value: T) => void>()

  return {
    stream: {
      subscribe: (listener: (value: T) => void) => {
        listeners.add(listener)
        listener(currentValue)
        return () => listeners.delete(listener)
      },
    },
    update: (value: T) => {
      currentValue = value
      listeners.forEach((listener) => listener(value))
    },
  }
}

// Get initial daemon state
const windowInfo = ipcRenderer.sendSync('initWindow')
const {stream: daemonState, update: updateDaemonState} =
  createSimpleStream<GoDaemonState>(windowInfo.daemonState)

// Expose minimal API
contextBridge.exposeInMainWorld('daemonState', daemonState)
contextBridge.exposeInMainWorld('windowIsReady', () => {
  ipcRenderer.send('windowIsReady')
})
contextBridge.exposeInMainWorld(
  'forceLoadingWindow',
  windowInfo.forceLoadingWindow,
)
contextBridge.exposeInMainWorld('forceActiveState', () => {
  ipcRenderer.send('forceActiveState')
})

// Listen for daemon state updates
ipcRenderer.on('goDaemonState', (_event, state: GoDaemonState) => {
  updateDaemonState(state)
})
