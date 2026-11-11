import type * as api from '@/api'
import {ActivityMonitor} from '@/activity-monitor'
import {AppInstallMonitor} from '@/app-install-monitor'
import * as apisvc from '@/api-service'
import {getBuildInfo} from '@/build-info'
import {installHmServerAuth} from '@/hm-server-auth'
import {configureDocsSpace, docsSpaceAccount, resolveDocsUrl} from '@/docs-space'
import {log, setLogLevel} from '@/log'
import {ExecCanary} from '@/exec-canary'
import {METRICS_CONTENT_TYPE, renderMetrics} from '@/metrics'
import {loopLagHealth, loopLagSnapshot, perfSnapshot, startLoopLagGauge, stopLoopLagGauge} from '@/perf'
import {PollLoop, withTimeout} from '@/poll-loop'
import {ScheduleMonitor} from '@/schedule-monitor'
import * as cbor from '@/cbor'
import * as config from '@/config'
import * as retention from '@/db-retention'
import * as sqlite from '@/sqlite'
import {type BunRequest, type Server, type ServerWebSocket, serve} from 'bun'
import * as fs from 'node:fs'
import * as filepath from 'node:path'

/** How often mounted agents' names are checked against their documents. */
const MOUNT_NAME_SYNC_INTERVAL_MS = 60_000
const MOUNT_NAME_SYNC_TIMEOUT_MS = 55_000

/** Data attached to each WebSocket connection. */
export type WSData = {
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

/** Canonical path prefix of the agents API, on its own host or on a site's origin. */
export const AGENTS_API_PREFIX = '/hm/api/agents'

/** WebSocket paths: the canonical one and the legacy one. */
export const AGENTS_WS_PATHS = [`${AGENTS_API_PREFIX}/ws`, '/agents/ws'] as const

function upgradeWebSocket(req: BunRequest, srv: Server<WSData>) {
  const upgraded = srv.upgrade(req, {
    data: {
      connectedAt: Date.now(),
      subscriptions: new Set<string>(),
      publicSubscriptions: new Map<string, string>(),
    },
  })
  if (upgraded) return undefined as unknown as Response
  return new Response('WebSocket upgrade failed', {status: 400})
}

/** Creates Bun route handlers for the Agents signed CBOR API. */
export function createAPIRoutes(
  svc: apisvc.Service,
  defaultPromptUrl?: string,
  canary: ExecCanary = new ExecCanary({probe: () => svc.probeCodeExec(), intervalMs: 0}),
): Bun.Serve.Routes<undefined, string> {
  const message = async (req: Request, server?: Server<undefined>) => {
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
      // The browser heartbeat waits up to 20 seconds; Bun otherwise resets idle HTTP requests at 10.
      if (envelope?.action?._ === 'PollSessionBrowser') server?.timeout(req, 30)
      return cbor.response(await svc.message(envelope))
    } catch (error) {
      if (error instanceof apisvc.APIError) {
        return cbor.response(
          {_: 'Error', message: error.message, ...(error.code ? {code: error.code} : {})} satisfies api.ErrorResponse,
          {status: error.status},
        )
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
    // A stalled event loop is the one failure every other field here hides: the handler that
    // reports `status: 'ok'` ran late, or not at all. When the p95 lag over the last minute is
    // past LOOP_LAG_UNHEALTHY_P95_MS the answer is 503 with the number, so the container
    // healthcheck, Caddy and an operator's curl all see the stall (see perf.ts).
    const lag = loopLagHealth()
    const loop = loopLagSnapshot()
    return Response.json(
      {
        status: lag.ok ? 'ok' : 'unhealthy',
        ...(lag.ok ? {} : {reason: lag.reason, p95: lag.p95}),
        loop: {lag: {p50: loop.p50, p95: loop.p95, max: loop.max, windowMs: loop.windowMs}},
        // What a space's agents-server binding must prove to be: see app-installs.ts.
        serverUid: svc.serverUid,
        uptime: process.uptime(),
        version: buildInfo.version,
        protocol: buildInfo.protocol,
        minClientProtocol: buildInfo.minClientProtocol,
        hmServerUrl: svc.hmServerUrl,
        ipfsServerUrl: svc.ipfsServerUrl,
        webTools: svc.webToolCapabilities(),
        subscriptionAuth: svc.subscriptionAuthEnabled,
        // Resolved to the docs space, so a client can open it: the configured value may still
        // spell the knowledge base as `hm://hyper.media`.
        defaultPromptUrl: defaultPromptUrl ? resolveDocsUrl(defaultPromptUrl) : defaultPromptUrl,
        codeExec: codeExec.available,
        codeExecReason: codeExec.reason,
        codeExecReasonCode: codeExec.code,
        // Which runtimes this server can actually run: `ts` needs an image with bun, so an
        // operator can see at a glance whether TypeScript execution is on here.
        codeExecRuntimes: codeExec.runtimes,
        // Whether a freshly booted sandbox last ran code (null until the canary has probed, or when
        // it is off). Informational: a restart does not fix a broken sandbox runtime, so this never
        // turns health 503 — the alert on /api/metrics is what pages.
        execCanary: execCanaryHealth(canary),
        // Free space where the database lives, against the floor new runs require (null when the
        // check is off), and whether the queue is claiming runs right now. A full disk shows up
        // here before it shows up as failed turns.
        disk: healthDisk(svc.diskStatus()),
        dispatch: svc.dispatchStatus(),
        // The boot passes that run after the server listens (parked-run reconcile, receipt
        // pruning): `running` right after a restart, then `done` with how long they took.
        bootRecovery: svc.bootRecoveryStatus(),
      },
      {status: lag.ok ? 200 : 503, headers: corsHeaders()},
    )
  }
  const version = () => Response.json(buildInfo, {headers: corsHeaders()})
  // Aggregate latency stats (metric names and millisecond percentiles only — no ids, no content),
  // so "is this server slow, and where" is one curl away. Same exposure class as /api/health.
  const perf = () => Response.json(perfSnapshot(), {headers: corsHeaders()})
  // The same aggregates plus the exec canary in Prometheus text format, for the metrics collector
  // and the alert rules (SeedInfra `seed_infra/monitoring`).
  const metrics = () =>
    new Response(
      renderMetrics({
        perf: perfSnapshot(),
        canary: canary.status(),
        build: {version: buildInfo.version, protocol: buildInfo.protocol},
        uptimeSeconds: process.uptime(),
      }),
      {headers: {...corsHeaders(), 'content-type': METRICS_CONTENT_TYPE}},
    )
  // Per-session timing rollup (tool names, counts, and milliseconds only — no content, no
  // arguments). The full session UUID is required and unguessable; unknown ids 404.
  const sessionPerf = (req: BunRequest) => {
    const rollup = svc.sessionPerf(req.params.sessionId ?? '')
    if (!rollup) return Response.json({error: 'Session not found'}, {status: 404, headers: corsHeaders()})
    return Response.json(rollup, {headers: corsHeaders()})
  }
  return {
    // Canonical mount: everything under one prefix, so a site's reverse proxy can route
    // `/hm/api/agents/*` to this service on the site's own origin.
    [`${AGENTS_API_PREFIX}/message`]: {OPTIONS: options, POST: message},
    [`${AGENTS_API_PREFIX}/webhooks/:triggerId`]: {POST: webhook},
    [`${AGENTS_API_PREFIX}/webhooks/:triggerId/:secret`]: {POST: webhook},
    [`${AGENTS_API_PREFIX}/health`]: {GET: health},
    [`${AGENTS_API_PREFIX}/version`]: {GET: version},
    [`${AGENTS_API_PREFIX}/perf`]: {GET: perf},
    [`${AGENTS_API_PREFIX}/metrics`]: {GET: metrics},
    [`${AGENTS_API_PREFIX}/perf/sessions/:sessionId`]: {GET: sessionPerf},
    // Legacy routes, kept for the standalone host (agentic.seed.hyper.media), older clients and
    // webhook URLs already handed out.
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
    '/api/metrics': {GET: metrics},
    '/agents/api/metrics': {GET: metrics},
    '/api/perf/sessions/:sessionId': {GET: sessionPerf},
    '/agents/api/perf/sessions/:sessionId': {GET: sessionPerf},
  }
}

/** The canary summary for health: the last outcome and when, without the raw error text. */
function execCanaryHealth(
  canary: ExecCanary,
): {ok: boolean | null; lastRunAt: number | null; consecutiveFailures: number} | null {
  const status = canary.status()
  if (!status.enabled) return null
  return {ok: status.lastOk, lastRunAt: status.lastRunAt, consecutiveFailures: status.consecutiveFailures}
}

/** The free-space figures for health, without the directory they were read from. */
function healthDisk(
  status: ReturnType<apisvc.Service['diskStatus']>,
): {freeBytes: number; minFreeBytes: number; ok: boolean} | null {
  return status ? {freeBytes: status.freeBytes, minFreeBytes: status.minFreeBytes, ok: status.ok} : null
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

/**
 * How far a published event travels: only to sockets subscribed to its exact key (`direct`), or
 * also to the account-wide `account/<id>` subscription (`account`).
 *
 * Transcript frames — appends, streaming partials, session snapshots — are `direct`. The
 * account-wide subscription is held by every open desktop window and signed-in web tab (it feeds
 * the unread indicator), so fanning every session's streaming text to all of them was most of the
 * socket traffic, and none of those clients used it: the sidebar and lists take what they need
 * from the account hints, which carry the session snapshot and the agent's activity rollup.
 */
export type WSDeliveryScope = 'direct' | 'account'

/** Whether one socket should receive an event addressed to `key` from `sourceAccountId`. */
export function wsShouldDeliver(data: WSData, sourceAccountId: string, key: string, scope: WSDeliveryScope): boolean {
  // Not this socket's account: only the owner's events for a publicly-read key pass through.
  if (data.accountId !== sourceAccountId) return data.publicSubscriptions.get(key) === sourceAccountId
  if (data.subscriptions.has(key)) return true
  return scope === 'account' && !!data.accountId && data.subscriptions.has(`account/${data.accountId}`)
}

function sendIfSubscribed(
  svc: apisvc.Service,
  ws: ServerWebSocket<WSData>,
  sourceAccountId: string,
  key: string,
  event: api.AgentWSEvent,
  scope: WSDeliveryScope = 'account',
): void {
  if (!wsShouldDeliver(ws.data, sourceAccountId, key, scope)) return
  if (ws.data.accountId !== sourceAccountId && event._ === 'change' && event.key.startsWith('agents/')) {
    // A public reader never sees the owner's access role — it gets the role public access grants,
    // which the snapshot's own flags determine.
    const agent = event.value as api.AgentInfo
    const value = {...agent, accessRole: agent.publicChat ? 'chatter' : 'reader'} satisfies api.AgentInfo
    sendWS(ws, {...event, value} as api.AgentWSEvent)
    return
  }
  sendWS(ws, svc.redactForViewer(event, ws.data.accountId ?? ''))
}

function corsHeaders(): HeadersInit {
  return cbor.corsHeaders('GET, POST, OPTIONS')
}

/** Paths that answer health while the server is still starting. */
const HEALTH_PATHS = [`${AGENTS_API_PREFIX}/health`, '/api/health', '/agents/api/health'] as const

/**
 * Routes served from the moment the process binds its port until the service is ready: health
 * answers 503 `starting` with the boot phase and how long it has run, and everything else 503
 * with a Retry-After. Without them a slow boot (migrations, the run-queue sweeps on a large
 * database) left the port closed, so the container healthcheck, Caddy and an operator saw nothing
 * at all, not even that the server was starting.
 *
 * Synchronous database work still blocks the only thread, so a request that arrives during a
 * long step is answered when the step ends; `main` yields between steps so those answers go out.
 */
export function createBootRoutes(boot: {phase: string}): Bun.Serve.Routes<WSData, string> {
  const buildInfo = getBuildInfo()
  const health = () =>
    Response.json(
      {
        status: 'starting',
        reason: `server is starting: ${boot.phase}`,
        phase: boot.phase,
        uptime: process.uptime(),
        version: buildInfo.version,
        protocol: buildInfo.protocol,
        minClientProtocol: buildInfo.minClientProtocol,
      },
      {status: 503, headers: {...corsHeaders(), 'Retry-After': '5'}},
    )
  return Object.fromEntries(HEALTH_PATHS.map((path) => [path, {GET: health}]))
}

/** The answer to every non-health request while the server is starting. */
function startingResponse(): Response {
  return Response.json(
    {_: 'Error', message: 'Agents server is starting; retry shortly'},
    {status: 503, headers: {...corsHeaders(), 'Retry-After': '5'}},
  )
}

/** Resolves on a later macrotask, so the HTTP server can answer what arrived during a synchronous boot step. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
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
      // mermaid and its DOM shim are bundled; prove a diagram parses so a bundling regression fails
      // the build instead of every document write that carries a diagram in production.
      const {mermaidSelfcheck} = await import('@/mermaid-parser')
      await mermaidSelfcheck()
      console.log(
        `exec-selfcheck: SDK loaded; msb=${process.env.MSB_PATH ?? '(binding-relative)'}; quickjs ok; mermaid ok`,
      )
      process.exit(0)
    } catch (error) {
      console.error(`exec-selfcheck: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  }

  const cfg = config.create(config.parseArgs())
  setLogLevel(cfg.logLevel)
  // A members-only (Enterprise) site lets this service in by a shared secret instead of a session.
  installHmServerAuth([cfg.activity.hmServerUrl, cfg.activity.ipfsServerUrl], process.env.SEED_AGENTS_HM_SERVER_SECRET)

  // Bind the port before any database work, answering health with `starting` until the service
  // is ready; the full routes replace these with server.reload below.
  const boot = {phase: 'opening the database'}
  const bootStartedAt = performance.now()
  const logBootStep = (step: string, since: number) =>
    console.info('[agents/boot] step finished', {step, ms: Math.round(performance.now() - since)})
  const server = serve<WSData, string>({
    port: cfg.http.port,
    hostname: cfg.http.hostname,
    // Agent memory accepts files of any size, so uploads must not hit Bun's 128MB default cap.
    maxRequestBodySize: Number.MAX_SAFE_INTEGER,
    error: handleError,
    routes: createBootRoutes(boot),
    fetch: startingResponse,
  })
  await yieldToEventLoop()

  let stepStartedAt = performance.now()
  const result = sqlite.open(cfg.dbPath, {
    cacheBytes: cfg.database.cacheBytes,
    mmapBytes: cfg.database.mmapBytes,
    walLimitBytes: cfg.database.walLimitBytes,
  })
  logBootStep('open database (migrations, planner statistics)', stepStartedAt)

  if (!result.ok) {
    console.error(
      `❌ Database schema mismatch: stored version is ${result.current}, but server expects ${result.desired}.`,
    )
    console.error(`   Delete the database file (rm ${cfg.dbPath}*) and restart the server.`)
    server.reload({
      routes: {'/*': Response.json({error: 'schema mismatch'}, {status: 500})},
      fetch: () => Response.json({error: 'schema mismatch'}, {status: 500}),
    })
    const hostname = cfg.http.hostname === '0.0.0.0' ? 'localhost' : cfg.http.hostname
    console.error(`   Server running at http://${hostname}:${server.port} (schema mismatch mode)`)
    return
  }
  boot.phase = 'starting the run queue'
  await yieldToEventLoop()

  const db = result.db
  console.log('[agents/sqlite] connection settings', sqlite.connectionSettings(db))
  retention.setPersistedToolOutputLimit(cfg.database.toolOutputStoreLimitChars)
  const clients = new Set<ServerWebSocket<WSData>>()
  const publish = (event: apisvc.ServiceEvent) => {
    // Truncated once per publish, not per client: a giant tool result would otherwise be encoded
    // whole into a multi-megabyte frame for every subscriber.
    const wireSessionEvent =
      event.type === 'session-event' ? apisvc.truncateSessionEventForWire(event.event) : undefined
    for (const ws of clients) {
      if (event.type === 'session-event') {
        const wireEvent = wireSessionEvent ?? event.event
        sendIfSubscribed(
          svc,
          ws,
          event.accountId,
          `sessions/${wireEvent.sessionId}`,
          {_: 'append', key: `sessions/${wireEvent.sessionId}`, event: wireEvent},
          'direct',
        )
      } else if (event.type === 'session-partial') {
        sendIfSubscribed(
          svc,
          ws,
          event.accountId,
          `sessions/${event.sessionId}`,
          {
            _: 'appendPartial',
            key: `sessions/${event.sessionId}`,
            partialId: event.partialId,
            patch: {textDelta: event.textDelta, done: event.done, usage: event.usage, activity: event.activity},
          },
          'direct',
        )
      } else if (event.type === 'session-change') {
        // The open transcript and the agent page; the sidebar gets the same snapshot on its hint.
        sendIfSubscribed(
          svc,
          ws,
          event.accountId,
          `sessions/${event.session.id}`,
          {_: 'change', key: `sessions/${event.session.id}`, value: event.session},
          'direct',
        )
        sendIfSubscribed(
          svc,
          ws,
          event.accountId,
          `agents/${event.session.agentId}`,
          {_: 'change', key: `sessions/${event.session.id}`, value: event.session},
          'direct',
        )
      } else if (event.type === 'agent-change') {
        sendIfSubscribed(svc, ws, event.accountId, `agents/${event.agent.id}`, {
          _: 'change',
          key: `agents/${event.agent.id}`,
          value: event.agent,
        })
      } else if (event.type === 'run-change') {
        sendIfSubscribed(svc, ws, event.accountId, `runs/${event.run.rootRunId}`, {
          _: 'change',
          key: `runs/${event.run.rootRunId}`,
          value: event.run,
        })
      } else if (event.type === 'run-append') {
        sendIfSubscribed(svc, ws, event.accountId, `runs/${event.rootRunId}`, {
          _: 'append',
          key: `runs/${event.rootRunId}`,
          runId: event.entry.runId,
          seq: event.entry.seq,
          entry: event.entry.entry,
          createdAt: event.entry.createdAt,
        })
      } else if (event.type === 'run-partial') {
        sendIfSubscribed(svc, ws, event.accountId, `runs/${event.rootRunId}`, {
          _: 'appendPartial',
          key: `runs/${event.rootRunId}`,
          runId: event.runId,
          partialId: event.partialId,
          patch: event.patch,
        })
      } else {
        sendIfSubscribed(svc, ws, event.accountId, `account/${event.accountId}`, {
          _: 'change',
          key: `account/${event.accountId}`,
          value: {
            reason: event.reason,
            agentId: event.agentId,
            sessionId: event.sessionId,
            activity: event.activity,
            session: event.session,
          },
        })
        // Agent-scoped account changes also reach the open agent page. This covers memory writes
        // (which have no agent-change event), collaborator changes, and an owner deleting an agent
        // while a collaborator still has its detail page open.
        if (event.agentId) {
          sendIfSubscribed(svc, ws, event.accountId, `agents/${event.agentId}`, {
            _: 'change',
            key: `account/${event.accountId}`,
            value: {
              reason: event.reason,
              agentId: event.agentId,
              sessionId: event.sessionId,
              activity: event.activity,
              session: event.session,
            },
          })
        }
      }
    }
  }
  configureDocsSpace(cfg.docs)
  stepStartedAt = performance.now()
  const svc = new apisvc.Service(db, cfg.dataDir, {
    onEvent: publish,
    hmServerUrl: cfg.activity.hmServerUrl,
    ipfsServerUrl: cfg.activity.ipfsServerUrl,
    web: cfg.web,
    apps: cfg.apps,
    exec: cfg.exec,
    subscriptionAuth: cfg.subscriptionAuth,
    titleGeneration: cfg.titleGeneration,
    runQueue: cfg.runQueue,
    storage: {path: filepath.dirname(filepath.resolve(cfg.dbPath)), minFreeBytes: cfg.storage.minFreeDiskBytes},
  })
  logBootStep('service (run and effect sweeps)', stepStartedAt)
  boot.phase = 'starting monitors'
  await yieldToEventLoop()
  const activityMonitor = new ActivityMonitor(db, svc, cfg.activity)
  const scheduleMonitor = new ScheduleMonitor(svc, {pollIntervalMs: cfg.activity.pollIntervalMs})
  // A mounted agent is named by its document: the first tick migrates agents adopted before that
  // rule, later ticks pick up renames (a title edit, published).
  const mountNameSync = new PollLoop({
    label: 'Agents Mount Names',
    intervalMs: MOUNT_NAME_SYNC_INTERVAL_MS,
    timeoutMs: MOUNT_NAME_SYNC_TIMEOUT_MS,
    run: async (signal) => {
      const synced = await svc.syncMountedAgentNames({signal})
      if (synced > 0) console.log('[Agents Mount Names] Renamed mounted agents after their documents', {synced})
    },
  })
  activityMonitor.start()
  scheduleMonitor.start()
  // Measures how late a 100 ms timer fires: the only signal that the single thread is stalled
  // when no request gets far enough to record a span. Read at /api/perf (`loop.lag`) and
  // enforced by /api/health.
  startLoopLagGauge()
  mountNameSync.start()
  // Proves a cold sandbox boot still works on a timer (SEED_AGENTS_EXEC_CANARY_SECS; off by default,
  // on for the hosted server). See exec-canary.ts for the outage that motivated it.
  const execCanary = new ExecCanary({probe: () => svc.probeCodeExec(), intervalMs: cfg.execCanaryIntervalMs})
  execCanary.start()
  // Bounds the database's growth: drops durable stores of long-idle sessions and compacts the
  // journals of long-finished runs, in throttled steps (see db-retention.ts).
  const retentionTask = new retention.RetentionTask(db, {
    ...retention.DEFAULT_RETENTION_POLICY,
    ...cfg.database.retention,
  })
  retentionTask.start()
  const appInstallMonitor = new AppInstallMonitor(svc, {pollIntervalMs: 5 * 60_000})
  appInstallMonitor.start()

  server.reload({
    error: handleError,
    routes: {
      ...createAPIRoutes(svc, cfg.defaultPromptUrl, execCanary),
      [AGENTS_WS_PATHS[0]]: upgradeWebSocket,
      [AGENTS_WS_PATHS[1]]: upgradeWebSocket,
    },
    // The server has no browser UI: everything outside the signed CBOR API, the health/version
    // probes, and the WebSocket is a 404. Account data is only reachable through signed envelopes.
    fetch() {
      return new Response('Not Found', {status: 404})
    },
    websocket: {
      open(ws: ServerWebSocket<WSData>) {
        clients.add(ws)
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
            // Read and subscribe in one step, with nothing awaited between them: an event written
            // after the read is delivered live, and one written before it is in the replay.
            const replay = sub.replay?.()
            ws.data.accountId = sub.accountId
            ws.data.subscriptions.add(sub.key)
            if (sub.publicReadOf) ws.data.publicSubscriptions.set(sub.key, sub.publicReadOf)
            else ws.data.publicSubscriptions.delete(sub.key)
            sendWS(ws, {_: 'subscribed', key: sub.key, accountId: sub.accountId})
            if (replay) {
              sendWS(ws, {_: 'change', key: `sessions/${replay.session.id}`, value: replay.session})
              for (const event of replay.events) {
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
            sendWS(ws, {
              _: 'error',
              message: error instanceof Error ? error.message : 'Invalid subscription',
              ...(error instanceof apisvc.APIError && error.code ? {code: error.code} : {}),
            })
          }
        })()
      },
      close(ws: ServerWebSocket<WSData>) {
        clients.delete(ws)
      },
    },
  })

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    console.log('Shutting down gracefully...')
    shuttingDown = true
    stopLoopLagGauge()
    execCanary.stop()
    activityMonitor.stop()
    scheduleMonitor.stop()
    mountNameSync.stop()
    await withTimeout(retentionTask.stop(), 2_000, 'stop retention').catch(() => {})
    appInstallMonitor.stop()
    for (const ws of clients) ws.close(1001, 'Server shutting down')
    clients.clear()
    // stop() waits for every open connection; clients whose sockets never finish closing would keep
    // the process alive forever with its listener already gone, so force-close after a grace period.
    await withTimeout(server.stop(), 3_000, 'stop http server').catch(() => server.stop(true))
    // Let in-flight background trigger runs finish their writes before closing the DB (bounded so a
    // stuck session can't block shutdown).
    await withTimeout(svc.drainTriggerSessions(), 5_000, 'drain trigger sessions').catch(() => {})
    svc.stopRunQueue()
    sqlite.closeDatabase(db)
    process.exit(0)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  const hostname = cfg.http.hostname === '0.0.0.0' ? 'localhost' : cfg.http.hostname
  console.log(`Agents server running at http://${hostname}:${server.port}`, {
    bootMs: Math.round(performance.now() - bootStartedAt),
  })
  console.log(`  Database: ${cfg.dbPath}`)
  console.log(`  WebSocket endpoint: ws://${hostname}:${server.port}${AGENTS_WS_PATHS[0]} (legacy /agents/ws)`)
  console.log(`  API: http://${hostname}:${server.port}/api/message`)
  console.log(`  HM API: ${cfg.activity.hmServerUrl}`)
  console.log(`  IPFS: ${cfg.activity.ipfsServerUrl}`)
  console.log(
    `  Knowledge base (hm://hyper.media): ${
      docsSpaceAccount() ?? (cfg.docs.accountFile ? `waiting for ${cfg.docs.accountFile}` : 'not configured')
    }`,
  )
  console.log(
    `  Web tools: search=${cfg.web.searxngUrl ? 'on' : 'off'} reader=${
      cfg.web.crawlerUrl ? 'static+crawl4ai' : 'static-only'
    }`,
  )
  // Serving already; the parked-run reconcile and receipt pruning run now, a step at a time.
  void svc.recoverAfterBoot()
}

function isCBORRequest(req: Request): boolean {
  return req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/cbor'
}

// Compiled executables don't reliably set import.meta.main (false on Windows in bun 1.3,
// oven-sh/bun#6009), so the binary build injects SEED_AGENTS_STANDALONE via define instead.
if (import.meta.main || process.env.SEED_AGENTS_STANDALONE === '1') {
  main()
}
