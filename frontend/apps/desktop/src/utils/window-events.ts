import {useEffect} from 'react'
import {useIPC} from '../app-context'

export type AppWindowEvent =
  | {type: 'back'}
  | {type: 'forward'}
  | {type: 'trigger_database_reindex'}
  | {type: 'open_launcher'}
  | {type: 'focus_omnibar'; mode: 'url' | 'search'}
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
  | {type: 'draft_externally_modified'; draftId: string}
  | {type: 'document_path_changed'; oldId: string; newId: string}
  | {type: 'create_new_document'}

// Helper type to extract payload for a given key
type EventPayload<K extends AppWindowEvent['type']> = Extract<AppWindowEvent, {type: K}>
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

/**
 * Broadcast an event to every renderer window (including the sender).
 * Use for cross-window notifications such as "this draft was modified
 * externally — please reload".
 */
export function useBroadcastWindowEvent() {
  const ipc = useIPC()
  return (event: AppWindowEvent) => {
    ipc.send('broadcastWindowEvent', event)
  }
}
