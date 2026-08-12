/**
 * Drives a REAL running Agents server over HTTP and checks the unified obligations loop end to end:
 * a plan-shaped task, a step left open at turn end, the continuation the runtime hands itself, and
 * the settled checklist afterwards. The model half is scripted (scripted-provider.ts) so the
 * result is about the runtime.
 */
import * as blobs from '@shm/shared/blobs'
import * as cbor from '../src/cbor'
import * as apisvc from '../src/api-service'

const BASE = process.env.BASE || 'http://127.0.0.1:3099'
const PROVIDER_URL = process.env.PROVIDER_URL || 'http://127.0.0.1:4099/v1'
const account = blobs.generateNobleKeyPair()

async function action(input: Record<string, unknown>, timeoutMs = 120_000): Promise<any> {
  const envelope = await apisvc.createSignedEnvelope(account, {action: input as never})
  const response = await fetch(`${BASE}/api/message`, {
    method: 'POST',
    headers: {'Content-Type': 'application/cbor'},
    body: cbor.encode(envelope),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = cbor.decode<any>(new Uint8Array(await response.arrayBuffer()))
  if (!response.ok || body._ === 'Error') throw new Error(`${input._} failed: ${body.message ?? response.status}`)
  return body
}

const checks: string[] = []
const check = (ok: boolean, label: string) => {
  checks.push(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
}

await action({
  _: 'SetModelProvider',
  name: 'scripted',
  provider: {type: 'ollama', baseUrl: PROVIDER_URL},
})
const agent = await action({
  _: 'CreateAgent',
  definition: {
    name: 'ObligationLiveCheck',
    systemPrompt: 'You keep a plan.',
    modelProvider: 'scripted',
    model: 'scripted-model',
    tools: [],
  },
})
const session = await action({_: 'CreateSession', agentId: agent.agentId})
console.log(`agent=${agent.agentId} session=${session.sessionId}`)

await action({
  _: 'MessageSession',
  sessionId: session.sessionId,
  content: [{type: 'text', text: 'Name three colors, then write one sentence using all three. Track it with a plan.'}],
})

// A parent that delegates PARKS, so the message call returns while the work is still going. Wait
// for the whole tree to reach a terminal status before reading anything.
const settled = async () => {
  const roots = await action({_: 'ListRuns', sessionId: session.sessionId})
  if (!roots.runs.length) return false
  const tree = await action({_: 'ListRuns', rootRunId: roots.runs[0].rootRunId})
  return tree.runs.every((run: any) => ['succeeded', 'failed', 'canceled'].includes(run.status))
}
for (let i = 0; i < 120; i++) {
  if (await settled()) break
  await new Promise((resolve) => setTimeout(resolve, 500))
}

const detail = await action({_: 'GetSession', sessionId: session.sessionId})
const list = await action({_: 'ListRuns', sessionId: session.sessionId})
const events = detail.events.map((event: any) => event.event)

const stubborn = process.env.MODE === 'stubborn'
const delegation = process.env.MODE === 'delegation'
const prompts = events.filter((event: any) =>
  String(event.content ?? '').includes('This turn is ending with work you committed to still open'),
)
const expectedPrompts = delegation ? 0 : stubborn ? 3 : 1
check(prompts.length === expectedPrompts, `continuation prompts: expected ${expectedPrompts}, got ${prompts.length}`)
if (delegation) {
  // The point of the whole package: the work was done by a sub-agent, the runtime closed the step on
  // that evidence before the parent was resumed, and so there was nothing left to nudge about.
  const steps = detail.session.plan?.steps ?? []
  check(
    steps.map((step: any) => `${step.label}:${step.status}`).join(' | ') ===
      'Research the colors:done | Write the sentence:done',
    `the checklist ended closed (${steps.map((s: any) => `${s.label}:${s.status}`).join(' | ')})`,
  )
  check(
    steps[0]?.resolvedBy === 'runtime',
    `the delegated step says the runtime closed it (got ${steps[0]?.resolvedBy})`,
  )
  check(
    steps[1]?.resolvedBy === undefined,
    `the step the agent closed itself carries no runtime mark (got ${steps[1]?.resolvedBy})`,
  )
  check(list.runs[0]?.status === 'succeeded', `the run succeeded (${list.runs[0]?.status})`)
  check(list.runs[0]?.unmetObligations === undefined, 'the run ended owing nothing')
  const observed = await Bun.file(process.env.OBSERVATIONS || '/tmp/scripted-provider-observations.json')
    .json()
    .catch(() => ({parentTurns: []}))
  const first = observed.parentTurns?.find((entry: any) => entry.turn === 1)
  const resumed = observed.parentTurns?.find((entry: any) => entry.turn === 2)
  check(first?.planState === null, 'the first turn, with no checklist yet, was handed none')
  check(
    typeof resumed?.planState === 'string' && resumed.planState.includes('s1 · Research the colors · done'),
    `the resumed turn was handed the checklist with the step already closed (${String(resumed?.planState ?? 'none')
      .replace(/\n/g, ' ')
      .slice(0, 120)})`,
  )
  const logged = events.filter((event: any) => String(event.content ?? '').includes('<plan_state>'))
  check(logged.length === 0, `the injected checklist never reaches the log (${logged.length} found)`)
} else {
  check(prompts[0]?.actor === 'system', `the prompt is stamped actor 'system' (got ${prompts[0]?.actor})`)
  check(
    String(prompts[0]?.content ?? '').includes('Write the sentence'),
    'the prompt names the step that was left open',
  )
}
if (stubborn) {
  const notices = events.filter((event: any) =>
    String(event.content ?? '').includes('This run ended with work still open'),
  )
  check(notices.length === 1, `one visible unmet-obligations notice (got ${notices.length})`)
  check(notices[0]?.actor === 'system', `the notice is stamped actor 'system' (got ${notices[0]?.actor})`)
  check(
    detail.session.plan?.steps.some((step: any) => step.status === 'pending') === true,
    `nothing was ticked off on the agent's behalf (${(detail.session.plan?.steps ?? [])
      .map((s: any) => s.status)
      .join(', ')})`,
  )
  check(detail.session.plan?.settledAt === undefined, 'an unsettled plan carries no settle date')
  check(list.runs[0]?.status === 'succeeded', `an unfinished plan is not a failure (${list.runs[0]?.status})`)
  check(
    JSON.stringify(list.runs[0]?.unmetObligations) === JSON.stringify([{kind: 'plan', steps: ['Write the sentence']}]),
    `the run surfaces what it owed (${JSON.stringify(list.runs[0]?.unmetObligations ?? null)})`,
  )
} else if (!delegation) {
  check(
    detail.session.plan?.steps.every((step: any) => step.status === 'done') === true,
    `the checklist ended fully settled (${(detail.session.plan?.steps ?? []).map((s: any) => s.status).join(', ')})`,
  )
  check(typeof detail.session.plan?.settledAt === 'number', 'the moment it settled is dated on the plan')
  check(list.runs[0]?.status === 'succeeded', `the run succeeded (${list.runs[0]?.status})`)
  check(list.runs[0]?.unmetObligations === undefined, 'the run ended owing nothing')
}
const assistantMeta = events.filter((event: any) => event.type === 'message' && event.role === 'assistant').at(-1)?.meta
check(
  assistantMeta?.model === 'scripted-model' && assistantMeta?.provider === 'ollama',
  `assistant messages carry model/provider (${JSON.stringify(assistantMeta ?? null)})`,
)
check((assistantMeta?.usage?.total ?? 0) > 0, 'assistant messages carry per-turn token usage')
check(typeof assistantMeta?.durationMs === 'number', 'assistant messages carry wall time')

console.log('\n─── log ───')
for (const event of events) {
  if (event.type === 'message') {
    console.log(
      `[${event.role}/${event.actor ?? '(derived)'}] ${String(event.content).slice(0, 160).replace(/\n/g, ' ⏎ ')}`,
    )
  } else {
    console.log(`[${event.type}] ${JSON.stringify(event).slice(0, 120)}`)
  }
}
console.log('\n─── checks ───')
for (const line of checks) console.log(line)
await action({_: 'DeleteAgent', agentId: agent.agentId})
process.exit(checks.some((line) => line.startsWith('FAIL')) ? 1 : 0)
