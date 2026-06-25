import type {ModelProviderType} from '@/agents-client'

/**
 * Single source of truth for per-provider desktop metadata. Adding a provider is
 * usually one entry here (plus a matching backend `PROVIDER_SPECS` entry in
 * `agents/src/api-service.ts`). Model-curation priorities and add-provider form
 * behavior are all derived from this map.
 */
export type ProviderMetadata = {
  /** Human label shown in the provider dropdown and used as the default provider name. */
  label: string
  /** Prefilled API endpoint. Empty string means the user must supply one (custom). */
  defaultBaseUrl: string
  /** Whether to show an editable Base URL field (self-hosted / custom providers). */
  showBaseUrlField: boolean
  /** Whether an API key is required to save and use this provider. */
  requiresApiKey: boolean
  /** Family prefixes that float flagship models to the top of the model list. */
  priorityPrefixes: string[]
  /** Models preferred as the initial default in agent creation/edit flows. */
  preferredDefaultModelIds: string[]
}

export const PROVIDER_METADATA: Record<ModelProviderType, ProviderMetadata> = {
  openai: {
    label: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    showBaseUrlField: false,
    requiresApiKey: true,
    priorityPrefixes: ['gpt-5', 'gpt-4.1', 'gpt-4o', 'o4', 'o3', 'o1', 'gpt-4', 'gpt-3.5', 'chatgpt'],
    preferredDefaultModelIds: ['gpt-5-mini'],
  },
  anthropic: {
    label: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    showBaseUrlField: false,
    requiresApiKey: true,
    priorityPrefixes: ['claude-opus', 'claude-sonnet', 'claude-haiku', 'claude-3-5', 'claude-3'],
    preferredDefaultModelIds: ['claude-sonnet-4.6', 'claude-sonnet-4-6'],
  },
  google: {
    label: 'Google',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    showBaseUrlField: false,
    requiresApiKey: true,
    priorityPrefixes: ['gemini-2.5', 'gemini-2.0', 'gemini-1.5', 'gemini', 'gemma'],
    preferredDefaultModelIds: [],
  },
  openrouter: {
    label: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    showBaseUrlField: false,
    requiresApiKey: true,
    priorityPrefixes: [],
    preferredDefaultModelIds: [],
  },
  deepseek: {
    label: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    showBaseUrlField: false,
    requiresApiKey: true,
    priorityPrefixes: ['deepseek-reasoner', 'deepseek-chat', 'deepseek'],
    preferredDefaultModelIds: [],
  },
  groq: {
    label: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    showBaseUrlField: false,
    requiresApiKey: true,
    priorityPrefixes: [],
    preferredDefaultModelIds: [],
  },
  xai: {
    label: 'xAI (Grok)',
    defaultBaseUrl: 'https://api.x.ai/v1',
    showBaseUrlField: false,
    requiresApiKey: true,
    priorityPrefixes: ['grok-4', 'grok-3', 'grok-2', 'grok'],
    preferredDefaultModelIds: [],
  },
  ollama: {
    label: 'Ollama',
    defaultBaseUrl: 'http://localhost:11434/v1',
    showBaseUrlField: true,
    requiresApiKey: false,
    priorityPrefixes: [],
    preferredDefaultModelIds: [],
  },
  custom: {
    label: 'Custom (OpenAI-compatible)',
    defaultBaseUrl: '',
    showBaseUrlField: true,
    requiresApiKey: false,
    priorityPrefixes: [],
    preferredDefaultModelIds: [],
  },
}

/** Provider types in display order for the add-provider dropdown. */
export const PROVIDER_TYPE_ORDER: ModelProviderType[] = [
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'deepseek',
  'groq',
  'xai',
  'ollama',
  'custom',
]

export function isModelProviderType(type: string): type is ModelProviderType {
  return type in PROVIDER_METADATA
}

export function providerLabel(type: string): string {
  return isModelProviderType(type) ? PROVIDER_METADATA[type].label : type
}
