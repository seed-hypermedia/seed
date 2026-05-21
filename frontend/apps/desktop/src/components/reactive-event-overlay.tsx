import {useEffect, useState} from 'react'
import {onEvent, ReactiveEvent} from '@shm/reactive'

type LoggedEvent = ReactiveEvent & {id: number; at: number}

const MAX_VISIBLE = 6
const EVENT_TTL_MS = 4_000

let nextId = 0

/**
 * Dev-only floating overlay that visualizes reactive-bus traffic. Subscribes
 * to the wildcard topic and shows a stack of recent events with topic labels
 * in the bottom-right corner. Useful for verifying that the reactive
 * pipeline is alive without instrumenting individual components.
 *
 * Render only in non-production builds.
 */
export function ReactiveEventOverlay() {
  const [events, setEvents] = useState<LoggedEvent[]>([])

  useEffect(() => {
    const unsub = onEvent('*', (event) => {
      const entry: LoggedEvent = {...event, id: nextId++, at: Date.now()}
      setEvents((prev) => [entry, ...prev].slice(0, MAX_VISIBLE))
    })
    return unsub
  }, [])

  useEffect(() => {
    if (events.length === 0) return
    const t = setTimeout(() => {
      const cutoff = Date.now() - EVENT_TTL_MS
      setEvents((prev) => prev.filter((e) => e.at >= cutoff))
    }, EVENT_TTL_MS)
    return () => clearTimeout(t)
  }, [events])

  if (events.length === 0) return null
  return (
    <div
      style={{
        position: 'fixed',
        right: 12,
        bottom: 12,
        zIndex: 99999,
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: 4,
        pointerEvents: 'none',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 11,
      }}
    >
      {events.map((e) => (
        <div
          key={e.id}
          style={{
            background: 'rgba(40, 167, 69, 0.92)',
            color: 'white',
            padding: '4px 8px',
            borderRadius: 4,
            boxShadow: '0 2px 6px rgba(0,0,0,0.25)',
            maxWidth: 360,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={e.topic}
        >
          • {e.topic}
        </div>
      ))}
    </div>
  )
}
