/**
 * Live check of context accounting against real providers. Spends a few cents of real tokens, so it
 * is a manual script. For each provider with a key it compares our window with the provider's
 * published limit where an API reports one, and our image estimate with the tokens the provider
 * actually counts (the same prompt with and without the image).
 *
 *   ANTHROPIC_API_KEY=… OPENAI_API_KEY=… GEMINI_API_KEY=… bun e2e/context-accounting-live.ts
 *   OLLAMA_MODEL=llama3.2 bun e2e/context-accounting-live.ts   # also checks a local Ollama
 *   OPENAI_SUBSCRIPTION_CREDENTIALS='{"access":…}' bun e2e/context-accounting-live.ts
 *
 * Subscription credentials are used as given and never refreshed: pass a copy whose `refresh` is
 * blank, because refreshing would rotate the token out from under the server that owns it.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as zlib from 'node:zlib'
import {Database} from 'bun:sqlite'
import * as os from 'node:os'
import * as piAi from '@earendil-works/pi-ai'
import * as protocol from '@seed-hypermedia/apps-protocol'
import * as blobs from '@shm/shared/blobs'
import * as apisvc from '../src/api-service'
import * as cbor from '../src/cbor'
import * as accounting from '../src/context-accounting'
import * as sqlite from '../src/sqlite'

// Keys may also live in the repo-root .keys file (gitignored), one NAME=value per line.
const keysFile = path.join(import.meta.dir, '..', '..', '.keys')
if (fs.existsSync(keysFile)) {
  for (const line of fs.readFileSync(keysFile, 'utf8').split('\n')) {
    const match = /^(?:export\s+)?([A-Z_]+_API_KEY)\s*=\s*(.+)$/.exec(line.trim())
    if (match && !process.env[match[1]!]) process.env[match[1]!] = match[2]!.replace(/^['"]|['"]$/g, '')
  }
}

const SIZES = [
  [256, 256],
  [1024, 768],
  [1920, 1080],
  [3000, 2000],
] as const
/** How far an image estimate may be from the provider's count and still pass. */
const IMAGE_TOLERANCE = 0.25

function crc32(bytes: Uint8Array): number {
  let crc = ~0
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return ~crc >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** A real, decodable PNG with a simple gradient. */
function makePng(width: number, height: number): string {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  const rows = Buffer.alloc((width * 3 + 1) * height)
  for (let y = 0, at = 0; y < height; y += 1) {
    at += 1
    for (let x = 0; x < width; x += 1) {
      rows[at++] = (x * 255) / width
      rows[at++] = (y * 255) / height
      rows[at++] = 128
    }
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64')
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {'content-type': 'application/json', ...headers},
    body: JSON.stringify(body),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(json).slice(0, 300)}`)
  return json
}

type Target = {
  providerType: string
  modelId: string
  reportedWindow?: () => Promise<number | undefined>
  /** Prompt tokens of a short question, with an image when one is given. */
  count: (image?: string) => Promise<number>
}

function targets(): Target[] {
  const list: Target[] = []
  const anthropicKey = process.env.ANTHROPIC_API_KEY
  if (anthropicKey) {
    const headers = {'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01'}
    for (const modelId of ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5']) {
      list.push({
        providerType: 'anthropic',
        modelId,
        reportedWindow: async () => {
          const response = await fetch(`https://api.anthropic.com/v1/models/${modelId}`, {headers})
          return ((await response.json()) as {max_input_tokens?: number}).max_input_tokens
        },
        count: async (image) => {
          const content = [
            ...(image ? [{type: 'image', source: {type: 'base64', media_type: 'image/png', data: image}}] : []),
            {type: 'text', text: 'Describe this.'},
          ]
          const body = {model: modelId, messages: [{role: 'user', content}]}
          return (await postJson('https://api.anthropic.com/v1/messages/count_tokens', headers, body)).input_tokens
        },
      })
    }
  }
  const openaiKey = process.env.OPENAI_API_KEY
  if (openaiKey) {
    for (const modelId of ['gpt-4o', 'gpt-5.5', 'gpt-5.6-terra']) {
      list.push({
        providerType: 'openai',
        modelId,
        count: async (image) => {
          const content = [
            ...(image ? [{type: 'input_image', image_url: `data:image/png;base64,${image}`, detail: 'high'}] : []),
            {type: 'input_text', text: 'Describe this.'},
          ]
          const body = {model: modelId, max_output_tokens: 16, input: [{role: 'user', content}]}
          const headers = {authorization: `Bearer ${openaiKey}`}
          return (await postJson('https://api.openai.com/v1/responses', headers, body)).usage.input_tokens
        },
      })
    }
  }
  const googleKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY
  if (googleKey) {
    const root = 'https://generativelanguage.googleapis.com/v1beta/models'
    const headers = {'x-goog-api-key': googleKey}
    for (const modelId of ['gemini-2.5-flash', 'gemini-3.5-flash']) {
      list.push({
        providerType: 'google',
        modelId,
        reportedWindow: async () => {
          const response = await fetch(`${root}/${modelId}`, {headers})
          return ((await response.json()) as {inputTokenLimit?: number}).inputTokenLimit
        },
        count: async (image) => {
          const parts = [
            ...(image ? [{inlineData: {mimeType: 'image/png', data: image}}] : []),
            {text: 'Describe this.'},
          ]
          return (await postJson(`${root}/${modelId}:countTokens`, headers, {contents: [{parts}]})).totalTokens
        },
      })
    }
  }
  return list
}

async function checkOllama(): Promise<boolean> {
  const modelId = process.env.OLLAMA_MODEL
  if (!modelId) return true
  const baseUrl = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434/v1'
  const root = baseUrl.replace(/\/v1\/?$/, '')
  await postJson(`${root}/api/generate`, {}, {model: modelId, prompt: 'Hi', stream: false, options: {num_predict: 1}})
  const running = (await (await fetch(`${root}/api/ps`)).json()) as {
    models: Array<{name: string; context_length?: number}>
  }
  const loaded = running.models.find((model) => model.name === modelId)?.context_length
  await accounting.discoverContextWindow('ollama', baseUrl, modelId)
  const resolved = accounting.resolveContextWindow('ollama', modelId, baseUrl)
  const pass = loaded === resolved
  console.log(`${pass ? 'PASS' : 'FAIL'} ollama/${modelId} window: ours ${resolved}, loaded ${loaded}`)
  return pass
}

/** Sends a prompt just over our limit: the provider must refuse it in a way we recognize as overflow. */
async function checkOpenAIOverflow(modelId: string, apiKey: string): Promise<boolean> {
  const window = accounting.resolveContextWindow('openai', modelId)
  const words = Math.ceil(window * 1.06)
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${apiKey}`},
    body: JSON.stringify({model: modelId, max_output_tokens: 16, input: 'hello '.repeat(words)}),
  })
  const body = (await response.json()) as {error?: {message?: string}; usage?: {input_tokens?: number}}
  if (response.ok) {
    console.log(
      `INFO openai/${modelId} accepted ${body.usage?.input_tokens} tokens; our ${window} limit is conservative`,
    )
    return true
  }
  const errorMessage = body.error?.message ?? ''
  const pass = piAi.isContextOverflow({stopReason: 'error', errorMessage} as piAi.AssistantMessage)
  console.log(
    `${pass ? 'PASS' : 'FAIL'} openai/${modelId} over-limit prompt (${words} words) refused, ${
      pass ? 'recognized as overflow' : `unrecognized: ${errorMessage.slice(0, 160)}`
    }`,
  )
  return pass
}

const CODEX_URL = 'https://chatgpt.com/backend-api/codex/responses'

/** One Codex backend request; resolves to its usage, or to the provider's error text. */
async function codexRequest(
  credentials: {access: string; accountId: string},
  modelId: string,
  content: unknown[],
): Promise<{inputTokens?: number; error?: string}> {
  const response = await fetch(CODEX_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${credentials.access}`,
      'chatgpt-account-id': credentials.accountId,
      'openai-beta': 'responses=experimental',
      originator: 'pi',
    },
    body: JSON.stringify({
      model: modelId,
      instructions: 'Reply with one word.',
      input: [{role: 'user', content}],
      store: false,
      stream: true,
    }),
  })
  const text = await response.text()
  if (!response.ok) {
    try {
      const body = JSON.parse(text) as {error?: {message?: string}; detail?: string}
      return {error: body.error?.message ?? body.detail ?? text.slice(0, 300)}
    } catch {
      return {error: text.slice(0, 300)}
    }
  }
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
    const event = JSON.parse(line.slice(6)) as {
      type?: string
      message?: string
      error?: {message?: string}
      response?: {usage?: {input_tokens?: number}; error?: {message?: string}}
    }
    if (event.type === 'response.completed') return {inputTokens: event.response?.usage?.input_tokens}
    if (event.type === 'response.failed' || event.type === 'error') {
      return {error: event.response?.error?.message ?? event.error?.message ?? event.message ?? 'failed'}
    }
  }
  return {error: 'no completed event'}
}

/** Windows, image sizes, overflow and a full agent turn over a ChatGPT subscription. */
async function checkSubscription(raw: string): Promise<boolean> {
  const credentials = JSON.parse(raw) as {access: string; accountId: string}
  let ok = true
  for (const modelId of ['gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-sol']) {
    const label = `openai-subscription/${modelId}`
    const count = async (image?: string) => {
      const content = [
        ...(image ? [{type: 'input_image', image_url: `data:image/png;base64,${image}`, detail: 'high'}] : []),
        {type: 'input_text', text: 'Describe this.'},
      ]
      const result = await codexRequest(credentials, modelId, content)
      if (result.inputTokens === undefined) throw new Error(result.error ?? 'no usage')
      return result.inputTokens
    }
    try {
      const base = await count()
      for (const [width, height] of SIZES) {
        const image = makePng(width, height)
        const actual = (await count(image)) - base
        const estimated = accounting.estimateImageTokens('openai', modelId, image)
        const error = Math.abs(estimated - actual) / actual
        const pass = error <= IMAGE_TOLERANCE
        ok &&= pass
        console.log(
          `${
            pass ? 'PASS' : 'FAIL'
          } ${label} ${width}x${height}: estimated ${estimated}, actual ${actual} (${Math.round(error * 100)}% off)`,
        )
      }
    } catch (error) {
      ok = false
      console.log(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
    ok =
      (await checkAgentRun({type: 'openai', authMode: 'subscription', secretRefs: {oauth: 'oauth'}}, modelId, {
        oauth: raw,
      })) && ok
  }
  // One over-limit probe: a refused prompt costs nothing, an accepted one spends plan quota.
  const words = Math.ceil(accounting.resolveContextWindow('openai', 'gpt-5.6-terra') * 1.06)
  const result = await codexRequest(credentials, 'gpt-5.6-terra', [{type: 'input_text', text: 'hello '.repeat(words)}])
  if (result.error) {
    const pass = piAi.isContextOverflow({stopReason: 'error', errorMessage: result.error} as piAi.AssistantMessage)
    ok &&= pass
    console.log(
      `${
        pass ? 'PASS' : 'FAIL'
      } openai-subscription/gpt-5.6-terra over-limit prompt (${words} words): ${result.error.slice(0, 140)}`,
    )
  } else {
    console.log(`INFO openai-subscription/gpt-5.6-terra accepted ${result.inputTokens} tokens over our limit`)
  }
  return ok
}

/** Real image counts for Claude and Gemini routes, and the window OpenRouter reports for each. */
async function checkOpenRouter(apiKey: string): Promise<boolean> {
  const baseUrl = 'https://openrouter.ai/api/v1'
  const listed = (await (await fetch(`${baseUrl}/models`)).json()) as {data: Array<{id: string}>}
  const available = new Set(listed.data.map((model) => model.id))
  const wanted = [
    'anthropic/claude-opus-5.5',
    'anthropic/claude-sonnet-5.5',
    'anthropic/claude-sonnet-4.5',
    'google/gemini-2.5-flash',
    'google/gemini-3.5-flash',
  ]
  let ok = true
  for (const modelId of wanted) {
    const label = `openrouter/${modelId}`
    if (!available.has(modelId)) {
      console.log(`INFO ${label}: not offered`)
      continue
    }
    await accounting.discoverContextWindow('openrouter', baseUrl, modelId)
    console.log(`INFO ${label} window: ${accounting.resolveContextWindow('openrouter', modelId, baseUrl)}`)
    const count = async (image?: string): Promise<number> => {
      const content = [
        ...(image ? [{type: 'image_url', image_url: {url: `data:image/png;base64,${image}`}}] : []),
        {type: 'text', text: 'Describe this.'},
      ]
      const body = {model: modelId, max_tokens: 16, messages: [{role: 'user', content}]}
      const reply = await postJson(`${baseUrl}/chat/completions`, {authorization: `Bearer ${apiKey}`}, body)
      if (reply.usage?.prompt_tokens === undefined) throw new Error('no usage reported')
      return reply.usage.prompt_tokens
    }
    try {
      const base = await count()
      for (const [width, height] of SIZES) {
        const image = makePng(width, height)
        const actual = (await count(image)) - base
        const estimated = accounting.estimateImageTokens('openrouter', modelId, image)
        const error = Math.abs(estimated - actual) / actual
        const pass = error <= IMAGE_TOLERANCE
        ok &&= pass
        console.log(
          `${
            pass ? 'PASS' : 'FAIL'
          } ${label} ${width}x${height}: estimated ${estimated}, actual ${actual} (${Math.round(error * 100)}% off)`,
        )
      }
    } catch (error) {
      ok = false
      console.log(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return ok
}

/** One real agent turn through the Service: a tool shows an image, and the log must measure it. */
async function checkAgentRun(
  provider: Record<string, unknown>,
  modelId: string,
  secrets: Record<string, string> = {},
): Promise<boolean> {
  const label = `${provider.type}/${modelId} agent run`
  const db = new Database(':memory:', {create: true, strict: true})
  if (!sqlite.openWithDatabase(db).ok) throw new Error('schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-accounting-live-'))
  const account = blobs.generateNobleKeyPair()
  const service = new apisvc.Service(db, dataDir, {})
  const send = async (action: unknown): Promise<any> =>
    service.message(await apisvc.createSignedEnvelope(account, {action: action as never}))
  const log = console.info
  console.info = () => {}
  try {
    for (const [name, value] of Object.entries(secrets)) {
      await send({_: 'SetSecret', name, value: new TextEncoder().encode(value)})
    }
    await send({
      _: 'SetModelProvider',
      name: 'live',
      provider,
    })
    const agent = await send({
      _: 'CreateAgent',
      definition: {name: 'Live', systemPrompt: 'Be terse.', modelProvider: 'live', model: modelId},
    })
    const session = await send({_: 'CreateSession', agentId: agent.agentId})
    const vision = protocol.modelSupportsImageInput(String(provider.type), modelId)
    let prompt = 'Reply with the single word ready.'
    const content: unknown[] = []
    if (vision) {
      const uploaded = await send({
        _: 'UploadSessionAttachment',
        sessionId: session.sessionId,
        name: 'gradient.png',
        mimeType: 'image/png',
        content: new Uint8Array(Buffer.from(makePng(1024, 768), 'base64')),
      })
      prompt = `Use the read tool on attachment:${uploaded.attachment.id}, then name its main colors in one line.`
      content.push({type: 'attachment', id: uploaded.attachment.id})
    }
    await send({_: 'MessageSession', sessionId: session.sessionId, content: [{type: 'text', text: prompt}, ...content]})
    const events = db
      .query<{event_cbor: Uint8Array}, [string]>(
        `SELECT event_cbor FROM session_events WHERE session_id = ? ORDER BY seq`,
      )
      .all(session.sessionId)
      .map((row) => cbor.decode(row.event_cbor))
    const readings = events.flatMap((event) => protocol.eventContextReading(event) ?? [])
    const last = readings.at(-1)
    const sawImage = readings.some((reading) => reading.ephemeralImageTokens > 0)
    const pass = !!last && last.promptTokens > 0 && (!vision || sawImage)
    const details = await send({_: 'GetSession', sessionId: session.sessionId})
    console.log(
      `${pass ? 'PASS' : 'FAIL'} ${label}: ${readings.length} measured responses, prompt ${last?.promptTokens}, image ${
        last?.ephemeralImageTokens ?? 0
      }, window ${details.contextWindow}`,
    )
    return pass
  } catch (error) {
    console.log(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`)
    return false
  } finally {
    console.info = log
    service.stopRunQueue()
    sqlite.closeDatabase(db)
    fs.rmSync(dataDir, {recursive: true, force: true})
  }
}

let failed = !(await checkOllama())
if (process.env.OLLAMA_MODEL) {
  const baseUrl = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434/v1'
  failed = !(await checkAgentRun({type: 'ollama', baseUrl}, process.env.OLLAMA_MODEL)) || failed
}
const selected = targets()
if (process.env.OPENAI_SUBSCRIPTION_CREDENTIALS) {
  failed = !(await checkSubscription(process.env.OPENAI_SUBSCRIPTION_CREDENTIALS)) || failed
}
if (process.env.OPENROUTER_API_KEY) {
  failed = !(await checkOpenRouter(process.env.OPENROUTER_API_KEY)) || failed
}
if (
  !selected.length &&
  !process.env.OLLAMA_MODEL &&
  !process.env.OPENAI_SUBSCRIPTION_CREDENTIALS &&
  !process.env.OPENROUTER_API_KEY
) {
  console.error(
    'No provider configured: set ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY, OPENAI_SUBSCRIPTION_CREDENTIALS or OLLAMA_MODEL.',
  )
  process.exit(2)
}
for (const target of selected) {
  const label = `${target.providerType}/${target.modelId}`
  try {
    const ours = accounting.resolveContextWindow(target.providerType, target.modelId)
    const reported = await target.reportedWindow?.()
    if (reported !== undefined) {
      const pass = ours <= reported
      failed ||= !pass
      console.log(`${pass ? 'PASS' : 'FAIL'} ${label} window: ours ${ours}, provider ${reported}`)
    } else {
      console.log(`INFO ${label} window: ours ${ours} (no API reports this provider's limit)`)
    }
    const base = await target.count()
    for (const [width, height] of SIZES) {
      const image = makePng(width, height)
      const actual = (await target.count(image)) - base
      const estimated = accounting.estimateImageTokens(target.providerType, target.modelId, image)
      const error = Math.abs(estimated - actual) / actual
      const pass = error <= IMAGE_TOLERANCE
      failed ||= !pass
      console.log(
        `${pass ? 'PASS' : 'FAIL'} ${label} ${width}x${height}: estimated ${estimated}, actual ${actual} (${Math.round(
          error * 100,
        )}% off)`,
      )
    }
  } catch (error) {
    failed = true
    console.log(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
const openaiKey = process.env.OPENAI_API_KEY
if (openaiKey) {
  for (const target of selected.filter((candidate) => candidate.providerType === 'openai')) {
    try {
      failed = !(await checkOpenAIOverflow(target.modelId, openaiKey)) || failed
    } catch (error) {
      failed = true
      console.log(`FAIL openai/${target.modelId} overflow: ${error instanceof Error ? error.message : String(error)}`)
    }
    failed =
      !(await checkAgentRun({type: 'openai', secretRefs: {apiKey: 'key'}}, target.modelId, {key: openaiKey})) || failed
  }
}
process.exit(failed ? 1 : 0)
