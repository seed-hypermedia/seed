import {useCallback, useEffect, useRef, useState} from 'react'
import {useSelector} from '@xstate/react'
import {useDocumentMachineRef, type DocumentMachineSnapshot} from './use-document-machine'
import {useUniversalAppContext} from '../routing'
import type {InspectEntry, InspectEventStore} from './document-machine-inspect'

/**
 * Formats a state value into a readable dot-separated path.
 * Handles both string values ("loading") and object values ({editing: "idle"}).
 */
function formatStateValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value)
      .map(([key, child]) => `${key}.${formatStateValue(child)}`)
      .join(', ')
  }
  return String(value)
}

/** Select the state value for display. */
function selectStateValue(snapshot: DocumentMachineSnapshot) {
  return snapshot.value
}

/** Select context fields relevant for debugging. */
function selectDebugContext(snapshot: DocumentMachineSnapshot) {
  const ctx = snapshot.context
  return {
    canEdit: ctx.canEdit,
    draftId: ctx.draftId,
    draftCreated: ctx.draftCreated,
    publishedVersion: ctx.publishedVersion,
    pendingRemoteVersion: ctx.pendingRemoteVersion,
    hasChangedWhileSaving: ctx.hasChangedWhileSaving,
    documentId: ctx.documentId ? `${ctx.documentId.uid}/${ctx.documentId.path?.join('/')}` : null,
  }
}

export interface DocumentMachineDebugDrawerProps {
  /** The event store to subscribe to for inspection events. */
  store?: InspectEventStore
}

/**
 * Debug drawer for the document state machine.
 * Shows current state, key context fields, event log, and quick event sender.
 *
 * Gated by the `developerTools` experiment flag — renders null when off.
 * Must be rendered inside a `DocumentMachineProvider` tree.
 */
export function DocumentMachineDebugDrawer({store}: DocumentMachineDebugDrawerProps) {
  const experiments = useUniversalAppContext().experiments
  const enabled = !!experiments?.developerTools
  const [isOpen, setIsOpen] = useState(false)

  // Keyboard shortcut: Cmd/Ctrl + Shift + D
  useEffect(() => {
    if (!enabled) return
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'd') {
        e.preventDefault()
        setIsOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled])

  if (!enabled) return null

  return (
    <>
      <StatePill onClick={() => setIsOpen(true)} isOpen={isOpen} />
      {isOpen && <DebugPanel onClose={() => setIsOpen(false)} store={store} />}
    </>
  )
}

function StatePill({onClick, isOpen}: {onClick: () => void; isOpen: boolean}) {
  const actorRef = useDocumentMachineRef()
  const stateValue = useSelector(actorRef, selectStateValue)
  const label = formatStateValue(stateValue)

  return (
    <button
      onClick={onClick}
      className="fixed right-3 bottom-3 z-[9999] flex items-center gap-1.5 rounded-full border border-neutral-300 bg-neutral-900 px-3 py-1.5 font-mono text-xs text-neutral-100 shadow-lg transition-colors hover:bg-neutral-800 dark:border-neutral-600 dark:bg-neutral-800 dark:hover:bg-neutral-700"
      title="Open Document Machine Debug Panel (Cmd+Shift+D)"
      style={{display: isOpen ? 'none' : undefined}}
    >
      <span
        className="inline-block size-2 rounded-full"
        style={{
          backgroundColor: label.startsWith('error')
            ? '#ef4444'
            : label.startsWith('editing')
            ? '#22c55e'
            : label.startsWith('publishing')
            ? '#eab308'
            : '#3b82f6',
        }}
      />
      {label}
    </button>
  )
}

function DebugPanel({onClose, store}: {onClose: () => void; store?: InspectEventStore}) {
  const actorRef = useDocumentMachineRef()
  const stateValue = useSelector(actorRef, selectStateValue)
  const debugCtx = useSelector(actorRef, selectDebugContext)

  // Event log from the inspect store (captures all XState inspection events)
  const [events, setEvents] = useState<InspectEntry[]>(() => (store ? [...store.entries] : []))
  const eventsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!store) return
    // Seed with existing entries
    setEvents([...store.entries])
    return store.subscribe(() => {
      setEvents([...store.entries])
    })
  }, [store])

  // Fallback: if no store, subscribe to actor events directly
  useEffect(() => {
    if (store) return // store takes priority
    const sub = actorRef.on('*', (event: any) => {
      setEvents((prev) => {
        const entry: InspectEntry = {
          inspType: 'event',
          eventType: event.type,
          timestamp: new Date().toISOString(),
          raw: event,
        }
        return [entry, ...prev].slice(0, 200)
      })
    })
    return () => sub.unsubscribe()
  }, [actorRef, store])

  const handleSendEvent = useCallback(
    (eventType: string) => {
      try {
        actorRef.send({type: eventType} as any)
      } catch (err) {
        console.error('[DebugPanel] Failed to send event:', err)
      }
    },
    [actorRef],
  )

  const handleClear = useCallback(() => {
    store?.clear()
    setEvents([])
  }, [store])

  const stateLabel = formatStateValue(stateValue)

  return (
    <div className="fixed inset-x-0 bottom-0 z-[9999] flex max-h-[50vh] flex-col border-t border-neutral-300 bg-white shadow-2xl dark:border-neutral-700 dark:bg-neutral-900">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-700">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold text-neutral-800 dark:text-neutral-200">
            Document Machine
          </span>
          <StateBadge label={stateLabel} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-neutral-400">Cmd+Shift+D</span>
          <button
            onClick={onClose}
            className="rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1L13 13M1 13L13 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Context panel */}
        <div className="flex-1 overflow-auto border-r border-neutral-200 p-3 dark:border-neutral-700">
          <h3 className="mb-2 font-mono text-xs font-semibold tracking-wider text-neutral-500 uppercase">Context</h3>
          <div className="space-y-1">
            {Object.entries(debugCtx).map(([key, value]) => (
              <div key={key} className="flex items-start gap-2 font-mono text-xs">
                <span className="shrink-0 text-neutral-500">{key}:</span>
                <span className="break-all text-neutral-800 dark:text-neutral-200">
                  {value === null ? <span className="text-neutral-400">null</span> : String(value)}
                </span>
              </div>
            ))}
          </div>

          {/* Quick event sender */}
          <h3 className="mt-4 mb-2 font-mono text-xs font-semibold tracking-wider text-neutral-500 uppercase">
            Send Event
          </h3>
          <div className="flex flex-wrap gap-1">
            {['edit.start', 'edit.cancel', 'change', 'publish.start', 'reset.content'].map((eventType) => (
              <button
                key={eventType}
                onClick={() => handleSendEvent(eventType)}
                className="rounded border border-neutral-300 px-2 py-0.5 font-mono text-xs text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
              >
                {eventType}
              </button>
            ))}
          </div>
        </div>

        {/* Event log panel */}
        <div className="flex w-80 flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 dark:border-neutral-700">
            <h3 className="font-mono text-xs font-semibold tracking-wider text-neutral-500 uppercase">
              Event Log ({events.length})
            </h3>
            <button
              onClick={handleClear}
              className="font-mono text-[10px] text-neutral-400 transition-colors hover:text-neutral-600"
            >
              clear
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            {events.length === 0 ? (
              <p className="p-3 font-mono text-xs text-neutral-400">No events yet...</p>
            ) : (
              events.map((evt, i) => (
                <div
                  key={`${evt.timestamp}-${i}`}
                  className="flex items-center justify-between border-b border-neutral-100 px-3 py-1 dark:border-neutral-800"
                >
                  <div className="flex items-center gap-1.5">
                    <EventTypeBadge type={evt.inspType} />
                    <span className="font-mono text-xs text-neutral-800 dark:text-neutral-200">{evt.eventType}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {evt.stateValue != null && (
                      <span className="font-mono text-[10px] text-neutral-500">{formatStateValue(evt.stateValue)}</span>
                    )}
                    <span className="font-mono text-[10px] text-neutral-400">
                      {new Date(evt.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              ))
            )}
            <div ref={eventsEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}

function StateBadge({label}: {label: string}) {
  return (
    <span
      className="inline-block rounded-full px-2 py-0.5 font-mono text-xs font-medium"
      style={{
        backgroundColor: label.startsWith('error')
          ? '#fecaca'
          : label.startsWith('editing')
          ? '#bbf7d0'
          : label.startsWith('publishing')
          ? '#fef08a'
          : '#bfdbfe',
        color: '#1e293b',
      }}
    >
      {label}
    </span>
  )
}

function EventTypeBadge({type}: {type: string}) {
  const colors: Record<string, string> = {
    event: '#3b82f6',
    snapshot: '#22c55e',
    actor: '#a855f7',
  }
  return (
    <span
      className="inline-block size-1.5 rounded-full"
      style={{backgroundColor: colors[type] ?? '#9ca3af'}}
      title={type}
    />
  )
}
