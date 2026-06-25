import type {ProviderModelInfo} from '@/agents-client'
import {isModelProviderType, PROVIDER_METADATA} from './provider-registry'

/**
 * Provider model lists returned by OpenAI/Anthropic/Google are long and noisy:
 * they mix in embedding/audio/image-only models and expose every dated snapshot
 * alongside its stable alias (e.g. `gpt-4o` and `gpt-4o-2024-08-06`). These
 * helpers trim the noise so the model dropdown can show a short curated list
 * while still letting the user reach the full set.
 */

/** Substrings that mark a model as something other than a text-generating chat model. */
const NON_CHAT_PATTERNS = [
  'embedding',
  'embed',
  'text-similarity',
  'text-search',
  'whisper',
  'transcribe',
  'tts',
  'audio',
  'realtime',
  'speech',
  'dall-e',
  'dalle',
  'gpt-image',
  'imagen',
  '-image',
  'image-',
  'veo',
  'moderation',
  'davinci',
  'babbage',
  'curie',
  '-instruct',
  'aqa',
]

/** Returns true for models we never want to surface in the agent model dropdown. */
export function isChatModel(id: string): boolean {
  const lower = id.toLowerCase()
  return !NON_CHAT_PATTERNS.some((pattern) => lower.includes(pattern))
}

/**
 * Strips trailing date/snapshot suffixes so dated variants collapse onto their
 * stable alias. Conservative on purpose: only numeric date-like suffixes and
 * `-latest` are removed, never semantic suffixes like `-mini` or `-preview`
 * that denote genuinely distinct models.
 */
export function canonicalModelId(id: string): string {
  return id
    .replace(/-latest$/i, '')
    .replace(/-\d{4}-\d{2}-\d{2}$/, '') // 2024-08-06
    .replace(/-\d{6,8}$/, '') // 20241022 / 240612
    .replace(/-\d{3,4}-preview$/i, '') // 0125-preview / 125-preview
    .replace(/-\d{4}$/, '') // 0613 / 1106 / 0125
}

function priorityIndex(id: string, providerType: string | undefined): number {
  const prefixes =
    providerType && isModelProviderType(providerType) ? PROVIDER_METADATA[providerType].priorityPrefixes : undefined
  if (!prefixes || !prefixes.length) return Number.MAX_SAFE_INTEGER
  const lower = id.toLowerCase()
  const index = prefixes.findIndex((prefix) => lower.startsWith(prefix))
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

export type CuratedModels = {
  /** Short, de-duplicated, priority-sorted list of stable chat models. */
  recommended: ProviderModelInfo[]
  /** Every chat model (snapshots included), priority-sorted. */
  all: ProviderModelInfo[]
  /** Whether `all` contains models beyond `recommended` (snapshots worth revealing). */
  hasMore: boolean
}

function comparator(providerType: string | undefined) {
  return (a: ProviderModelInfo, b: ProviderModelInfo) => {
    const priorityDiff = priorityIndex(a.id, providerType) - priorityIndex(b.id, providerType)
    if (priorityDiff !== 0) return priorityDiff
    return a.id.localeCompare(b.id)
  }
}

/**
 * Turns a raw provider model list into a curated short list plus the full
 * chat-model list. Embedding/audio/image models are dropped entirely; dated
 * snapshots are collapsed onto their stable alias for the `recommended` list
 * but remain available in `all`.
 */
export function curateProviderModels(
  models: ProviderModelInfo[] | undefined,
  providerType: string | undefined,
): CuratedModels {
  const chatModels = (models || []).filter((model) => isChatModel(model.id))
  const sort = comparator(providerType)
  const all = [...chatModels].sort(sort)

  // Collapse dated snapshots onto one entry per canonical family, preferring the
  // stable alias (id === canonical) and otherwise the newest snapshot.
  const byCanonical = new Map<string, ProviderModelInfo>()
  for (const model of chatModels) {
    const canonical = canonicalModelId(model.id)
    const existing = byCanonical.get(canonical)
    if (!existing) {
      byCanonical.set(canonical, model)
      continue
    }
    const existingIsAlias = canonicalModelId(existing.id) === existing.id
    const candidateIsAlias = canonicalModelId(model.id) === model.id
    if (candidateIsAlias && !existingIsAlias) byCanonical.set(canonical, model)
    else if (candidateIsAlias === existingIsAlias && model.id > existing.id) byCanonical.set(canonical, model)
  }
  const recommended = Array.from(byCanonical.values()).sort(sort)

  return {recommended, all, hasMore: all.length > recommended.length}
}

/** Human-friendly label for a model option. */
function normalizePreferredModelId(id: string): string {
  return canonicalModelId(id).toLowerCase().replace(/\./g, '-')
}

function matchesPreferredModelId(candidate: string, preferred: string): boolean {
  return normalizePreferredModelId(candidate) === normalizePreferredModelId(preferred)
}

/** Picks the best default model for a provider, honoring product defaults when available. */
export function pickDefaultProviderModel(
  models: ProviderModelInfo[] | undefined,
  providerType: string | undefined,
): ProviderModelInfo | undefined {
  const curated = curateProviderModels(models, providerType)
  const preferredIds =
    providerType && isModelProviderType(providerType)
      ? PROVIDER_METADATA[providerType].preferredDefaultModelIds
      : undefined

  return (
    curated.recommended.find(
      (model) => preferredIds?.some((preferredId) => matchesPreferredModelId(model.id, preferredId)),
    ) ||
    curated.recommended[0] ||
    curated.all[0]
  )
}

export function modelLabel(model: ProviderModelInfo): string {
  return model.name && model.name !== model.id ? `${model.name} (${model.id})` : model.id
}
