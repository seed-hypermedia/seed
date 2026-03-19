/** Default OpenAI model for providers authenticated with an API key. */
export const DEFAULT_OPENAI_API_KEY_MODEL = 'gpt-4o-mini'

/** Default OpenAI model for providers authenticated with a ChatGPT account. */
export const DEFAULT_OPENAI_LOGIN_MODEL = 'gpt-5'

/** Fallback OpenAI models shown before the API key model list loads. */
export const OPENAI_API_KEY_FALLBACK_MODELS = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1', 'o1-mini', 'o3-mini']

/** Codex-compatible OpenAI models supported when using ChatGPT sign-in. */
export const OPENAI_LOGIN_MODELS = [
  'gpt-5',
  'gpt-5.4',
  'gpt-5.3-codex',
  'gpt-5.2-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex',
  'gpt-5.2',
  'gpt-5.1',
  'gpt-5-codex',
  'gpt-5.1-codex-mini',
  'gpt-5-codex-mini',
] as const

/** Minimal model-catalog entry used to build the ChatGPT model picker. */
export type OpenAIModelCatalogEntry = {
  slug: string
  visibility?: string
  priority?: number
}

/** Returns the default OpenAI model for the selected authentication mode. */
export function getDefaultOpenAIModel(authMode: 'apiKey' | 'login' = 'apiKey'): string {
  return authMode === 'login' ? DEFAULT_OPENAI_LOGIN_MODEL : DEFAULT_OPENAI_API_KEY_MODEL
}

/** Returns whether a model slug is valid for ChatGPT account sign-in mode. */
export function isSupportedOpenAILoginModel(model?: string | null): boolean {
  return !!model && OPENAI_LOGIN_MODELS.includes(model as (typeof OPENAI_LOGIN_MODELS)[number])
}

/** Replaces unsupported ChatGPT sign-in models with the default Codex-compatible fallback. */
export function normalizeOpenAILoginModel(model?: string | null): string {
  return isSupportedOpenAILoginModel(model) && model ? model : DEFAULT_OPENAI_LOGIN_MODEL
}

/** Picks visible OpenAI login models from a live Codex model catalog, ordered by priority. */
export function pickOpenAILoginModelsFromCatalog(models: readonly OpenAIModelCatalogEntry[]): string[] {
  const visibleModels = models
    .filter((model) => model.visibility === 'list')
    .slice()
    .sort((left, right) => {
      const leftPriority = typeof left.priority === 'number' && Number.isFinite(left.priority) ? left.priority : 0
      const rightPriority = typeof right.priority === 'number' && Number.isFinite(right.priority) ? right.priority : 0
      return leftPriority - rightPriority
    })

  return visibleModels.reduce<string[]>((result, model) => {
    if (!result.includes(model.slug)) {
      result.push(model.slug)
    }
    return result
  }, [])
}
