import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, mock, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as apisvc from '@/api-service'
import type * as api from '@/api'
import * as cbor from '@/cbor'
import * as sqlite from '@/sqlite'
import * as protocol from '@seed-hypermedia/apps-protocol'
import * as blobs from '@shm/shared/blobs'

/** Context accounting through real runs: a canned provider reports usage, the requests show the result. */

const cleanups: Array<() => void> = []
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  while (cleanups.length) cleanups.pop()?.()
})

async function createSession() {
  const db = new Database(':memory:', {create: true, strict: true})
  if (!sqlite.openWithDatabase(db).ok) throw new Error('unexpected schema mismatch')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'context-accounting-test-'))
  const account = blobs.generateNobleKeyPair()
  const service = new apisvc.Service(db, dataDir, {})
  const send = async (action: unknown) =>
    service.message(await apisvc.createSignedEnvelope(account, {action: action as never}))
  await send({_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')})
  await send({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}}})
  const agent = await send({
    _: 'CreateAgent',
    definition: {name: 'Counter', systemPrompt: 'ok', modelProvider: 'openai', model: 'gpt-4o'},
  })
  if (agent._ !== 'CreateAgentResponse') throw new Error('unexpected response')
  const session = await send({_: 'CreateSession', agentId: agent.agentId})
  if (session._ !== 'CreateSessionResponse') throw new Error('unexpected response')
  cleanups.push(() => {
    service.stopRunQueue()
    sqlite.closeDatabase(db)
    fs.rmSync(dataDir, {recursive: true, force: true})
  })
  return {db, service, send, sessionId: session.sessionId}
}

function sse(chunks: unknown[]): Response {
  return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: {'content-type': 'text/event-stream'},
  })
}

function usage(promptTokens: number) {
  return {prompt_tokens: promptTokens, completion_tokens: 5, total_tokens: promptTokens + 5}
}

function textReply(text: string, promptTokens: number): Response {
  return sse([
    {id: 'text', choices: [{index: 0, delta: {role: 'assistant', content: text}}]},
    {id: 'text', choices: [{index: 0, delta: {}, finish_reason: 'stop'}], usage: usage(promptTokens)},
  ])
}

function toolReply(callId: string, address: string, promptTokens: number): Response {
  const call = {index: 0, id: callId, type: 'function', function: {name: 'read', arguments: JSON.stringify({address})}}
  return sse([
    {id: callId, choices: [{index: 0, delta: {role: 'assistant', tool_calls: [call]}}]},
    {id: callId, choices: [{index: 0, delta: {}, finish_reason: 'tool_calls'}], usage: usage(promptTokens)},
  ])
}

function png(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(40)
  bytes.writeUInt32BE(0x89504e47, 0)
  bytes.writeUInt32BE(0x0d0a1a0a, 4)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'latin1')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return new Uint8Array(bytes)
}

function contextBlocks(body: string): number[] {
  return [...body.matchAll(/<context_usage tokens=\\"(\d+)\\"/g)].map((match) => Number(match[1]))
}

function sessionEvents(db: Database, sessionId: string): unknown[] {
  return db
    .query<{event_cbor: Uint8Array}, [string]>(
      `SELECT event_cbor FROM session_events WHERE session_id = ? ORDER BY seq`,
    )
    .all(sessionId)
    .map((row) => cbor.decode(row.event_cbor))
}

async function uploadImage(h: Awaited<ReturnType<typeof createSession>>, image: Uint8Array): Promise<string> {
  const uploaded = await h.send({
    _: 'UploadSessionAttachment',
    sessionId: h.sessionId,
    name: 'shot.png',
    mimeType: 'image/png',
    content: image,
  })
  if (uploaded._ !== 'UploadSessionAttachmentResponse') throw new Error('unexpected response')
  return uploaded.attachment.id
}

describe('context accounting in a run', () => {
  test('a tool loop raises each pressure level once, without disturbing the prompt prefix', async () => {
    const h = await createSession()
    const bodies: string[] = []
    const replies = [
      () => toolReply('call-1', '~/memory/', 50_000),
      () => toolReply('call-2', '~/memory/', 95_000),
      () => toolReply('call-3', '~/memory/', 115_000),
      () => toolReply('call-4', '~/memory/', 116_000),
      () => textReply('Done.', 117_000),
    ]
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body))
      return replies[bodies.length - 1]!()
    }) as unknown as typeof fetch

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Look around'}]})

    expect(bodies).toHaveLength(5)
    expect(contextBlocks(bodies[1]!)).toHaveLength(0)
    expect(contextBlocks(bodies[2]!)).toHaveLength(1)
    expect(contextBlocks(bodies[2]!)[0]).toBeGreaterThanOrEqual(95_000)
    expect(bodies[2]).toContain('Context pressure')
    expect(contextBlocks(bodies[3]!)).toHaveLength(2)
    expect(bodies[3]).toContain('nearly full')
    expect(contextBlocks(bodies[4]!)).toHaveLength(2)
    const messagesOf = (body: string) => (JSON.parse(body) as {messages: unknown[]}).messages
    const before = messagesOf(bodies[2]!)
    expect(messagesOf(bodies[3]!).slice(0, before.length)).toEqual(before)
  })

  test('tool-only responses are measured for the next turn', async () => {
    const h = await createSession()
    const bodies: string[] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body))
      if (bodies.length === 1) return toolReply('call-1', '~/memory/', 60_000)
      if (bodies.length === 2) return sse([{id: 'x', choices: [{index: 0, delta: {}, finish_reason: 'stop'}]}])
      return textReply('Fine.', 61_000)
    }) as unknown as typeof fetch

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'First'}]})
    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Second'}]})

    const blocks = contextBlocks(bodies.at(-1)!)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toBeGreaterThanOrEqual(60_000)
  })

  test('an image counts for the turn that saw it and not for the conversation after', async () => {
    const h = await createSession()
    const attachmentId = await uploadImage(h, png(1000, 750))
    const bodies: string[] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body))
      if (bodies.length === 1) return toolReply('call-look', `attachment:${attachmentId}`, 2_000)
      if (bodies.length === 2) return textReply('A chart.', 2_765)
      return textReply('Welcome.', 2_100)
    }) as unknown as typeof fetch

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Look'}]})

    const answer = sessionEvents(h.db, h.sessionId).findLast((event) => (event as {role?: string}).role === 'assistant')
    const reading = protocol.eventContextReading(answer)!
    expect(reading).toEqual({promptTokens: 2_765, ephemeralImageTokens: 765})
    expect(protocol.contextTokensOfReading(reading)).toBe(2_000)

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Thanks'}]})
    const next = contextBlocks(bodies[2]!)[0]!
    expect(next).toBeGreaterThanOrEqual(2_000)
    expect(next).toBeLessThan(2_765)
  })

  test('an image that cannot fit is left out and the model is told', async () => {
    const h = await createSession()
    const image = png(2000, 2000)
    const attachmentId = await uploadImage(h, image)
    const base64 = Buffer.from(image).toString('base64')
    const bodies: string[] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body))
      if (bodies.length === 1) return toolReply('call-look', `attachment:${attachmentId}`, 127_500)
      return textReply('Understood.', 127_600)
    }) as unknown as typeof fetch

    await h.send({_: 'MessageSession', sessionId: h.sessionId, content: [{type: 'text', text: 'Look'}]})

    expect(bodies[1]).not.toContain(base64)
    expect(bodies[1]).toContain('<context_notice>')
    expect(bodies[1]).toContain('call-look')
  })

  test('a prompt the provider rejects as too large continues in a successor that answers', async () => {
    const h = await createSession()
    const bodies: string[] = []
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body)
      bodies.push(body)
      if (body.includes('<session_continuation>')) return textReply('Answered in the successor.', 3_000)
      return new Response(
        JSON.stringify({
          error: {
            message: "This model's maximum context length is 128000 tokens. However, you requested 140000 tokens.",
            code: 'context_length_exceeded',
          },
        }),
        {status: 400, headers: {'content-type': 'application/json'}},
      )
    }) as unknown as typeof fetch

    const response = await h.send({
      _: 'MessageSession',
      sessionId: h.sessionId,
      content: [{type: 'text', text: 'Summarize everything so far'}],
    })
    if (response._ !== 'MessageSessionResponse') throw new Error('unexpected response')
    const successorId = response.continuedToSessionId
    expect(successorId).toBeTruthy()
    await h.service.awaitQueueIdle()

    const successor = sessionEvents(h.db, successorId!)
    expect(successor.some((event) => (event as {content?: string}).content === 'Answered in the successor.')).toBe(true)
    expect(successor.some((event) => (event as {content?: string}).content === 'Summarize everything so far')).toBe(
      true,
    )
    const edge = h.db
      .query<{reason: string}, [string]>(`SELECT reason FROM session_continuations WHERE predecessor_session_id = ?`)
      .get(h.sessionId)
    expect(edge?.reason).toBe('context_pressure')
  })
})
