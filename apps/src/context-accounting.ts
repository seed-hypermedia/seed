/**
 * Context accounting: how big the next provider request will be, and how much room the model has.
 *
 * Providers report the true size of a prompt only after answering it, so the next prompt is the
 * last measured one plus what was added since: the response itself, tool results, images and the
 * per-turn state blocks. Only that added part is estimated. Images are sized from their real pixel
 * dimensions by each provider's own formula, because byte length says nothing about image tokens.
 */
import type * as piAi from '@earendil-works/pi-ai'
import * as piAnthropicCatalog from '@earendil-works/pi-ai/providers/anthropic.models'
import * as piGoogleCatalog from '@earendil-works/pi-ai/providers/google.models'
import * as piOpenAICatalog from '@earendil-works/pi-ai/providers/openai.models'
import * as piEstimate from '@earendil-works/pi-ai/utils/estimate'
import * as protocol from '@seed-hypermedia/apps-protocol'

/** Pixel size of an image. */
export type ImageDimensions = {width: number; height: number}

/** Base64 characters decoded when looking for an image header; JPEG metadata can precede its size. */
const IMAGE_HEADER_BASE64_CHARS = 512 * 1024
/** Assumed for an image whose header cannot be read: a high-resolution frame, so the meter errs full. */
const UNKNOWN_IMAGE_DIMENSIONS: ImageDimensions = {width: 2576, height: 1449}
/** How long a server-reported context window is trusted before it is asked again. */
const DISCOVERY_TTL_MS = 60_000
/** A context-window lookup must never hold up a turn for longer than this. */
const DISCOVERY_TIMEOUT_MS = 1_500

/** Reads width and height from a base64 PNG, JPEG, GIF or WebP header. */
export function imageDimensions(base64: string): ImageDimensions | undefined {
  const usable = base64.slice(0, IMAGE_HEADER_BASE64_CHARS - (IMAGE_HEADER_BASE64_CHARS % 4))
  const bytes = Buffer.from(usable, 'base64')
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) {
    return valid(bytes.readUInt32BE(16), bytes.readUInt32BE(20))
  }
  if (bytes.length >= 10 && bytes.toString('latin1', 0, 3) === 'GIF') {
    return valid(bytes.readUInt16LE(6), bytes.readUInt16LE(8))
  }
  if (bytes.length >= 30 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = bytes.toString('latin1', 12, 16)
    if (chunk === 'VP8X') return valid(bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1)
    if (chunk === 'VP8 ') return valid(bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff)
    if (chunk === 'VP8L') {
      const bits = bytes.readUInt32LE(21)
      return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1
        continue
      }
      const marker = bytes[offset + 1]!
      if (marker === 0xff) {
        offset += 1
        continue
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2
        continue
      }
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrame) return valid(bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5))
      offset += 2 + bytes.readUInt16BE(offset + 2)
    }
  }
  return undefined
}

function valid(width: number, height: number): ImageDimensions | undefined {
  return width > 0 && height > 0 ? {width, height} : undefined
}

/** Claude models that accept 2576px images rather than the earlier 1568px limit. */
function isHighResolutionClaude(modelId: string): boolean {
  return /claude-(fable|mythos)|claude-opus-(4-[7-9]|[5-9])|claude-sonnet-[5-9]|claude-haiku-[5-9]/.test(modelId)
}

function anthropicImageTokens(modelId: string, {width, height}: ImageDimensions): number {
  const highResolution = isHighResolutionClaude(modelId)
  const maxEdge = highResolution ? 2576 : 1568
  const maxPixels = highResolution ? 3_750_000 : 1_150_000
  const scale = Math.min(1, maxEdge / Math.max(width, height), Math.sqrt(maxPixels / (width * height)))
  const tokens = Math.ceil((Math.round(width * scale) * Math.round(height * scale)) / 750)
  return Math.min(tokens, highResolution ? 4_784 : 1_568)
}

function openAIImageTokens({width, height}: ImageDimensions): number {
  const fit = Math.min(1, 2048 / Math.max(width, height))
  const fittedWidth = width * fit
  const fittedHeight = height * fit
  const shrink = Math.min(1, 768 / Math.min(fittedWidth, fittedHeight))
  return 85 + 170 * Math.ceil((fittedWidth * shrink) / 512) * Math.ceil((fittedHeight * shrink) / 512)
}

/** GPT-5 and later count 32px patches, up to a budget, at a per-patch token rate. */
const OPENAI_PATCH_PX = 32
const OPENAI_PATCH_BUDGET = 2_500
const OPENAI_TOKENS_PER_PATCH = 1.2

function openAIPatchImageTokens({width, height}: ImageDimensions): number {
  const shrink = Math.min(1, Math.sqrt((OPENAI_PATCH_PX ** 2 * OPENAI_PATCH_BUDGET) / (width * height)))
  let scaledWidth = width * shrink
  let scaledHeight = height * shrink
  if (shrink < 1) {
    // The shrunken image is trimmed to whole patches along its tighter edge.
    const trim = Math.min(
      Math.floor(scaledWidth / OPENAI_PATCH_PX) / (scaledWidth / OPENAI_PATCH_PX),
      Math.floor(scaledHeight / OPENAI_PATCH_PX) / (scaledHeight / OPENAI_PATCH_PX),
    )
    scaledWidth *= trim
    scaledHeight *= trim
  }
  const patches =
    Math.ceil(Math.round(scaledWidth) / OPENAI_PATCH_PX) * Math.ceil(Math.round(scaledHeight) / OPENAI_PATCH_PX)
  return Math.ceil(Math.min(patches, OPENAI_PATCH_BUDGET) * OPENAI_TOKENS_PER_PATCH)
}

/** Gemini charges a flat rate per image whatever its size, and the rate changed with Gemini 3. */
function googleImageTokens(modelId: string): number {
  return /^gemini-([3-9]|\d{2,})|^gemini-(flash|pro)/.test(modelId) ? 1_090 : 258
}

/** Tokens one image costs on this provider and model. */
export function estimateImageTokens(providerType: string, modelId: string, base64: string): number {
  if (providerType === 'openrouter') {
    // A route is named `vendor/model` and bills images the way the vendor counts them.
    const [vendor, ...rest] = modelId.split('/')
    const routed = rest.join('/').replaceAll('.', vendor === 'anthropic' ? '-' : '.')
    if (vendor === 'anthropic' || vendor === 'openai' || vendor === 'google') {
      return estimateImageTokens(vendor, routed, base64)
    }
  }
  const dimensions = imageDimensions(base64) ?? UNKNOWN_IMAGE_DIMENSIONS
  if (providerType === 'openai') {
    return /^gpt-([5-9]|\d{2,})/.test(modelId) ? openAIPatchImageTokens(dimensions) : openAIImageTokens(dimensions)
  }
  if (providerType === 'google') return googleImageTokens(modelId)
  return anthropicImageTokens(providerType === 'anthropic' ? modelId : 'claude-opus-5', dimensions)
}

type ModelRef = {providerType: string; modelId: string}

function contentTokens(content: piAi.ToolResultMessage['content'] | string, ref: ModelRef): number {
  if (typeof content === 'string') return piEstimate.estimateTextTokens(content)
  let tokens = 0
  for (const part of content) {
    tokens +=
      part.type === 'text'
        ? piEstimate.estimateTextTokens(part.text)
        : estimateImageTokens(ref.providerType, ref.modelId, part.data)
  }
  return tokens
}

/** Estimated tokens of one message, with images sized for the model. */
export function estimateMessageTokens(message: piAi.Message, ref: ModelRef): number {
  if (message.role === 'user' || message.role === 'toolResult') return contentTokens(message.content, ref)
  return piEstimate.estimateMessageTokens(message)
}

/** Whether an assistant message carries a real measurement of the prompt that produced it. */
function measuredPromptTokens(message: piAi.Message): number | undefined {
  if (message.role !== 'assistant') return undefined
  if (message.stopReason === 'error' || message.stopReason === 'aborted') return undefined
  const tokens = message.usage.input + message.usage.cacheRead + message.usage.cacheWrite
  return tokens > 0 ? tokens : undefined
}

/**
 * The size of the request about to be sent. `overheadTokens` covers the system prompt and tools,
 * and counts only when no measurement exists (a measured prompt already includes them).
 * `carriedPromptTokens` is the last measurement from the session log, for a transcript whose
 * messages were replayed without their usage; `measuredDiscountTokens` removes turn-only images
 * from a measurement taken in an earlier run, since they are not sent again.
 */
export function estimateNextPromptTokens(
  messages: readonly piAi.Message[],
  ref: ModelRef,
  options: {overheadTokens: number; carriedPromptTokens?: number; measuredDiscountTokens?: number},
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!
    const measured = measuredPromptTokens(message)
    if (measured === undefined) continue
    let tokens = Math.max(0, measured - (options.measuredDiscountTokens ?? 0))
    for (let next = index; next < messages.length; next += 1) tokens += estimateMessageTokens(messages[next]!, ref)
    return tokens
  }
  const estimated = messages.reduce((sum, message) => sum + estimateMessageTokens(message, ref), options.overheadTokens)
  return Math.max(estimated, options.carriedPromptTokens ?? 0)
}

function catalogEntry(providerType: string, modelId: string): {contextWindow: number; maxTokens: number} | undefined {
  const catalog: Record<string, {id: string; contextWindow: number; maxTokens: number}> | undefined =
    providerType === 'anthropic'
      ? piAnthropicCatalog.ANTHROPIC_MODELS
      : providerType === 'openai'
        ? piOpenAICatalog.OPENAI_MODELS
        : providerType === 'google'
          ? piGoogleCatalog.GOOGLE_MODELS
          : undefined
  return catalog ? Object.values(catalog).find((model) => model.id === modelId) : undefined
}

const discoveredWindows = new Map<string, {window: number; at: number}>()

function discoveryKey(providerType: string, baseUrl: string, modelId: string): string {
  return `${providerType}\n${baseUrl}\n${modelId}`
}

/**
 * The most prompt tokens a model accepts: what its server reported, else the model catalog, else
 * the id heuristics. OpenAI publishes windows that include output, so its reserved output comes
 * off wherever the catalog still lists the combined figure.
 */
export function resolveContextWindow(providerType: string, modelId: string, baseUrl = ''): number {
  const discovered = discoveredWindows.get(discoveryKey(providerType, baseUrl, modelId))
  if (discovered) return discovered.window
  if (providerType === 'anthropic' && /\[1m\]|-1m\b/.test(modelId)) return 1_000_000
  const entry = catalogEntry(providerType, modelId)
  if (!entry) return protocol.modelContextWindow(providerType, modelId)
  if (providerType === 'openai' && entry.contextWindow >= 400_000) return entry.contextWindow - entry.maxTokens
  return entry.contextWindow
}

/**
 * Asks servers that know their real limit: Ollama for the context a model is actually loaded with
 * (usually far below its architectural maximum), OpenRouter for its per-route limit. A failed
 * lookup changes nothing, and it never delays a turn beyond a short timeout.
 */
export async function discoverContextWindow(providerType: string, baseUrl: string, modelId: string): Promise<void> {
  if (providerType !== 'ollama' && providerType !== 'openrouter') return
  const key = discoveryKey(providerType, baseUrl, modelId)
  const known = discoveredWindows.get(key)
  if (known && Date.now() - known.at < DISCOVERY_TTL_MS) return
  try {
    const window =
      providerType === 'ollama'
        ? await ollamaLoadedContext(baseUrl, modelId)
        : await openRouterContext(baseUrl, modelId)
    if (window) discoveredWindows.set(key, {window, at: Date.now()})
    else discoveredWindows.delete(key)
  } catch {
    // The static resolution stands.
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {...init, signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)})
  return response.ok ? response.json() : undefined
}

async function ollamaLoadedContext(baseUrl: string, modelId: string): Promise<number | undefined> {
  const root = baseUrl.replace(/\/v1\/?$/, '').replace(/\/$/, '')
  const running = (await fetchJson(`${root}/api/ps`)) as {
    models?: Array<{name?: string; model?: string; context_length?: number}>
  }
  const loaded = running?.models?.find((model) => model.name === modelId || model.model === modelId)
  return loaded?.context_length && loaded.context_length > 0 ? loaded.context_length : undefined
}

async function openRouterContext(baseUrl: string, modelId: string): Promise<number | undefined> {
  const body = (await fetchJson(`${baseUrl.replace(/\/$/, '')}/models`)) as {
    data?: Array<{id?: string; context_length?: number; top_provider?: {context_length?: number}}>
  }
  const model = body?.data?.find((candidate) => candidate.id === modelId)
  const window = model?.top_provider?.context_length ?? model?.context_length
  return window && window > 0 ? window : undefined
}
