/**
 * Model input-capability knowledge shared by the agents server and clients.
 *
 * Mirrors the approach of `reasoning.ts`: provider-specific model-id heuristics
 * rather than a scraped catalog, so the server can decide whether to send image
 * content to a model. Unknown providers/models default to text-only, which
 * degrades gracefully — attachments are then described to the model as metadata
 * instead of being sent as image parts.
 */

function openaiSupportsImageInput(modelId: string): boolean {
  // Multimodal chat models: gpt-4o family, gpt-4.1 family, gpt-4-turbo, and everything gpt-5+.
  if (/^(gpt-4o|chatgpt-4o|gpt-4\.1|gpt-4-turbo)/.test(modelId)) return true
  const gpt = modelId.match(/^gpt-(\d+)/)
  if (gpt && Number(gpt[1]) >= 5) return true
  // o-series reasoning models: o1 and o3 (full) and o4-mini accept images; the
  // small text-only variants (o1-mini, o3-mini) do not.
  if (/^o1(-pro)?($|-2)/.test(modelId)) return true
  if (/^o3($|-2|-pro)/.test(modelId)) return true
  if (/^o4-mini/.test(modelId)) return true
  return false
}

function anthropicSupportsImageInput(modelId: string): boolean {
  // Vision shipped with claude-3; every later generation (including family-first
  // ids like claude-sonnet-4-5 and claude-fable-5) supports it.
  const legacy = modelId.match(/^claude-(\d+)/)
  if (legacy) return Number(legacy[1]) >= 3
  return /^claude-[a-z]+-\d+/.test(modelId)
}

function googleSupportsImageInput(modelId: string): boolean {
  // Gemini has been multimodal since 1.0.
  return /^gemini-/.test(modelId)
}

/**
 * Whether a model accepts image content in user messages. `providerType` is the
 * agents server provider type ('openai' | 'anthropic' | 'google' | ...); unknown
 * providers return false so image attachments fall back to metadata text.
 */
export function modelSupportsImageInput(providerType: string, modelId: string): boolean {
  switch (providerType) {
    case 'openai':
      return openaiSupportsImageInput(modelId)
    case 'anthropic':
      return anthropicSupportsImageInput(modelId)
    case 'google':
      return googleSupportsImageInput(modelId)
    default:
      return false
  }
}

/** Default assumed for models no heuristic recognizes; conservative on purpose. */
export const DEFAULT_MODEL_CONTEXT_WINDOW = 128_000

/**
 * The context window (tokens) of a model, by the same provider-id heuristics as the input
 * capabilities above. Used to tell the model — and show the user — how full its context is, so
 * continuation can be decided while there is still room to write a careful handoff. Errs low
 * for unknown ids: a meter that reads a little high is a safer failure than one that reads
 * "plenty of room" as the provider starts rejecting requests.
 */
export function modelContextWindow(providerType: string, modelId: string): number {
  switch (providerType) {
    case 'anthropic': {
      // Every current Claude generation is 200k; the [1m] beta suffix marks the million-token tier.
      if (/\[1m\]|-1m\b/.test(modelId)) return 1_000_000
      return 200_000
    }
    case 'openai': {
      if (/^gpt-4\.1/.test(modelId)) return 1_047_576
      const gpt = modelId.match(/^gpt-(\d+)/)
      if (gpt && Number(gpt[1]) >= 5) return 400_000
      if (/^gpt-4o|^chatgpt-4o|^gpt-4-turbo/.test(modelId)) return 128_000
      if (/^o[134]/.test(modelId)) return 200_000
      if (/^codex|^gpt-5.*codex/.test(modelId)) return 272_000
      return DEFAULT_MODEL_CONTEXT_WINDOW
    }
    case 'google': {
      if (/^gemini-/.test(modelId)) return 1_048_576
      return DEFAULT_MODEL_CONTEXT_WINDOW
    }
    default:
      return DEFAULT_MODEL_CONTEXT_WINDOW
  }
}
