import {describe, expect, test} from 'bun:test'
import {isReasoningLevel, modelReasoningSupport} from './reasoning'

describe('modelReasoningSupport', () => {
  test('openai gpt-5.0 family: minimal..high, reasoning cannot be disabled', () => {
    for (const model of ['gpt-5', 'gpt-5-mini', 'gpt-5-nano']) {
      expect(modelReasoningSupport('openai', model)).toEqual({
        levels: ['minimal', 'low', 'medium', 'high'],
        offBehavior: 'default',
        supportsEffortNone: false,
      })
    }
  })

  test('openai gpt-5.1: none + low..high', () => {
    expect(modelReasoningSupport('openai', 'gpt-5.1')).toEqual({
      levels: ['low', 'medium', 'high'],
      offBehavior: 'off',
      supportsEffortNone: true,
    })
  })

  test('openai gpt-5.2 and newer: none + low..xhigh', () => {
    for (const model of ['gpt-5.2', 'gpt-5.4', 'gpt-5.6-terra', 'gpt-6']) {
      expect(modelReasoningSupport('openai', model)).toEqual({
        levels: ['low', 'medium', 'high', 'xhigh'],
        offBehavior: 'off',
        supportsEffortNone: true,
      })
    }
  })

  test('openai o-series and non-reasoning models', () => {
    expect(modelReasoningSupport('openai', 'o3')?.levels).toEqual(['low', 'medium', 'high'])
    expect(modelReasoningSupport('openai', 'gpt-4.1')).toBeNull()
    expect(modelReasoningSupport('openai', 'gpt-4o-mini')).toBeNull()
    expect(modelReasoningSupport('openai', 'gpt-5-chat-latest')).toBeNull()
  })

  test('anthropic: extended thinking from claude-3-7 onward', () => {
    expect(modelReasoningSupport('anthropic', 'claude-3-7-sonnet-latest')?.levels).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
    ])
    expect(modelReasoningSupport('anthropic', 'claude-sonnet-4-5')?.offBehavior).toBe('off')
    expect(modelReasoningSupport('anthropic', 'claude-3-5-haiku-latest')).toBeNull()
  })

  test('google: thinking from gemini-2.5, always-on for pro tiers', () => {
    expect(modelReasoningSupport('google', 'gemini-2.5-pro')?.offBehavior).toBe('default')
    expect(modelReasoningSupport('google', 'gemini-2.5-flash')?.offBehavior).toBe('off')
    expect(modelReasoningSupport('google', 'gemini-2.0-flash')).toBeNull()
  })

  test('unknown provider types expose no reasoning control', () => {
    expect(modelReasoningSupport('ollama', 'gpt-5.6-terra')).toBeNull()
    expect(modelReasoningSupport('custom', 'claude-sonnet-4-5')).toBeNull()
  })
})

describe('isReasoningLevel', () => {
  test('accepts levels and rejects everything else', () => {
    expect(isReasoningLevel('xhigh')).toBe(true)
    expect(isReasoningLevel('none')).toBe(false)
    expect(isReasoningLevel('off')).toBe(false)
    expect(isReasoningLevel(3)).toBe(false)
  })
})
