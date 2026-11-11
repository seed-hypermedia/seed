import {describe, expect, test} from 'bun:test'
import {DEFAULT_MODEL_CONTEXT_WINDOW, modelContextWindow} from './model-capabilities'

describe('modelContextWindow', () => {
  test('anthropic models are 200k, with the 1m tier marked by suffix', () => {
    expect(modelContextWindow('anthropic', 'claude-sonnet-4-5')).toBe(200_000)
    expect(modelContextWindow('anthropic', 'claude-fable-5')).toBe(200_000)
    expect(modelContextWindow('anthropic', 'claude-sonnet-4-5[1m]')).toBe(1_000_000)
  })

  test('openai families', () => {
    expect(modelContextWindow('openai', 'gpt-5')).toBe(400_000)
    expect(modelContextWindow('openai', 'gpt-5-mini')).toBe(400_000)
    expect(modelContextWindow('openai', 'gpt-4o')).toBe(128_000)
    expect(modelContextWindow('openai', 'gpt-4.1')).toBe(1_047_576)
    expect(modelContextWindow('openai', 'o3')).toBe(200_000)
  })

  test('google gemini is a million tokens', () => {
    expect(modelContextWindow('google', 'gemini-2.5-pro')).toBe(1_048_576)
  })

  test('unknown providers and models fall back to the conservative default', () => {
    expect(modelContextWindow('openai', 'gpt-test')).toBe(DEFAULT_MODEL_CONTEXT_WINDOW)
    expect(modelContextWindow('ollama', 'llama3')).toBe(DEFAULT_MODEL_CONTEXT_WINDOW)
    expect(DEFAULT_MODEL_CONTEXT_WINDOW).toBe(128_000)
  })
})
