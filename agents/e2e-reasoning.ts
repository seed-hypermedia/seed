// Manual e2e: drives the real Service against the real OpenAI API to prove the
// gpt-5.6-terra + tools fix and reasoning levels. Run: bun e2e-reasoning.ts <api-key>
// Kept as a manual script (not a bun test) because it spends real tokens.
import {Database} from 'bun:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as apisvc from './src/api-service'
import * as sqlite from './src/sqlite'
import * as blobs from '@shm/shared/blobs'

const apiKey = process.argv[2]
if (!apiKey) throw new Error('usage: bun e2e-reasoning.ts <openai-api-key>')

const db = new Database(':memory:', {create: true, strict: true})
const result = sqlite.openWithDatabase(db)
if (!result.ok) throw new Error('schema mismatch')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-e2e-'))
const account = blobs.generateNobleKeyPair()
const svc = new apisvc.Service(db, dataDir)

async function send(action: unknown): Promise<any> {
  return svc.message(await apisvc.createSignedEnvelope(account, {action} as never))
}

await send({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}}})
await send({_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode(apiKey)})

async function runScenario(model: string, reasoningLevel?: string): Promise<void> {
  const created = await send({
    _: 'CreateAgent',
    definition: {
      name: `E2E ${model} ${reasoningLevel ?? 'off'}`,
      systemPrompt: 'You are terse. Answer in one short sentence.',
      modelProvider: 'openai',
      model,
      ...(reasoningLevel ? {reasoningLevel} : {}),
    },
  })
  if (created._ !== 'CreateAgentResponse') throw new Error('create failed')
  const session = await send({_: 'CreateSession', agentId: created.agentId})
  if (session._ !== 'CreateSessionResponse') throw new Error('session failed')
  const reply = await send({
    _: 'MessageSession',
    sessionId: session.sessionId,
    content: [{type: 'text', text: 'What is 2+2? Reply with just the number.'}],
  })
  if (reply._ !== 'MessageSessionResponse') throw new Error(`message failed: ${JSON.stringify(reply)}`)
  const events = await send({_: 'GetSession', sessionId: session.sessionId})
  const last = events.events[events.events.length - 1]?.event
  console.log(`✔ ${model} / ${reasoningLevel ?? 'off'} →`, JSON.stringify(last).slice(0, 140))
}

try {
  await runScenario('gpt-5.6-terra') // the exact case that 400'd in prod (tools + default reasoning)
  await runScenario('gpt-5.6-terra', 'low') // reasoning + tools via Responses API
  await runScenario('gpt-5-mini') // unchanged completions path
  await runScenario('gpt-5-mini', 'minimal') // 5.0-family level via Responses API
  console.log('ALL SCENARIOS PASSED')
} finally {
  fs.rmSync(dataDir, {recursive: true, force: true})
}
