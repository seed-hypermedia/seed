import {describe, expect, test} from 'bun:test'
import {signalMatchesWait} from './run-events.ts'
import {
  answerSignalFor,
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
  callTool?: (tool: string, input: unknown, description?: string) => Promise<unknown>
  spawnAgent?: (spec: unknown, stepLabel?: string) => {childRunId: string; sessionId?: string}
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
  waits: Array<{waitId: string; match: unknown; timeoutAt?: number}>
} {
  const journal = options.journal ?? []
  const plans: RunPlanState[] = []
  const progress: Array<{fraction?: number; label?: string}> = []
  const waits: Array<{waitId: string; match: unknown; timeoutAt?: number}> = []
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
      registerEventWait: (wait) => waits.push(wait),
    },
    isCanceled: options.isCanceled ?? (() => false),
    timerParkThresholdMs: options.timerParkThresholdMs,
    fuelMs: options.fuelMs,
  }
  return {adapters, journal, plans, progress, waits}
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

  // Regression: a real agent-authored workflow measured its content with `new TextEncoder()` and
  // died at runtime — QuickJS has no WHATWG APIs unless the prelude provides them. Encoding is
  // deterministic, so the realm now does.
  test('TextEncoder/TextDecoder are available and round-trip UTF-8', async () => {
    const {adapters} = fakeAdapters({
      source: `export default async function (input, ctx) {
        const bytes = new TextEncoder().encode(input.text)
        const roundTrip = new TextDecoder('utf-8').decode(bytes)
        return {byteLength: bytes.length, isUint8: bytes instanceof Uint8Array, roundTrip}
      }`,
      // Mixed ASCII, accents, CJK, and an emoji (astral plane): 1-, 2-, 3-, and 4-byte sequences.
      input: {text: 'héllo 世界 🎉'},
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome).toEqual({
      type: 'succeeded',
      output: {
        byteLength: new TextEncoder().encode('héllo 世界 🎉').byteLength,
        isUint8: true,
        roundTrip: 'héllo 世界 🎉',
      },
    })
  })

  // A script error between tool calls must say WHERE it died: the stack's workflow.js line numbers
  // index into the stored source, which is what lets the UI excerpt the offending line.
  test('a script error carries a stack pointing into workflow.js', async () => {
    const {adapters} = fakeAdapters({
      source: `export default async function (input, ctx) {
        const ok = await ctx.call('echo', {x: 1})
        return {bytes: new MissingGlobal().encode('x')}
      }`,
    })
    const outcome = await runWorkflowVM(adapters)
    if (outcome.type !== 'failed') throw new Error(`expected failure, got ${outcome.type}`)
    expect(outcome.error.code).toBe('workflow-error')
    expect(outcome.error.message).toContain('MissingGlobal')
    expect(outcome.error.stack).toContain('workflow.js:3')
  })

  // An uncaught tool failure must name the call it came from, so the terminal error can be joined
  // to the journaled call (tool, args, result) instead of leaving the reader to guess.
  test('an uncaught tool failure identifies the failing call and forwards detail', async () => {
    const {adapters, journal} = fakeAdapters({
      source: `export default async function (input, ctx) {
        await ctx.call('echo', {x: 1})
        return await ctx.call('publish', {path: '/paper', bytes: 12345})
      }`,
      callTool: async (tool) => {
        if (tool === 'publish') {
          throw {code: 'quota-exceeded', message: 'Site quota exceeded', detail: {limitBytes: 10_000}}
        }
        return {ok: true}
      },
    })
    const outcome = await runWorkflowVM(adapters)
    if (outcome.type !== 'failed') throw new Error(`expected failure, got ${outcome.type}`)
    expect(outcome.error).toMatchObject({
      code: 'quota-exceeded',
      message: 'Site quota exceeded',
      tool: 'publish',
      detail: {limitBytes: 10_000},
    })
    // A tool failure's pointer is its call identity; an ActionError's construction stack is
    // prelude plumbing and must not masquerade as a script location.
    expect(outcome.error.stack).toBeUndefined()
    // The callSeq on the error is the journal's: the failing call entry holds the args.
    const failingCall = journal.find(
      (entry) => entry.kind === 'call' && 'callSeq' in entry && entry.callSeq === outcome.error.callSeq,
    )
    expect(failingCall).toMatchObject({op: 'tool', tool: 'publish', input: {path: '/paper', bytes: 12345}})
  })

  test('a replayed tool failure carries the same call identity as a live one', async () => {
    const source = `export default async function (input, ctx) {
      return await ctx.call('publish', {path: '/paper'})
    }`
    // First pass fails live and journals the failure.
    const first = fakeAdapters({
      source,
      callTool: async () => {
        throw {code: 'quota-exceeded', message: 'Site quota exceeded'}
      },
    })
    const liveOutcome = await runWorkflowVM(first.adapters)
    // Second pass replays from the journal; the tool must not be called again.
    const second = fakeAdapters({
      source,
      journal: [...first.journal],
      callTool: async () => {
        throw new Error('replay must not re-execute a journaled call')
      },
    })
    const replayOutcome = await runWorkflowVM(second.adapters)
    expect(replayOutcome).toEqual(liveOutcome)
    if (replayOutcome.type !== 'failed') throw new Error('expected failure')
    expect(replayOutcome.error.tool).toBe('publish')
    expect(typeof replayOutcome.error.callSeq).toBe('number')
  })

  test('TextDecoder rejects non-utf8 labels and replaces invalid bytes', async () => {
    const {adapters} = fakeAdapters({
      source: `export default async function (input, ctx) {
        let labelError = null
        try { new TextDecoder('utf-16le') } catch (error) { labelError = String(error && error.message) }
        const replaced = new TextDecoder().decode(new Uint8Array([0x41, 0xff, 0x42]))
        return {labelError, replaced}
      }`,
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome).toEqual({
      type: 'succeeded',
      output: {labelError: 'Only utf-8 is supported in workflows', replaced: 'A�B'},
    })
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

  test('ctx.call carries its {description} to the journal and the tool adapter', async () => {
    const calls: Array<{tool: string; description?: string}> = []
    const {adapters, journal} = fakeAdapters({
      source: `export default async function (input, ctx) {
        await ctx.call('write', {address: '~/memory/a.md', content: 'a'}, {description: 'Writing the first note'})
        await ctx.call('read', {address: '~/memory/a.md'}, {description: 'Reading it back'})
        await ctx.call('write', {address: '~/memory/b.md', content: 'b'})
        return {done: true}
      }`,
      callTool: async (tool, _input, description) => {
        calls.push({tool, description})
        return {ok: true}
      },
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome).toEqual({type: 'succeeded', output: {done: true}})
    // The run card reads the journal; the transcript reads the adapter. The label must reach both.
    expect(
      journal.filter((entry) => entry.kind === 'call').map((entry) => (entry as {description?: string}).description),
    ).toEqual(['Writing the first note', 'Reading it back', undefined])
    expect(calls).toEqual([
      {tool: 'write', description: 'Writing the first note'},
      {tool: 'read', description: 'Reading it back'},
      {tool: 'write', description: undefined},
    ])
  })

  test('relabeling a call does not re-execute it on replay', async () => {
    // Descriptions are display metadata outside the content key. An agent that rewrites its own
    // narration between attempts must still resume from the journal instead of redoing the work.
    const labeled = (description: string) =>
      `export default async function (input, ctx) {
        const res = await ctx.call('op', {step: 1}, {description: ${JSON.stringify(description)}})
        return {res}
      }`
    const first = fakeAdapters({source: labeled('Doing the thing'), callTool: async () => ({done: 1})})
    const firstOutcome = await runWorkflowVM(first.adapters)
    expect(firstOutcome).toEqual({type: 'succeeded', output: {res: {done: 1}}})

    const replay = fakeAdapters({
      source: labeled('Doing the thing, rephrased'),
      journal: [...first.journal],
      callTool: async () => {
        throw new Error('tool must not re-execute after a relabel')
      },
    })
    expect(await runWorkflowVM(replay.adapters)).toEqual({type: 'succeeded', output: {res: {done: 1}}})
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

  test('workflow failure waits for sibling parallel effects to finish', async () => {
    let resolveSlow!: (value: unknown) => void
    const slowStarted = Promise.withResolvers<void>()
    const {adapters, journal} = fakeAdapters({
      source: `export default async function (input, ctx) {
        await ctx.parallel([
          () => ctx.call('slow', {}),
          () => { throw new Error('parallel failed') },
        ])
      }`,
      callTool: () =>
        new Promise((resolve) => {
          resolveSlow = resolve
          slowStarted.resolve()
        }),
    })

    let settled = false
    const outcomePromise = runWorkflowVM(adapters).then((outcome) => {
      settled = true
      return outcome
    })
    await slowStarted.promise
    await new Promise<void>((resolve) => setImmediate(resolve))

    expect(settled).toBe(false)
    expect(journal.filter((entry) => entry.kind === 'result')).toHaveLength(0)

    resolveSlow({ok: true})
    const outcome = await outcomePromise
    expect(outcome).toMatchObject({type: 'failed', error: {message: 'parallel failed'}})
    expect(journal.filter((entry) => entry.kind === 'result')).toHaveLength(1)
  })

  test('cancellation wins when an in-flight tool later succeeds', async () => {
    let canceled = false
    let releaseTool!: () => void
    const toolStarted = Promise.withResolvers<void>()
    const {adapters} = fakeAdapters({
      source: `export default async function (input, ctx) {
        await ctx.call('slow', {})
        return 'done'
      }`,
      callTool: async () => {
        toolStarted.resolve()
        await new Promise<void>((resolve) => {
          releaseTool = resolve
        })
        return {ok: true}
      },
      isCanceled: () => canceled,
    })

    const outcomePromise = runWorkflowVM(adapters)
    await toolStarted.promise
    canceled = true
    releaseTool()

    expect(await outcomePromise).toEqual({type: 'canceled'})
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
    if (outcome.wait.reason !== 'timer') return
    expect(outcome.wait.wakeAt).toBeGreaterThan(Date.now() - 1_000)
    await new Promise((resolve) => setTimeout(resolve, 100))
    const resumed = fakeAdapters({source, journal: [...first.journal], timerParkThresholdMs: 50})
    const resumedOutcome = await runWorkflowVM(resumed.adapters)
    expect(resumedOutcome).toEqual({type: 'succeeded', output: 'woke late'})
  })

  test('ctx.waitForEvent parks on a registered wait, and a delivered payload resumes it', async () => {
    const source = `export default async function (input, ctx) {
      const approval = await ctx.waitForEvent({signal: 'approved'}, {label: 'approval from the reviewer'})
      return 'got ' + approval.payload.by
    }`
    const first = fakeAdapters({source})
    const parked = await runWorkflowVM(first.adapters)
    expect(parked.type).toBe('parked')
    if (parked.type !== 'parked') return
    expect(parked.wait.reason).toBe('event')
    if (parked.wait.reason !== 'event') return
    expect(parked.wait.label).toBe('approval from the reviewer')
    // The host was told what to listen for, under the id the journal recorded.
    expect(first.waits).toHaveLength(1)
    expect(first.waits[0]).toMatchObject({waitId: parked.wait.waitId, match: {signal: 'approved'}})
    const registration = first.journal.find((entry) => entry.kind === 'wait')
    expect(registration).toMatchObject({waitId: parked.wait.waitId})

    // Delivery is journaled by whoever wakes the run; the replay reads it as the call's result.
    const delivered = [
      ...first.journal,
      {
        kind: 'event' as const,
        callSeq: registration!.callSeq,
        key: registration!.key,
        waitId: parked.wait.waitId,
        delivery: {source: 'signal', payload: {by: 'Ada'}},
      },
    ]
    const resumed = fakeAdapters({source, journal: delivered})
    expect(await runWorkflowVM(resumed.adapters)).toEqual({type: 'succeeded', output: 'got Ada'})
    // Replay does not re-register a wait that has already been answered.
    expect(resumed.waits).toHaveLength(0)
  })

  test('parallel waits park on a timed wait even when an untimed wait registers first', async () => {
    const source = `export default async function (input, ctx) {
      return ctx.parallel([
        () => ctx.waitForEvent({signal: 'untimed'}),
        () => ctx.waitForEvent({signal: 'timed'}, {timeoutMs: 20_000}),
      ])
    }`
    const run = fakeAdapters({source})
    const parked = await runWorkflowVM(run.adapters)
    if (parked.type !== 'parked' || parked.wait.reason !== 'event') throw new Error('expected an event park')

    expect(run.waits).toHaveLength(2)
    const timedWait = run.waits.find((wait) => (wait.match as {signal?: string}).signal === 'timed')!
    expect(parked.wait.waitId).toBe(timedWait.waitId)
    expect(parked.wait.timeoutAt).toBe(timedWait.timeoutAt)
  })

  test('parallel timed waits park on the earliest deadline in either registration order', async () => {
    for (const timeouts of [
      [10_000, 20_000],
      [20_000, 10_000],
    ]) {
      const source = `export default async function (input, ctx) {
        return ctx.parallel([
          () => ctx.waitForEvent({signal: 'first'}, {timeoutMs: ${timeouts[0]}}),
          () => ctx.waitForEvent({signal: 'second'}, {timeoutMs: ${timeouts[1]}}),
        ])
      }`
      const run = fakeAdapters({source})
      const parked = await runWorkflowVM(run.adapters)
      if (parked.type !== 'parked' || parked.wait.reason !== 'event') throw new Error('expected an event park')

      expect(run.waits).toHaveLength(2)
      const earliest = run.waits.reduce((left, right) => (left.timeoutAt! < right.timeoutAt! ? left : right))
      expect(parked.wait.waitId).toBe(earliest.waitId)
      expect(parked.wait.timeoutAt).toBe(earliest.timeoutAt)
    }
  })

  test('parallel event waits and long sleeps park at the global earliest deadline', async () => {
    for (const sleepMs of [5_000, 30_000]) {
      const source = `export default async function (input, ctx) {
        return ctx.parallel([
          () => ctx.waitForEvent({signal: 'untimed'}),
          () => ctx.waitForEvent({signal: 'timed'}, {timeoutMs: 10_000}),
          () => ctx.sleep(${sleepMs}),
        ])
      }`
      const run = fakeAdapters({source, timerParkThresholdMs: 1})
      const parked = await runWorkflowVM(run.adapters)
      if (parked.type !== 'parked' || parked.wait.reason !== 'event') throw new Error('expected an event park')

      expect(run.waits).toHaveLength(2)
      const timedWait = run.waits.find((wait) => (wait.match as {signal?: string}).signal === 'timed')!
      const timer = run.journal.find((entry) => entry.kind === 'timer')!
      expect(parked.wait.waitId).toBe(timedWait.waitId)
      expect(parked.wait.timeoutAt).toBe(Math.min(timedWait.timeoutAt!, timer.wakeAt))
    }
  })

  test('a wait that runs out of time resolves as null on the next replay', async () => {
    const source = `export default async function (input, ctx) {
      const answer = await ctx.waitForEvent({signal: 'approved'}, {timeoutMs: 40})
      return answer === null ? 'gave up' : 'answered'
    }`
    const first = fakeAdapters({source})
    const parked = await runWorkflowVM(first.adapters)
    expect(parked.type).toBe('parked')
    if (parked.type !== 'parked' || parked.wait.reason !== 'event') return
    // The timeout is the wake time the queue parks on.
    expect(parked.wait.timeoutAt).toBeGreaterThan(Date.now() - 1_000)

    await new Promise((resolve) => setTimeout(resolve, 60))
    const resumed = fakeAdapters({source, journal: [...first.journal]})
    expect(await runWorkflowVM(resumed.adapters)).toEqual({type: 'succeeded', output: 'gave up'})
    // A timed-out wait is settled: it is not registered again.
    expect(resumed.waits).toHaveLength(0)
  })

  test('a delivered payload beats a timeout that has already passed', async () => {
    const source = `export default async function (input, ctx) {
      const answer = await ctx.waitForEvent({signal: 'approved'}, {timeoutMs: 5})
      return answer === null ? 'gave up' : 'answered'
    }`
    const first = fakeAdapters({source})
    const parked = await runWorkflowVM(first.adapters)
    if (parked.type !== 'parked' || parked.wait.reason !== 'event') throw new Error('expected an event park')
    const registration = first.journal.find((entry) => entry.kind === 'wait')!
    await new Promise((resolve) => setTimeout(resolve, 20))

    // The signal won the race in the database, so the run resumes with its payload even though the
    // deadline has since passed — the journal, not the clock, is the record of what happened.
    const resumed = fakeAdapters({
      source,
      journal: [
        ...first.journal,
        {
          kind: 'event' as const,
          callSeq: registration.callSeq,
          key: registration.key,
          waitId: parked.wait.waitId,
          delivery: {source: 'signal'},
        },
      ],
    })
    expect(await runWorkflowVM(resumed.adapters)).toEqual({type: 'succeeded', output: 'answered'})
  })

  test('the answer signal a wait advertises is one that would actually satisfy it', () => {
    // The host decides what to offer a person; run-events decides what to accept on delivery. If
    // those two ever disagree, the button sends a signal the run ignores.
    for (const match of [{}, {signal: 'approved'}, {signal: 'ship-it'}]) {
      const offered = answerSignalFor(match)
      expect(offered).toBeString()
      expect(signalMatchesWait(match, offered!)).toBe(true)
    }
    // A wait watching the activity feed cannot be answered by hand, and says so by offering nothing.
    for (const match of [{eventType: 'Comment'}, {resource: 'hm://z6MkDoc/spec'}, {author: 'z6Mk'}]) {
      expect(answerSignalFor(match)).toBeUndefined()
      expect(signalMatchesWait(match, 'answer')).toBe(false)
    }
  })

  test('ctx.continueAsNew ends the run and hands its state to a successor', async () => {
    const source = `export default async function (input, ctx) {
      const seen = (input && input.seen) || 0
      await ctx.log('info', 'generation ' + seen)
      await ctx.continueAsNew({seen: seen + 1})
      return 'never reached'
    }`
    const {adapters, journal} = fakeAdapters({source, input: {seen: 2}})
    const outcome = await runWorkflowVM(adapters)
    expect(outcome).toEqual({type: 'continued', state: {seen: 3}})
    // Work done before the handoff is journaled; nothing after continueAsNew ran.
    expect(journal.some((entry) => entry.kind === 'log' && entry.message === 'generation 2')).toBe(true)
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

  test('ctx.agent inside ctx.step carries the step label to the spawner', async () => {
    const spawns: Array<{spec: unknown; stepLabel?: string}> = []
    const {adapters} = fakeAdapters({
      source: `export default async function (input, ctx) {
        await ctx.step('Research', async () => {
          await ctx.agent({input: 'go research'})
        })
        await ctx.agent({input: 'no step here'})
        return 'ok'
      }`,
      spawnAgent: (spec, stepLabel) => {
        spawns.push({spec, stepLabel})
        return {childRunId: `child-${spawns.length}`}
      },
      awaitChild: async () => ({status: 'succeeded', output: {text: 'done'}}),
    })
    const outcome = await runWorkflowVM(adapters)
    expect(outcome).toEqual({type: 'succeeded', output: 'ok'})
    expect(spawns.map((spawn) => spawn.stepLabel)).toEqual(['Research', undefined])
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
