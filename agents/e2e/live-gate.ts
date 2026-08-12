/**
 * Live gate — drives a REAL running Agents server over the wire with REAL model calls.
 *
 * Unlike `e2e/run.ts` (in-process Service, recorded cassettes), this script is a pure client: it
 * signs envelopes with the desktop daemon's key over grpc-web, exactly the way the desktop app
 * does, and talks CBOR to an already-running server. That makes it the only harness that can gate
 * the thing Eric actually uses — his dev server on :3051 with the OpenAI subscription provider.
 *
 * It creates its own throwaway agent ("NightGate"), runs the scenarios, writes full transcripts to
 * the artifact directory, and deletes the agent again so the UI stays clean.
 *
 * Usage:
 *   bun e2e/live-gate.ts                      # every scenario against localhost:3051
 *   bun e2e/live-gate.ts trivial memory       # a subset
 *   bun e2e/live-gate.ts --base http://localhost:3099 --out /tmp/gate --keep
 *
 * Flags: --base (agents server), --daemon (Seed daemon http/grpc-web), --account (uid to sign as),
 * --model / --provider (default: copied from --like agent), --like (agent id to mirror),
 * --out (artifact dir), --timeout (per-scenario ms), --keep (do not delete the NightGate agent).
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {createGrpcWebTransport} from '@connectrpc/connect-web'
import {base58btc} from 'multiformats/bases/base58'
import * as blobs from '@shm/shared/blobs'
import {createGRPCClient} from '@shm/shared/grpc-client'
import * as cbor from '../src/cbor'

// ─── Configuration ───────────────────────────────────────────────────────────

const argv = process.argv.slice(2)
const flags = new Map<string, string>()
const positional: string[] = []
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!
  if (!arg.startsWith('--')) {
    positional.push(arg)
    continue
  }
  const name = arg.slice(2)
  if (name === 'keep') {
    flags.set(name, 'true')
    continue
  }
  flags.set(name, argv[i + 1] ?? '')
  i += 1
}

const BASE = flags.get('base') || 'http://localhost:3051'
const DAEMON = flags.get('daemon') || 'http://localhost:56001'
/** The account that owns Eric's agents on the dev server; also the daemon signing key name. */
const ACCOUNT = flags.get('account') || 'z6MkgisVMELvqnsCo3dYmtVpy8PiqPGMVwfAyBWFn84vebq4'
/** Agent whose provider/model/tools NightGate mirrors, so the gate tests Eric's real setup. */
const LIKE_AGENT = flags.get('like') || '46182c80-02b5-4920-845c-5c5c3a1ce094'
const SCENARIO_TIMEOUT_MS = Number(flags.get('timeout') || '600000')
const KEEP = flags.has('keep')
const OUT_DIR =
  flags.get('out') ||
  path.join(os.tmpdir(), 'seed-agents-live-gate', new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19))

fs.mkdirSync(OUT_DIR, {recursive: true})

// ─── Signed transport (desktop daemon signing, grpc-web) ─────────────────────

const grpc = createGRPCClient(createGrpcWebTransport({baseUrl: DAEMON}))

const signer: blobs.Signer = {
  principal: base58btc.decode(ACCOUNT),
  sign: async (data: Uint8Array) => {
    const result = await grpc.daemon.signData({signingKeyName: ACCOUNT, data: new Uint8Array(data)})
    return new Uint8Array(result.signature)
  },
}

type Response = {_: string} & Record<string, any>

async function action(unsigned: Record<string, unknown> & {_: string}): Promise<Response> {
  const envelope = await blobs.sign(signer, {
    type: 'AgentsAction',
    signer: signer.principal,
    sig: new Uint8Array(blobs.ED25519_SIGNATURE_SIZE),
    account: signer.principal,
    action: {...omitUndefined(unsigned), ts: Date.now()},
  } as unknown as blobs.Blob)
  const res = await fetch(`${BASE}/api/message`, {
    method: 'POST',
    headers: {'Content-Type': 'application/cbor', Accept: 'application/cbor'},
    body: cbor.encode(envelope) as BodyInit,
  })
  const decoded = cbor.decode<Response>(new Uint8Array(await res.arrayBuffer()))
  if (decoded._ === 'Error') throw new Error(`API error for ${unsigned._}: ${decoded.message}`)
  return decoded
}

/** CBOR encodes `undefined` as a value the server rejects; the desktop client strips it the same way. */
function omitUndefined<T>(value: T): T {
  if (value === undefined || value === null) return value
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) return value.map((item) => omitUndefined(item)) as T
  if (typeof value !== 'object') return value
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item !== undefined) output[key] = omitUndefined(item)
  }
  return output as T
}

// ─── Session driving ─────────────────────────────────────────────────────────

type SessionEvent = {seq: number; event: Record<string, any>}
type RunInfo = {
  id: string
  rootRunId: string
  parentRunId?: string
  depth: number
  kind: 'agent' | 'workflow'
  sessionId?: string
  status: string
  wait?: {reason: string; pendingChildren?: number}
  plan?: {title?: string; steps: Array<{id: string; label: string; status: string}>}
  error?: {code: string; message: string}
  title?: string
  stepLabel?: string
  planStepId?: string
  sourceText?: string
  startedAt?: number
  finishedAt?: number
}

/** True when two child runs were in flight at the same instant — the only proof of real concurrency. */
function overlapped(runs: RunInfo[]): boolean {
  const spans = runs
    .filter((run) => typeof run.startedAt === 'number' && typeof run.finishedAt === 'number')
    .map((run) => [run.startedAt!, run.finishedAt!] as const)
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      if (spans[i]![0] < spans[j]![1] && spans[j]![0] < spans[i]![1]) return true
    }
  }
  return false
}

const createSession = async (agentId: string): Promise<string> =>
  (await action({_: 'CreateSession', agentId})).sessionId as string

const message = (sessionId: string, text: string) =>
  action({_: 'MessageSession', sessionId, content: [{type: 'text', text}]})

const getSession = (sessionId: string) => action({_: 'GetSession', sessionId})
const rootRuns = async (sessionId: string): Promise<RunInfo[]> =>
  (await action({_: 'ListRuns', sessionId})).runs as RunInfo[]
const runTree = async (rootRunId: string): Promise<RunInfo[]> =>
  (await action({_: 'ListRuns', rootRunId})).runs as RunInfo[]
const journal = async (runId: string): Promise<Array<{seq: number; entry: Record<string, any>}>> =>
  (await action({_: 'GetRunJournal', runId})).entries as Array<{seq: number; entry: Record<string, any>}>
const childSessions = async (sessionId: string): Promise<any[]> =>
  (await action({_: 'ListSessions', parentSessionId: sessionId})).sessions as any[]

const TERMINAL = new Set(['succeeded', 'failed', 'canceled'])

type Settled = {
  runs: RunInfo[]
  /** Every (runId → status) transition the poller witnessed; the only evidence park/resume happened. */
  observed: Array<{runId: string; depth: number; kind: string; status: string; wait?: string; at: number}>
}

/**
 * Polls until every run under the session's roots is terminal. Records status transitions along the
 * way: a run that only ever shows `succeeded` at the end is indistinguishable from one that never
 * parked, so parking is asserted from what the poller saw live, not from the final row.
 */
async function settle(sessionId: string, label: string): Promise<Settled> {
  const deadline = Date.now() + SCENARIO_TIMEOUT_MS
  const observed: Settled['observed'] = []
  const seen = new Map<string, string>()
  let runs: RunInfo[] = []
  while (Date.now() < deadline) {
    const roots = await rootRuns(sessionId)
    const trees = await Promise.all(roots.map((run) => runTree(run.rootRunId)))
    runs = dedupeRuns([...roots, ...trees.flat()])
    for (const run of runs) {
      const key = `${run.status}|${run.wait?.reason ?? ''}`
      if (seen.get(run.id) === key) continue
      seen.set(run.id, key)
      observed.push({
        runId: run.id,
        depth: run.depth,
        kind: run.kind,
        status: run.status,
        wait: run.wait?.reason,
        at: Date.now(),
      })
    }
    if (runs.length > 0 && runs.every((run) => TERMINAL.has(run.status))) return {runs, observed}
    await Bun.sleep(1_200)
  }
  throw new Error(`[${label}] runs did not settle within ${SCENARIO_TIMEOUT_MS}ms`)
}

function dedupeRuns(runs: RunInfo[]): RunInfo[] {
  const byId = new Map<string, RunInfo>()
  for (const run of runs) byId.set(run.id, run)
  return [...byId.values()]
}

/** Session titling is detached from the run, so it lands shortly after the run is already terminal. */
async function waitForTitle(sessionId: string, timeoutMs = 45_000): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const title = (await getSession(sessionId)).session?.title as string | undefined
    if (title && title.trim() && title.trim().toLowerCase() !== 'untitled session') return title
    await Bun.sleep(1_500)
  }
  return undefined
}

// ─── Transcript helpers ──────────────────────────────────────────────────────

const events = async (sessionId: string): Promise<SessionEvent[]> =>
  ((await getSession(sessionId)).events as SessionEvent[]) ?? []

const toolCalls = (list: SessionEvent[], name?: string) =>
  list.map((e) => e.event).filter((e) => e.type === 'tool_call' && (name === undefined || e.name === name))

const toolResults = (list: SessionEvent[], name?: string) =>
  list.map((e) => e.event).filter((e) => e.type === 'tool_result' && (name === undefined || e.name === name))

/** Longest run of consecutive `tool_call`s for one tool — i.e. the widest single-turn fan-out. */
function maxAdjacentCalls(list: SessionEvent[], name: string): number {
  let best = 0
  let current = 0
  for (const {event} of list) {
    if (event.type === 'tool_call' && event.name === name) {
      current += 1
      best = Math.max(best, current)
    } else if (event.type === 'tool_result' || event.type === 'message') {
      current = 0
    }
  }
  return best
}

const assistantText = (list: SessionEvent[]): string =>
  list
    .map((e) => e.event)
    .filter((e) => e.type === 'message' && e.role === 'assistant' && typeof e.content === 'string')
    .map((e) => e.content as string)
    .join('\n')

// ─── Scenario plumbing ───────────────────────────────────────────────────────

class Checks {
  failures: string[] = []
  notes: string[] = []
  that(condition: unknown, description: string): void {
    if (!condition) this.failures.push(description)
  }
  note(text: string): void {
    this.notes.push(text)
  }
}

function dump(name: string, payload: unknown): void {
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), JSON.stringify(payload, null, 2))
}

/** Full durable state of one scenario: transcript, run tree, every workflow journal, child threads. */
async function capture(name: string, sessionId: string, settled: Settled): Promise<void> {
  const transcript = await events(sessionId)
  const children = await childSessions(sessionId)
  const journals: Record<string, unknown> = {}
  for (const run of settled.runs) {
    if (run.kind !== 'workflow') continue
    journals[run.id] = await journal(run.id)
  }
  const childTranscripts: Record<string, unknown> = {}
  for (const run of settled.runs) {
    if (!run.sessionId || run.sessionId === sessionId) continue
    childTranscripts[run.sessionId] = await events(run.sessionId)
  }
  dump(name, {
    sessionId,
    session: (await getSession(sessionId)).session,
    transcript,
    runs: settled.runs,
    observed: settled.observed,
    children,
    journals,
    childTranscripts,
  })
}

type Context = {agentId: string}

const SCENARIOS: Record<string, (checks: Checks, ctx: Context) => Promise<void>> = {
  /**
   * Restraint + self-naming. A trivial question must be answered directly — no delegation, no
   * workflow — and the session must still end up with a model-authored title.
   */
  trivial: async (checks, ctx) => {
    const sessionId = await createSession(ctx.agentId)
    await message(sessionId, 'What is 17 + 25?')
    const settled = await settle(sessionId, 'trivial')
    const transcript = await events(sessionId)
    const answer = assistantText(transcript)
    checks.that(/42/.test(answer), `answered 42 directly (got: ${answer.slice(0, 120)})`)
    checks.that(toolCalls(transcript, 'delegate').length === 0, 'no delegation for arithmetic')
    checks.that(
      settled.runs.length === 1 && settled.runs[0]!.status === 'succeeded',
      `exactly one succeeded run (got ${settled.runs.map((r) => `${r.kind}:${r.status}`).join(', ')})`,
    )
    const title = await waitForTitle(sessionId)
    checks.that(title !== undefined, 'session received a model-authored title')
    checks.note(`title: ${title ?? '(none)'} · answer: ${answer.slice(0, 80).replace(/\n/g, ' ')}`)
    await capture('trivial', sessionId, settled)
  },

  /**
   * Memory round-trip through the verbs: one session writes a fact to ~/memory, a SECOND session of
   * the same agent reads it back. Crossing the session boundary is the point — it proves durable
   * agent memory, not conversation recall.
   */
  memory: async (checks, ctx) => {
    const marker = `duckdb-${Math.floor(Date.now() / 1000)}`
    const writeSession = await createSession(ctx.agentId)
    await message(
      writeSession,
      `Save this to your memory at ~/memory/notes/live-gate.md so you remember it later: my favorite database is DuckDB and my project codeword is "${marker}". Confirm when written.`,
    )
    const writeSettled = await settle(writeSession, 'memory:write')
    const writeEvents = await events(writeSession)
    const writes = toolCalls(writeEvents, 'write')
    checks.that(writes.length >= 1, `used the write verb (${writes.length} calls)`)
    checks.that(
      writes.some((call) => String(call.input?.address ?? '').includes('~/memory/')),
      `wrote to a ~/memory address (got: ${writes.map((c) => c.input?.address).join(', ')})`,
    )

    // Verify through the API's own view of memory, independent of what the model claims.
    const listed = await action({_: 'ListAgentMemory', agentId: ctx.agentId})
    const files = (listed.entries ?? listed.files ?? []) as Array<{path?: string}>
    checks.that(
      files.some((entry) => String(entry.path ?? '').includes('live-gate')),
      `memory file exists on disk (entries: ${files
        .map((f) => f.path)
        .join(', ')
        .slice(0, 200)})`,
    )

    const readSession = await createSession(ctx.agentId)
    await message(readSession, 'Check your memory: what is my favorite database, and what is my project codeword?')
    const readSettled = await settle(readSession, 'memory:read')
    const readEvents = await events(readSession)
    const reads = toolCalls(readEvents, 'read')
    const recalled = assistantText(readEvents)
    checks.that(reads.length >= 1, `used the read verb to recall (${reads.length} calls)`)
    checks.that(/duckdb/i.test(recalled), 'recalled DuckDB in a fresh session')
    checks.that(recalled.includes(marker), `recalled the exact codeword ${marker}`)
    checks.note(`recall: ${recalled.slice(0, 120).replace(/\n/g, ' ')}`)
    await capture('memory-write', writeSession, writeSettled)
    await capture('memory-read', readSession, readSettled)
  },

  /**
   * Parallel delegation: two model children spawned in one turn with declared output schemas. Gates
   * the checklist (plan), the park/resume cycle (the parent must be observed `waiting` on children),
   * typed results, and a combined final answer.
   */
  'parallel-delegate': async (checks, ctx) => {
    const sessionId = await createSession(ctx.agentId)
    await message(
      sessionId,
      [
        'Research two things IN PARALLEL by delegating one model child for each, spawned in the same reply:',
        '1) three notable strengths of SQLite, and 2) three notable strengths of PostgreSQL.',
        'Require a structured result from each child: declare an output schema with fields `strengths` (array of strings, exactly 3) and `summary` (string).',
        'Keep a plan so I can follow along, then give me one combined answer naming both databases.',
      ].join(' '),
    )
    const settled = await settle(sessionId, 'parallel-delegate')
    const transcript = await events(sessionId)
    const calls = toolCalls(transcript, 'delegate')
    const results = toolResults(transcript, 'delegate')

    checks.that(calls.length >= 2, `spawned at least two children (${calls.length} delegate calls)`)
    // Real fan-out means two delegate calls in ONE assistant turn. Serial delegation (call, park,
    // result, call again) produces the same final answer at twice the latency, and the transcript
    // is the only place the difference shows: adjacent tool_call events with no result between them.
    // REPORTED, NOT ENFORCED: measured across three contract variants, gpt-5.6-sol never batches its
    // delegate calls, and the two prompt attempts that chased it either duplicated children or made
    // no difference. The shipping position is serial-but-clean with script children as the parallel
    // path, so failing the gate on it would only ever be reporting a known model behavior.
    checks.note(`same-turn delegate burst: ${maxAdjacentCalls(transcript, 'delegate')} (1 = fully serial)`)
    const titles = calls.map((call) => String(call.input?.title ?? ''))
    checks.that(
      new Set(titles).size === titles.length,
      `no child spawned twice for the same work (titles: ${titles.join(' | ')})`,
    )
    checks.that(
      calls.every((call) => typeof call.input?.output === 'object' && call.input.output !== null),
      'every delegate declared an output schema',
    )
    const typed = results
      .map((result) => result.output as {status?: string; output?: Record<string, unknown>} | undefined)
      .filter((output) => output?.status === 'succeeded')
    checks.that(typed.length >= 2, `two children resolved succeeded (${typed.length})`)
    checks.that(
      typed.every((output) => Array.isArray((output?.output as any)?.strengths)),
      `typed payloads carry a strengths array (got: ${JSON.stringify(typed[0]?.output ?? null).slice(0, 160)})`,
    )

    const session = (await getSession(sessionId)).session
    const plan = session?.plan as {steps?: Array<{id: string; label: string; status: string}>} | undefined
    checks.that((plan?.steps?.length ?? 0) >= 2, `session carries a plan checklist (${plan?.steps?.length ?? 0} steps)`)
    checks.that(
      (plan?.steps ?? []).every((step) => step.status !== 'running' && step.status !== 'pending'),
      `plan settled — no step left running/pending (${(plan?.steps ?? []).map((s) => s.status).join(', ')})`,
    )

    const parked = settled.observed.filter((entry) => entry.status === 'waiting')
    checks.that(parked.length >= 1, 'parent run was observed parked (waiting) while children ran')
    checks.that(
      parked.some((entry) => entry.wait === 'children'),
      `park reason is children (got: ${parked.map((p) => p.wait).join(', ') || 'none'})`,
    )

    const childRuns = settled.runs.filter((run) => run.depth >= 1)
    checks.that(childRuns.length >= 2, `two child runs in the tree (${childRuns.length})`)
    // Also reported, not enforced: overlap is downstream of the same serial-delegation behavior.
    // The script-parallel scenario DOES enforce concurrency, because ctx.parallel is deterministic.
    checks.note(`children overlapped in time: ${overlapped(childRuns) ? 'yes' : 'no'}`)
    checks.that(
      childRuns.every((run) => run.status === 'succeeded'),
      `every child run succeeded (${childRuns.map((r) => r.status).join(', ')})`,
    )
    const threads = await childSessions(sessionId)
    checks.that(threads.length >= 2, `two child threads nested under the parent (${threads.length})`)

    // Attachment: the UI hangs a child under a plan step, joined on the step ID. Agents rewrite step
    // labels mid-run, so a label-joined child comes loose the moment that happens — a failure that
    // is invisible in the answer and findable only here.
    const stepIds = new Set((plan?.steps ?? []).map((step) => step.id))
    const stepLabels = new Set((plan?.steps ?? []).map((step) => step.label))
    const stamped = childRuns.filter((run) => typeof run.planStepId === 'string' && run.planStepId.length > 0)
    checks.that(
      stamped.length === childRuns.length,
      `every child carries a planStepId (${stamped.length}/${childRuns.length}; got ${childRuns
        .map((run) => JSON.stringify(run.planStepId))
        .join(', ')})`,
    )
    checks.that(
      stamped.every((run) => stepIds.has(run.planStepId!)),
      `every planStepId resolves in the final plan (ids ${stamped.map((run) => run.planStepId).join(' | ')} vs steps ${[
        ...stepIds,
      ].join(' | ')})`,
    )
    const renamedAway = childRuns.filter((run) => run.stepLabel && !stepLabels.has(run.stepLabel))
    if (renamedAway.length > 0) {
      checks.note(
        `${renamedAway.length}/${childRuns.length} children outlived their step label (${renamedAway
          .map((run) => run.stepLabel)
          .join(' | ')}) — the id join is what saved them`,
      )
    }

    const answer = assistantText(transcript)
    checks.that(/sqlite/i.test(answer) && /postgres/i.test(answer), 'combined answer names both databases')
    checks.note(
      `plan: ${(plan?.steps ?? [])
        .map((s) => `${s.label}[${s.status}]`)
        .join(' · ')
        .slice(0, 160)}; parked ${parked.length}×`,
    )
    await capture('parallel-delegate', sessionId, settled)
  },

  /**
   * The other route to parallel work: a script child using `ctx.parallel` over two `ctx.delegate`
   * thunks. Unlike two delegate calls in one model reply, this is deterministic — the script says
   * "run these together", so concurrency does not depend on the model's tool-calling style.
   */
  'script-parallel': async (checks, ctx) => {
    const sessionId = await createSession(ctx.agentId)
    await message(
      sessionId,
      [
        'Use a SCRIPT child (delegate with `script`) that runs two model children CONCURRENTLY with ctx.parallel:',
        'one lists three uses of SQLite, the other three uses of PostgreSQL.',
        'Then have the script write the combined list to ~/memory/gate/databases.md with the write verb and return {sqlite, postgres, file}.',
        'Report the result to me.',
      ].join(' '),
    )
    const settled = await settle(sessionId, 'script-parallel')
    const transcript = await events(sessionId)
    checks.that(
      toolCalls(transcript, 'delegate').some((call) => typeof call.input?.script === 'string'),
      'model delegated a script child',
    )
    const workflowRun = settled.runs.find((run) => run.kind === 'workflow')
    checks.that(workflowRun !== undefined, 'a workflow run exists')
    if (workflowRun) {
      checks.that(workflowRun.status === 'succeeded', `workflow succeeded (${workflowRun.status})`)
      const spawned = settled.runs.filter((run) => run.parentRunId === workflowRun.id)
      checks.that(spawned.length >= 2, `workflow spawned two model children (${spawned.length})`)
      checks.that(overlapped(spawned), 'the workflow ran its two children concurrently')
      const entries = await journal(workflowRun.id)
      const kinds = entries.map((entry) => entry.entry.kind)
      checks.that(kinds.includes('spawn') || kinds.includes('call'), `journal recorded effects (${kinds.join(',')})`)
      checks.note(
        `children: ${spawned
          .map((run) => `${run.title ?? run.id.slice(0, 6)}[${run.startedAt}→${run.finishedAt}]`)
          .join(' · ')}`,
      )
    }
    const listed = await action({_: 'ListAgentMemory', agentId: ctx.agentId})
    checks.that(
      ((listed.entries ?? []) as Array<{path?: string}>).some((entry) =>
        String(entry.path ?? '').includes('databases'),
      ),
      'the combined memory file landed',
    )
    await capture('script-parallel', sessionId, settled)
  },

  /**
   * Script child with narrated effects: `ctx.call(tool, input, {description})`. The journal is the
   * durable record the UI renders, so the assertion is on journal entries, not on prose.
   */
  'script-narration': async (checks, ctx) => {
    const sessionId = await createSession(ctx.agentId)
    await message(
      sessionId,
      [
        'Use a SCRIPT child (delegate with `script`, not a brief) for this.',
        'The script must write three memory files with the write verb via ctx.call:',
        '~/memory/gate/one.md containing "one", ~/memory/gate/two.md containing "two", and ~/memory/gate/three.md containing "three".',
        'Narrate each call by passing a third argument {description: "..."} to ctx.call — for example ctx.call("write", {address, content}, {description: "Writing one.md"}).',
        'Return {written: number}.',
      ].join(' '),
    )
    const settled = await settle(sessionId, 'script-narration')
    const transcript = await events(sessionId)
    const calls = toolCalls(transcript, 'delegate')
    checks.that(
      calls.some((call) => typeof call.input?.script === 'string'),
      'model delegated a script child',
    )
    const workflowRuns = settled.runs.filter((run) => run.kind === 'workflow')
    checks.that(workflowRuns.length >= 1, `a workflow run exists (${workflowRuns.length})`)
    const workflowRun = workflowRuns.find((run) => run.status === 'succeeded') ?? workflowRuns.at(-1)
    let described: Array<{tool?: string; description?: string}> = []
    if (workflowRun) {
      const entries = await journal(workflowRun.id)
      const callEntries = entries.map((entry) => entry.entry).filter((entry) => entry.kind === 'call')
      checks.that(callEntries.length >= 3, `journal recorded the tool calls (${callEntries.length})`)
      described = callEntries
        .filter((entry) => typeof entry.description === 'string' && entry.description.length > 0)
        .map((entry) => ({tool: entry.tool, description: entry.description}))
      checks.that(
        described.length >= 1,
        `journal call entries carry {description} labels (${described.length} of ${callEntries.length} — absent means the running build predates narrated ctx.call)`,
      )
      checks.that(workflowRun.status === 'succeeded', `workflow succeeded (${workflowRun.status})`)
      checks.that(typeof workflowRun.sourceText === 'string', 'workflow run kept its source for review')
      checks.note(
        `descriptions: ${described
          .map((d) => `${d.tool}:${d.description}`)
          .join(' | ')
          .slice(0, 200)}`,
      )
    }
    await capture('script-narration', sessionId, settled)
  },
}

// ─── Runner ──────────────────────────────────────────────────────────────────

async function ensureAgent(): Promise<Context> {
  const reference = (await action({_: 'GetAgent', agentId: LIKE_AGENT})).agent as
    | {definition: {modelProvider: string; model: string; tools?: string[]; reasoningLevel?: string}}
    | undefined
  const modelProvider = flags.get('provider') || reference?.definition.modelProvider
  const model = flags.get('model') || reference?.definition.model
  if (!modelProvider || !model) throw new Error(`Could not resolve provider/model (reference agent ${LIKE_AGENT})`)
  const created = await action({
    _: 'CreateAgent',
    definition: {
      name: 'NightGate',
      systemPrompt:
        'You are NightGate, an automated test agent. Be efficient and concrete. Follow the instructions in each message exactly, including which mechanism to use.',
      modelProvider,
      model,
      reasoningLevel: reference?.definition.reasoningLevel,
      tools: reference?.definition.tools,
    },
  })
  console.log(`agent: NightGate ${created.agentId} (${modelProvider}/${model})`)
  return {agentId: created.agentId as string}
}

const requested = positional.length > 0 ? positional : Object.keys(SCENARIOS)
console.log(`\n=== Live gate · ${BASE} · signing as ${ACCOUNT.slice(0, 12)}… via daemon ${DAEMON} ===`)
console.log(`artifacts: ${OUT_DIR}\n`)

const ctx = await ensureAgent()
const summary: string[] = []
let failed = 0
try {
  for (const name of requested) {
    const scenario = SCENARIOS[name]
    if (!scenario) {
      console.log(`→ ${name} ... SKIP (unknown scenario)`)
      continue
    }
    process.stdout.write(`→ ${name} ... `)
    const checks = new Checks()
    const started = Date.now()
    try {
      await scenario(checks, ctx)
    } catch (error) {
      checks.failures.push(`threw: ${error instanceof Error ? error.message : String(error)}`)
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    if (checks.failures.length === 0) {
      console.log(`PASS (${seconds}s)`)
      summary.push(`PASS ${name} (${seconds}s)`)
    } else {
      failed += 1
      console.log(`FAIL (${seconds}s)`)
      for (const failure of checks.failures) console.log(`    ✗ ${failure}`)
      summary.push(`FAIL ${name} (${seconds}s): ${checks.failures.join(' | ')}`)
    }
    for (const note of checks.notes) {
      console.log(`    · ${note}`)
      summary.push(`     note: ${note}`)
    }
  }
} finally {
  if (KEEP) {
    console.log(`\nkeeping agent ${ctx.agentId} (--keep)`)
  } else {
    try {
      await action({_: 'DeleteAgent', agentId: ctx.agentId})
      console.log(`\ndeleted agent ${ctx.agentId}`)
    } catch (error) {
      console.error(`\nFAILED to delete agent ${ctx.agentId}:`, error)
    }
  }
  fs.writeFileSync(path.join(OUT_DIR, 'summary.txt'), summary.join('\n'))
  console.log(`\n=== ${summary.filter((line) => line.startsWith('PASS')).length} pass, ${failed} fail ===`)
  console.log(`artifacts: ${OUT_DIR}`)
}
process.exit(failed > 0 ? 1 : 0)
