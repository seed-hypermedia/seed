import {describe, expect, it} from 'vitest'
import {
  DEFAULT_OPENAI_API_KEY_MODEL,
  DEFAULT_OPENAI_LOGIN_MODEL,
  getDefaultOpenAIModel,
  isSupportedOpenAILoginModel,
  pickOpenAILoginModelsFromCatalog,
  normalizeOpenAILoginModel,
} from '../openai-models'

describe('openai-models', () => {
  it('uses separate defaults for api key and ChatGPT login modes', () => {
    expect(getDefaultOpenAIModel('apiKey')).toBe(DEFAULT_OPENAI_API_KEY_MODEL)
    expect(getDefaultOpenAIModel('login')).toBe(DEFAULT_OPENAI_LOGIN_MODEL)
  })

  it('accepts Codex-compatible ChatGPT login models', () => {
    expect(isSupportedOpenAILoginModel('gpt-5')).toBe(true)
    expect(isSupportedOpenAILoginModel('gpt-5.4')).toBe(true)
  })

  it('normalizes unsupported ChatGPT login models to the login default', () => {
    expect(isSupportedOpenAILoginModel('gpt-4o')).toBe(false)
    expect(normalizeOpenAILoginModel('gpt-4o')).toBe(DEFAULT_OPENAI_LOGIN_MODEL)
    expect(normalizeOpenAILoginModel(undefined)).toBe(DEFAULT_OPENAI_LOGIN_MODEL)
  })

  it('builds the login picker from visible live models ordered by priority', () => {
    expect(
      pickOpenAILoginModelsFromCatalog([
        {slug: 'gpt-5.4', visibility: 'list', priority: 20},
        {slug: 'gpt-5', visibility: 'list', priority: 10},
        {slug: 'gpt-5-hidden', visibility: 'hide', priority: 1},
        {slug: 'gpt-5', visibility: 'list', priority: 10},
      ]),
    ).toEqual(['gpt-5', 'gpt-5.4'])
  })
})
