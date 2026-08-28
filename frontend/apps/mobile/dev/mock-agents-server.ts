/**
 * A mock agents server for developing and demoing the mobile agents UI without a model.
 *
 * It speaks the real protocol — the same signed DAG-CBOR action API and WebSocket subscription
 * protocol the Bun service implements — so the app under test is entirely real: the real signed
 * client, the real React Query models, the real chat row model, the real rendering. Only the thing
 * on the other end of the socket is fake.
 *
 * That makes it useful for the parts of the UI a live model makes *hard* to exercise on demand: a
 * reply that streams token by token, a tool call that stays pending for a while before resolving, a
 * plan whose steps advance, a delegated child, and a run that parks waiting for you to answer. Each
 * is scripted and deterministic, so the same prompt produces the same demo every time.
 *
 * Deliberately NOT implemented: signature verification. This process accepts any well-formed
 * envelope and trusts the account it names. That is exactly what a real agents server must never
 * do, which is why this lives under `dev/`, binds to loopback, and prints a warning on boot. Do not
 * deploy it, and do not copy its request handling into the service.
 *
 * Usage:
 *   bun frontend/apps/mobile/dev/mock-agents-server.ts        # serves :3052
 *   …then point the app's agent server at http://localhost:3052
 */

import * as cbor from '@shm/shared/cbor'
import type {
  AgentInfo,
  RunInfo,
  RunPlanStep,
  SessionEvent,
  SessionEventPayload,
  SessionInfo,
} from '@seed-hypermedia/agents-protocol'

const PORT = Number(process.env.MOCK_AGENTS_PORT ?? 3052)
const BOOT_TIME = Date.now()

// ─── State ───────────────────────────────────────────────────────────────────

type MockSession = {
  info: SessionInfo
  events: SessionEvent[]
  seq: number
}

const AGENT_ID = 'mock-agent-1'
const sessions = new Map<string, MockSession>()
const runs = new Map<string, RunInfo>()
/** Open subscriptions, keyed by subscription key (`sessions/<id>`, `runs/<id>`, …). */
const subscribers = new Map<string, Set<{send: (data: string) => void}>>()

function agentFor(account: string): AgentInfo {
  return {
    id: AGENT_ID,
    account,
    definition: {
      name: 'Mock',
      systemPrompt: 'A scripted agent used to demo the mobile UI without spending a model call.',
      modelProvider: 'Mock provider',
      model: 'mock-1',
      tools: ['search', 'web_search', 'execute', 'publish'],
    },
    stateDir: '/tmp/mock-agent',
    status: 'idle',
    createdAt: BOOT_TIME,
    updatedAt: BOOT_TIME,
    accessRole: 'owner',
  }
}

// ─── Broadcast ───────────────────────────────────────────────────────────────

function broadcast(key: string, event: Record<string, unknown>): void {
  const payload = JSON.stringify(event)
  for (const socket of subscribers.get(key) ?? []) socket.send(payload)
}

/** Appends a durable event and pushes it to subscribers, exactly as the service does. */
function append(session: MockSession, payload: SessionEventPayload): SessionEvent {
  session.seq += 1
  const event: SessionEvent = {
    id: `${session.info.id}-${session.seq}`,
    sessionId: session.info.id,
    seq: session.seq,
    event: payload,
    createdAt: Date.now(),
  }
  session.events.push(event)
  session.info.updatedAt = event.createdAt
  broadcast(`sessions/${session.info.id}`, {_: 'append', key: `sessions/${session.info.id}`, event})
  return event
}

function setSessionStatus(session: MockSession, status: SessionInfo['status']): void {
  session.info.status = status
  broadcast(`sessions/${session.info.id}`, {_: 'change', key: `sessions/${session.info.id}`, value: session.info})
}

function putRun(run: RunInfo): void {
  runs.set(run.id, run)
  broadcast(`runs/${run.rootRunId}`, {_: 'change', key: `runs/${run.rootRunId}`, value: run})
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ─── The scripted turns ──────────────────────────────────────────────────────

/**
 * Picks a script from the user's message. Keywords rather than parsing, so a demo can reach a
 * specific behaviour on purpose ("plan this", "delegate this") while anything else gets the simple
 * streaming reply.
 */
function scriptFor(text: string): 'plan' | 'tool' | 'park' | 'simple' {
  const lower = text.toLowerCase()
  if (lower.includes('plan')) return 'plan'
  if (lower.includes('search') || lower.includes('read') || lower.includes('tool')) return 'tool'
  if (lower.includes('ask me') || lower.includes('approve')) return 'park'
  return 'simple'
}

/** Streams an assistant message the way the runtime does: partials, then one durable event. */
async function streamAssistant(session: MockSession, text: string, runId: string): Promise<void> {
  const key = `sessions/${session.info.id}`
  const partialId = `${runId}-partial-${session.seq + 1}`
  // Chunk on word boundaries so markdown structure arrives progressively, which is what makes the
  // renderer's tolerance for half-finished syntax worth testing.
  const chunks = text.match(/\S+\s*/g) ?? [text]
  for (const chunk of chunks) {
    broadcast(key, {_: 'appendPartial', key, partialId, patch: {textDelta: chunk, activity: {phase: 'responding'}}})
    await sleep(45)
  }
  broadcast(key, {_: 'appendPartial', key, partialId, patch: {done: true}})
  append(session, {type: 'message', role: 'assistant', content: text, actor: 'agent'})
}

async function runToolCall(
  session: MockSession,
  call: {id: string; name: string; input: unknown; output: unknown; pendingMs?: number},
): Promise<void> {
  append(session, {type: 'tool_call', id: call.id, name: call.name, input: call.input, actor: 'agent'})
  // A visible pending window is the point: it is what proves the row renders its spinner and then
  // settles, which a fast tool never demonstrates.
  await sleep(call.pendingMs ?? 900)
  append(session, {type: 'tool_result', toolCallId: call.id, name: call.name, output: call.output, actor: 'agent'})
}

/** Runs one scripted turn in the background, mutating the session as a real run would. */
async function runTurn(session: MockSession, userText: string, account: string): Promise<void> {
  const script = scriptFor(userText)
  const runId = `run-${session.info.id}-${session.seq}`
  const now = Date.now()

  const run: RunInfo = {
    id: runId,
    account,
    rootRunId: runId,
    depth: 0,
    kind: 'agent',
    agentId: AGENT_ID,
    sessionId: session.info.id,
    origin: 'user',
    title: userText.slice(0, 60),
    status: 'running',
    createdAt: now,
    startedAt: now,
    updatedAt: now,
  }
  putRun(run)
  setSessionStatus(session, 'streaming')

  try {
    if (script === 'plan') {
      const steps: RunPlanStep[] = [
        {id: 's1', label: 'Read the source material', status: 'running'},
        {id: 's2', label: 'Draft the summary', status: 'pending'},
        {id: 's3', label: 'Check it against the original', status: 'pending'},
      ]
      // `ownerRunId` is stamped by the server, never accepted from model input. Without it the
      // client cannot tell which turn a session-level plan belongs to, and the completed checklist
      // freezes at the run's finish time — i.e. after the closing answer instead of before it.
      run.plan = {title: 'Summarise the document', steps, ownerRunId: runId}
      session.info.plan = run.plan
      putRun({...run})
      await streamAssistant(session, "I'll work through this in three steps.", runId)

      for (let index = 0; index < steps.length; index++) {
        await sleep(700)
        steps[index] = {...steps[index], status: 'done'}
        if (steps[index + 1]) steps[index + 1] = {...steps[index + 1], status: 'running'}
        // The third step closes itself the way the runtime does when its children all succeed —
        // which the card must mark `auto` rather than crediting to the agent.
        if (index === 2) steps[index] = {...steps[index], status: 'done', resolvedBy: 'runtime'}
        run.plan = {title: 'Summarise the document', steps: [...steps], ownerRunId: runId}
        session.info.plan = run.plan
        putRun({...run})
      }
      // Stamped BEFORE the closing answer is appended, so the frozen card lands above it — the
      // checklist finished telling its story first, and the answer is the final state the reader
      // is left on.
      run.plan = {...run.plan!, settledAt: Date.now()}
      session.info.plan = run.plan
      putRun({...run})
      await sleep(50)
      await streamAssistant(session, 'Done — all three steps are settled.', runId)
    } else if (script === 'tool') {
      await streamAssistant(session, 'Let me look that up.', runId)
      await runToolCall(session, {
        id: `${runId}-call-1`,
        name: 'read',
        input: {address: 'hm://z6MkmZUb4K5c17zGGBuJJerwFzBaGkiYLfEEnkb9CH1W1ptb'},
        output: {title: 'Onyx', type: 'hypermedia_document', markdown: '# Onyx\n\nA self-describing type system.'},
      })
      await streamAssistant(
        session,
        'That resolves to **Onyx**, a self-describing IPLD type system. The `read` verb took the `hm://` address directly — no separate fetch tool.',
        runId,
      )
    } else if (script === 'park') {
      await streamAssistant(session, 'Before I continue I need you to confirm.', runId)
      run.status = 'waiting'
      run.wait = {reason: 'event', label: 'your approval', answerWith: 'approved'}
      run.updatedAt = Date.now()
      putRun({...run})
      setSessionStatus(session, 'idle')
      // Stays parked until SignalRun arrives — waiting is free, so nothing is scheduled here.
      return
    } else {
      await streamAssistant(
        session,
        [
          'The Harness is built on three nouns:',
          '',
          '1. **Space** — everything an agent _has_: `~/memory/`, `~/tools/`, `~/triggers/`, `~/self`.',
          '2. **Log** — everything that _happened_, append-only, every event stamped with an actor.',
          '3. **Runs** — everything that _executes_; the table doubles as the dispatch queue.',
          '',
          'The five verbs over them are `read`, `write`, `call`, `delegate` and `plan`.',
        ].join('\n'),
        runId,
      )
    }

    run.status = 'succeeded'
    run.finishedAt = Date.now()
    run.updatedAt = run.finishedAt
    run.usage = {input: 1840, output: 260, cacheRead: 0, cacheWrite: 0, total: 2100}
    putRun({...run})
    setSessionStatus(session, 'idle')
  } catch (error) {
    run.status = 'failed'
    run.error = {code: 'mock_error', message: error instanceof Error ? error.message : String(error)}
    run.finishedAt = Date.now()
    putRun({...run})
    append(session, {type: 'error', message: run.error.message, actor: 'system'})
    setSessionStatus(session, 'error')
  }
}

/** Resumes a parked run when the card's Answer button signals it. */
async function resumeParkedRun(run: RunInfo): Promise<void> {
  const session = run.sessionId ? sessions.get(run.sessionId) : undefined
  if (!session) return
  run.status = 'running'
  run.wait = undefined
  run.updatedAt = Date.now()
  putRun({...run})
  setSessionStatus(session, 'streaming')
  await streamAssistant(session, 'Thanks — carrying on with that confirmed.', run.id)
  run.status = 'succeeded'
  run.finishedAt = Date.now()
  run.updatedAt = run.finishedAt
  putRun({...run})
  setSessionStatus(session, 'idle')
}

// ─── Action handling ─────────────────────────────────────────────────────────

function handleAction(action: Record<string, any>, account: string): Record<string, unknown> {
  switch (action._) {
    case 'ListAgents':
      return {_: 'ListAgentsResponse', agents: [agentFor(account)]}

    case 'GetAgent':
      return {
        _: 'GetAgentResponse',
        agent: agentFor(account),
        sessions: [...sessions.values()].map((session) => session.info).sort((a, b) => b.updatedAt - a.updatedAt),
      }

    case 'ListModelProviders':
      return {
        _: 'ListModelProvidersResponse',
        providers: [
          {
            id: 'mock-provider',
            name: 'Mock provider',
            type: 'custom',
            hasSecrets: true,
            createdAt: BOOT_TIME,
            updatedAt: BOOT_TIME,
          },
        ],
      }

    case 'ListProviderModels':
      return {_: 'ListProviderModelsResponse', models: [{id: 'mock-1', name: 'Mock 1'}]}

    case 'ListSessions':
      return {
        _: 'ListSessionsResponse',
        sessions: [...sessions.values()]
          .map((session) => session.info)
          .filter((info) => !info.parentSessionId)
          .sort((a, b) => b.updatedAt - a.updatedAt),
        agents: [agentFor(account)],
      }

    case 'CreateSession': {
      const id = `session-${sessions.size + 1}`
      const now = Date.now()
      const session: MockSession = {
        info: {id, account, agentId: AGENT_ID, status: 'idle', createdAt: now, updatedAt: now},
        events: [],
        seq: 0,
      }
      sessions.set(id, session)
      return {_: 'CreateSessionResponse', sessionId: id}
    }

    case 'GetSession': {
      const session = sessions.get(action.sessionId)
      if (!session) return {_: 'Error', message: `No such session: ${action.sessionId}`}
      return {
        _: 'GetSessionResponse',
        session: session.info,
        events: session.events,
        systemPromptMarkdown: agentFor(account).definition.systemPrompt as string,
      }
    }

    case 'UpdateSession': {
      const session = sessions.get(action.sessionId)
      if (!session) return {_: 'Error', message: `No such session: ${action.sessionId}`}
      if (typeof action.title === 'string') session.info.title = action.title
      return {_: 'UpdateSessionResponse', session: session.info}
    }

    case 'MessageSession': {
      const session = sessions.get(action.sessionId)
      if (!session) return {_: 'Error', message: `No such session: ${action.sessionId}`}
      const parts: any[] = action.content ?? []
      const text = parts
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      const clientMessageId = parts.find((part) => part.type === 'text')?.clientMessageId
      append(session, {type: 'message', role: 'user', content: text, actor: 'user', clientMessageId})
      if (!session.info.title) session.info.title = text.slice(0, 60)
      // Detached on purpose: the action returns immediately and the turn plays out over the socket,
      // which is the behaviour the client is written against.
      void runTurn(session, text, account)
      return {_: 'MessageSessionResponse', sessionId: session.info.id}
    }

    case 'ListRuns': {
      const all = [...runs.values()]
      if (action.rootRunId) return {_: 'ListRunsResponse', runs: all.filter((r) => r.rootRunId === action.rootRunId)}
      if (action.sessionId) {
        // Root runs only, matching the service: the card looks up the tree separately.
        return {
          _: 'ListRunsResponse',
          runs: all.filter((r) => r.sessionId === action.sessionId && r.id === r.rootRunId),
        }
      }
      return {_: 'ListRunsResponse', runs: all}
    }

    case 'GetRun': {
      const run = runs.get(action.runId)
      return run ? {_: 'GetRunResponse', run} : {_: 'Error', message: `No such run: ${action.runId}`}
    }

    case 'GetRunJournal':
      return {_: 'GetRunJournalResponse', entries: []}

    case 'SignalRun': {
      const run = runs.get(action.runId)
      if (!run) return {_: 'Error', message: `No such run: ${action.runId}`}
      void resumeParkedRun(run)
      return {_: 'SignalRunResponse', runId: run.id, delivered: true}
    }

    case 'CancelRun': {
      const run = runs.get(action.runId)
      if (!run) return {_: 'Error', message: `No such run: ${action.runId}`}
      const wasLive = run.status !== 'succeeded' && run.status !== 'failed' && run.status !== 'canceled'
      run.status = 'canceled'
      run.finishedAt = Date.now()
      putRun({...run})
      if (run.sessionId) {
        const session = sessions.get(run.sessionId)
        if (session) setSessionStatus(session, 'idle')
      }
      return {_: 'CancelRunResponse', runId: run.id, canceled: wasLive}
    }

    case 'StopSession': {
      const session = sessions.get(action.sessionId)
      if (session) setSessionStatus(session, 'idle')
      return {_: 'StopSessionResponse', sessionId: action.sessionId}
    }

    case 'DeleteSession':
      sessions.delete(action.sessionId)
      return {_: 'DeleteSessionResponse', sessionId: action.sessionId}

    case 'ListAgentInvites':
      return {_: 'ListAgentInvitesResponse', invites: []}

    case 'ListAgentTriggers':
      return {_: 'ListAgentTriggersResponse', triggers: []}

    case 'ListAgentTools':
      return {_: 'ListAgentToolsResponse', tools: []}

    case 'ListSigningIdentities':
      return {_: 'ListSigningIdentitiesResponse', identities: []}

    default:
      return {_: 'Error', message: `Mock server does not implement ${action._}`}
  }
}

// ─── Server ──────────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

/**
 * Reads the account out of a signed envelope WITHOUT verifying the signature.
 * See the file header: this is a development fixture, not an authorization boundary.
 */
function accountFromEnvelope(envelope: any): string {
  const principal = envelope?.account
  if (principal instanceof Uint8Array) {
    // Rendering the principal is not needed to serve the mock; a stable string per caller is.
    return `mock-account-${principal.length}`
  }
  return 'mock-account'
}

const server = Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',

  async fetch(request, server) {
    const url = new URL(request.url)

    if (request.method === 'OPTIONS') return new Response(null, {headers: CORS_HEADERS})

    if (url.pathname === '/agents/ws') {
      if (server.upgrade(request)) return undefined
      return new Response('Expected a WebSocket upgrade', {status: 400})
    }

    if (url.pathname === '/agents/api/health' || url.pathname === '/api/health') {
      return Response.json(
        {
          status: 'ok',
          uptime: (Date.now() - BOOT_TIME) / 1000,
          version: 'mock',
          webTools: {search: true, readBrowser: true},
          codeExec: false,
          codeExecReason: 'The mock server does not run sandboxes.',
        },
        {headers: CORS_HEADERS},
      )
    }

    if (url.pathname === '/api/message' || url.pathname === '/agents/api/message') {
      const envelope = cbor.decode<any>(new Uint8Array(await request.arrayBuffer()))
      const response = handleAction(envelope.action ?? {}, accountFromEnvelope(envelope))
      return new Response(cbor.encode(response) as BodyInit, {
        headers: {'Content-Type': 'application/cbor', ...CORS_HEADERS},
      })
    }

    return new Response('Not found', {status: 404, headers: CORS_HEADERS})
  },

  websocket: {
    message(socket, raw) {
      // The subscribe handshake is a signed CBOR envelope, same as an HTTP action.
      // Bun hands binary frames over as a Buffer, which is already a Uint8Array view.
      const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : new Uint8Array(raw)
      let key: string
      try {
        key = cbor.decode<any>(bytes)?.action?.key
      } catch {
        socket.send(JSON.stringify({_: 'error', message: 'Malformed subscribe envelope'}))
        return
      }
      if (!key) {
        socket.send(JSON.stringify({_: 'error', message: 'Subscribe requires a key'}))
        return
      }
      let set = subscribers.get(key)
      if (!set) {
        set = new Set()
        subscribers.set(key, set)
      }
      set.add(socket as never)
      socket.send(JSON.stringify({_: 'connected', connectedAt: Date.now()}))
      socket.send(JSON.stringify({_: 'subscribed', key, accountId: 'mock-account'}))

      // Replay, so a reload rebuilds the screen from the server exactly as the real one does.
      const sessionMatch = /^sessions\/(.+)$/.exec(key)
      if (sessionMatch) {
        const session = sessions.get(sessionMatch[1])
        for (const event of session?.events ?? []) socket.send(JSON.stringify({_: 'append', key, event}))
      }
      const runMatch = /^runs\/(.+)$/.exec(key)
      if (runMatch) {
        for (const run of runs.values()) {
          if (run.rootRunId === runMatch[1]) socket.send(JSON.stringify({_: 'change', key, value: run}))
        }
      }
    },
    close(socket) {
      for (const set of subscribers.values()) set.delete(socket as never)
    },
  },
})

console.log(`Mock agents server on http://localhost:${server.port}`)
console.log('  WARNING: signatures are NOT verified. Development only; never expose this port.')
console.log('  Point the mobile app at this URL, then try:')
console.log('    "what are the three nouns?"  → a streamed markdown reply')
console.log('    "read that document"         → a tool call that renders pending, then resolves')
console.log('    "plan the summary"           → a live checklist, including a runtime-settled step')
console.log('    "ask me before continuing"   → a parked run with an Answer button')
