import {afterEach, describe, expect, mock, test} from 'bun:test'
import type * as piAi from '@earendil-works/pi-ai'
import * as accounting from '@/context-accounting'

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

function png(width: number, height: number): string {
  const bytes = Buffer.alloc(32)
  bytes.writeUInt32BE(0x89504e47, 0)
  bytes.writeUInt32BE(0x0d0a1a0a, 4)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'latin1')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes.toString('base64')
}

function jpeg(width: number, height: number): string {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00])
  const frame = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 0, 0, 0])
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, frame]).toString('base64')
}

function gif(width: number, height: number): string {
  const bytes = Buffer.alloc(13)
  bytes.write('GIF89a', 0, 'latin1')
  bytes.writeUInt16LE(width, 6)
  bytes.writeUInt16LE(height, 8)
  return bytes.toString('base64')
}

function webp(width: number, height: number): string {
  const bytes = Buffer.alloc(32)
  bytes.write('RIFF', 0, 'latin1')
  bytes.write('WEBP', 8, 'latin1')
  bytes.write('VP8X', 12, 'latin1')
  bytes.writeUIntLE(width - 1, 24, 3)
  bytes.writeUIntLE(height - 1, 27, 3)
  return bytes.toString('base64')
}

function assistant(input: number, text = 'ok', stopReason: piAi.AssistantMessage['stopReason'] = 'stop') {
  return {
    role: 'assistant',
    content: [{type: 'text', text}],
    usage: {input, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: input + 10},
    stopReason,
    timestamp: 1,
  } as unknown as piAi.Message
}

const ref = {providerType: 'anthropic', modelId: 'claude-opus-5-5'}

describe('imageDimensions', () => {
  test('reads every format the runtime can inline', () => {
    expect(accounting.imageDimensions(png(1920, 1080))).toEqual({width: 1920, height: 1080})
    expect(accounting.imageDimensions(jpeg(1280, 720))).toEqual({width: 1280, height: 720})
    expect(accounting.imageDimensions(gif(320, 200))).toEqual({width: 320, height: 200})
    expect(accounting.imageDimensions(webp(800, 600))).toEqual({width: 800, height: 600})
  })

  test('does not invent a size for unreadable data', () => {
    expect(accounting.imageDimensions(Buffer.from('not an image').toString('base64'))).toBeUndefined()
  })
})

describe('estimateImageTokens', () => {
  test('anthropic scales by pixels within each model tier', () => {
    expect(accounting.estimateImageTokens('anthropic', 'claude-opus-5-5', png(1000, 750))).toBe(1000)
    expect(accounting.estimateImageTokens('anthropic', 'claude-opus-5-5', png(8000, 8000))).toBe(4_784)
    expect(accounting.estimateImageTokens('anthropic', 'claude-sonnet-4-5', png(8000, 8000))).toBeLessThanOrEqual(1534)
  })

  test('openai counts high-detail tiles', () => {
    expect(accounting.estimateImageTokens('openai', 'gpt-4o', png(1024, 1024))).toBe(765)
  })

  test('gpt-5 and later count patches, matching counts measured from the live API', () => {
    const tokens = (width: number, height: number) =>
      accounting.estimateImageTokens('openai', 'gpt-5.6-terra', png(width, height))
    expect(tokens(256, 256)).toBe(77)
    expect(tokens(1024, 768)).toBe(922)
    expect(Math.abs(tokens(1920, 1080) - 2449)).toBeLessThanOrEqual(1)
    expect(Math.abs(tokens(3000, 2000) - 2881)).toBeLessThanOrEqual(1)
  })

  test('google charges a flat rate per image, by generation', () => {
    expect(accounting.estimateImageTokens('google', 'gemini-2.5-flash', png(300, 300))).toBe(258)
    expect(accounting.estimateImageTokens('google', 'gemini-2.5-flash', png(3000, 2000))).toBe(258)
    expect(accounting.estimateImageTokens('google', 'gemini-3.5-flash', png(3000, 2000))).toBe(1_090)
  })

  test('openrouter routes are sized like their vendor', () => {
    expect(accounting.estimateImageTokens('openrouter', 'google/gemini-2.5-flash', png(1024, 768))).toBe(258)
    expect(
      accounting.estimateImageTokens('openrouter', 'anthropic/claude-sonnet-4.5', png(8000, 8000)),
    ).toBeLessThanOrEqual(1_568)
  })

  test('size follows pixels, not bytes', () => {
    const padded = Buffer.concat([Buffer.from(png(100, 100), 'base64'), Buffer.alloc(100_000)]).toString('base64')
    expect(accounting.estimateImageTokens('anthropic', 'claude-opus-5-5', padded)).toBe(14)
  })
})

describe('estimateNextPromptTokens', () => {
  test('starts from the measurement and adds the response and what followed', () => {
    const toolResult = {
      role: 'toolResult',
      toolCallId: 'a',
      toolName: 'read',
      content: [
        {type: 'text', text: 'x'.repeat(350)},
        {type: 'image', data: png(1000, 750), mimeType: 'image/png'},
      ],
      isError: false,
      timestamp: 2,
    } as unknown as piAi.Message
    const tokens = accounting.estimateNextPromptTokens([assistant(5_000, 'y'.repeat(35)), toolResult], ref, {
      overheadTokens: 99_999,
    })
    expect(tokens).toBe(5_000 + 10 + 100 + 1000)
  })

  test('a failed response is not a measurement', () => {
    const tokens = accounting.estimateNextPromptTokens([assistant(5_000), assistant(0, 'x', 'error')], ref, {
      overheadTokens: 0,
    })
    expect(tokens).toBeGreaterThanOrEqual(5_000)
    const onlyFailed = accounting.estimateNextPromptTokens([assistant(9_000, 'x', 'error')], ref, {overheadTokens: 7})
    expect(onlyFailed).toBeLessThan(100)
  })

  test('removes turn-only images measured by an earlier run', () => {
    const tokens = accounting.estimateNextPromptTokens([assistant(5_000, '')], ref, {
      overheadTokens: 0,
      measuredDiscountTokens: 1_200,
    })
    expect(tokens).toBe(3_800)
  })

  test('falls back to the logged measurement for a replayed transcript', () => {
    const tokens = accounting.estimateNextPromptTokens([assistant(0, 'short')], ref, {
      overheadTokens: 10,
      carriedPromptTokens: 40_000,
    })
    expect(tokens).toBe(40_000)
  })
})

describe('resolveContextWindow', () => {
  test('uses the model catalog', () => {
    expect(accounting.resolveContextWindow('anthropic', 'claude-opus-5-5')).toBe(1_000_000)
    expect(accounting.resolveContextWindow('anthropic', 'claude-haiku-4-5')).toBe(200_000)
    expect(accounting.resolveContextWindow('google', 'gemini-3.1-flash-lite-image')).toBe(65_536)
    expect(accounting.resolveContextWindow('openai', 'gpt-4')).toBe(8_192)
  })

  test('takes reserved output off OpenAI combined windows', () => {
    expect(accounting.resolveContextWindow('openai', 'gpt-5')).toBe(272_000)
    expect(accounting.resolveContextWindow('openai', 'gpt-5.5')).toBe(272_000)
  })

  test('assumes little for a local model until its server reports', async () => {
    const baseUrl = 'http://ollama.test/v1'
    expect(accounting.resolveContextWindow('ollama', 'tiny', baseUrl)).toBe(32_000)
    globalThis.fetch = mock(
      async () => new Response(JSON.stringify({models: [{name: 'tiny', context_length: 4096}]})),
    ) as unknown as typeof fetch
    await accounting.discoverContextWindow('ollama', baseUrl, 'tiny')
    expect(accounting.resolveContextWindow('ollama', 'tiny', baseUrl)).toBe(4096)
  })

  test('a failed lookup leaves the static answer', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('down')
    }) as unknown as typeof fetch
    await accounting.discoverContextWindow('openrouter', 'http://router.test', 'a/b')
    expect(accounting.resolveContextWindow('openrouter', 'a/b', 'http://router.test')).toBe(128_000)
  })
})
