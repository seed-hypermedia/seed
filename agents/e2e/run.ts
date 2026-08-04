/**
 * Tier-3 live-model validation harness (workflows-v1-plan.md §15.3).
 *
 * Drives the REAL Service against the REAL OpenAI API to validate prompt and tool designs with an
 * actual model: does it use sub_session/run_workflow/update_plan correctly, do typed results
 * validate, does park/resume hold up outside mocks. Assertions are on durable state (runs, journal,
 * session events), never on eyeballed prose. Spends real tokens — a manual gate, not a bun test.
 *
 * Usage:
 *   bun e2e/run.ts all
 *   bun e2e/run.ts sub-basic wf-hello --model gpt-5-mini --n 1
 *
 * The API key comes from OPENAI_API_KEY or the repo-root .keys file. Full transcripts land in
 * agents/e2e-artifacts/<timestamp>/ for prompt-design autopsies.
 */
import {Database} from 'bun:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as apisvc from '../src/api-service'
import * as sqlite from '../src/sqlite'
import * as blobs from '@shm/shared/blobs'
import type * as api from '../src/api'

const args = process.argv.slice(2)
const flags = new Map<string, string>()
const positional: string[] = []
for (let i = 0; i < args.length; i++) {
  const arg = args[i]!
  if (arg.startsWith('--')) {
    flags.set(arg.slice(2), args[i + 1] ?? '')
    i += 1
  } else {
    positional.push(arg)
  }
}
const MODEL = flags.get('model') || 'gpt-5-mini'
const REPS = Number(flags.get('n') || '1')
const SCENARIO_TIMEOUT_MS = Number(flags.get('timeout') || '240000')
/**
 * Modes: replay (default) serves recorded model responses from e2e/recordings — no live model,
 * safe for CI. `--record` forwards to the real OpenAI API and (re)writes the recordings; it is the
 * only mode that spends tokens or needs a key.
 */
const RECORD = args.includes('--record')
const RECORDINGS_DIR = path.join(import.meta.dir, 'recordings')
const PROXY_PORT = Number(flags.get('proxy-port') || '45899')

function loadApiKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY
  const keysPath = path.join(import.meta.dir, '..', '..', '.keys')
  if (fs.existsSync(keysPath)) {
    for (const line of fs.readFileSync(keysPath, 'utf8').split('\n')) {
      const match = /^OPENAI_API_KEY\s*=\s*(.+)$/.exec(line.trim())
      if (match) return match[1]!.trim().replace(/^"|"$/g, '')
    }
  }
  throw new Error('OPENAI_API_KEY not found in env or ../.keys (needed only for --record)')
}

const API_KEY = RECORD ? loadApiKey() : ''
const ARTIFACT_DIR = path.join(import.meta.dir, '..', 'e2e-artifacts', new Date().toISOString().replace(/[:.]/g, '-'))
fs.mkdirSync(ARTIFACT_DIR, {recursive: true})

// ─── Record/replay proxy ─────────────────────────────────────────────────────
// The service talks to a local OpenAI-compatible proxy. Recording forwards upstream and captures
// the full SSE body per request; replay serves the recording matched by a content fingerprint that
// is stable across runs (volatile lines like the current-time prompt are stripped before hashing).

type Cassette = {
  fingerprint: string
  request: {model?: string; systemHead: string; lastUser: string; toolNames: string[]; toolResultCount: number}
  status: number
  body: string
}

let currentScenario = 'unscoped'
const recorded = new Map<string, Cassette[]>()
/** Per-fingerprint serve cursor so repeated identical requests replay in recorded order. */
let replayCursors = new Map<string, number>()
let replayCassettes: Cassette[] = []

function cassettePath(scenario: string): string {
  return path.join(RECORDINGS_DIR, `${scenario}.json`)
}

function requestFingerprint(body: {
  model?: string
  messages?: Array<{role?: string; content?: unknown}>
  tools?: Array<{function?: {name?: string}}>
}): {fingerprint: string; request: Cassette['request']} {
  const messages = body.messages ?? []
  const system = String(messages[0]?.content ?? '')
    .split('\n')
    .filter((line) => !line.startsWith('The current time is:'))
    .join('\n')
    .slice(0, 2000)
  const lastUser = String([...messages].reverse().find((message) => message.role === 'user')?.content ?? '').slice(
    0,
    2000,
  )
  const toolNames = (body.tools ?? []).map((tool) => tool.function?.name ?? '').sort()
  const toolResultCount = messages.filter((message) => message.role === 'tool').length
  const request = {model: body.model, systemHead: system, lastUser, toolNames, toolResultCount}
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(JSON.stringify(request))
  return {fingerprint: hasher.digest('hex').slice(0, 24), request}
}

function loadReplayCassettes(scenario: string): void {
  const file = cassettePath(scenario)
  if (!fs.existsSync(file)) {
    throw new Error(`No recording for scenario "${scenario}" (${file}). Run: bun e2e/run.ts ${scenario} --record`)
  }
  replayCassettes = JSON.parse(fs.readFileSync(file, 'utf8')) as Cassette[]
  replayCursors = new Map()
}

function flushRecordings(scenario: string): void {
  const cassettes = recorded.get(scenario)
  if (!cassettes) return
  fs.mkdirSync(RECORDINGS_DIR, {recursive: true})
  fs.writeFileSync(cassettePath(scenario), JSON.stringify(cassettes, null, 2))
  recorded.delete(scenario)
}

Bun.serve({
  port: PROXY_PORT,
  async fetch(req) {
    const url = new URL(req.url)
    if (!url.pathname.endsWith('/chat/completions')) return new Response('not found', {status: 404})
    const rawBody = await req.text()
    const parsed = JSON.parse(rawBody) as Parameters<typeof requestFingerprint>[0]
    const {fingerprint, request} = requestFingerprint(parsed)
    if (RECORD) {
      const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {'content-type': 'application/json', authorization: `Bearer ${API_KEY}`},
        body: rawBody,
      })
      const body = await upstream.text()
      const list = recorded.get(currentScenario) ?? []
      list.push({fingerprint, request, status: upstream.status, body})
      recorded.set(currentScenario, list)
      return new Response(body, {
        status: upstream.status,
        headers: {'content-type': upstream.headers.get('content-type') ?? 'text/event-stream'},
      })
    }
    const matches = replayCassettes.filter((cassette) => cassette.fingerprint === fingerprint)
    if (matches.length === 0) {
      console.error(`[replay-miss] scenario=${currentScenario} fp=${fingerprint}`)
      console.error(`  wanted: ${JSON.stringify(request).slice(0, 300)}`)
      for (const cassette of replayCassettes.slice(0, 8)) {
        console.error(`  have fp=${cassette.fingerprint}: ${JSON.stringify(cassette.request).slice(0, 160)}`)
      }
      return new Response('data: [DONE]\n\n', {status: 500, headers: {'content-type': 'text/event-stream'}})
    }
    const cursor = replayCursors.get(fingerprint) ?? 0
    const cassette = matches[Math.min(cursor, matches.length - 1)]!
    replayCursors.set(fingerprint, cursor + 1)
    return new Response(cassette.body, {
      status: cassette.status,
      headers: {'content-type': 'text/event-stream'},
    })
  },
})

type Harness = {
  svc: apisvc.Service
  account: blobs.Signer
  send: (action: unknown) => Promise<api.AgentResponse>
  createAgent: (definition: Record<string, unknown>) => Promise<string>
  createSession: (agentId: string) => Promise<string>
  message: (sessionId: string, text: string) => Promise<api.AgentResponse>
  sessionEvents: (sessionId: string) => Promise<api.SessionEvent[]>
  sessionInfo: (sessionId: string) => Promise<api.SessionInfo>
  runsForSession: (sessionId: string) => Promise<api.RunInfo[]>
  runTree: (rootRunId: string) => Promise<api.RunInfo[]>
  journal: (runId: string) => Promise<api.RunJournalEntryInfo[]>
  listChildren: (sessionId: string) => Promise<api.SessionInfo[]>
  drain: () => Promise<void>
  cleanup: () => void
}

async function createHarness(): Promise<Harness> {
  const db = new Database(':memory:', {create: true, strict: true})
  const opened = sqlite.openWithDatabase(db)
  if (!opened.ok) throw new Error('schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-e2e-'))
  const account = blobs.generateNobleKeyPair()
  const svc = new apisvc.Service(db, dataDir, {titleGeneration: true})
  const send = async (action: unknown): Promise<api.AgentResponse> =>
    svc.message(await apisvc.createSignedEnvelope(account, {action} as never))
  const expectType = <T extends api.AgentResponse['_']>(response: api.AgentResponse, type: T) => {
    if (response._ !== type) throw new Error(`Expected ${type}, got ${response._}: ${JSON.stringify(response)}`)
    return response as Extract<api.AgentResponse, {_: T}>
  }
  // All model traffic rides the local record/replay proxy; only --record touches the real API.
  await send({
    _: 'SetModelProvider',
    name: 'openai',
    provider: {type: 'custom', baseUrl: `http://127.0.0.1:${PROXY_PORT}/v1`},
  })
  return {
    svc,
    account,
    send,
    createAgent: async (definition) =>
      expectType(await send({_: 'CreateAgent', definition}), 'CreateAgentResponse').agentId,
    createSession: async (agentId) =>
      expectType(await send({_: 'CreateSession', agentId}), 'CreateSessionResponse').sessionId,
    message: (sessionId, text) => send({_: 'MessageSession', sessionId, content: [{type: 'text', text}]}),
    sessionEvents: async (sessionId) =>
      expectType(await send({_: 'GetSession', sessionId}), 'GetSessionResponse').events,
    sessionInfo: async (sessionId) =>
      expectType(await send({_: 'GetSession', sessionId}), 'GetSessionResponse').session,
    runsForSession: async (sessionId) => expectType(await send({_: 'ListRuns', sessionId}), 'ListRunsResponse').runs,
    runTree: async (rootRunId) => expectType(await send({_: 'ListRuns', rootRunId}), 'ListRunsResponse').runs,
    journal: async (runId) => expectType(await send({_: 'GetRunJournal', runId}), 'GetRunJournalResponse').entries,
    listChildren: async (sessionId) =>
      expectType(await send({_: 'ListSessions', parentSessionId: sessionId}), 'ListSessionsResponse').sessions,
    drain: () => svc.awaitQueueIdle(),
    cleanup: () => {
      svc.stopRunQueue()
      db.close()
      fs.rmSync(dataDir, {recursive: true, force: true})
    },
  }
}

type CheckFailure = string
type ScenarioResult = {pass: boolean; failures: CheckFailure[]; notes: string[]}

class Checks {
  failures: CheckFailure[] = []
  notes: string[] = []
  that(condition: boolean, description: string): void {
    if (!condition) this.failures.push(description)
  }
  note(text: string): void {
    this.notes.push(text)
  }
}

function eventTypes(events: api.SessionEvent[]): Array<{type?: string; name?: string}> {
  return events.map((event) => event.event as {type?: string; name?: string})
}

function toolCalls(events: api.SessionEvent[], toolName?: string) {
  return events
    .map((event) => event.event as {type?: string; name?: string; id?: string; input?: unknown})
    .filter((event) => event.type === 'tool_call' && (toolName === undefined || event.name === toolName))
}

function toolResults(events: api.SessionEvent[], toolName?: string) {
  return events
    .map(
      (event) => event.event as {type?: string; name?: string; toolCallId?: string; output?: unknown; error?: string},
    )
    .filter((event) => event.type === 'tool_result' && (toolName === undefined || event.name === toolName))
}

function lastAssistantText(events: api.SessionEvent[]): string {
  const messages = events
    .map((event) => event.event as {type?: string; role?: string; content?: string})
    .filter((event) => event.type === 'message' && event.role === 'assistant')
  return messages.at(-1)?.content ?? ''
}

const SCENARIOS: Record<string, (checks: Checks) => Promise<void>> = {
  /** Phase 1 gate: plain conversation through the queue path. */
  'chat-smoke': async (checks) => {
    const h = await createHarness()
    try {
      const agentId = await h.createAgent({
        name: 'Smoke',
        systemPrompt: 'You are terse. Answer in one short sentence.',
        modelProvider: 'openai',
        model: MODEL,
        tools: [],
      })
      const sessionId = await h.createSession(agentId)
      await h.message(sessionId, 'What is the capital of France? One word.')
      await h.drain()
      const events = await h.sessionEvents(sessionId)
      const answer = lastAssistantText(events)
      checks.that(/paris/i.test(answer), `answer mentions Paris (got: ${answer.slice(0, 80)})`)
      const runs = await h.runsForSession(sessionId)
      checks.that(runs.length === 1 && runs[0]!.status === 'succeeded', 'one succeeded run recorded')
      checks.that((runs[0]!.usage?.total ?? 0) > 0, 'usage persisted on the run')
      dumpArtifact('chat-smoke', {events, runs})
    } finally {
      h.cleanup()
    }
  },

  /** Phase 2 gate: the model delegates via sub_session, parks, and uses the child's result. */
  'sub-basic': async (checks) => {
    const h = await createHarness()
    try {
      const agentId = await h.createAgent({
        name: 'Coordinator',
        systemPrompt: 'You coordinate work. Keep final answers under four sentences.',
        modelProvider: 'openai',
        model: MODEL,
        tools: ['sub_session'],
      })
      const sessionId = await h.createSession(agentId)
      await h.message(
        sessionId,
        'Delegate this to a sub-session rather than doing it yourself: write a two-line rhyming couplet about databases. Then tell me what the sub-session produced.',
      )
      await h.drain()
      const events = await h.sessionEvents(sessionId)
      const calls = toolCalls(events, 'sub_session')
      const results = toolResults(events, 'sub_session')
      checks.that(calls.length >= 1, `model called sub_session (${calls.length} calls)`)
      checks.that(
        results.every((result) => (result.output as {status?: string} | undefined)?.status === 'succeeded'),
        'every sub-session resolved succeeded',
      )
      const runs = await h.runsForSession(sessionId)
      const tree = runs.length > 0 ? await h.runTree(runs[0]!.id) : []
      checks.that(
        tree.some((run) => run.depth === 1 && run.status === 'succeeded'),
        'child run in the tree succeeded',
      )
      const children = await h.listChildren(sessionId)
      checks.that(children.length >= 1, 'child session nested under the parent')
      checks.that(lastAssistantText(events).length > 0, 'parent produced a final answer after resuming')
      dumpArtifact('sub-basic', {events, tree, children})
    } finally {
      h.cleanup()
    }
  },

  /** Phase 2 gate: typed sub_session result via return_result validation. */
  'sub-typed': async (checks) => {
    const h = await createHarness()
    try {
      const agentId = await h.createAgent({
        name: 'TypedCoordinator',
        systemPrompt: 'You coordinate work and prefer structured results.',
        modelProvider: 'openai',
        model: MODEL,
        tools: ['sub_session'],
      })
      const sessionId = await h.createSession(agentId)
      await h.message(
        sessionId,
        'Use a sub-session to estimate how many piano tuners work in Chicago. Require a structured result from it by declaring an output schema with fields: estimate (number) and reasoning (string). Then report the estimate to me.',
      )
      await h.drain()
      const events = await h.sessionEvents(sessionId)
      const calls = toolCalls(events, 'sub_session')
      checks.that(calls.length >= 1, 'model called sub_session')
      const declaredSchema = calls.some((call) => {
        const input = call.input as {output?: unknown} | undefined
        return input?.output !== undefined && typeof input.output === 'object'
      })
      checks.that(declaredSchema, 'model declared an output schema on the spawn')
      const results = toolResults(events, 'sub_session')
      const typedOutput = results
        .map((result) => result.output as {status?: string; output?: Record<string, unknown>} | undefined)
        .find((output) => output?.status === 'succeeded')?.output
      checks.that(
        typeof typedOutput === 'object' &&
          typedOutput !== null &&
          typeof (typedOutput as {estimate?: unknown}).estimate === 'number',
        `typed payload has a numeric estimate (got: ${JSON.stringify(typedOutput).slice(0, 120)})`,
      )
      dumpArtifact('sub-typed', {events})
    } finally {
      h.cleanup()
    }
  },

  /** Phase 2 guard: trivial prompts must not spawn sub-sessions. */
  'sub-restraint': async (checks) => {
    const h = await createHarness()
    try {
      const agentId = await h.createAgent({
        name: 'Restrained',
        systemPrompt: 'You are a helpful, efficient assistant.',
        modelProvider: 'openai',
        model: MODEL,
        tools: ['sub_session'],
      })
      const sessionId = await h.createSession(agentId)
      await h.message(sessionId, 'What is 17 + 25?')
      await h.drain()
      const events = await h.sessionEvents(sessionId)
      const calls = toolCalls(events, 'sub_session')
      checks.that(calls.length === 0, `no sub_session for trivial arithmetic (got ${calls.length})`)
      checks.that(/42/.test(lastAssistantText(events)), 'answered 42 directly')
      dumpArtifact('sub-restraint', {events})
    } finally {
      h.cleanup()
    }
  },

  /** Phase 3 gate: the model authors a working workflow first try. */
  'wf-hello': async (checks) => {
    const h = await createHarness()
    try {
      const agentId = await h.createAgent({
        name: 'WorkflowAuthor',
        systemPrompt: 'You orchestrate multi-step work with workflows when asked.',
        modelProvider: 'openai',
        model: MODEL,
        tools: ['run_workflow', 'memory_write', 'memory_list'],
      })
      const sessionId = await h.createSession(agentId)
      await h.message(
        sessionId,
        'Use a workflow (run_workflow) for this: run two sub-agents in parallel — one lists three uses of SQLite, one lists three uses of Postgres — then combine both lists into a memory file at notes/databases.md and return a summary object {sqlite: string, postgres: string, file: string}. Use ctx.step so I can follow along.',
      )
      await h.drain()
      const events = await h.sessionEvents(sessionId)
      const calls = toolCalls(events, 'run_workflow')
      checks.that(calls.length >= 1, 'model called run_workflow')
      const results = toolResults(events, 'run_workflow')
      const succeeded = results.some(
        (result) => (result.output as {status?: string} | undefined)?.status === 'succeeded',
      )
      const lintRejected = results.some((result) => result.error?.includes('Workflow source rejected'))
      checks.that(!lintRejected || succeeded, 'lint passed (eventually) and the workflow ran')
      checks.that(succeeded, 'workflow resolved succeeded')
      const runs = await h.runsForSession(sessionId)
      const tree = runs.length > 0 ? await h.runTree(runs[0]!.id) : []
      const workflowRuns = tree.filter((run) => run.kind === 'workflow')
      const workflowRun = workflowRuns.find((run) => run.status === 'succeeded') ?? workflowRuns.at(-1)
      checks.that(workflowRun !== undefined, 'workflow run exists in the tree')
      if (workflowRun) {
        const journal = await h.journal(workflowRun.id)
        const kinds = journal.map((entry) => entry.entry.kind)
        checks.that(kinds.includes('call'), 'journal has effect calls')
        checks.that(
          tree.filter((run) => run.kind === 'agent' && run.parentRunId === workflowRun.id).length >= 2,
          'workflow spawned at least two sub-agents',
        )
        checks.note(`journal entries: ${journal.length}; workflow status: ${workflowRun.status}`)
      }
      dumpArtifact('wf-hello', {events, tree})
    } finally {
      h.cleanup()
    }
  },

  /** Phase 4 gate: the model maintains a todo list on a multi-step task. */
  'todo-adoption': async (checks) => {
    const h = await createHarness()
    try {
      const agentId = await h.createAgent({
        name: 'Planner',
        systemPrompt: 'You are a careful assistant who keeps the user informed of progress.',
        modelProvider: 'openai',
        model: MODEL,
        tools: ['memory_write', 'memory_list'],
      })
      const sessionId = await h.createSession(agentId)
      await h.message(
        sessionId,
        'Do these in order: (1) create memory file plans/a.md with a haiku about spring, (2) create plans/b.md with a haiku about autumn, (3) create plans/index.md linking to both. Track your progress with a plan.',
      )
      await h.drain()
      const info = await h.sessionInfo(sessionId)
      checks.that(info.plan !== undefined, 'session has a plan snapshot')
      checks.that((info.plan?.steps.length ?? 0) >= 3, `plan has >= 3 steps (got ${info.plan?.steps.length ?? 0})`)
      const done = info.plan?.steps.filter((step) => step.status === 'done').length ?? 0
      checks.that(done >= 3, `steps marked done as work completed (got ${done})`)
      const events = await h.sessionEvents(sessionId)
      checks.that(toolCalls(events, 'memory_write').length >= 3, 'three memory files written')
      dumpArtifact('todo-adoption', {events, plan: info.plan})
    } finally {
      h.cleanup()
    }
  },
}

function dumpArtifact(name: string, payload: unknown): void {
  const file = path.join(ARTIFACT_DIR, `${name}-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify(payload, null, 2))
}

async function runScenario(name: string): Promise<ScenarioResult> {
  const checks = new Checks()
  const scenario = SCENARIOS[name]
  if (!scenario) return {pass: false, failures: [`unknown scenario: ${name}`], notes: []}
  currentScenario = name
  try {
    if (!RECORD) loadReplayCassettes(name)
  } catch (error) {
    return {pass: false, failures: [error instanceof Error ? error.message : String(error)], notes: []}
  }
  try {
    await Promise.race([
      scenario(checks),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`scenario timed out after ${SCENARIO_TIMEOUT_MS}ms`)), SCENARIO_TIMEOUT_MS),
      ),
    ])
  } catch (error) {
    checks.failures.push(`threw: ${error instanceof Error ? error.message : String(error)}`)
  }
  // Only passing runs overwrite recordings: a failed record pass must not poison the cassettes.
  if (RECORD && checks.failures.length === 0) flushRecordings(name)
  if (RECORD) recorded.delete(name)
  return {pass: checks.failures.length === 0, failures: checks.failures, notes: checks.notes}
}

const requested = positional.length === 0 || positional.includes('all') ? Object.keys(SCENARIOS) : positional
console.log(
  `\n=== Tier-3 gates · ${RECORD ? `RECORDING live from ${MODEL}` : 'replaying recordings'} · reps=${REPS} ===`,
)
console.log(`artifacts: ${ARTIFACT_DIR}\n`)
let failed = 0
const summary: string[] = []
for (const name of requested) {
  for (let rep = 1; rep <= REPS; rep++) {
    const label = REPS > 1 ? `${name} (rep ${rep}/${REPS})` : name
    process.stdout.write(`→ ${label} ... `)
    const started = Date.now()
    const result = await runScenario(name)
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    if (result.pass) {
      console.log(`PASS (${seconds}s)${result.notes.length ? ` — ${result.notes.join('; ')}` : ''}`)
      summary.push(`PASS ${label}`)
    } else {
      failed += 1
      console.log(`FAIL (${seconds}s)`)
      for (const failure of result.failures) console.log(`    ✗ ${failure}`)
      summary.push(`FAIL ${label}: ${result.failures.join(' | ')}`)
    }
  }
}
console.log(`\n=== ${summary.filter((s) => s.startsWith('PASS')).length} pass, ${failed} fail ===`)
fs.writeFileSync(path.join(ARTIFACT_DIR, 'summary.txt'), summary.join('\n'))
process.exit(failed > 0 ? 1 : 0)
