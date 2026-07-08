import {describe, expect, it} from 'bun:test'
import {buildRedactor} from './redact.js'

describe('buildRedactor', () => {
  it('redacts known secrets', () => {
    const r = buildRedactor({DEEPSEEK_API_KEY: 'sk-aaaaaaaaaaaa'} as NodeJS.ProcessEnv)
    expect(r('hello sk-aaaaaaaaaaaa world')).toBe('hello ***REDACTED*** world')
  })

  it('redacts longest first to avoid partial overlaps', () => {
    const r = buildRedactor({
      DEEPSEEK_API_KEY: 'sk-long-secret-12345',
      OPENAI_API_KEY: 'sk-shorter',
    } as NodeJS.ProcessEnv)
    const out = r('value=sk-long-secret-12345 other=sk-shorter')
    expect(out).toBe('value=***REDACTED*** other=***REDACTED***')
  })

  it('passes through when no secrets configured', () => {
    const r = buildRedactor({})
    expect(r('plain string')).toBe('plain string')
  })

  it('ignores empty / short values', () => {
    const r = buildRedactor({DEEPSEEK_API_KEY: 'short'} as NodeJS.ProcessEnv)
    expect(r('contains short value')).toBe('contains short value')
  })
})
