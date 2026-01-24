/**
 * Preload script for Memory Profiler window
 */

import {contextBridge, ipcRenderer} from 'electron'

// Expose IPC to the profiler window
contextBridge.exposeInMainWorld('ipcRenderer', {
  invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, listener: (event: any, ...args: any[]) => void) => {
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
})

// For inline script compatibility (the HTML uses require)
;(window as any).require = (module: string) => {
  if (module === 'electron') {
    return {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args),
        on: (channel: string, listener: (event: any, ...args: any[]) => void) => {
          ipcRenderer.on(channel, listener)
        },
      },
    }
  }
  throw new Error(`Cannot require module: ${module}`)
}
