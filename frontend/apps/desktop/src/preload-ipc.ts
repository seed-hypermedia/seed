import type {IpcRenderer} from 'electron'

// Keep in sync with renderer ipc.send/useIPC and useListen callers. Dedicated
// preload APIs (imports, exports, updates, onboarding, tRPC) have their own channels.
const SEND_COMMANDS = new Set([
  'windowNavState',
  'windowAssistantState',
  'focusedWindowAppEvent',
  'broadcastWindowEvent',
  'open_path',
  'open-external-link',
  'maximize_window',
  'close_window',
  'minimize_window',
  'hide_window',
  'quit_app',
  'find_in_page_query',
  'find_in_page_cancel',
])
const LISTEN_COMMANDS = new Set(['open_route', 'query_invalidation'])
const FIND_SEND_COMMANDS = new Set(['find_in_page_query', 'find_in_page_cancel'])

/** Restrict the generic preload bridge to the channels used by its renderer. */
export function createRendererIPC(ipcRenderer: IpcRenderer, findOnly = false) {
  const sendCommands = findOnly ? FIND_SEND_COMMANDS : SEND_COMMANDS
  return {
    send: (cmd: string, args?: any) => {
      if (!sendCommands.has(cmd)) {
        console.warn('Blocked unknown IPC send command:', cmd)
        return
      }
      ipcRenderer.send(cmd, args)
    },
    listen: async (cmd: string, handler: (event: any) => void) => {
      if (findOnly || !LISTEN_COMMANDS.has(cmd)) {
        console.warn('Blocked unknown IPC listen command:', cmd)
        return () => {}
      }
      const innerHandler = (info: Electron.IpcRendererEvent, payload: any) => {
        handler({info, payload})
      }
      ipcRenderer.addListener(cmd, innerHandler)
      return () => {
        ipcRenderer.removeListener(cmd, innerHandler)
      }
    },
    versions: () => process.versions,
  }
}
