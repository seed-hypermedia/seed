import {describe, expect, it} from 'vitest'
import {getChatProviderRequestOptions} from '../chat-provider-options'
import type {AgentProvider} from '../app-ai-config'

describe('getChatProviderRequestOptions', () => {
  const systemPrompt = 'You are Seed.'

  it('uses top-level instructions for ChatGPT login providers', () => {
    const provider: AgentProvider = {
      id: 'openai-login',
      label: 'OpenAI',
      type: 'openai',
      model: 'gpt-5.3-codex',
      authMode: 'login',
      openaiAuth: {
        idToken: 'id',
        accessToken: 'access',
        refreshToken: 'refresh',
        lastRefreshAt: new Date().toISOString(),
      },
    }

    expect(getChatProviderRequestOptions(provider, systemPrompt)).toEqual({
      providerOptions: {
        openai: {
          instructions: systemPrompt,
          systemMessageMode: 'remove',
          store: false,
        },
      },
    })
  })

  it('keeps the standard system prompt for API key providers', () => {
    const provider: AgentProvider = {
      id: 'openai-api-key',
      label: 'OpenAI',
      type: 'openai',
      model: 'gpt-5',
      authMode: 'apiKey',
      apiKey: 'sk-test',
    }

    expect(getChatProviderRequestOptions(provider, systemPrompt)).toEqual({
      system: systemPrompt,
    })
  })
})
