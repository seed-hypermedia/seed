/**
 * Datalab document conversion client for the `convert` tool.
 *
 * One request per file: POST `/convert` with the document as a multipart part, then poll the
 * returned `request_check_url` until the job is `complete`. Datalab has no batch endpoint; callers
 * run several of these concurrently. Nothing here knows about agent memory, accounts or SQLite, so
 * the builtin executor and the hosted `ConvertDocument` action share the same client. The API key
 * only ever travels in the `X-API-Key` header and never appears in errors or logs.
 */

import {withFetchDeadline} from '@/web-tools'

/** Datalab's public API root. Tests point `baseUrl` at a local fake. */
export const DATALAB_BASE_URL = 'https://www.datalab.to/api/v1'

/** Conversion modes, cheapest first. Fast and balanced share a price; accurate costs 2.5x. */
export const DATALAB_MODES = ['fast', 'balanced', 'accurate'] as const
export type DatalabMode = (typeof DATALAB_MODES)[number]

/** Returns the mode when the value is one Datalab accepts. */
export function parseDatalabMode(value: unknown): DatalabMode | undefined {
  return typeof value === 'string' && (DATALAB_MODES as readonly string[]).includes(value)
    ? (value as DatalabMode)
    : undefined
}

/** Picks the cheaper of two modes, so a shared-key request never exceeds the server's mode. */
export function cheaperDatalabMode(requested: DatalabMode, ceiling: DatalabMode): DatalabMode {
  return DATALAB_MODES.indexOf(requested) <= DATALAB_MODES.indexOf(ceiling) ? requested : ceiling
}

/** Input types Datalab converts, by extension, with the MIME type sent for the multipart part. */
export const CONVERT_SUPPORTED_EXTENSIONS: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xlsm: 'application/vnd.ms-excel.sheet.macroenabled.12',
  xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  csv: 'text/csv',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  html: 'text/html',
  epub: 'application/epub+zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  tiff: 'image/tiff',
}

/** The extension list as the tool contract and error messages print it. */
export const CONVERT_SUPPORTED_EXTENSION_LIST = Object.keys(CONVERT_SUPPORTED_EXTENSIONS)
  .map((ext) => `.${ext}`)
  .join(', ')

/** Returns the extension and MIME type of a file Datalab can convert, by its name. */
export function supportedDocumentType(fileName: string): {ext: string; mimeType: string} | undefined {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return undefined
  const ext = base.slice(dot + 1).toLowerCase()
  const mimeType = CONVERT_SUPPORTED_EXTENSIONS[ext]
  return mimeType ? {ext, mimeType} : undefined
}

/** True when the bytes carry a PDF header within the leading junk the PDF spec tolerates. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024))).toString('latin1')
  return head.includes('%PDF-')
}

/** Datalab page ranges are zero-indexed comma lists of pages and spans, like `0-5,10`. */
export function validatePageRange(value: string): boolean {
  return /^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(value)
}

/** Why a conversion did not produce output. */
export type DatalabErrorKind = 'auth' | 'request' | 'rate_limited' | 'failed' | 'timeout' | 'network' | 'aborted'

/** A conversion failure with a stable kind so callers can tell configuration from bad input. */
export class DatalabError extends Error {
  constructor(
    readonly kind: DatalabErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'DatalabError'
  }
}

/** One conversion request. `mode` and `extras` are always decided by the caller, never defaulted here. */
export type ConvertDocumentInput = {
  bytes: Uint8Array
  fileName: string
  mimeType: string
  apiKey: string
  mode: DatalabMode
  /** Comma-separated Datalab extras, e.g. `extract_links,chart_understanding`. Empty sends none. */
  extras: string
  /** Upper bound on pages Datalab processes (and bills). */
  maxPages?: number
  pageRange?: string
  fetch?: typeof fetch
  baseUrl?: string
  signal?: AbortSignal
  pollIntervalMs?: number
  /** Overall deadline from submit to result. */
  timeoutMs?: number
  /** Base delay of the exponential backoff on rate limits; tests shrink it. */
  retryBaseMs?: number
  onProgress?: (progress: {stage: 'submitting' | 'processing'; elapsedMs: number; requestId?: string}) => void
}

/** What Datalab returned for one document. Image bytes are decoded from base64 and keyed by Datalab's file name. */
export type ConvertDocumentResult = {
  markdown: string
  images: Map<string, Uint8Array>
  pageCount: number
  parseQualityScore: number | null
  costCents: number | null
  requestId: string
}

const SUBMIT_TIMEOUT_MS = 120_000
const POLL_REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_POLL_INTERVAL_MS = 2_000
const DEFAULT_TIMEOUT_MS = 10 * 60_000
const DEFAULT_RETRY_BASE_MS = 4_000
const MAX_SUBMIT_ATTEMPTS = 5

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DatalabError('aborted', 'Conversion was canceled'))
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(new DatalabError('aborted', 'Conversion was canceled'))
    }
    signal?.addEventListener('abort', onAbort, {once: true})
  })
}

function combineSignals(a: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!b) return a
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (a.aborted || b.aborted) controller.abort()
  a.addEventListener('abort', abort, {once: true})
  b.addEventListener('abort', abort, {once: true})
  return controller.signal
}

/** Reads a Datalab failure message without echoing anything that could carry the key. */
function datalabMessage(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    const error = body.error ?? body.detail ?? body.message
    if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 300)
  }
  return fallback
}

function isPageRateLimit(body: unknown): boolean {
  return isRecord(body) && typeof body.error === 'string' && /page rate limit/i.test(body.error)
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

/**
 * Converts one document and returns its markdown plus extracted images. Rate limits (HTTP 429 on
 * submit, or a completed job that reports Datalab's page-concurrency limit) are retried with
 * exponential backoff; every other failure is reported once with a stable `DatalabError.kind`.
 */
export async function convertDocument(input: ConvertDocumentInput): Promise<ConvertDocumentResult> {
  const doFetch = input.fetch ?? globalThis.fetch
  const baseUrl = (input.baseUrl ?? DATALAB_BASE_URL).replace(/\/+$/, '')
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const retryBaseMs = input.retryBaseMs ?? DEFAULT_RETRY_BASE_MS
  const startedAt = Date.now()
  const elapsed = () => Date.now() - startedAt
  const headers = {'X-API-Key': input.apiKey}

  for (let attempt = 0; ; attempt++) {
    if (input.signal?.aborted) throw new DatalabError('aborted', 'Conversion was canceled')
    input.onProgress?.({stage: 'submitting', elapsedMs: elapsed()})

    const form = new FormData()
    form.append('file', new Blob([input.bytes as BlobPart], {type: input.mimeType}), input.fileName)
    form.append('output_format', 'markdown')
    form.append('mode', input.mode)
    form.append('disable_image_captions', 'true')
    form.append('paginate', 'false')
    if (input.extras) form.append('extras', input.extras)
    if (input.maxPages !== undefined) form.append('max_pages', String(input.maxPages))
    if (input.pageRange) form.append('page_range', input.pageRange)

    let submitted: unknown
    let status: number
    try {
      ;[status, submitted] = await withFetchDeadline(SUBMIT_TIMEOUT_MS, async (signal) => {
        const res = await doFetch(`${baseUrl}/convert`, {
          method: 'POST',
          headers,
          body: form,
          signal: combineSignals(signal, input.signal),
        })
        return [res.status, await readJson(res)] as const
      })
    } catch (error) {
      if (input.signal?.aborted) throw new DatalabError('aborted', 'Conversion was canceled')
      throw new DatalabError('network', `Could not reach the conversion service: ${errorText(error)}`)
    }

    if (status === 401 || status === 403) throw new DatalabError('auth', 'The conversion service rejected the API key')
    const rateLimited = status === 429
    if (!rateLimited) {
      if (status < 200 || status >= 300) {
        throw new DatalabError('request', datalabMessage(submitted, `The conversion service answered HTTP ${status}`))
      }
      if (!isRecord(submitted) || submitted.success !== true || typeof submitted.request_check_url !== 'string') {
        throw new DatalabError(
          'request',
          datalabMessage(submitted, 'The conversion service did not accept the document'),
        )
      }
      const requestId = typeof submitted.request_id === 'string' ? submitted.request_id : ''
      const checkUrl = submitted.request_check_url
      const outcome = await pollUntilComplete({
        doFetch,
        headers,
        checkUrl,
        requestId,
        pollIntervalMs,
        timeoutMs,
        startedAt,
        signal: input.signal,
        onProgress: input.onProgress,
      })
      if (!isPageRateLimit(outcome)) return parseResult(outcome, requestId)
    }
    if (attempt + 1 >= MAX_SUBMIT_ATTEMPTS) {
      throw new DatalabError('rate_limited', 'The conversion service is rate limiting this key; try again in a minute')
    }
    await sleep(retryBaseMs * 2 ** attempt, input.signal)
  }
}

type PollInput = {
  doFetch: typeof fetch
  headers: Record<string, string>
  checkUrl: string
  requestId: string
  pollIntervalMs: number
  timeoutMs: number
  startedAt: number
  signal?: AbortSignal
  onProgress?: ConvertDocumentInput['onProgress']
}

/** Polls the check URL until Datalab reports `complete`, returning the final body. */
async function pollUntilComplete(input: PollInput): Promise<Record<string, unknown>> {
  for (;;) {
    const elapsedMs = Date.now() - input.startedAt
    if (elapsedMs > input.timeoutMs) {
      throw new DatalabError('timeout', `The conversion did not finish within ${Math.round(input.timeoutMs / 1000)}s`)
    }
    await sleep(input.pollIntervalMs, input.signal)
    input.onProgress?.({stage: 'processing', elapsedMs: Date.now() - input.startedAt, requestId: input.requestId})
    let body: unknown
    let status: number
    try {
      ;[status, body] = await withFetchDeadline(POLL_REQUEST_TIMEOUT_MS, async (signal) => {
        const res = await input.doFetch(input.checkUrl, {
          headers: input.headers,
          signal: combineSignals(signal, input.signal),
        })
        return [res.status, await readJson(res)] as const
      })
    } catch (error) {
      if (input.signal?.aborted) throw new DatalabError('aborted', 'Conversion was canceled')
      // A single failed poll is not the conversion failing; the next loop iteration retries.
      continue
    }
    if (status === 401 || status === 403) throw new DatalabError('auth', 'The conversion service rejected the API key')
    if (status < 200 || status >= 300) continue
    if (!isRecord(body)) continue
    if (body.status !== 'complete') continue
    if (body.success === false) {
      if (isPageRateLimit(body)) return body
      throw new DatalabError('failed', datalabMessage(body, 'The conversion failed'))
    }
    return body
  }
}

function parseResult(body: Record<string, unknown>, requestId: string): ConvertDocumentResult {
  const images = new Map<string, Uint8Array>()
  if (isRecord(body.images)) {
    for (const [name, value] of Object.entries(body.images)) {
      if (typeof value === 'string' && value) images.set(name, new Uint8Array(Buffer.from(value, 'base64')))
    }
  }
  const pageCount =
    typeof body.page_count === 'number' && Number.isFinite(body.page_count)
      ? Math.max(0, Math.floor(body.page_count))
      : 0
  const score = body.parse_quality_score
  const breakdown = body.cost_breakdown
  const total =
    typeof body.total_cost === 'number'
      ? body.total_cost
      : isRecord(breakdown)
        ? breakdown.total_cost ?? breakdown.total
        : undefined
  return {
    markdown: typeof body.markdown === 'string' ? body.markdown : '',
    images,
    pageCount,
    parseQualityScore: typeof score === 'number' && Number.isFinite(score) ? score : null,
    costCents: typeof total === 'number' && Number.isFinite(total) ? total : null,
    requestId,
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Turns a document file name into a stable folder slug: ascii, lowercase, dashes. */
export function slugForFileName(fileName: string): string {
  const base = fileName.slice(fileName.lastIndexOf('/') + 1)
  const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base
  const slug = stem
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '')
  return slug || 'document'
}

/** Appends `-2`, `-3`, ... until the name is not in `used`, then records it. */
export function uniqueName(candidate: string, used: Set<string>): string {
  let name = candidate
  for (let n = 2; used.has(name); n++) name = `${candidate}-${n}`
  used.add(name)
  return name
}

/** Maps Datalab's image names to safe file names under `assets/`, keeping the extension. */
export function assetFileNames(originalNames: Iterable<string>): Map<string, string> {
  const used = new Set<string>()
  const out = new Map<string, string>()
  for (const original of originalNames) {
    const base = original.slice(Math.max(original.lastIndexOf('/'), original.lastIndexOf('\\')) + 1)
    const dot = base.lastIndexOf('.')
    const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '')
    const ext =
      dot > 0
        ? base
            .slice(dot + 1)
            .replace(/[^A-Za-z0-9]+/g, '')
            .toLowerCase()
        : ''
    const candidate = `${stem || 'image'}${ext ? `.${ext}` : ''}`
    out.set(original, uniqueName(candidate, used))
  }
  return out
}

const IMAGE_REF_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g

/**
 * Rewrites image references so every resolved image sits alone on its own line. The shared markdown
 * parser keeps only standalone image lines as image blocks (an inline image collapses to its alt
 * text), and the memory publish path uploads only those. References `resolve` does not know, such
 * as remote URLs, are left untouched and listed in `unresolved`. Fenced code is not touched.
 */
export function rewriteImageReferences(
  markdown: string,
  resolve: (ref: string) => string | undefined,
): {markdown: string; rewritten: number; unresolved: string[]} {
  const out: string[] = []
  const unresolved: string[] = []
  let rewritten = 0
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    if (inFence || !line.includes('![')) {
      out.push(line)
      continue
    }
    const pieces: string[] = []
    let cursor = 0
    let changed = false
    for (const match of line.matchAll(IMAGE_REF_RE)) {
      const whole = match[0]
      const alt = match[1] ?? ''
      const rawRef = match[2] ?? ''
      let ref = rawRef
      try {
        ref = decodeURIComponent(rawRef)
      } catch {
        // Keep the raw reference when it is not percent-encoded.
      }
      const target = resolve(ref)
      if (target === undefined) {
        unresolved.push(ref)
        continue
      }
      pieces.push(line.slice(cursor, match.index), `\u0000![${alt}](${target})\u0000`)
      cursor = match.index + whole.length
      rewritten++
      changed = true
    }
    if (!changed) {
      out.push(line)
      continue
    }
    pieces.push(line.slice(cursor))
    // Each marker becomes its own paragraph; the text around it keeps its order.
    for (const piece of pieces.join('').split('\u0000')) {
      const trimmed = piece.trim()
      if (trimmed) out.push('', trimmed, '')
    }
  }
  // The split paragraphs add blank lines; keep the document's own trailing newline count.
  const trailing = /\n*$/.exec(markdown)?.[0] ?? ''
  return {
    markdown:
      out
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n+/, '')
        .replace(/\n+$/, '') + trailing,
    rewritten,
    unresolved,
  }
}

/** Caps a conversion result so the relay response stays bounded; large images are dropped largest first. */
export function boundConversionResult(
  result: ConvertDocumentResult,
  limits: {maxMarkdownBytes: number; maxImagesBytes: number},
): {markdown: string; images: Map<string, Uint8Array>; droppedImages: string[]} {
  if (Buffer.byteLength(result.markdown, 'utf8') > limits.maxMarkdownBytes) {
    throw new DatalabError(
      'failed',
      `The converted markdown is larger than ${Math.round(
        limits.maxMarkdownBytes / (1024 * 1024),
      )} MiB; convert fewer pages`,
    )
  }
  let total = 0
  for (const bytes of result.images.values()) total += bytes.byteLength
  if (total <= limits.maxImagesBytes) return {markdown: result.markdown, images: result.images, droppedImages: []}
  const bySize = [...result.images.entries()].sort((a, b) => b[1].byteLength - a[1].byteLength)
  const droppedImages: string[] = []
  const images = new Map(result.images)
  for (const [name, bytes] of bySize) {
    if (total <= limits.maxImagesBytes) break
    images.delete(name)
    droppedImages.push(name)
    total -= bytes.byteLength
  }
  return {markdown: result.markdown, images, droppedImages}
}

/** Runs `worker` over `items` with at most `limit` in flight; results keep the input order. */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const runners = Array.from({length: Math.max(1, Math.min(limit, items.length))}, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await worker(items[index]!, index)
    }
  })
  await Promise.all(runners)
  return results
}
