import type * as api from '@/api'
import {ActivityMonitor} from '@/activity-monitor'
import * as apisvc from '@/api-service'
import {getBuildInfo} from '@/build-info'
import {log, setLogLevel} from '@/log'
import {perfSnapshot} from '@/perf'
import {withTimeout} from '@/poll-loop'
import {ScheduleMonitor} from '@/schedule-monitor'
import * as cbor from '@/cbor'
import * as config from '@/config'
import * as sqlite from '@/sqlite'
import {type BunRequest, type Server, type ServerWebSocket, serve} from 'bun'
import * as fs from 'node:fs'
import * as filepath from 'node:path'

/** Data attached to each WebSocket connection. */
type WSData = {
  connectedAt: number
  subscriptions: Set<string>
  /**
   * Keys this socket reads through an agent's public-read setting, mapped to the owning account.
   * Service events are addressed to owner and collaborator accounts only, so the owner's events for
   * these keys are forwarded here as well.
   */
  publicSubscriptions: Map<string, string>
  accountId?: string
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
      // A thrown non-API error must still come back as a CORS-bearing CBOR error: Bun's bare 500
      // carries no Access-Control-Allow-Origin, which browsers report only as "Failed to fetch".
      console.error('[Agents API] Unhandled error in', envelope.action?._, error)
      const message = error instanceof Error ? error.message : String(error)
      return cbor.response({_: 'Error', message: `Internal server error: ${message}`} satisfies api.ErrorResponse, {
        status: 500,
      })
    }
  }

  // The secret normally rides in the URL (`/webhooks/<triggerId>/<secret>`) because many senders
  // can only POST to a URL they are given; senders that can set headers may instead POST to
  // `/webhooks/<triggerId>` with `Authorization: Bearer <secret>`. Both carry the same credential.
  const webhook = async (req: BunRequest) => {
    if (req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      return Response.json({error: 'Content-Type must be application/json'}, {status: 415})
    }
    const contentEncoding = req.headers.get('content-encoding')
    if (contentEncoding !== null && contentEncoding.trim().toLowerCase() !== 'identity') {
      return Response.json({error: 'Content-Encoding must be identity'}, {status: 415})
    }
    // Idempotency-Key is optional: senders that provide one get exact-retry deduplication, while
    // every delivery without one is treated as new.
    const suppliedKey = req.headers.get('idempotency-key')
    if (suppliedKey !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(suppliedKey)) {
      return Response.json({error: 'Invalid Idempotency-Key'}, {status: 400})
    }
    const deliveryKey = suppliedKey ?? crypto.randomUUID()
    // Only the `/:triggerId/:secret` route sets this; the header-only route leaves it undefined.
    const pathSecret: string | undefined = req.params.secret
    const authorization = req.headers.get('authorization') ?? ''
    const secret =
      (pathSecret && /^[A-Za-z0-9_-]{43}$/u.test(pathSecret) ? pathSecret : undefined) ??
      /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization)?.[1] ??
      ''

    let body: Uint8Array
    try {
      body = await readWebhookBody(req)
    } catch (error) {
      if (error instanceof apisvc.APIError) return Response.json({error: error.message}, {status: error.status})
      throw error
    }
    try {
      const result = svc.fireWebhookTrigger(req.params.triggerId ?? '', secret, deliveryKey, body)
      return Response.json({accepted: true, duplicate: result.duplicate}, {status: 202})
    } catch (error) {
      if (error instanceof apisvc.APIError) return Response.json({error: error.message}, {status: error.status})
      throw error
    }
  }

  const options = () => new Response(null, {status: 204, headers: corsHeaders()})
  const buildInfo = getBuildInfo()
  const health = async () => {
    const codeExec = await svc.codeExecAvailability()
    return Response.json(
      {
        status: 'ok',
        uptime: process.uptime(),
        version: buildInfo.version,
        hmServerUrl: svc.hmServerUrl,
        ipfsServerUrl: svc.ipfsServerUrl,
        webTools: svc.webToolCapabilities(),
        subscriptionAuth: svc.subscriptionAuthEnabled,
        codeExec: codeExec.available,
        codeExecReason: codeExec.reason,
        codeExecReasonCode: codeExec.code,
        // Which runtimes this server can actually run: `ts` needs an image with bun, so an
        // operator can see at a glance whether TypeScript execution is on here.
        codeExecRuntimes: codeExec.runtimes,
      },
      {headers: corsHeaders()},
    )
  }
  const version = () => Response.json(buildInfo, {headers: corsHeaders()})
  // Aggregate latency stats (metric names and millisecond percentiles only — no ids, no content),
  // so "is this server slow, and where" is one curl away. Same exposure class as /api/health.
  const perf = () => Response.json(perfSnapshot(), {headers: corsHeaders()})
  // Per-session timing rollup (tool names, counts, and milliseconds only — no content, no
  // arguments). The full session UUID is required and unguessable; unknown ids 404.
  const sessionPerf = (req: BunRequest) => {
    const rollup = svc.sessionPerf(req.params.sessionId ?? '')
    if (!rollup) return Response.json({error: 'Session not found'}, {status: 404, headers: corsHeaders()})
    return Response.json(rollup, {headers: corsHeaders()})
  }
  return {
    '/api/message': {OPTIONS: options, POST: message},
    '/agents/api/message': {OPTIONS: options, POST: message},
    '/agents/api/webhooks/:triggerId': {POST: webhook},
    '/agents/api/webhooks/:triggerId/:secret': {POST: webhook},
    '/api/health': {GET: health},
    '/agents/api/health': {GET: health},
    '/api/version': {GET: version},
    '/agents/api/version': {GET: version},
    '/api/perf': {GET: perf},
    '/agents/api/perf': {GET: perf},
    '/api/perf/sessions/:sessionId': {GET: sessionPerf},
    '/agents/api/perf/sessions/:sessionId': {GET: sessionPerf},
  }
}

async function readWebhookBody(req: Request): Promise<Uint8Array> {
  const contentLength = req.headers.get('content-length')
  if (contentLength && /^\d+$/u.test(contentLength) && Number(contentLength) > apisvc.WEBHOOK_MAX_BODY_BYTES) {
    throw new apisvc.APIError(413, 'Webhook body is too large')
  }
  if (!req.body) return new Uint8Array()
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > apisvc.WEBHOOK_MAX_BODY_BYTES) {
        await reader.cancel()
        throw new apisvc.APIError(413, 'Webhook body is too large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function sendWS(ws: ServerWebSocket<WSData>, event: api.AgentWSEvent): void {
  ws.send(JSON.stringify(event))
}

function summarizeWSEvent(event: api.AgentWSEvent): Record<string, unknown> {
  if (event._ === 'appendPartial') {
    const patch = event.patch as {
      textDelta?: string
      done?: boolean
      usage?: api.AgentRunUsage
      activity?: api.AgentRunActivity
    }
    return {
      type: event._,
      key: event.key,
      partialId: event.partialId,
      textDeltaBytes: patch.textDelta ? new TextEncoder().encode(patch.textDelta).byteLength : 0,
      done: patch.done === true,
      activity: patch.activity?.phase,
      totalTokens: patch.usage?.total,
    }
  }
  if (event._ === 'append') return {type: event._, key: event.key, seq: 'seq' in event ? event.seq : event.event.seq}
  if (event._ === 'change') return {type: event._, key: event.key}
  if (event._ === 'subscribed') return {type: event._, key: event.key, accountId: event.accountId}
  return {type: event._}
}

function sendIfSubscribed(
  ws: ServerWebSocket<WSData>,
  sourceAccountId: string,
  key: string,
  event: api.AgentWSEvent,
): void {
  if (ws.data.accountId !== sourceAccountId) {
    // Not this socket's account: only the owner's events for a publicly-read key pass through, and
    // an agent snapshot is downgraded so a public reader never sees the owner's access role — it
    // gets the role public access grants, which the snapshot's own flags determine.
    if (ws.data.publicSubscriptions.get(key) !== sourceAccountId) return
    if (event._ === 'change' && event.key.startsWith('agents/')) {
      const agent = event.value as api.AgentInfo
      const value = {...agent, accessRole: agent.publicChat ? 'chatter' : 'reader'} satisfies api.AgentInfo
      sendWS(ws, {...event, value} as api.AgentWSEvent)
      return
    }
    sendWS(ws, event)
    return
  }
  const direct = ws.data.subscriptions.has(key)
  const accountKey = ws.data.accountId ? `account/${ws.data.accountId}` : undefined
  const accountWide = accountKey ? ws.data.subscriptions.has(accountKey) : false
  if (direct || accountWide) {
    if (event._ === 'appendPartial') {
      log.debug('[agents/ws] send partial', {...summarizeWSEvent(event), direct, accountWide})
    }
    sendWS(ws, event)
  } else if (event._ === 'appendPartial') {
    log.debug('[agents/ws] skip partial; no subscription', {
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

async function main(): Promise<void> {
  if (process.argv.includes('--exec-selfcheck')) {
    // Verifies the microsandbox SDK is loadable through the same path execute_code uses. The SDK
    // is external to the compiled binary and staged on disk by build-binary.ts, so this catches
    // packaging regressions (missing node_modules, wrong platform package) in --smoke and CI.
    try {
      const {loadMicrosandbox} = await import('@/code-exec')
      await loadMicrosandbox()
      // When the staged runtime layout is present (compiled binary), the loader must have
      // resolved the msb helper from it — otherwise execute_code would fail at sandbox boot.
      const stagedModules = filepath.join(filepath.dirname(process.execPath), 'node_modules')
      if (fs.existsSync(stagedModules) && !process.env.MSB_PATH) {
        console.error('exec-selfcheck: staged node_modules present but no msb helper was found in it')
        process.exit(1)
      }
      // The workflow engine's QuickJS wasm is embedded in the bundle; prove it instantiates so a
      // bundling regression fails the build instead of the first delegated script in production.
      const {quickjsSelfcheck} = await import('@/workflow-host')
      await quickjsSelfcheck()
      console.log(`exec-selfcheck: SDK loaded; msb=${process.env.MSB_PATH ?? '(binding-relative)'}; quickjs ok`)
      process.exit(0)
    } catch (error) {
      console.error(`exec-selfcheck: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  }

  const cfg = config.create(config.parseArgs())
  setLogLevel(cfg.logLevel)
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
  const clients = new Set<ServerWebSocket<WSData>>()
  const publish = (event: apisvc.ServiceEvent) => {
    if (event.type === 'session-partial') {
      log.debug('[agents/ws] publish partial', {
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
    // Truncated once per publish, not per client: a giant tool result would otherwise be encoded
    // whole into a multi-megabyte frame for every subscriber.
    const wireSessionEvent =
      event.type === 'session-event' ? apisvc.truncateSessionEventForWire(event.event) : undefined
    for (const ws of clients) {
      if (event.type === 'session-event') {
        const wireEvent = wireSessionEvent ?? event.event
        sendIfSubscribed(ws, event.accountId, `sessions/${wireEvent.sessionId}`, {
          _: 'append',
          key: `sessions/${wireEvent.sessionId}`,
          event: wireEvent,
        })
      } else if (event.type === 'session-partial') {
        sendIfSubscribed(ws, event.accountId, `sessions/${event.sessionId}`, {
          _: 'appendPartial',
          key: `sessions/${event.sessionId}`,
          partialId: event.partialId,
          patch: {textDelta: event.textDelta, done: event.done, usage: event.usage, activity: event.activity},
        })
      } else if (event.type === 'session-change') {
        sendIfSubscribed(ws, event.accountId, `sessions/${event.session.id}`, {
          _: 'change',
          key: `sessions/${event.session.id}`,
          value: event.session,
        })
        sendIfSubscribed(ws, event.accountId, `agents/${event.session.agentId}`, {
          _: 'change',
          key: `sessions/${event.session.id}`,
          value: event.session,
        })
      } else if (event.type === 'agent-change') {
        sendIfSubscribed(ws, event.accountId, `agents/${event.agent.id}`, {
          _: 'change',
          key: `agents/${event.agent.id}`,
          value: event.agent,
        })
      } else if (event.type === 'run-change') {
        sendIfSubscribed(ws, event.accountId, `runs/${event.run.rootRunId}`, {
          _: 'change',
          key: `runs/${event.run.rootRunId}`,
          value: event.run,
        })
      } else if (event.type === 'run-append') {
        sendIfSubscribed(ws, event.accountId, `runs/${event.rootRunId}`, {
          _: 'append',
          key: `runs/${event.rootRunId}`,
          runId: event.entry.runId,
          seq: event.entry.seq,
          entry: event.entry.entry,
          createdAt: event.entry.createdAt,
        })
      } else if (event.type === 'run-partial') {
        sendIfSubscribed(ws, event.accountId, `runs/${event.rootRunId}`, {
          _: 'appendPartial',
          key: `runs/${event.rootRunId}`,
          runId: event.runId,
          partialId: event.partialId,
          patch: event.patch,
        })
      } else {
        sendIfSubscribed(ws, event.accountId, `account/${event.accountId}`, {
          _: 'change',
          key: `account/${event.accountId}`,
          value: {reason: event.reason, agentId: event.agentId, sessionId: event.sessionId},
        })
        // Agent-scoped account changes also reach the open agent page. This covers memory writes
        // (which have no agent-change event), collaborator changes, and an owner deleting an agent
        // while a collaborator still has its detail page open.
        if (event.agentId) {
          sendIfSubscribed(ws, event.accountId, `agents/${event.agentId}`, {
            _: 'change',
            key: `account/${event.accountId}`,
            value: {reason: event.reason, agentId: event.agentId, sessionId: event.sessionId},
          })
        }
      }
    }
  }
  const svc = new apisvc.Service(db, cfg.dataDir, {
    onEvent: publish,
    hmServerUrl: cfg.activity.hmServerUrl,
    ipfsServerUrl: cfg.activity.ipfsServerUrl,
    web: cfg.web,
    exec: cfg.exec,
    subscriptionAuth: cfg.subscriptionAuth,
    titleGeneration: cfg.titleGeneration,
    runQueue: cfg.runQueue,
  })
  const activityMonitor = new ActivityMonitor(db, svc, cfg.activity)
  const scheduleMonitor = new ScheduleMonitor(svc, {pollIntervalMs: cfg.activity.pollIntervalMs})
  activityMonitor.start()
  scheduleMonitor.start()

  const server = serve({
    port: cfg.http.port,
    hostname: cfg.http.hostname,
    // Agent memory accepts files of any size, so uploads must not hit Bun's 128MB default cap.
    maxRequestBodySize: Number.MAX_SAFE_INTEGER,
    error: handleError,
    routes: {
      ...createAPIRoutes(svc),
      '/agents/ws': (req: BunRequest, srv: Server<WSData>) => {
        const upgraded = srv.upgrade(req, {
          data: {
            connectedAt: Date.now(),
            subscriptions: new Set<string>(),
            publicSubscriptions: new Map<string, string>(),
          },
        })
        if (upgraded) return undefined as unknown as Response
        return new Response('WebSocket upgrade failed', {status: 400})
      },
    },
    // The server has no browser UI: everything outside the signed CBOR API, the health/version
    // probes, and the WebSocket is a 404. Account data is only reachable through signed envelopes.
    fetch() {
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
            if (sub.publicReadOf) ws.data.publicSubscriptions.set(sub.key, sub.publicReadOf)
            else ws.data.publicSubscriptions.delete(sub.key)
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
            if (sub.runsReplay) {
              const runsKey = sub.key as `runs/${string}`
              for (const run of sub.runsReplay.runs) {
                sendWS(ws, {_: 'change', key: runsKey, value: run})
              }
              for (const entry of sub.runsReplay.entries) {
                sendWS(ws, {
                  _: 'append',
                  key: runsKey,
                  runId: entry.runId,
                  seq: entry.seq,
                  entry: entry.entry,
                  createdAt: entry.createdAt,
                })
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
    // stop() waits for every open connection; clients whose sockets never finish closing would keep
    // the process alive forever with its listener already gone, so force-close after a grace period.
    await withTimeout(server.stop(), 3_000, 'stop http server').catch(() => server.stop(true))
    // Let in-flight background trigger runs finish their writes before closing the DB (bounded so a
    // stuck session can't block shutdown).
    await withTimeout(svc.drainTriggerSessions(), 5_000, 'drain trigger sessions').catch(() => {})
    svc.stopRunQueue()
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
  console.log(`  HM API: ${cfg.activity.hmServerUrl}`)
  console.log(`  IPFS: ${cfg.activity.ipfsServerUrl}`)
  console.log(
    `  Web tools: search=${cfg.web.searxngUrl ? 'on' : 'off'} reader=${
      cfg.web.crawlerUrl ? 'static+crawl4ai' : 'static-only'
    }`,
  )
}

function isCBORRequest(req: Request): boolean {
  return req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/cbor'
}

// Compiled executables don't reliably set import.meta.main (false on Windows in bun 1.3,
// oven-sh/bun#6009), so the binary build injects SEED_AGENTS_STANDALONE via define instead.
if (import.meta.main || process.env.SEED_AGENTS_STANDALONE === '1') {
  main()
}
