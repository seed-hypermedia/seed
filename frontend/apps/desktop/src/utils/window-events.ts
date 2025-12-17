import {useEffect} from 'react'
import {useIPC} from '../app-context'

export type AppWindowEvent =
  | {type: 'back'}
  | {type: 'forward'}
  | {type: 'trigger_peer_sync'}
  | {type: 'trigger_database_reindex'}
  | {type: 'open_launcher'}
  | {type: 'find_in_page'}
  | {type: 'discover'}
  | {type: 'toggle_sidebar'}
  | {type: 'toggle_accessory'; index: number}
  | {type: 'window_state_changed'}
  | {type: 'connectPeer'; connectionUrl: string}
  | {type: 'hypermediaHoverIn'; id: string}
  | {type: 'hypermediaHoverOut'; id: string}
  | {type: 'selectedIdentityChanged'; selectedIdentity: string | null}
  | {type: 'deviceLink'; origin?: string}

// Helper type to extract payload for a given key
type EventPayload<K extends AppWindowEvent['type']> = Extract<
  AppWindowEvent,
  {type: K}
>
export function useListenAppEvent<K extends AppWindowEvent['type']>(
  eventKey: K,
  handlerFn: (event: EventPayload<K>) => void,
) {
  useEffect(() => {
    return window.appWindowEvents?.subscribe((event: AppWindowEvent) => {
      if (event.type === eventKey) {
        handlerFn(event as EventPayload<K>)
      }
    })
  }, [eventKey, handlerFn])
}

export function useTriggerWindowEvent() {
  const ipc = useIPC()
  return (event: AppWindowEvent) => {
    ipc.send('focusedWindowAppEvent', event)
  }
}
