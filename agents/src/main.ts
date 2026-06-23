import type * as api from '@/api'
import {ActivityMonitor} from '@/activity-monitor'
import * as apisvc from '@/api-service'
import {ScheduleMonitor} from '@/schedule-monitor'
import * as cbor from '@/cbor'
import * as config from '@/config'
import index from '@/frontend/index.html'
import * as sqlite from '@/sqlite'
import {type BunRequest, type ServerWebSocket, serve} from 'bun'
import type {Database} from 'bun:sqlite'
import * as fs from 'node:fs'
import * as filepath from 'node:path'

/** Data attached to each WebSocket connection. */
type WSData = {
  connectedAt: number
  subscriptions: Set<string>
  accountId?: string
}

type DebugAgent = api.AgentInfo & {sessions: DebugSession[]; triggers: DebugTrigger[]}

type DebugSession = api.SessionInfo & {eventCount: number; lastEventAt?: number}

type DebugTrigger = api.AgentTriggerInfo & {firingCount: number; errorCount: number; lastFiringAt?: number}

type DebugWatermark = {
  accountId: string
  serverUrl: string
  lastPollAt?: number
  lastSuccessAt?: number
  lastError?: string
  seenKeys: string[]
}

type AgentRow = {
  id: string
  account_id: string
  definition_cbor: Uint8Array | ArrayBuffer
  state_dir: string
  status: api.AgentInfo['status']
  created_at: number
  updated_at: number
}

type AgentTriggerRow = {
  id: string
  account_id: string
  agent_id: string
  name: string
  enabled: number
  source_cbor: Uint8Array | ArrayBuffer
  prompt: string
  created_at: number
  updated_at: number
  last_checked_at: number | null
  last_fired_at: number | null
  last_error: string | null
}

type DebugTriggerRow = AgentTriggerRow & {firing_count: number; error_count: number; last_firing_at: number | null}

type ActivityWatermarkRow = {
  account_id: string
  server_url: string
  cursor_cbor: Uint8Array | ArrayBuffer
  last_poll_at: number | null
  last_success_at: number | null
  last_error: string | null
}

type SessionRow = {
  id: string
  account_id: string
  agent_id: string
  title: string | null
  status: api.SessionInfo['status']
  created_at: number
  updated_at: number
}

type DebugSessionRow = SessionRow & {event_count: number; last_event_at: number | null}

type SessionEventRow = {
  id: string
  session_id: string
  seq: number
  event_cbor: Uint8Array | ArrayBuffer
  created_at: number
}

/** Scan directory for built assets and create a lookup map for O(1) serving. */
function collectStaticAssets(dir: string, urlPrefix: string): Map<string, ReturnType<typeof Bun.file>> {
  const assets = new Map<string, ReturnType<typeof Bun.file>>()
  if (!fs.existsSync(dir)) return assets
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    if (entry.isDirectory()) {
      for (const [k, v] of collectStaticAssets(filepath.join(dir, entry.name), urlPrefix)) {
        assets.set(k, v)
      }
    } else if (entry.name !== 'main.js' && !entry.name.endsWith('.map')) {
      assets.set(`${urlPrefix}${entry.name}`, Bun.file(filepath.join(dir, entry.name)))
    }
  }
  return assets
}

/** Handle errors from route handlers. */
async function handleError(error: unknown): Promise<Response> {
  console.error('Unexpected error:', error)
  return cbor.response({_: 'Error', message: 'Internal server error'} satisfies api.ErrorResponse, {status: 500})
}

/** Creates Bun route handlers for the Agents signed CBOR API. */
export function createAPIRoutes(svc: apisvc.Service): Bun.Serve.Routes<undefined, string> {
  const message = async (req: Request) => {
    if (!isCBORRequest(req)) {
      return cbor.response({_: 'Error', message: 'Content-Type must be application/cbor'} satisfies api.ErrorResponse, {
        status: 415,
      })
    }

    let envelope: api.SignedActionEnvelope
    try {
      envelope = await cbor.readRequest<api.SignedActionEnvelope>(req)
    } catch {
      return cbor.response({_: 'Error', message: 'Invalid CBOR request'} satisfies api.ErrorResponse, {status: 400})
    }

    try {
      return cbor.response(await svc.message(envelope))
    } catch (error) {
      if (error instanceof apisvc.APIError) {
        return cbor.response({_: 'Error', message: error.message} satisfies api.ErrorResponse, {status: error.status})
      }
      throw error
    }
  }

  const options = () => new Response(null, {status: 204, headers: corsHeaders()})
  const health = () =>
    Response.json(
      {status: 'ok', uptime: process.uptime(), webTools: svc.webToolCapabilities()},
      {headers: corsHeaders()},
    )
  return {
    '/api/message': {OPTIONS: options, POST: message},
    '/agents/api/message': {OPTIONS: options, POST: message},
    '/api/health': {GET: health},
    '/agents/api/health': {GET: health},
  }
}

function sendWS(ws: ServerWebSocket<WSData>, event: api.AgentWSEvent): void {
  ws.send(JSON.stringify(event))
}

function summarizeWSEvent(event: api.AgentWSEvent): Record<string, unknown> {
  if (event._ === 'appendPartial') {
    return {
      type: event._,
      key: event.key,
      partialId: event.partialId,
      textDeltaBytes: event.patch.textDelta ? new TextEncoder().encode(event.patch.textDelta).byteLength : 0,
      done: event.patch.done === true,
      activity: event.patch.activity?.phase,
      totalTokens: event.patch.usage?.total,
    }
  }
  if (event._ === 'append') return {type: event._, key: event.key, seq: event.event.seq}
  if (event._ === 'change') return {type: event._, key: event.key}
  if (event._ === 'subscribed') return {type: event._, key: event.key, accountId: event.accountId}
  return {type: event._}
}

function sendIfSubscribed(ws: ServerWebSocket<WSData>, key: string, event: api.AgentWSEvent): void {
  const direct = ws.data.subscriptions.has(key)
  const accountKey = ws.data.accountId ? `account/${ws.data.accountId}` : undefined
  const accountWide = accountKey ? ws.data.subscriptions.has(accountKey) : false
  if (direct || accountWide) {
    if (event._ === 'appendPartial') {
      console.info('[agents/ws] send partial', {...summarizeWSEvent(event), direct, accountWide})
    }
    sendWS(ws, event)
  } else if (event._ === 'appendPartial') {
    console.info('[agents/ws] skip partial; no subscription', {
      key,
      accountId: ws.data.accountId,
      subscriptions: Array.from(ws.data.subscriptions),
    })
  }
}

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Origin': '*',
  }
}

function json(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {...init, headers: {...corsHeaders(), ...init.headers}})
}

function getDebugOverview(db: Database): {
  connections?: number
  uptime: number
  agents: DebugAgent[]
  watermarks: DebugWatermark[]
} {
  const agentRows = db
    .query<AgentRow, []>(
      `SELECT id, account_id, definition_cbor, state_dir, status, created_at, updated_at
       FROM agents
       ORDER BY updated_at DESC`,
    )
    .all()
  const triggerRows = db
    .query<DebugTriggerRow, []>(
      `SELECT t.id, t.account_id, t.agent_id, t.name, t.enabled, t.source_cbor, t.prompt,
              t.created_at, t.updated_at, t.last_checked_at, t.last_fired_at, t.last_error,
              COUNT(f.id) AS firing_count,
              SUM(CASE WHEN f.status = 'error' THEN 1 ELSE 0 END) AS error_count,
              MAX(f.created_at) AS last_firing_at
       FROM agent_triggers t
       LEFT JOIN trigger_firings f ON f.trigger_id = t.id
       GROUP BY t.id
       ORDER BY t.updated_at DESC`,
    )
    .all()
  const sessionRows = db
    .query<DebugSessionRow, []>(
      `SELECT s.id, s.account_id, s.agent_id, s.title, s.status, s.created_at, s.updated_at,
              COUNT(e.id) AS event_count, MAX(e.created_at) AS last_event_at
       FROM sessions s
       LEFT JOIN session_events e ON e.session_id = s.id
       GROUP BY s.id
       ORDER BY s.updated_at DESC`,
    )
    .all()
  const triggersByAgent = new Map<string, DebugTrigger[]>()
  for (const row of triggerRows) {
    const triggers = triggersByAgent.get(row.agent_id) ?? []
    triggers.push(debugTriggerRowToInfo(row))
    triggersByAgent.set(row.agent_id, triggers)
  }
  const sessionsByAgent = new Map<string, DebugSession[]>()
  for (const row of sessionRows) {
    const sessions = sessionsByAgent.get(row.agent_id) ?? []
    sessions.push(debugSessionRowToInfo(row))
    sessionsByAgent.set(row.agent_id, sessions)
  }
  const watermarkRows = db
    .query<ActivityWatermarkRow, []>(
      `SELECT account_id, server_url, cursor_cbor, last_poll_at, last_success_at, last_error
       FROM activity_watermarks
       ORDER BY last_poll_at DESC`,
    )
    .all()
  return {
    uptime: process.uptime(),
    watermarks: watermarkRows.map(debugWatermarkRowToInfo),
    agents: agentRows.map((row) => ({
      ...agentRowToInfo(row),
      triggers: triggersByAgent.get(row.id) ?? [],
      sessions: sessionsByAgent.get(row.id) ?? [],
    })),
  }
}

function getDebugSession(db: Database, sessionId: string): Response {
  const session = db
    .query<SessionRow, [string]>(
      `SELECT id, account_id, agent_id, title, status, created_at, updated_at
       FROM sessions
       WHERE id = ?`,
    )
    .get(sessionId)
  if (!session) return json({error: 'Session not found'}, {status: 404})
  const events = db
    .query<SessionEventRow, [string]>(
      `SELECT id, session_id, seq, event_cbor, created_at
       FROM session_events
       WHERE session_id = ?
       ORDER BY seq ASC`,
    )
    .all(sessionId)
  return json({session: sessionRowToInfo(session), events: events.map(sessionEventRowToInfo)})
}

function agentRowToInfo(row: AgentRow): api.AgentInfo {
  return {
    id: row.id,
    account: row.account_id,
    definition: cbor.decode<api.AgentDefinition>(toBytes(row.definition_cbor)),
    stateDir: row.state_dir,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function debugTriggerRowToInfo(row: DebugTriggerRow): DebugTrigger {
  return {
    id: row.id,
    account: row.account_id,
    agentId: row.agent_id,
    name: row.name,
    enabled: row.enabled !== 0,
    source: cbor.decode<api.AgentTriggerSource>(toBytes(row.source_cbor)),
    prompt: row.prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.last_checked_at === null ? {} : {lastCheckedAt: row.last_checked_at}),
    ...(row.last_fired_at === null ? {} : {lastFiredAt: row.last_fired_at}),
    ...(row.last_error === null ? {} : {lastError: row.last_error}),
    firingCount: row.firing_count,
    errorCount: row.error_count,
    ...(row.last_firing_at ? {lastFiringAt: row.last_firing_at} : {}),
  }
}

function debugSessionRowToInfo(row: DebugSessionRow): DebugSession {
  return {
    ...sessionRowToInfo(row),
    eventCount: row.event_count,
    ...(row.last_event_at ? {lastEventAt: row.last_event_at} : {}),
  }
}

function sessionRowToInfo(row: SessionRow): api.SessionInfo {
  return {
    id: row.id,
    account: row.account_id,
    agentId: row.agent_id,
    ...(row.title ? {title: row.title} : {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function debugWatermarkRowToInfo(row: ActivityWatermarkRow): DebugWatermark {
  const decoded = cbor.decode<{seenKeys?: unknown}>(toBytes(row.cursor_cbor))
  const seenKeys = Array.isArray(decoded.seenKeys)
    ? decoded.seenKeys.filter((key): key is string => typeof key === 'string')
    : []
  return {
    accountId: row.account_id,
    serverUrl: row.server_url,
    seenKeys,
    ...(row.last_poll_at ? {lastPollAt: row.last_poll_at} : {}),
    ...(row.last_success_at ? {lastSuccessAt: row.last_success_at} : {}),
    ...(row.last_error ? {lastError: row.last_error} : {}),
  }
}

function sessionEventRowToInfo(row: SessionEventRow): api.SessionEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    seq: row.seq,
    event: cbor.decode(toBytes(row.event_cbor)),
    createdAt: row.created_at,
  }
}

function toBytes(value: Uint8Array | ArrayBuffer): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

async function main(): Promise<void> {
  const cfg = config.create(config.parseArgs())
  const result = sqlite.open(cfg.dbPath)

  if (!result.ok) {
    console.error(
      `❌ Database schema mismatch: stored version is ${result.current}, but server expects ${result.desired}.`,
    )
    console.error(`   Delete the database file (rm ${cfg.dbPath}*) and restart the server.`)
    const server = serve({
      port: cfg.http.port,
      hostname: cfg.http.hostname,
      routes: {'/*': Response.json({error: 'schema mismatch'}, {status: 500})},
    })
    const hostname = cfg.http.hostname === '0.0.0.0' ? 'localhost' : cfg.http.hostname
    console.error(`   Server running at http://${hostname}:${server.port} (schema mismatch mode)`)
    return
  }

  const db = result.db
  const isProd = process.env.NODE_ENV === 'production'
  const clients = new Set<ServerWebSocket<WSData>>()
  const publish = (event: apisvc.ServiceEvent) => {
    if (event.type === 'session-partial') {
      console.info('[agents/ws] publish partial', {
        accountId: event.accountId,
        sessionId: event.sessionId,
        partialId: event.partialId,
        textDeltaBytes: event.textDelta ? new TextEncoder().encode(event.textDelta).byteLength : 0,
        done: event.done === true,
        activity: event.activity
          ? event.activity.phase + (event.activity.toolName ? `:${event.activity.toolName}` : '')
          : undefined,
        totalTokens: event.usage?.total,
        clients: clients.size,
      })
    }
    for (const ws of clients) {
      if (ws.data.accountId !== event.accountId) continue
      if (event.type === 'session-event') {
        sendIfSubscribed(ws, `sessions/${event.event.sessionId}`, {
          _: 'append',
          key: `sessions/${event.event.sessionId}`,
          event: event.event,
        })
      } else if (event.type === 'session-partial') {
        sendIfSubscribed(ws, `sessions/${event.sessionId}`, {
          _: 'appendPartial',
          key: `sessions/${event.sessionId}`,
          partialId: event.partialId,
          patch: {textDelta: event.textDelta, done: event.done, usage: event.usage, activity: event.activity},
        })
      } else if (event.type === 'session-change') {
        sendIfSubscribed(ws, `sessions/${event.session.id}`, {
          _: 'change',
          key: `sessions/${event.session.id}`,
          value: event.session,
        })
        sendIfSubscribed(ws, `agents/${event.session.agentId}`, {
          _: 'change',
          key: `sessions/${event.session.id}`,
          value: event.session,
        })
      } else if (event.type === 'agent-change') {
        sendIfSubscribed(ws, `agents/${event.agent.id}`, {
          _: 'change',
          key: `agents/${event.agent.id}`,
          value: event.agent,
        })
      } else {
        sendIfSubscribed(ws, `account/${event.accountId}`, {
          _: 'change',
          key: `account/${event.accountId}`,
          value: {reason: event.reason, agentId: event.agentId, sessionId: event.sessionId},
        })
      }
    }
  }
  const svc = new apisvc.Service(db, cfg.dataDir, {
    onEvent: publish,
    hmServerUrl: cfg.activity.hmServerUrl,
    web: cfg.web,
  })
  const activityMonitor = new ActivityMonitor(db, svc, cfg.activity)
  const scheduleMonitor = new ScheduleMonitor(svc, {pollIntervalMs: cfg.activity.pollIntervalMs})
  activityMonitor.start()
  scheduleMonitor.start()
  const assets = isProd ? collectStaticAssets('frontend', '/agents/') : new Map()

  const server = serve({
    port: cfg.http.port,
    hostname: cfg.http.hostname,
    development: !isProd && {
      hmr: true,
      console: true,
    },
    error: handleError,
    routes: {
      ...createAPIRoutes(svc),
      '/agents/api/status': {
        GET: () => json({...getDebugOverview(db), connections: clients.size}),
      },
      '/agents/api/session': {
        GET: (req: BunRequest) => {
          const sessionId = new URL(req.url).searchParams.get('id') ?? ''
          if (!sessionId) return json({error: 'Session ID is required'}, {status: 400})
          return getDebugSession(db, sessionId)
        },
      },
      '/agents': index,
      '/agents/*': isProd
        ? (req: BunRequest) => {
            const asset = assets.get(new URL(req.url).pathname)
            if (asset) return new Response(asset, {headers: {'Content-Type': asset.type}})
            return new Response(Bun.file('frontend/index.html'), {headers: {'Content-Type': 'text/html;charset=utf-8'}})
          }
        : index,
    },
    fetch(req, server) {
      const url = new URL(req.url)
      if (url.pathname === '/agents/ws') {
        const upgraded = server.upgrade(req, {data: {connectedAt: Date.now(), subscriptions: new Set<string>()}})
        if (upgraded) return undefined
        return new Response('WebSocket upgrade failed', {status: 400})
      }
      if (url.pathname === '/') return Response.redirect(`${url.origin}/agents`, 302)
      return new Response('Not Found', {status: 404})
    },
    websocket: {
      open(ws: ServerWebSocket<WSData>) {
        clients.add(ws)
        console.info('[agents/ws] open', {connectedAt: ws.data.connectedAt, clients: clients.size})
        sendWS(ws, {_: 'connected', connectedAt: ws.data.connectedAt})
      },
      message(ws: ServerWebSocket<WSData>, message: string | Buffer) {
        void (async () => {
          try {
            const bytes =
              typeof message === 'string' ? Uint8Array.from(JSON.parse(message) as number[]) : new Uint8Array(message)
            const sub = await svc.verifySubscription(cbor.decode<api.SignedActionEnvelope>(bytes))
            if (ws.data.accountId && ws.data.accountId !== sub.accountId) {
              throw new apisvc.APIError(403, 'WebSocket account switch is not allowed')
            }
            ws.data.accountId = sub.accountId
            ws.data.subscriptions.add(sub.key)
            console.info('[agents/ws] subscribed', {
              accountId: sub.accountId,
              key: sub.key,
              replayEvents: sub.replay?.events.length ?? 0,
            })
            sendWS(ws, {_: 'subscribed', key: sub.key, accountId: sub.accountId})
            if (sub.replay) {
              sendWS(ws, {_: 'change', key: `sessions/${sub.replay.session.id}`, value: sub.replay.session})
              for (const event of sub.replay.events) {
                sendWS(ws, {_: 'append', key: `sessions/${event.sessionId}`, event})
              }
            }
          } catch (error) {
            sendWS(ws, {_: 'error', message: error instanceof Error ? error.message : 'Invalid subscription'})
          }
        })()
      },
      close(ws: ServerWebSocket<WSData>) {
        clients.delete(ws)
        console.info('[agents/ws] close', {accountId: ws.data.accountId, clients: clients.size})
      },
    },
  })

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    console.log('Shutting down gracefully...')
    shuttingDown = true
    activityMonitor.stop()
    scheduleMonitor.stop()
    for (const ws of clients) ws.close(1001, 'Server shutting down')
    clients.clear()
    await server.stop()
    db.close()
    process.exit(0)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  const hostname = cfg.http.hostname === '0.0.0.0' ? 'localhost' : cfg.http.hostname
  console.log(`Agents server running at http://${hostname}:${server.port}`)
  console.log(`  Database: ${cfg.dbPath}`)
  console.log(`  WebSocket endpoint: ws://${hostname}:${server.port}/agents/ws`)
  console.log(`  API: http://${hostname}:${server.port}/api/message`)
  console.log(`  Activity feed: ${cfg.activity.hmServerUrl}`)
  console.log(
    `  Web tools: search=${cfg.web.searxngUrl ? 'on' : 'off'} reader=${
      cfg.web.crawlerUrl ? 'static+crawl4ai' : 'static-only'
    }`,
  )
}

function isCBORRequest(req: Request): boolean {
  return req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/cbor'
}

if (import.meta.main) {
  main()
}
