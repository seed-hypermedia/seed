import {useEffect} from 'react'
import {useIPC} from '../app-context'

export type AppWindowSimpleEvent =
  | 'back'
  | 'forward'
  | 'trigger_peer_sync'
  | 'open_launcher'
  | 'find_in_page'
  | 'discover'

export type AppWindowEvent =
  | AppWindowSimpleEvent
  | {key: 'connectPeer'; connectionString: string; name?: string}

export function useListenAppEvent(
  eventKey: AppWindowSimpleEvent,
  handlerFn: () => void,
) {
  useEffect(() => {
    // @ts-expect-error
    return window.appWindowEvents?.subscribe((event: AppWindowEvent) => {
      if (event === eventKey) handlerFn()
    })
  })
}

export function useTriggerWindowEvent() {
  const ipc = useIPC()
  return (event: AppWindowEvent) => {
    ipc.send('focusedWindowAppEvent', event)
  }
}
