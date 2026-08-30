import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as apisvc from '@/api-service'
import * as blobs from '@shm/shared/blobs'
import {encode as cborEncode, decode as cborDecode} from '@/cbor'
import * as runs from '@/runs'
import * as sqlite from '@/sqlite'
import type {WorkflowJournalEntry} from '@/workflow-host'

/**
 * The event bus underneath the trigger surface: a run finishing is an event, and a trigger can
 * answer a run that is already waiting instead of always starting a new thread.
 *
 * These drive real runs through the real queue and the real finalize path, because the whole point
 * of `run-completed` is that it fires from finalization — a faked finalizer would prove nothing —
 * and because the `wake` continuation is only trustworthy if it goes through the same delivery a
 * hand-sent signal does.
 */

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

type Harness = {
  db: Database
  accountId: string
  agentId: string
  account: ReturnType<typeof blobs.generateNobleKeyPair>
  service: apisvc.Service
  restart: () => void
}

async function createHarness(): Promise<Harness> {
  const db = new Database(':memory:', {create: true, strict: true})
  if (!sqlite.openWithDatabase(db).ok) throw new Error('unexpected schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trigger-events-test-'))
  const account = blobs.generateNobleKeyPair()
  let service = new apisvc.Service(db, dataDir, {})
  const send = async (action: unknown) =>
    service.message(await apisvc.createSignedEnvelope(account, {action: action as never}))
  await send({_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')})
  await send({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}}})
  const created = await send({
    _: 'CreateAgent',
    definition: {name: 'Chainer', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt-test'},
  })
  if (created._ !== 'CreateAgentResponse') throw new Error('unexpected response')
  cleanups.push(() => {
    service.stopRunQueue()
    db.close()
    fs.rmSync(dataDir, {recursive: true, force: true})
  })
  return {
    db,
    accountId: blobs.principalToString(account.principal),
    agentId: created.agentId,
    account,
    get service() {
      return service
    },
    restart: () => {
      service.stopRunQueue()
      service = new apisvc.Service(db, dataDir, {})
    },
  } as Harness
}

async function createTrigger(
  harness: Harness,
  trigger: {name: string; source: unknown; continuation?: unknown; prompt?: string},
): Promise<string> {
  const response = await harness.service.message(
    await apisvc.createSignedEnvelope(harness.account, {
      action: {
        _: 'CreateAgentTrigger',
        agentId: harness.agentId,
        trigger: {
          name: trigger.name,
          source: trigger.source as never,
          prompt: trigger.prompt ?? 'Do the next thing.',
          ...(trigger.continuation === undefined ? {} : {continuation: trigger.continuation as never}),
        },
      },
    }),
  )
  if (response._ !== 'CreateAgentTriggerResponse') throw new Error('unexpected response')
  return response.trigger.id
}

/** Enqueues a workflow run and starts a service on it (the boot sweep is what picks the row up). */
function enqueueWorkflow(
  harness: Harness,
  options: {id: string; source: string; title?: string; triggerFiringId?: string},
): void {
  const now = Date.now()
  harness.db.run(
    `INSERT INTO runs (id, account_id, root_run_id, depth, kind, agent_id, origin, title, source_text,
       input_cbor, status, attempt, max_attempts, queue, trigger_firing_id, created_at, updated_at)
     VALUES (?, ?, ?, 0, 'workflow', ?, 'agent', ?, ?, ?, 'queued', 0, 1, 'background', ?, ?, ?)`,
    [
      options.id,
      harness.accountId,
      options.id,
      harness.agentId,
      options.title ?? 'Nightly crawl',
      options.source,
      cborEncode({input: null}),
      options.triggerFiringId ?? null,
      now,
      now,
    ],
  )
  harness.restart()
}

async function untilRun(
  harness: Harness,
  runId: string,
  predicate: (run: runs.RunRecord) => boolean,
  timeoutMs = 5_000,
): Promise<runs.RunRecord> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const run = runs.getRun(harness.db, harness.accountId, runId)
    if (run && predicate(run)) return run
    if (Date.now() > deadline) throw new Error(`run ${runId} never settled: ${run?.status}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

function firingsOf(harness: Harness, triggerId: string): Array<{status: string; activity_key: string}> {
  return harness.db
    .query<{status: string; activity_key: string}, [string]>(
      `SELECT status, activity_key FROM trigger_firings WHERE trigger_id = ? ORDER BY created_at ASC`,
    )
    .all(triggerId)
}

const RETURNS_IMMEDIATELY = `export default async function () { return 'done' }`
const WAITS_FOR_GO = `export default async function (input, ctx) {
  const event = await ctx.waitForEvent({signal: 'go'})
  return 'woken by ' + event.source
}`

describe('run-completed triggers', () => {
  test('a finished run wakes a run that was waiting for it', async () => {
    const harness = await createHarness()
    await createTrigger(harness, {
      name: 'Unblock the writer',
      source: {type: 'run-completed', status: 'succeeded'},
      continuation: {kind: 'wake', signal: 'go'},
    })

    // Someone is waiting…
    enqueueWorkflow(harness, {id: 'waiter', source: WAITS_FOR_GO, title: 'Waiting writer'})
    await untilRun(harness, 'waiter', (run) => run.status === 'waiting')

    // …and a different run finishing is what releases them.
    enqueueWorkflow(harness, {id: 'crawler', source: RETURNS_IMMEDIATELY, title: 'Nightly crawl'})
    await untilRun(harness, 'crawler', (run) => run.status === 'succeeded')

    const woken = await untilRun(harness, 'waiter', (run) => runs.TERMINAL_RUN_STATUSES.includes(run.status))
    expect(woken.status).toBe('succeeded')
    // The delivery went through the SignalRun path, so the payload says where it came from.
    expect(woken.output).toBe('woken by trigger')
    // Exactly one delivery is journaled, and the firing history says what happened.
    const journal = harness.db
      .query<{entry_cbor: Uint8Array}, [string]>(`SELECT entry_cbor FROM run_journal WHERE run_id = ?`)
      .all('waiter')
      .map((row) => cborDecode<WorkflowJournalEntry>(row.entry_cbor))
    expect(journal.filter((entry) => entry.kind === 'event')).toHaveLength(1)
  })

  test('a trigger that fires with nobody listening records that, rather than failing', async () => {
    const harness = await createHarness()
    const triggerId = await createTrigger(harness, {
      name: 'Unblock nobody',
      source: {type: 'run-completed'},
      continuation: {kind: 'wake', signal: 'go'},
    })

    enqueueWorkflow(harness, {id: 'crawler', source: RETURNS_IMMEDIATELY})
    await untilRun(harness, 'crawler', (run) => run.status === 'succeeded')
    await new Promise((resolve) => setTimeout(resolve, 50))

    const firings = firingsOf(harness, triggerId)
    expect(firings).toHaveLength(1)
    expect(firings[0]).toMatchObject({status: 'no-listener', activity_key: 'run:crawler'})
  })

  test('a trigger already in the chain that produced a run does not fire on it again', async () => {
    const harness = await createHarness()
    const triggerId = await createTrigger(harness, {
      name: 'Chain forever',
      source: {type: 'run-completed'},
      continuation: {kind: 'wake', signal: 'go'},
    })
    // Forge the state a first firing leaves behind: this run exists BECAUSE that trigger fired.
    const firingId = 'firing-1'
    harness.db.run(
      `INSERT INTO trigger_firings (id, account_id, agent_id, trigger_id, activity_key, activity_cbor, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        firingId,
        harness.accountId,
        harness.agentId,
        triggerId,
        'run:earlier',
        cborEncode({type: 'run-completed', runId: 'earlier'}),
        'created',
        Date.now(),
      ],
    )

    enqueueWorkflow(harness, {id: 'child-of-trigger', source: RETURNS_IMMEDIATELY, triggerFiringId: firingId})
    await untilRun(harness, 'child-of-trigger', (run) => run.status === 'succeeded')
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Only the forged one: the run this trigger caused did not cause it again.
    expect(firingsOf(harness, triggerId).map((firing) => firing.activity_key)).toEqual(['run:earlier'])
  })

  test('the source filters on how a run ended, whose it was, and what it was called', async () => {
    const harness = await createHarness()
    const wrongStatus = await createTrigger(harness, {
      name: 'Only failures',
      source: {type: 'run-completed', status: 'failed'},
      continuation: {kind: 'wake', signal: 'go'},
    })
    const wrongAgent = await createTrigger(harness, {
      name: 'Another agent',
      source: {type: 'run-completed', agentId: 'someone-else'},
      continuation: {kind: 'wake', signal: 'go'},
    })
    const wrongTitle = await createTrigger(harness, {
      name: 'Only the digest',
      source: {type: 'run-completed', titleMatch: 'digest'},
      continuation: {kind: 'wake', signal: 'go'},
    })
    const matching = await createTrigger(harness, {
      name: 'Matches on title',
      // Case-insensitive substring: an agent naming its run "Nightly Crawl" still matches.
      source: {type: 'run-completed', titleMatch: 'nightly'},
      continuation: {kind: 'wake', signal: 'go'},
    })

    enqueueWorkflow(harness, {id: 'crawler', source: RETURNS_IMMEDIATELY, title: 'Nightly crawl'})
    await untilRun(harness, 'crawler', (run) => run.status === 'succeeded')
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(firingsOf(harness, wrongStatus)).toHaveLength(0)
    expect(firingsOf(harness, wrongAgent)).toHaveLength(0)
    expect(firingsOf(harness, wrongTitle)).toHaveLength(0)
    expect(firingsOf(harness, matching)).toHaveLength(1)
  })
})

describe('headless trigger continuations', () => {
  const RUN_FOR = (id: string) => `firing-${id}`
  const firingRow = (harness: Harness, triggerId: string) =>
    harness.db
      .query<
        {id: string; status: string; error: string | null; run_id: string | null; session_id: string | null},
        [string]
      >(
        `SELECT id, status, error, run_id, session_id FROM trigger_firings WHERE trigger_id = ? ORDER BY created_at DESC`,
      )
      .get(triggerId)

  test('a tool continuation calls the tool with the event and records the run on the firing', async () => {
    const harness = await createHarness()
    const triggerId = await createTrigger(harness, {
      name: 'Note the finish',
      source: {type: 'run-completed', status: 'succeeded'},
      continuation: {kind: 'tool', tool: 'read', input: {address: '~/triggers/'}},
    })
    enqueueWorkflow(harness, {id: 'crawler', source: RETURNS_IMMEDIATELY})
    await untilRun(harness, 'crawler', (run) => run.status === 'succeeded')

    const firing = await (async () => {
      for (let i = 0; i < 200; i += 1) {
        const row = firingRow(harness, triggerId)
        if (row?.run_id) return row
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error('firing never linked a run')
    })()
    expect(firing.run_id).toBe(RUN_FOR(firing.id))
    expect(firing.session_id).toBeNull()
    const run = await untilRun(harness, firing.run_id!, (r) => runs.TERMINAL_RUN_STATUSES.includes(r.status))
    expect(run).toMatchObject({status: 'succeeded', kind: 'workflow', origin: 'trigger', triggerFiringId: firing.id})
    expect(run.sessionId).toBeUndefined()
    // The tool ran for real: `read ~/triggers/` lists the trigger that fired it.
    expect(JSON.stringify(run.output)).toContain('Note the finish')
    expect(firingRow(harness, triggerId)).toMatchObject({status: 'succeeded', error: null})
    // The trigger reads back its own firing with the run address an agent can follow.
    const trigger = harness.db
      .query<{last_fired_at: number | null; last_error: string | null}, [string]>(
        `SELECT last_fired_at, last_error FROM agent_triggers WHERE id = ?`,
      )
      .get(triggerId)
    expect(trigger?.last_fired_at).not.toBeNull()
    expect(trigger?.last_error).toBeNull()
  })

  test('a script continuation gets the event, its input, and the trigger as ctx.input', async () => {
    const harness = await createHarness()
    const triggerId = await createTrigger(harness, {
      name: 'Describe the finish',
      source: {type: 'run-completed'},
      continuation: {
        kind: 'script',
        input: {tag: 'v1'},
        script: `export default async function (input, ctx) {
          await ctx.log('info', 'headless')
          return [input.event.type, input.event.runStatus, input.input.tag, input.trigger.name].join('|')
        }`,
      },
    })
    enqueueWorkflow(harness, {id: 'crawler', source: RETURNS_IMMEDIATELY})
    await untilRun(harness, 'crawler', (run) => run.status === 'succeeded')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const firing = firingRow(harness, triggerId)
    expect(firing?.run_id).toBeTruthy()
    const run = await untilRun(harness, firing!.run_id!, (r) => runs.TERMINAL_RUN_STATUSES.includes(r.status))
    expect(run.status).toBe('succeeded')
    expect(run.output).toBe('run-completed|succeeded|v1|Describe the finish')
  })

  test('a failed headless run marks the firing and, when asked, starts a recovery thread', async () => {
    const harness = await createHarness()
    // The recovery thread runs a real agent turn; answer it with a canned stream so the test never
    // reaches a provider (and nothing is left retrying after the database closes).
    const modelRequests: string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      modelRequests.push(String(init?.body ?? ''))
      const chunks = [
        {id: 'chat-recovery', choices: [{delta: {content: 'Recovered.'}}]},
        {
          id: 'chat-recovery',
          choices: [{delta: {}, finish_reason: 'stop'}],
          usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
        },
      ]
      return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
        headers: {'content-type': 'text/event-stream'},
      })
    }) as unknown as typeof fetch
    cleanups.push(() => {
      globalThis.fetch = originalFetch
    })
    const quiet = await createTrigger(harness, {
      name: 'Quiet failure',
      source: {type: 'run-completed'},
      continuation: {kind: 'script', script: `export default async function () { throw new Error('boom') }`},
    })
    const loud = await createTrigger(harness, {
      name: 'Loud failure',
      source: {type: 'run-completed'},
      prompt: 'Sort out the deploy recorder.',
      continuation: {
        kind: 'script',
        onFailure: 'thread',
        script: `export default async function () { throw new Error('kaboom') }`,
      },
    })
    enqueueWorkflow(harness, {id: 'crawler', source: RETURNS_IMMEDIATELY})
    await untilRun(harness, 'crawler', (run) => run.status === 'succeeded')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const quietFiring = firingRow(harness, quiet)!
    const loudFiring = firingRow(harness, loud)!
    await untilRun(harness, quietFiring.run_id!, (r) => r.status === 'failed')
    await untilRun(harness, loudFiring.run_id!, (r) => r.status === 'failed')

    expect(firingRow(harness, quiet)).toMatchObject({
      status: 'error',
      error: expect.stringContaining('boom'),
      session_id: null,
    })
    const escalated = firingRow(harness, loud)!
    expect(escalated.status).toBe('escalated')
    expect(escalated.session_id).toBeTruthy()
    const session = harness.db
      .query<{title: string}, [string]>(`SELECT title FROM sessions WHERE id = ?`)
      .get(escalated.session_id!)
    expect(session?.title).toContain('automation failed')
    // The recovery thread's first message carries the failure and points at the run's journal. It
    // is appended before the model runs, so there is no need to wait for that (fake-keyed) run.
    const firstMessage = await (async () => {
      for (let i = 0; i < 300; i += 1) {
        const row = harness.db
          .query<{event_cbor: Uint8Array}, [string]>(
            `SELECT event_cbor FROM session_events WHERE session_id = ? ORDER BY seq ASC LIMIT 1`,
          )
          .get(escalated.session_id!)
        if (row) return row
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      return null
    })()
    const text = firstMessage ? JSON.stringify(cborDecode(firstMessage.event_cbor)) : ''
    expect(text).toContain('Sort out the deploy recorder.')
    expect(text).toContain('automationFailure')
    expect(text).toContain(`run:${loudFiring.run_id}`)
    expect(text).toContain('kaboom')
    const agentRow = harness.db
      .query<{last_error: string | null}, [string]>(`SELECT last_error FROM agent_triggers WHERE id = ?`)
      .get(loud)
    expect(agentRow?.last_error).toContain('kaboom')
    // The recovery thread reached the model with the failure in its context.
    await harness.service.drainTriggerSessions()
    // (More than one request is fine: the runtime may also ask for a title.)
    expect(modelRequests.some((body) => body.includes('automationFailure') && body.includes('kaboom'))).toBe(true)
    const escalationRun = runs.getRun(harness.db, harness.accountId, `firing-${loudFiring.id}-escalation`)
    expect(escalationRun?.status).toBe('succeeded')
  })
})
