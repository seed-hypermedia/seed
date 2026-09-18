import {contextBridge, ipcRenderer} from 'electron'

const events: unknown[] = []
ipcRenderer.on('appWindowEvent', (_event, value) => events.push(value))
contextBridge.exposeInMainWorld('browserTest', {
  events: () => events,
  navigate: (input: unknown) => ipcRenderer.send('web-browser-navigate', input),
  access: (input: unknown) => ipcRenderer.invoke('browser-agent-access', input),
  execute: (input: unknown) => ipcRenderer.invoke('browser-agent-execute', input),
  openApp: (input: unknown) => ipcRenderer.invoke('agent-app-open', input),
  hide: () => ipcRenderer.send('windowNavState', {routes: [{key: 'library'}], routeIndex: 0}),
})
