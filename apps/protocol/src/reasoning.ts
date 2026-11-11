/**
 * Model reasoning knowledge shared by the agents server and every model-picker UI.
 *
 * The level lists are empirically verified against the live provider APIs (see the
 * per-provider notes below) rather than scraped from a catalog, because providers
 * gate levels per model generation — e.g. OpenAI's gpt-5 family accepts `minimal`
 * but not `none`, gpt-5.1+ accepts `none` but not `minimal`, and gpt-6 drops `none`
 * again while adding `max`.
 *
 * The matrix is a first guess, not the last word: the server also learns from a
 * provider's own rejection of an effort value at run time (see
 * `learnReasoningEffortSupport` in the agents server), so a model this file does not
 * know yet degrades to a corrected request rather than a permanently failing agent.
 */

/** A user-selectable reasoning level, ordered from least to most reasoning. */
export type ReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** All levels in display order. */
export const REASONING_LEVELS: ReasoningLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Display label per level, used by dropdowns and tags. */
export const REASONING_LEVEL_LABELS: Record<ReasoningLevel, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-High',
  max: 'Max',
}

/** Short human explanation per level, used by dropdowns and tag tooltips. */
export const REASONING_LEVEL_DESCRIPTIONS: Record<ReasoningLevel, string> = {
  minimal: 'Barely any reasoning — fastest and cheapest, best for simple tasks.',
  low: 'A little reasoning before answering — quick with a light quality boost.',
  medium: 'Moderate reasoning — balanced speed, cost, and answer quality.',
  high: 'Extensive reasoning — slower and costlier, best for hard problems.',
  xhigh: 'Very extensive reasoning — slow and expensive, for the hardest problems.',
  max: 'Maximum reasoning — the model thinks as long as it needs. Slowest and most expensive.',
}

/**
 * What "no level selected" means for a model:
 * - `off`: the model does no reasoning (the server disables or omits it).
 * - `default`: reasoning cannot be turned off; the provider's default level applies.
 */
export type ReasoningOffBehavior = 'off' | 'default'

export type ModelReasoningSupport = {
  /** Levels the model accepts, in display order. */
  levels: ReasoningLevel[]
  /** Meaning of leaving the reasoning level unset. */
  offBehavior: ReasoningOffBehavior
  /**
   * The model accepts an explicit "no reasoning" value (OpenAI `reasoning_effort:
   * 'none'`). Newer OpenAI chat models (gpt-5.1+) default reasoning ON server-side
   * and reject function tools unless reasoning is explicitly disabled, so the
   * server must send `none` rather than omitting the field.
   */
  supportsEffortNone: boolean
  /**
   * The model must be driven through OpenAI's Responses API even when no level is
   * chosen. gpt-5.1 and newer reason by default server-side and reject function
   * tools on /v1/chat/completions unless reasoning is explicitly configured there;
   * the Responses API is OpenAI's supported path for tools plus reasoning. Older
   * reasoning models (gpt-5.0, o-series) accept tools on chat completions and stay
   * on that path while their level is unset.
   */
  requiresResponsesApi: boolean
}

const OPENAI_LEVELS_BY_GENERATION: Record<
  'gpt5' | 'gpt51' | 'gpt52plus' | 'gpt6plus' | 'oseries',
  ModelReasoningSupport
> = {
  // Verified 2026-07-29: gpt-5 / gpt-5-mini accept minimal|low|medium|high; reasoning cannot be disabled.
  gpt5: {
    levels: ['minimal', 'low', 'medium', 'high'],
    offBehavior: 'default',
    supportsEffortNone: false,
    requiresResponsesApi: false,
  },
  // Verified 2026-07-29: gpt-5.1 accepts none|low|medium|high.
  gpt51: {levels: ['low', 'medium', 'high'], offBehavior: 'off', supportsEffortNone: true, requiresResponsesApi: true},
  // Verified 2026-07-29: gpt-5.2, gpt-5.4, gpt-5.6-terra accept none|low|medium|high|xhigh.
  gpt52plus: {
    levels: ['low', 'medium', 'high', 'xhigh'],
    offBehavior: 'off',
    supportsEffortNone: true,
    requiresResponsesApi: true,
  },
  // Verified 2026-09-08 against the live API's rejection of gpt-6-astra: `none` is
  // "not supported with the 'gpt-6-astra' model. Supported values are: 'low',
  // 'medium', 'high', 'xhigh', and 'max'." Reasoning cannot be disabled, so an unset
  // level runs at the provider's default (the server omits the effort on the Responses
  // API — the documented contract, not yet exercised live; e2e-reasoning.ts covers it).
  gpt6plus: {
    levels: ['low', 'medium', 'high', 'xhigh', 'max'],
    offBehavior: 'default',
    supportsEffortNone: false,
    requiresResponsesApi: true,
  },
  // o-series reasons at low|medium|high and cannot be disabled.
  oseries: {
    levels: ['low', 'medium', 'high'],
    offBehavior: 'default',
    supportsEffortNone: false,
    requiresResponsesApi: false,
  },
}

function openaiReasoningSupport(modelId: string): ModelReasoningSupport | null {
  if (/^o[134](-|$)/.test(modelId)) return OPENAI_LEVELS_BY_GENERATION.oseries
  const gpt = modelId.match(/^gpt-(\d+)(?:\.(\d+))?/)
  if (!gpt) return null
  const major = Number(gpt[1])
  const minor = Number(gpt[2] ?? '0')
  if (major < 5) return null
  if (major >= 6) return OPENAI_LEVELS_BY_GENERATION.gpt6plus
  if (minor >= 2) return OPENAI_LEVELS_BY_GENERATION.gpt52plus
  if (minor === 1) return OPENAI_LEVELS_BY_GENERATION.gpt51
  // Chat-tuned variants of the 5.0 family do not expose reasoning control.
  if (modelId.startsWith('gpt-5-chat')) return null
  return OPENAI_LEVELS_BY_GENERATION.gpt5
}

const ANTHROPIC_SUPPORT: ModelReasoningSupport = {
  levels: ['minimal', 'low', 'medium', 'high'],
  offBehavior: 'off',
  supportsEffortNone: false,
  requiresResponsesApi: false,
}

function anthropicReasoningSupport(modelId: string): ModelReasoningSupport | null {
  // Extended thinking shipped with claude-3-7; every later generation supports it.
  // Ids look like claude-3-7-sonnet-*, claude-sonnet-4-5, claude-opus-4-1, claude-fable-5.
  const legacy = modelId.match(/^claude-(\d+)-(\d+)/)
  if (legacy) {
    const [major, minor] = [Number(legacy[1]), Number(legacy[2])]
    if (major < 3 || (major === 3 && minor < 7)) return null
    return ANTHROPIC_SUPPORT
  }
  if (/^claude-[a-z]+-(\d+)/.test(modelId)) {
    // Family-first ids (claude-sonnet-4-5 and newer) all support thinking.
    return ANTHROPIC_SUPPORT
  }
  return null
}

function googleReasoningSupport(modelId: string): ModelReasoningSupport | null {
  const gemini = modelId.match(/^gemini-(\d+)(?:\.(\d+))?/)
  if (!gemini) return null
  const major = Number(gemini[1])
  const minor = Number(gemini[2] ?? '0')
  // Thinking arrived with gemini-2.5. Pro-tier models cannot fully disable it.
  if (major < 2 || (major === 2 && minor < 5)) return null
  const alwaysOn = modelId.includes('-pro')
  return {
    levels: ['minimal', 'low', 'medium', 'high'],
    offBehavior: alwaysOn ? 'default' : 'off',
    supportsEffortNone: false,
    requiresResponsesApi: false,
  }
}

/**
 * Returns the reasoning support for a model, or null when the model (or the
 * provider type) has no controllable reasoning. `providerType` is the agents
 * server provider type ('openai' | 'anthropic' | 'google' | ...).
 */
export function modelReasoningSupport(providerType: string, modelId: string): ModelReasoningSupport | null {
  switch (providerType) {
    case 'openai':
      return openaiReasoningSupport(modelId)
    case 'anthropic':
      return anthropicReasoningSupport(modelId)
    case 'google':
      return googleReasoningSupport(modelId)
    default:
      return null
  }
}

/** Type guard for values arriving from stored definitions or API input. */
export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === 'string' && (REASONING_LEVELS as string[]).includes(value)
}
