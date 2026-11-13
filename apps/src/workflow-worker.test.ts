import {describe, expect, test} from 'bun:test'
import {runWorkflowVM, type WorkflowAdapters, type WorkflowJournalEntry} from '@/workflow-host'
import {runWorkflowInWorker} from '@/workflow-worker-host'

/** Minimal real adapters backed by in-test arrays; effects run on THIS (main) thread. */
function adaptersFor(opts: {
  source: string
  input?: unknown
  journal?: WorkflowJournalEntry[]
  callTool?: WorkflowAdapters['effects']['callTool']
  spawnAgent?: WorkflowAdapters['effects']['spawnAgent']
  awaitChild?: WorkflowAdapters['effects']['awaitChild']
}) {
  const journal = opts.journal ?? []
  const plans: unknown[] = []
  const progress: unknown[] = []
  const adapters: WorkflowAdapters = {
    runId: 'wf-worker-test',
    input: opts.input ?? null,
    source: opts.source,
    journal: {load: () => [...journal], append: (e) => void journal.push(e)},
    effects: {
      callTool: opts.callTool ?? (async () => ({ok: true})),
      spawnAgent: opts.spawnAgent ?? (() => ({childRunId: 'child-1', sessionId: 'sess-1'})),
      awaitChild: opts.awaitChild ?? (async () => ({status: 'succeeded', output: {text: 'done'}})),
      updatePlan: (p) => void plans.push(p),
      progress: (p) => void progress.push(p),
      registerEventWait: () => {},
    },
    isCanceled: () => false,
    fuelMs: 5_000,
  }
  return {adapters, journal, plans, progress}
}

describe('workflow-in-worker POC', () => {
  test('pure workflow: worker output matches in-process', async () => {
    const source = `export default async function (input, ctx) { return {sum: input.a + input.b, tag: 'ok'} }`
    const inProcess = await runWorkflowVM(adaptersFor({source, input: {a: 2, b: 3}}).adapters)
    const inWorker = await runWorkflowInWorker(adaptersFor({source, input: {a: 2, b: 3}}).adapters)
    expect(inWorker).toEqual(inProcess)
    expect(inWorker).toMatchObject({type: 'succeeded', output: {sum: 5, tag: 'ok'}})
  })

  test('tool call bridges to main and returns its result', async () => {
    const calls: Array<{tool: string; input: unknown}> = []
    const {adapters, journal} = adaptersFor({
      source: `export default async function (input, ctx) { const r = await ctx.call('search', {q: 'hi'}); return {got: r} }`,
      callTool: async (tool, input) => {
        calls.push({tool, input})
        return {hits: 3}
      },
    })
    const outcome = await runWorkflowInWorker(adapters)
    expect(outcome).toMatchObject({type: 'succeeded', output: {got: {hits: 3}}})
    expect(calls).toEqual([{tool: 'search', input: {q: 'hi'}}])
    // the call was journaled on main
    expect(journal.some((e) => e.kind === 'result')).toBe(true)
  })

  test('spawnAgent (synchronous effect) round-trips via SharedArrayBuffer', async () => {
    const spawned: unknown[] = []
    const {adapters} = adaptersFor({
      source: `export default async function (input, ctx) { const c = await ctx.agent({input: 'go'}); return {child: c} }`,
      spawnAgent: (spec) => {
        spawned.push(spec)
        return {childRunId: 'child-xyz', sessionId: 'sess-xyz'}
      },
      awaitChild: async () => ({status: 'succeeded', output: {text: 'child done'}}),
    })
    const outcome = await runWorkflowInWorker(adapters)
    expect(outcome).toMatchObject({type: 'succeeded'})
    expect(spawned).toHaveLength(1)
  })

  test('a CPU-heavy workflow in the worker does NOT block the main event loop', async () => {
    // Main-thread heartbeat: count how many 10ms ticks fire while the worker computes. If the worker
    // blocked main, almost none would fire; if main stays free, they fire throughout. Counting ticks
    // is robust to GC/scheduler jitter in a way a max-gap threshold is not.
    let ticks = 0
    const beat = setInterval(() => ticks++, 10)
    try {
      // Pure-arithmetic busy loop inside the VM (workflows have no Date/Math.random ambient authority).
      const source = `export default async function (input, ctx) {
        let x = 0; for (let i = 0; i < 3000000; i++) { x = (x + i) % 1000003 }
        return {done: true, x}
      }`
      const startedAt = performance.now()
      const outcome = await runWorkflowInWorker(adaptersFor({source}).adapters)
      const elapsedMs = performance.now() - startedAt
      expect(outcome).toMatchObject({type: 'succeeded', output: {done: true}})
      // The compute was genuinely slow in QuickJS (proves the worker did real work off-thread)...
      expect(elapsedMs).toBeGreaterThan(50)
      // ...yet main kept ticking: if the worker had blocked the main thread, the timer would not
      // have fired at all during the compute. A handful of ticks proves it stayed free. (A tighter
      // bound would be flaky when this runs alongside the rest of the suite on a shared thread.)
      expect(ticks).toBeGreaterThan(3)
    } finally {
      clearInterval(beat)
    }
  })

  test('cancellation reaches the worker through the SharedArrayBuffer', async () => {
    // A long compute; cancel it shortly after start. The cancel flag must interrupt the VM.
    const source = `export default async function (input, ctx) {
      let x = 0; for (let i = 0; i < 2000000000; i++) { x = (x + i) % 1000003 }
      return {done: true}
    }`
    const {adapters} = adaptersFor({source})
    let canceled = false
    const withCancel: WorkflowAdapters = {...adapters, isCanceled: () => canceled}
    setTimeout(() => {
      canceled = true
    }, 200)
    const outcome = await runWorkflowInWorker(withCancel)
    expect(outcome.type).toBe('canceled')
  })

  test('a throwing workflow surfaces as failed, not a crash', async () => {
    const source = `export default async function (input, ctx) { throw new Error('boom') }`
    const outcome = await runWorkflowInWorker(adaptersFor({source}).adapters)
    expect(outcome.type).toBe('failed')
    if (outcome.type === 'failed') expect(outcome.error.message).toContain('boom')
  })

  test('journal replay: a completed call is served from the journal, not re-executed', async () => {
    let toolCalls = 0
    // Run once to capture the journal the first execution wrote.
    const first = adaptersFor({
      source: `export default async function (input, ctx) { const r = await ctx.call('search', {q: 'x'}); return {r} }`,
      callTool: async () => {
        toolCalls++
        return {hit: 1}
      },
    })
    const out1 = await runWorkflowInWorker(first.adapters)
    expect(out1).toMatchObject({type: 'succeeded', output: {r: {hit: 1}}})
    expect(toolCalls).toBe(1)

    // Replay from that journal: the tool must NOT be called again (deterministic replay).
    const replay = adaptersFor({
      source: `export default async function (input, ctx) { const r = await ctx.call('search', {q: 'x'}); return {r} }`,
      journal: first.journal,
      callTool: async () => {
        toolCalls++
        return {hit: 999}
      },
    })
    const out2 = await runWorkflowInWorker(replay.adapters)
    expect(out2).toMatchObject({type: 'succeeded', output: {r: {hit: 1}}}) // journaled value, not 999
    expect(toolCalls).toBe(1) // no second call
  })
})
