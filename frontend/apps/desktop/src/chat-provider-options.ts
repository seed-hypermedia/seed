import type {AgentProvider} from './app-ai-config'

/**
 * Provider-specific request options passed to `streamText`.
 */
export type ChatProviderRequestOptions = {
  system?: string
  providerOptions?: {
    openai?: {
      instructions?: string
      systemMessageMode?: 'remove'
      store?: false
    }
  }
}

/**
 * Maps Seed chat prompts to the request shape expected by the selected provider.
 */
export function getChatProviderRequestOptions(
  provider: AgentProvider,
  systemPrompt: string,
): ChatProviderRequestOptions {
  if (provider.type === 'openai' && provider.authMode === 'login') {
    return {
      providerOptions: {
        openai: {
          instructions: systemPrompt,
          systemMessageMode: 'remove',
          store: false,
        },
      },
    }
  }

  return {
    system: systemPrompt,
  }
}
