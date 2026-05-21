import {getSeedToolMetadata} from '@seed-hypermedia/agents-protocol'
import {useEffect, useMemo, useState} from 'react'

type AgentDefinition = {
  name: string
  systemPrompt: string
  modelProvider: string
  model: string
  tools?: string[]
  metadata?: Record<string, unknown>
}

type AgentInfo = {
  id: string
  account: string
  definition: AgentDefinition
  stateDir: string
  status: 'idle' | 'running' | 'stopped' | 'error'
  createdAt: number
  updatedAt: number
  sessions: SessionInfo[]
  triggers: TriggerInfo[]
}

type TriggerSource =
  | {type: 'document-comment'; resource: string; author?: string}
  | {type: 'user-mention'; mentionedAccount: string; resourcePrefix?: string}
  | {type: 'site-update'; resourcePrefix: string; eventTypes?: string[]}

type TriggerInfo = {
  id: string
  agentId: string
  name: string
  enabled: boolean
  source: TriggerSource
  cooldownMs?: number
  updatedAt: number
  lastCheckedAt?: number
  lastFiredAt?: number
  lastError?: string
  firingCount: number
  errorCount: number
  lastFiringAt?: number
}

type SessionInfo = {
  id: string
  account: string
  agentId: string
  title?: string
  status: 'idle' | 'streaming' | 'stopped' | 'error'
  createdAt: number
  updatedAt: number
  eventCount: number
  lastEventAt?: number
}

type SessionEvent = {
  id: string
  sessionId: string
  seq: number
  event: SessionEventPayload
  createdAt: number
}

type SessionEventPayload =
  | {type: 'message'; role: 'user' | 'assistant' | 'tool'; content: string; toolCallId?: string}
  | {type: 'tool_call'; id: string; name: string; input: unknown}
  | {type: 'tool_result'; toolCallId: string; name: string; output?: unknown; error?: string}
  | {type: 'error'; message: string}
  | Record<string, unknown>

type ActivityWatermark = {
  accountId: string
  serverUrl: string
  lastPollAt?: number
  lastSuccessAt?: number
  lastError?: string
  seenKeys: string[]
}

type StatusResponse = {
  connections: number
  uptime: number
  agents: AgentInfo[]
  watermarks: ActivityWatermark[]
}

type SessionResponse = {
  session: Omit<SessionInfo, 'eventCount' | 'lastEventAt'>
  events: SessionEvent[]
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {hour: '2-digit', minute: '2-digit', second: '2-digit'})

/** Root application component. */
export function App() {
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingSession, setLoadingSession] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch('/agents/api/status')
        if (!response.ok) throw new Error(`Status request failed: ${response.status}`)
        const data = (await response.json()) as StatusResponse
        if (cancelled) return
        setStatus(data)
        setError(null)
        if (!selectedSessionId) {
          const active = data.agents.flatMap((agent) => agent.sessions).find((item) => item.status === 'streaming')
          if (active) setSelectedSessionId(active.id)
        }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Failed to load status')
      }
    }
    void load()
    const interval = window.setInterval(load, 2_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [selectedSessionId])

  useEffect(() => {
    if (!selectedSessionId) {
      setSession(null)
      return
    }
    let cancelled = false
    const load = async () => {
      setLoadingSession(true)
      try {
        const response = await fetch(`/agents/api/session?id=${encodeURIComponent(selectedSessionId)}`)
        if (!response.ok) throw new Error(`Session request failed: ${response.status}`)
        const data = (await response.json()) as SessionResponse
        if (cancelled) return
        setSession(data)
        setError(null)
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Failed to load session')
      } finally {
        if (!cancelled) setLoadingSession(false)
      }
    }
    void load()
    const interval = window.setInterval(load, 2_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [selectedSessionId])

  const selectedSession = useMemo(() => {
    if (!status || !selectedSessionId) return null
    return status.agents.flatMap((agent) => agent.sessions).find((item) => item.id === selectedSessionId) ?? null
  }, [status, selectedSessionId])

  const sessionCount = status?.agents.reduce((sum, agent) => sum + agent.sessions.length, 0) ?? 0
  const triggerCount = status?.agents.reduce((sum, agent) => sum + agent.triggers.length, 0) ?? 0

  return (
    <main className="bg-background text-foreground min-h-screen w-full overflow-hidden">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,color-mix(in_oklab,var(--primary)_30%,transparent),transparent_34rem),linear-gradient(135deg,transparent_0%,color-mix(in_oklab,var(--accent)_28%,transparent)_100%)]" />
      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 p-6 lg:p-8">
        <header className="border-border/70 bg-card/80 flex flex-col gap-5 rounded-3xl border p-6 shadow-2xl shadow-black/5 backdrop-blur md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-primary text-xs font-black tracking-[0.35em] uppercase">Seed Agents Control Room</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight md:text-5xl">Live session inspector</h1>
            <p className="text-muted-foreground mt-3 max-w-2xl text-sm">
              Diagnostic view for local agents, their sessions, durable events, and active server connections.
            </p>
          </div>
          <div className="grid grid-cols-4 gap-3 text-center">
            <Metric label="Agents" value={status?.agents.length ?? '—'} />
            <Metric label="Triggers" value={triggerCount || '—'} />
            <Metric label="Sessions" value={sessionCount || '—'} />
            <Metric label="Sockets" value={status?.connections ?? '—'} />
          </div>
        </header>

        {error && (
          <div className="border-destructive/40 bg-destructive/10 text-destructive rounded-2xl border px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {status?.watermarks.length ? (
          <section className="border-border/70 bg-card/80 rounded-3xl border p-4 shadow-xl shadow-black/5 backdrop-blur">
            <div className="mb-3 px-2">
              <h2 className="font-bold">Activity watermarks</h2>
              <p className="text-muted-foreground text-xs">Trigger monitor progress by account and HM server.</p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {status.watermarks.map((watermark) => (
                <div
                  key={`${watermark.accountId}:${watermark.serverUrl}`}
                  className="border-border bg-background/70 rounded-2xl border p-3"
                >
                  <div className="font-mono text-xs break-all">{watermark.accountId}</div>
                  <div className="text-muted-foreground mt-1 font-mono text-xs break-all">{watermark.serverUrl}</div>
                  <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span>seen {watermark.seenKeys.length}</span>
                    <span>poll {formatTime(watermark.lastPollAt)}</span>
                    <span>success {formatTime(watermark.lastSuccessAt)}</span>
                  </div>
                  {watermark.lastError ? <p className="text-destructive mt-2 text-xs">{watermark.lastError}</p> : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="grid min-h-0 flex-1 gap-6 lg:grid-cols-[25rem_minmax(0,1fr)]">
          <aside className="border-border/70 bg-card/80 min-h-0 rounded-3xl border p-4 shadow-xl shadow-black/5 backdrop-blur">
            <div className="mb-4 flex items-center justify-between px-2">
              <div>
                <h2 className="font-bold">Agents and sessions</h2>
                <p className="text-muted-foreground text-xs">Auto-refreshes every 2 seconds.</p>
              </div>
              <span className="bg-secondary text-secondary-foreground rounded-full px-3 py-1 text-xs font-bold">
                {formatUptime(status?.uptime)}
              </span>
            </div>

            <div className="flex max-h-[calc(100vh-18rem)] flex-col gap-3 overflow-auto pr-1">
              {!status ? (
                <EmptyState title="Loading agents…" />
              ) : status.agents.length === 0 ? (
                <EmptyState
                  title="No agents yet"
                  detail="Create an agent from the desktop app and it will appear here."
                />
              ) : (
                status.agents.map((agent) => (
                  <section key={agent.id} className="border-border/70 bg-background/70 rounded-2xl border p-3">
                    <div className="mb-3 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-black">{agent.definition.name}</h3>
                        <p className="text-muted-foreground truncate text-xs">
                          {agent.definition.modelProvider} · {agent.definition.model}
                        </p>
                      </div>
                      <StatusPill status={agent.status} />
                    </div>
                    <div className="mb-3 flex flex-col gap-2">
                      {agent.triggers.length === 0 ? (
                        <p className="text-muted-foreground rounded-xl border border-dashed p-3 text-xs">
                          No triggers.
                        </p>
                      ) : (
                        agent.triggers.map((trigger) => <TriggerCard key={trigger.id} trigger={trigger} />)
                      )}
                    </div>
                    <div className="flex flex-col gap-2">
                      {agent.sessions.length === 0 ? (
                        <p className="text-muted-foreground rounded-xl border border-dashed p-3 text-xs">
                          No sessions.
                        </p>
                      ) : (
                        agent.sessions.map((item) => (
                          <button
                            key={item.id}
                            className={`group rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-lg ${
                              selectedSessionId === item.id
                                ? 'border-primary bg-primary/10 shadow-primary/10 shadow-lg'
                                : 'border-border bg-card hover:border-primary/40'
                            }`}
                            onClick={() => setSelectedSessionId(item.id)}
                          >
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <span className="line-clamp-2 text-sm font-bold">{item.title || 'Untitled session'}</span>
                              <StatusPill status={item.status} />
                            </div>
                            <div className="text-muted-foreground flex items-center justify-between text-xs">
                              <span>{item.eventCount} events</span>
                              <span>{formatTime(item.lastEventAt ?? item.updatedAt)}</span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </section>
                ))
              )}
            </div>
          </aside>

          <section className="border-border/70 bg-card/80 flex min-h-0 flex-col rounded-3xl border shadow-xl shadow-black/5 backdrop-blur">
            <div className="border-border/70 flex items-center justify-between border-b p-5">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-black">{selectedSession?.title || 'Select a session'}</h2>
                <p className="text-muted-foreground truncate text-xs">
                  {selectedSessionId
                    ? selectedSessionId
                    : 'Choose a session to inspect messages, tool calls, and errors.'}
                </p>
              </div>
              {selectedSession && <StatusPill status={selectedSession.status} />}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-5">
              {!selectedSessionId ? (
                <EmptyState
                  title="Nothing selected"
                  detail="Click a session in the left rail to see what is happening."
                />
              ) : loadingSession && !session ? (
                <EmptyState title="Loading session…" />
              ) : session?.events.length === 0 ? (
                <EmptyState
                  title="No events yet"
                  detail="Messages and tool activity will show up here as they are persisted."
                />
              ) : (
                <ol className="flex flex-col gap-4">
                  {session?.events.map((event) => (
                    <li key={event.id} className="grid gap-3 md:grid-cols-[5rem_minmax(0,1fr)]">
                      <div className="text-muted-foreground pt-3 font-mono text-xs">#{event.seq}</div>
                      <EventCard event={event} />
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  )
}

function Metric(props: {label: string; value: string | number}) {
  return (
    <div className="border-border/70 bg-background/80 min-w-24 rounded-2xl border px-4 py-3">
      <div className="text-2xl font-black tabular-nums">{props.value}</div>
      <div className="text-muted-foreground text-[0.65rem] font-bold tracking-widest uppercase">{props.label}</div>
    </div>
  )
}

function TriggerCard(props: {trigger: TriggerInfo}) {
  return (
    <div className="border-border bg-card rounded-xl border p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm font-bold">{props.trigger.name}</span>
        <span
          className={`rounded-full px-2.5 py-1 text-[0.65rem] font-black uppercase ${
            props.trigger.enabled
              ? 'bg-green-500/15 text-green-700 dark:text-green-300'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {props.trigger.enabled ? 'enabled' : 'disabled'}
        </span>
      </div>
      <p className="text-muted-foreground line-clamp-2 text-xs">{formatTriggerSource(props.trigger.source)}</p>
      <div className="text-muted-foreground mt-2 flex items-center justify-between text-xs">
        <span>
          {props.trigger.firingCount} firings
          {props.trigger.errorCount ? ` · ${props.trigger.errorCount} errors` : ''}
          {props.trigger.cooldownMs ? ` · ${formatDuration(props.trigger.cooldownMs)} cooldown` : ''}
        </span>
        <span>{formatTime(props.trigger.lastFiringAt ?? props.trigger.lastFiredAt)}</span>
      </div>
      {props.trigger.lastError ? (
        <p className="text-destructive mt-2 line-clamp-2 text-xs">{props.trigger.lastError}</p>
      ) : null}
    </div>
  )
}

function EmptyState(props: {title: string; detail?: string}) {
  return (
    <div className="border-border/70 bg-background/60 flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed p-8 text-center">
      <h3 className="font-black">{props.title}</h3>
      {props.detail && <p className="text-muted-foreground mt-2 max-w-sm text-sm">{props.detail}</p>}
    </div>
  )
}

function formatTriggerSource(source: TriggerSource): string {
  if (source.type === 'document-comment')
    return `Comment in ${source.resource}${source.author ? ` by ${source.author}` : ''}`
  if (source.type === 'user-mention') {
    return `Mention of ${source.mentionedAccount}${source.resourcePrefix ? ` in ${source.resourcePrefix}` : ''}`
  }
  return `Update in ${source.resourcePrefix}${source.eventTypes?.length ? ` (${source.eventTypes.join(', ')})` : ''}`
}

function StatusPill(props: {status: string}) {
  const color =
    props.status === 'streaming' || props.status === 'running'
      ? 'bg-green-500/15 text-green-700 dark:text-green-300'
      : props.status === 'error'
      ? 'bg-red-500/15 text-red-700 dark:text-red-300'
      : 'bg-muted text-muted-foreground'
  return <span className={`${color} rounded-full px-2.5 py-1 text-[0.65rem] font-black uppercase`}>{props.status}</span>
}

function EventCard(props: {event: SessionEvent}) {
  const payload = props.event.event
  const type = typeof payload.type === 'string' ? payload.type : 'event'
  if (type === 'message' && 'role' in payload && 'content' in payload) {
    return (
      <article className="border-border bg-background rounded-2xl border p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-primary text-xs font-black tracking-widest uppercase">{String(payload.role)}</span>
          <span className="text-muted-foreground text-xs">{formatTime(props.event.createdAt)}</span>
        </div>
        <p className="text-sm leading-6 whitespace-pre-wrap">{String(payload.content)}</p>
      </article>
    )
  }
  if ((type === 'tool_call' || type === 'tool_result') && 'name' in payload) {
    return <ToolEventCard payload={payload} createdAt={props.event.createdAt} />
  }
  if (type === 'error' && 'message' in payload) {
    return (
      <article className="border-destructive/40 bg-destructive/10 text-destructive rounded-2xl border p-4">
        <EventHeader label="error" createdAt={props.event.createdAt} />
        <p className="text-sm">{String(payload.message)}</p>
      </article>
    )
  }
  return (
    <article className="border-border bg-background rounded-2xl border p-4">
      <EventHeader label={type} createdAt={props.event.createdAt} />
      <CodeBlock value={payload} />
    </article>
  )
}

function ToolEventCard(props: {payload: SessionEventPayload; createdAt: number}) {
  const [expanded, setExpanded] = useState(false)
  const name = 'name' in props.payload ? String(props.payload.name) : 'tool'
  const tool = getSeedToolMetadata(name)
  const isResult = props.payload.type === 'tool_result'
  const input = props.payload.type === 'tool_call' && 'input' in props.payload ? props.payload.input : undefined
  const output = props.payload.type === 'tool_result' && 'output' in props.payload ? props.payload.output : undefined
  const summary = firstToolText(output, tool?.render.summaryOutputPath) || firstToolText(input, tool?.render.summaryArg)
  const links = (tool?.render.links || []).flatMap((link) => {
    const source = link.source === 'input' ? input : output
    const labels = link.labelPath ? getToolPathValues(source, link.labelPath) : []
    return getToolPathValues(source, link.path).flatMap((url, index) => {
      if (typeof url !== 'string') return []
      return [{url, label: link.label || firstToolInlineText(labels[index]) || shortToolUrl(url)}]
    })
  })

  return (
    <article className="border-primary/30 bg-primary/5 rounded-2xl border p-3">
      <div className="flex min-w-0 items-center gap-2 text-xs">
        <button
          type="button"
          className="hover:bg-background rounded px-1"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <span className="text-primary shrink-0 font-black tracking-widest uppercase">
          {isResult ? 'tool result' : 'tool call'} · {tool?.render.label || name}
        </span>
        {summary ? <span className="text-muted-foreground min-w-0 truncate">{summary}</span> : null}
        <div className="ml-auto flex shrink-0 gap-1 overflow-hidden">
          {links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="hover:underline">
              {link.label}
            </a>
          ))}
        </div>
        <span className="text-muted-foreground shrink-0">{formatTime(props.createdAt)}</span>
      </div>
      {expanded ? <CodeBlock value={props.payload} /> : null}
    </article>
  )
}

function getToolPathValues(value: unknown, path?: string): unknown[] {
  if (!path) return [value]
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown[]>(
      (values, part) => {
        const arrayKey = part.endsWith('[]') ? part.slice(0, -2) : undefined
        return values.flatMap((current) => {
          if (typeof current !== 'object' || current === null) return []
          const next = (current as Record<string, unknown>)[arrayKey ?? part]
          return arrayKey ? (Array.isArray(next) ? next : []) : next === undefined ? [] : [next]
        })
      },
      [value],
    )
}

function firstToolInlineText(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function firstToolText(value: unknown, path?: string): string | undefined {
  for (const item of getToolPathValues(value, path)) {
    const text = firstToolInlineText(item)
    if (text) return text
  }
  return undefined
}

function shortToolUrl(url: string): string {
  return url.length <= 32 ? url : `${url.slice(0, 16)}…${url.slice(-10)}`
}

function EventHeader(props: {label: string; createdAt: number}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className="text-primary text-xs font-black tracking-widest uppercase">{props.label}</span>
      <span className="text-muted-foreground text-xs">{formatTime(props.createdAt)}</span>
    </div>
  )
}

function CodeBlock(props: {value: unknown}) {
  return (
    <pre className="border-border bg-muted max-h-96 overflow-auto rounded-xl border p-3 text-xs leading-5">
      {JSON.stringify(props.value, null, 2)}
    </pre>
  )
}

function formatTime(value?: number): string {
  return value ? dateFormatter.format(new Date(value)) : '—'
}

function formatDuration(ms: number): string {
  if (ms >= 3_600_000) return `${Math.round(ms / 3_600_000)}h`
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`
  return `${Math.round(ms / 1000)}s`
}

function formatUptime(value?: number): string {
  if (value === undefined) return '—'
  if (value < 60) return `${Math.floor(value)}s`
  const minutes = Math.floor(value / 60)
  const seconds = Math.floor(value % 60)
  return `${minutes}m ${seconds}s`
}
