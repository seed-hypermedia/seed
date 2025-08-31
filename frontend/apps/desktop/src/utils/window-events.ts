import {useEffect} from 'react'
import {useIPC} from '../app-context'

export type AppWindowSimpleEvent =
  | 'back'
  | 'forward'
  | 'trigger_peer_sync'
  | 'trigger_database_reindex'
  | 'open_launcher'
  | 'find_in_page'
  | 'discover'
  | 'window_state_changed'

export type AppWindowEvent =
  | AppWindowSimpleEvent
  | {key: 'connectPeer'; connectionUrl: string}
  | {key: 'hypermediaHoverIn'; id: string}
  | {key: 'hypermediaHoverOut'; id: string}
  | {key: 'selectedIdentityChanged'; selectedIdentity: string | null}

export function useListenAppEvent(
  eventKey:
    | AppWindowSimpleEvent
    | 'connectPeer'
    | 'hypermediaHoverIn'
    | 'hypermediaHoverOut'
    | 'selectedIdentityChanged',
  handlerFn: (event: AppWindowEvent) => void,
) {
  useEffect(() => {
    return window.appWindowEvents?.subscribe((event: AppWindowEvent) => {
      const eventMatchesKey =
        typeof event === 'string'
          ? event === eventKey
          : typeof event === 'object' && event.key === eventKey
      if (eventMatchesKey) handlerFn(event)
    })
  })
}

export function useTriggerWindowEvent() {
  const ipc = useIPC()
  return (event: AppWindowEvent) => {
    ipc.send('focusedWindowAppEvent', event)
  }
}
