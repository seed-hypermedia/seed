import {describe, expect, test} from 'bun:test'
import {
  contextTokensOfReading,
  DEFAULT_LOCAL_CONTEXT_WINDOW,
  DEFAULT_MODEL_CONTEXT_WINDOW,
  eventContextReading,
  modelContextWindow,
} from './model-capabilities'

describe('modelContextWindow', () => {
  test('anthropic models are 200k, with the 1m tier marked by suffix', () => {
    expect(modelContextWindow('anthropic', 'claude-sonnet-4-5')).toBe(200_000)
    expect(modelContextWindow('anthropic', 'claude-fable-5')).toBe(1_000_000)
    expect(modelContextWindow('anthropic', 'claude-opus-5-5')).toBe(1_000_000)
    expect(modelContextWindow('anthropic', 'claude-haiku-4-5')).toBe(200_000)
    expect(modelContextWindow('anthropic', 'claude-sonnet-4-5[1m]')).toBe(1_000_000)
  })

  test('openai families', () => {
    expect(modelContextWindow('openai', 'gpt-5')).toBe(272_000)
    expect(modelContextWindow('openai', 'gpt-5.1-codex')).toBe(272_000)
    expect(modelContextWindow('openai', 'gpt-5-mini')).toBe(272_000)
    expect(modelContextWindow('openai', 'gpt-4o')).toBe(128_000)
    expect(modelContextWindow('openai', 'gpt-4.1')).toBe(1_014_808)
    expect(modelContextWindow('openai', 'o3')).toBe(200_000)
  })

  test('google gemini is a million tokens', () => {
    expect(modelContextWindow('google', 'gemini-2.5-pro')).toBe(1_048_576)
  })

  test('unknown providers and models fall back to the conservative default', () => {
    expect(modelContextWindow('openai', 'gpt-test')).toBe(DEFAULT_MODEL_CONTEXT_WINDOW)
    expect(modelContextWindow('ollama', 'llama3')).toBe(DEFAULT_LOCAL_CONTEXT_WINDOW)
    expect(DEFAULT_MODEL_CONTEXT_WINDOW).toBe(128_000)
  })
})

describe('eventContextReading', () => {
  const usage = {input: 10, output: 5, cacheRead: 80, cacheWrite: 10, total: 105}

  test('reads text responses and tool-only responses', () => {
    expect(eventContextReading({type: 'message', role: 'assistant', meta: {usage}})?.promptTokens).toBe(100)
    expect(eventContextReading({type: 'tool_call', meta: {usage}})?.promptTokens).toBe(100)
  })

  test('ignores tool results, user messages and empty usage', () => {
    expect(eventContextReading({type: 'tool_result', meta: {usage}})).toBeUndefined()
    expect(eventContextReading({type: 'message', role: 'user', meta: {usage}})).toBeUndefined()
    const empty = {input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0}
    expect(eventContextReading({type: 'tool_call', meta: {usage: empty}})).toBeUndefined()
  })

  test('turn-only images do not count toward the conversation', () => {
    const reading = eventContextReading({type: 'tool_call', meta: {usage, ephemeralImageTokens: 30}})!
    expect(contextTokensOfReading(reading)).toBe(70)
  })
})
