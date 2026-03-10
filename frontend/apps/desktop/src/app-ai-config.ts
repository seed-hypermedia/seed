import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import z from 'zod'
import {appInvalidateQueries} from './app-invalidation'
import {userDataPath} from './app-paths'
import {t} from './app-trpc'

const configPath = path.join(userDataPath, 'ai-config.json')

// Types

export type AgentProviderType = 'openai' | 'anthropic' | 'ollama'

export type AgentProvider = {
  id: string
  label: string
  type: AgentProviderType
  model: string
  apiKey?: string
  baseUrl?: string
}

type AIConfig = {
  agentProviders?: AgentProvider[]
  selectedProviderId?: string
  lastUsedProviderId?: string
  // Legacy fields kept for migration
  providers?: {openai?: {apiKey?: string}}
}

// Config read/write

export async function readConfig(): Promise<AIConfig> {
  try {
    const content = await fs.readFile(configPath, 'utf-8')
    const config: AIConfig = JSON.parse(content)
    return migrateConfig(config)
  } catch {
    return {}
  }
}

async function writeConfig(config: AIConfig): Promise<void> {
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
  appInvalidateQueries(['AI_CONFIG'])
  appInvalidateQueries(['AI_PROVIDERS'])
  appInvalidateQueries(['AI_SELECTED_PROVIDER'])
  appInvalidateQueries(['AI_LAST_USED_PROVIDER'])
}

// Migration from old format

function migrateConfig(config: AIConfig): AIConfig {
  if (config.agentProviders) return config
  const legacyKey = config.providers?.openai?.apiKey
  if (!legacyKey) return config
  const provider: AgentProvider = {
    id: crypto.randomUUID(),
    label: 'OpenAI',
    type: 'openai',
    model: 'gpt-4o-mini',
    apiKey: legacyKey,
  }
  const migrated: AIConfig = {
    ...config,
    agentProviders: [provider],
    selectedProviderId: provider.id,
  }
  // Write migrated config back (fire-and-forget)
  writeConfig(migrated).catch(() => {})
  return migrated
}

// Legacy helpers for backward compat

function getNestedValue(obj: Record<string, any>, path: string): any {
  const keys = path.split('.')
  let current: any = obj
  for (const key of keys) {
    if (current == null || typeof current !== 'object') return undefined
    current = current[key]
  }
  return current
}

function setNestedValue(obj: Record<string, any>, path: string, value: any): Record<string, any> {
  const keys = path.split('.')
  const result = {...obj}
  let current: any = result
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]
    current[key] = current[key] != null && typeof current[key] === 'object' ? {...current[key]} : {}
    current = current[key]
  }
  current[keys[keys.length - 1]] = value
  return result
}

function maskApiKey(key?: string): string | undefined {
  if (!key) return undefined
  if (key.length <= 7) return '*'.repeat(key.length)
  return key.slice(0, 7) + '*'.repeat(Math.min(20, key.length - 7))
}

// Zod schemas

const agentProviderTypeSchema = z.enum(['openai', 'anthropic', 'ollama'])

const addProviderSchema = z.object({
  type: agentProviderTypeSchema,
  label: z.string().optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
})

const updateProviderSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  type: agentProviderTypeSchema.optional(),
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
})

const DEFAULT_LABELS: Record<AgentProviderType, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
}

const DEFAULT_MODELS: Record<AgentProviderType, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-sonnet-4-20250514',
  ollama: 'llama3',
}

export async function setLastUsedProvider(providerId: string) {
  const config = await readConfig()
  config.lastUsedProviderId = providerId
  await writeConfig(config)
}

// tRPC router

export const aiConfigApi = t.router({
  // Legacy endpoints
  get: t.procedure.query(async () => {
    return await readConfig()
  }),
  getValue: t.procedure.input(z.string()).query(async ({input}) => {
    const config = await readConfig()
    return getNestedValue(config as Record<string, any>, input) ?? null
  }),
  setValue: t.procedure.input(z.object({path: z.string(), value: z.any()})).mutation(async ({input}) => {
    const config = await readConfig()
    const updated = setNestedValue(config as Record<string, any>, input.path, input.value)
    await writeConfig(updated)
    return null
  }),

  // Provider CRUD
  listProviders: t.procedure.query(async () => {
    const config = await readConfig()
    const providers = config.agentProviders || []
    return providers.map((p) => ({...p, apiKey: maskApiKey(p.apiKey)}))
  }),

  getProvider: t.procedure.input(z.string()).query(async ({input}) => {
    const config = await readConfig()
    const provider = (config.agentProviders || []).find((p) => p.id === input)
    return provider || null
  }),

  addProvider: t.procedure.input(addProviderSchema).mutation(async ({input}) => {
    const config = await readConfig()
    const providers = config.agentProviders || []
    const provider: AgentProvider = {
      id: crypto.randomUUID(),
      label: input.label || DEFAULT_LABELS[input.type],
      type: input.type,
      model: input.model || DEFAULT_MODELS[input.type],
      apiKey: input.apiKey,
      baseUrl: input.type === 'ollama' ? input.baseUrl || 'http://localhost:11434' : input.baseUrl,
    }
    providers.push(provider)
    config.agentProviders = providers
    if (!config.selectedProviderId) {
      config.selectedProviderId = provider.id
    }
    await writeConfig(config)
    return provider
  }),

  updateProvider: t.procedure.input(updateProviderSchema).mutation(async ({input}) => {
    const config = await readConfig()
    const providers = config.agentProviders || []
    const idx = providers.findIndex((p) => p.id === input.id)
    if (idx === -1) throw new Error('Provider not found')
    const existing = providers[idx]
    providers[idx] = {
      ...existing,
      ...(input.label !== undefined ? {label: input.label} : {}),
      ...(input.type !== undefined ? {type: input.type} : {}),
      ...(input.model !== undefined ? {model: input.model} : {}),
      ...(input.apiKey !== undefined ? {apiKey: input.apiKey} : {}),
      ...(input.baseUrl !== undefined ? {baseUrl: input.baseUrl} : {}),
    }
    config.agentProviders = providers
    await writeConfig(config)
    return providers[idx]
  }),

  duplicateProvider: t.procedure.input(z.string()).mutation(async ({input}) => {
    const config = await readConfig()
    const providers = config.agentProviders || []
    const source = providers.find((p) => p.id === input)
    if (!source) throw new Error('Provider not found')
    const duplicate: AgentProvider = {
      ...source,
      id: crypto.randomUUID(),
      label: source.label + ' (copy)',
    }
    providers.push(duplicate)
    config.agentProviders = providers
    await writeConfig(config)
    return duplicate
  }),

  deleteProvider: t.procedure.input(z.string()).mutation(async ({input}) => {
    const config = await readConfig()
    config.agentProviders = (config.agentProviders || []).filter((p) => p.id !== input)
    if (config.selectedProviderId === input) {
      config.selectedProviderId = config.agentProviders[0]?.id
    }
    await writeConfig(config)
    return null
  }),

  setSelectedProvider: t.procedure.input(z.string()).mutation(async ({input}) => {
    const config = await readConfig()
    config.selectedProviderId = input
    await writeConfig(config)
    return null
  }),

  getSelectedProvider: t.procedure.query(async () => {
    const config = await readConfig()
    if (!config.selectedProviderId || !config.agentProviders) return null
    return config.agentProviders.find((p) => p.id === config.selectedProviderId) || null
  }),

  getLastUsedProviderId: t.procedure.query(async () => {
    const config = await readConfig()
    return config.lastUsedProviderId || null
  }),

  listOllamaModels: t.procedure.input(z.string()).query(async ({input}) => {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const res = await fetch(`${input}/api/tags`, {signal: controller.signal})
      clearTimeout(timeout)
      if (!res.ok) return []
      const data = await res.json()
      return (data.models || []).map((m: any) => m.name as string)
    } catch {
      return []
    }
  }),
})
