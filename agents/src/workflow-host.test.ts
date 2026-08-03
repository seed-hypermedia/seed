import {describe, expect, test} from 'bun:test'
import {
  lintWorkflowSource,
  runWorkflowVM,
  type WorkflowAdapters,
  type WorkflowChildResolution,
  type WorkflowJournalEntry,
} from './workflow-host.ts'
import type {RunPlanState} from './runs.ts'

type FakeAdapterOptions = {
  source: string
  input?: unknown
  journal?: WorkflowJournalEntry[]
  callTool?: (tool: string, input: unknown) => Promise<unknown>
  spawnAgent?: (spec: unknown) => {childRunId: string; sessionId?: string}
  awaitChild?: (childRunId: string) => Promise<WorkflowChildResolution>
  isCanceled?: () => boolean
  timerParkThresholdMs?: number
  fuelMs?: number
  journalCapEntries?: number
}

function fakeAdapters(options: FakeAdapterOptions): {
  adapters: WorkflowAdapters
  journal: WorkflowJournalEntry[]
  plans: RunPlanState[]
  progress: Array<{fraction?: number; label?: string}>
} {
  const journal = options.journal ?? []
  const plans: RunPlanState[] = []
  const progress: Array<{fraction?: number; label?: string}> = []
  const adapters: WorkflowAdapters = {
    runId: 'wf-run-1',
    input: options.input ?? null,
    source: options.source,
    journal: {
      load: () => [...journal],
      append: (entry) => {
        if (options.journalCapEntries !== undefined && journal.length >= options.journalCapEntries) {
          throw {code: 'journal-cap'}
        }
        journal.push(entry)
      },
    },
    effects: {
      callTool: options.callTool ?? (async () => ({ok: true})),
      spawnAgent: options.spawnAgent ?? (() => ({childRunId: 'child-1'})),
      awaitChild: options.awaitChild ?? (async () => ({status: 'succeeded', output: {text: 'done'}})),
      updatePlan: (plan) => plans.push(structuredClone(plan)),
      progress: (patch) => progress.push(patch),
    },
    isCanceled: options.isCanceled ?? (() => false),
    timerParkThresholdMs: options.timerParkThresholdMs,
    fuelMs: options.fuelMs,
  }
  return {adapters, journal, plans, progress}
}

describe('workflow host', () => {
  test('pure function returns its output', async () => {
    const {adapters} = fakeAdapters({
      source: `export default async function (input, ctx) { return {sum: input.a + input.b} }`,
      input: {a: 2, b: 3},
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome).toEqual({type: 'succeeded', output: {sum: 5}})
  })

  test('ctx.call executes a tool and journals call + result', async () => {
    const calls: Array<{tool: string; input: unknown}> = []
    const {adapters, journal} = fakeAdapters({
      source: `export default async function (input, ctx) {
        const res = await ctx.call('echo', {x: 1})
        return {echoed: res.x}
      }`,
      callTool: async (tool, input) => {
        calls.push({tool, input})
        return {x: (input as {x: number}).x}
      },
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome).toEqual({type: 'succeeded', output: {echoed: 1}})
    expect(calls).toEqual([{tool: 'echo', input: {x: 1}}])
    expect(journal.map((entry) => entry.kind)).toEqual(['call', 'result'])
  })

  test('ctx.parallel results are positionally stable under reversed completion order', async () => {
    const resolvers: Array<(value: unknown) => void> = []
    const {adapters} = fakeAdapters({
      source: `export default async function (input, ctx) {
        const [a, b, c] = await ctx.parallel([
          () => ctx.call('slow', {n: 1}),
          () => ctx.call('slow', {n: 2}),
          () => ctx.call('slow', {n: 3}),
        ])
        return [a.n, b.n, c.n]
      }`,
      callTool: (tool, input) =>
        new Promise((resolve) => {
          resolvers.push(resolve)
          if (resolvers.length === 3) {
            // Resolve in reverse issuance order: 3, 2, 1.
            const pending = resolvers.splice(0)
            const values = [{n: 1}, {n: 2}, {n: 3}]
            pending[2]!(values[2])
            pending[1]!(values[1])
            pending[0]!(values[0])
          }
          void input
        }),
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome).toEqual({type: 'succeeded', output: [1, 2, 3]})
  })

  test('replay returns journaled results without re-executing tools, byte-identical output', async () => {
    const source = `export default async function (input, ctx) {
      const one = await ctx.call('op', {step: 1})
      const two = await ctx.call('op', {step: 2})
      const at = await ctx.now()
      return {one, two, at}
    }`
    let liveCalls = 0
    const first = fakeAdapters({
      source,
      callTool: async (_tool, input) => {
        liveCalls += 1
        return {done: (input as {step: number}).step}
      },
    })
    const firstOutcome = await runWorkflowVM(first.adapters)
    expect(firstOutcome.type).toBe('succeeded')
    expect(liveCalls).toBe(2)

    const replay = fakeAdapters({
      source,
      journal: [...first.journal],
      callTool: async () => {
        throw new Error('tool must not re-execute on replay')
      },
    })
    const replayOutcome = await runWorkflowVM(replay.adapters)
    expect(JSON.stringify(replayOutcome)).toBe(JSON.stringify(firstOutcome))
  })

  test('interruption between calls: resume executes only the remaining call', async () => {
    const source = `export default async function (input, ctx) {
      const one = await ctx.call('op', {step: 1})
      const two = await ctx.call('op', {step: 2})
      return {one, two}
    }`
    const executed: number[] = []
    let cancelAfterFirst = false
    const first = fakeAdapters({
      source,
      callTool: async (_tool, input) => {
        const step = (input as {step: number}).step
        executed.push(step)
        cancelAfterFirst = step === 1
        return {done: step}
      },
      isCanceled: () => cancelAfterFirst,
    })
    const firstOutcome = await runWorkflowVM(first.adapters)
    expect(firstOutcome.type).toBe('canceled')

    const resume = fakeAdapters({
      source,
      journal: [...first.journal],
      callTool: async (_tool, input) => {
        const step = (input as {step: number}).step
        executed.push(step)
        return {done: step}
      },
    })
    const resumeOutcome = await runWorkflowVM(resume.adapters)
    expect(resumeOutcome).toEqual({type: 'succeeded', output: {one: {done: 1}, two: {done: 2}}})
    // Step 1 executed exactly once across both passes; step 2 exactly once.
    expect(executed).toEqual([1, 2])
  })

  test('content-keyed replay: reordered parallel continuations consume the journal with zero re-execution', async () => {
    // The regression the order-based design had: fastB finishes before slowA live, so afterB is
    // journaled before afterA; on replay both journaled results deliver in issuance order, flipping
    // which continuation runs first. Content keys make the match order-independent.
    const source = `export default async function (input, ctx) {
      const [a, b] = await ctx.parallel([
        () => ctx.call('slowA', {}).then(() => ctx.call('afterA', {from: 'A'})),
        () => ctx.call('fastB', {}).then(() => ctx.call('afterB', {from: 'B'})),
      ])
      return {a, b}
    }`
    const first = fakeAdapters({
      source,
      callTool: (tool) =>
        new Promise((resolve) => {
          const delay = tool === 'slowA' ? 60 : 5
          setTimeout(() => resolve({tool}), delay)
        }),
    })
    const firstOutcome = await runWorkflowVM(first.adapters)
    expect(firstOutcome.type).toBe('succeeded')
    // Sanity: the journal really recorded the continuations in completion order (B before A).
    const callTools = first.journal
      .filter((entry) => entry.kind === 'call')
      .map((entry) => (entry as {tool?: string}).tool)
    expect(callTools.indexOf('afterB')).toBeLessThan(callTools.indexOf('afterA'))

    const replay = fakeAdapters({
      source,
      journal: [...first.journal],
      callTool: async () => {
        throw new Error('tool must not re-execute on replay')
      },
    })
    const replayOutcome = await runWorkflowVM(replay.adapters)
    expect(JSON.stringify(replayOutcome)).toBe(JSON.stringify(firstOutcome))
  })

  test('journal misses execute live instead of failing (content-keyed matching)', async () => {
    const first = fakeAdapters({
      source: `export default async function (input, ctx) { return ctx.call('alpha', {v: 1}) }`,
      callTool: async () => ({ok: 1}),
    })
    await runWorkflowVM(first.adapters)
    let liveCalls = 0
    const edited = fakeAdapters({
      source: `export default async function (input, ctx) { return ctx.call('beta', {v: 2}) }`,
      journal: [...first.journal],
      callTool: async (tool) => {
        liveCalls += 1
        return {ran: tool}
      },
    })
    const outcome = await runWorkflowVM(edited.adapters)
    expect(outcome).toEqual({type: 'succeeded', output: {ran: 'beta'}})
    expect(liveCalls).toBe(1)
  })

  test('short sleeps stay resident and journal timer + fired', async () => {
    const {adapters, journal} = fakeAdapters({
      source: `export default async function (input, ctx) { await ctx.sleep(20); return 'woke' }`,
      timerParkThresholdMs: 10_000,
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome).toEqual({type: 'succeeded', output: 'woke'})
    expect(journal.map((entry) => entry.kind)).toEqual(['timer', 'fired'])
  })

  test('long sleeps park with the wake time, and the post-wake replay fires them', async () => {
    const source = `export default async function (input, ctx) { await ctx.sleep(80); return 'woke late' }`
    const first = fakeAdapters({source, timerParkThresholdMs: 50})
    const outcome = await runWorkflowVM(first.adapters)
    expect(outcome.type).toBe('parked')
    if (outcome.type !== 'parked') return
    expect(outcome.wait.reason).toBe('timer')
    expect(outcome.wait.wakeAt).toBeGreaterThan(Date.now() - 1_000)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const resumed = fakeAdapters({source, journal: [...first.journal], timerParkThresholdMs: 50})
    const resumedOutcome = await runWorkflowVM(resumed.adapters)
    expect(resumedOutcome).toEqual({type: 'succeeded', output: 'woke late'})
  })

  test('ctx.agent unwraps success and surfaces child failure as a catchable coded error', async () => {
    const {adapters} = fakeAdapters({
      source: `export default async function (input, ctx) {
        const good = await ctx.agent({prompt: 'worker', input: 'go'})
        let caught = null
        try {
          await ctx.agent({prompt: 'worker', input: 'fail please'})
        } catch (error) {
          caught = error.code
        }
        return {good, caught}
      }`,
      spawnAgent: (spec) => ({
        childRunId: JSON.stringify(spec).includes('fail please') ? 'child-fail' : 'child-ok',
      }),
      awaitChild: async (childRunId) =>
        childRunId === 'child-ok'
          ? {status: 'succeeded', output: {text: 'worker done'}}
          : {status: 'failed', error: {code: 'output-schema', message: 'no result'}},
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome).toEqual({
      type: 'succeeded',
      output: {good: {text: 'worker done'}, caught: 'output-schema'},
    })
  })

  test('ctx.plan accepts bare-string steps and ctx.step ticks them by label', async () => {
    const {adapters, plans} = fakeAdapters({
      source: `export default async function (input, ctx) {
        await ctx.plan({steps: ['Fetch', 'Combine']})
        await ctx.step('Fetch', async () => 1)
        return 'ok'
      }`,
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome).toEqual({type: 'succeeded', output: 'ok'})
    const finalPlan = plans.at(-1)
    expect(finalPlan?.steps.map((step) => `${step.label}:${step.status}`)).toEqual(['Fetch:done', 'Combine:pending'])
  })

  test('ctx.step maintains the plan through start/done/failed', async () => {
    const {adapters, plans} = fakeAdapters({
      source: `export default async function (input, ctx) {
        await ctx.step('First', async () => 1)
        try {
          await ctx.step('Second', async () => { throw new Error('nope') })
        } catch {}
        return 'ok'
      }`,
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome).toEqual({type: 'succeeded', output: 'ok'})
    const finalPlan = plans.at(-1)
    expect(finalPlan?.steps).toEqual([
      {id: 'step-1', label: 'First', status: 'done'},
      {id: 'step-2', label: 'Second', status: 'failed'},
    ])
  })

  test('awaiting a promise outside ctx fails as a deadlock, not a hang', async () => {
    const {adapters} = fakeAdapters({
      source: `export default async function (input, ctx) { await new Promise(function () {}); return 'never' }`,
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome.type).toBe('failed')
    if (outcome.type !== 'failed') return
    expect(outcome.error.code).toBe('workflow-deadlock')
  })

  test('runaway compute is interrupted by fuel', async () => {
    const {adapters} = fakeAdapters({
      source: `export default async function (input, ctx) { for (;;) {} }`,
      fuelMs: 100,
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome.type).toBe('failed')
    if (outcome.type !== 'failed') return
    expect(outcome.error.code).toBe('fuel-exhausted')
  })

  test('journal cap fails the run with a pointer to splitting the work', async () => {
    const {adapters} = fakeAdapters({
      source: `export default async function (input, ctx) {
        for (let i = 0; i < 50; i++) await ctx.call('op', {i})
        return 'done'
      }`,
      journalCapEntries: 10,
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome.type).toBe('failed')
    if (outcome.type !== 'failed') return
    expect(outcome.error.code).toBe('journal-cap')
  })

  test('ambient nondeterminism throws inside the realm', async () => {
    const {adapters} = fakeAdapters({
      // Assembled with concat so the lint-style banned tokens in this test source are intentional.
      source: `export default async function (input, ctx) { return Math.random() }`,
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome.type).toBe('failed')
    if (outcome.type !== 'failed') return
    expect(outcome.error.message).toContain('Math.random is not available')
  })

  test('tool failures reject as coded ActionErrors the script can catch', async () => {
    const {adapters} = fakeAdapters({
      source: `export default async function (input, ctx) {
        try {
          await ctx.call('flaky', {})
          return 'unexpected'
        } catch (error) {
          return {code: error.code, message: error.message}
        }
      }`,
      callTool: async () => {
        const error = new Error('backend down') as Error & {code: string; retryable: boolean}
        error.code = 'tool-error'
        error.retryable = true
        throw error
      },
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome).toEqual({type: 'succeeded', output: {code: 'tool-error', message: 'backend down'}})
  })
})

describe('workflow lint', () => {
  test('accepts a clean module', () => {
    expect(
      lintWorkflowSource(`export default async function (input, ctx) { return ctx.call('read', {id: input.id}) }`),
    ).toEqual([])
  })

  test('rejects banned tokens with pointers to ctx equivalents', () => {
    const errors = lintWorkflowSource(`
      export default async function (input, ctx) {
        const t = Date.now()
        const r = Math.random()
        setTimeout(() => {}, 10)
        const page = await fetch('https://example.com')
        return {t, r, page}
      }
    `)
    expect(errors.join('\n')).toContain('ctx.now')
    expect(errors.join('\n')).toContain('randomness as workflow input')
    expect(errors.join('\n')).toContain('ctx.sleep')
    expect(errors.join('\n')).toContain('web_read')
  })

  test('requires exactly one default export', () => {
    expect(lintWorkflowSource(`const x = 1`).join('\n')).toContain('export default')
    expect(lintWorkflowSource(`export default async () => 1\nexport default async () => 2`).join('\n')).toContain(
      'exactly one',
    )
  })
})
