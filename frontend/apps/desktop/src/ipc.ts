import {AppIPC} from '@/app-ipc'

import {decodeRouteFromPath} from '@/utils/route-encoding'
import {client} from './trpc'

export const ipc: AppIPC = {
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    if (cmd === 'plugin:window|open') {
      const path = (args?.path as string) || ''
      const route = decodeRouteFromPath(path.slice(1))
      await client.createAppWindow.mutate({
        routes: [route],
      })
    } else {
      console.debug('IPC Invoke', cmd, args)
    }
  },
  // @ts-expect-error
  ...window.ipc,
}
