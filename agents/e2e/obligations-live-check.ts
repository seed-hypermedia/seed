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

const detail = await action({_: 'GetSession', sessionId: session.sessionId})
const list = await action({_: 'ListRuns', sessionId: session.sessionId})
const events = detail.events.map((event: any) => event.event)

const stubborn = process.env.MODE === 'stubborn'
const prompts = events.filter((event: any) =>
  String(event.content ?? '').includes('This turn is ending with work you committed to still open'),
)
check(
  prompts.length === (stubborn ? 3 : 1),
  `continuation prompts: expected ${stubborn ? 3 : 1}, got ${prompts.length}`,
)
check(prompts[0]?.actor === 'system', `the prompt is stamped actor 'system' (got ${prompts[0]?.actor})`)
check(String(prompts[0]?.content ?? '').includes('Write the sentence'), 'the prompt names the step that was left open')
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
} else {
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
