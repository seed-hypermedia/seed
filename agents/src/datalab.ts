/**
 * Everything behind the `convert` tool except the tool itself (`executeConvert` in api-service.ts):
 * the Datalab client, the relay through which servers without a key convert on a hosted server
 * (`convertDocumentViaRelay`), the usage ledger of the server's shared key (`reservePages`), and
 * the deterministic post-processing of the converted markdown (`postprocessConvertedMarkdown`).
 *
 * The client makes one request per file: POST `/convert` with the document as a multipart part,
 * then poll the returned `request_check_url` until the job is `complete`. Datalab has no batch
 * endpoint; callers run several of these concurrently. The client knows nothing about agent
 * memory, accounts or SQLite, so the builtin executor and the hosted `ConvertDocument` action
 * share it. The API key only ever travels in the `X-API-Key` header and never appears in errors
 * or logs.
 */

import type {Database} from 'bun:sqlite'
import type * as api from '@/api'
import {createSignedEnvelope} from '@/auth'
import * as cbor from '@/cbor'
import {stmt} from '@/statements'
import {withFetchDeadline} from '@/web-tools'
import type * as blobs from '@shm/shared/blobs'

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

/** How often the relay asks whether a job finished. */
export const CONVERT_RELAY_POLL_INTERVAL_MS = 2_000
/** How long one relayed conversion may take, upload to result. */
export const CONVERT_RELAY_DEADLINE_MS = 15 * 60_000
/** Upload budget: 100 MiB over a home uplink is minutes, not seconds. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000
const POLL_TIMEOUT_MS = 20_000

/** A relay failure carrying the hosted server's HTTP status so the tool can map it faithfully. */
export class ConvertRelayError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ConvertRelayError'
  }
}

/** One relayed conversion. */
export type ConvertRelayInput = {
  relayUrl: string
  /** The agent's identity key pair; the hosted server charges its account. */
  signer: blobs.Signer
  bytes: Uint8Array
  fileName: string
  mode?: DatalabMode
  maxPages?: number
  pageRange?: string
  onProgress?: (detail: string) => void
  pollIntervalMs?: number
  deadlineMs?: number
  fetch?: typeof fetch
}

/** A relayed result: a direct conversion's shape plus the images the hosted server had to leave out. */
export type ConvertRelayResult = ConvertDocumentResult & {droppedImages: string[]}

async function sendRelayAction<T extends api.AgentResponse['_']>(
  input: ConvertRelayInput,
  action: api.UnsignedAgentAction,
  timeoutMs: number,
): Promise<Extract<api.AgentResponse, {_: T}>> {
  const envelope = await createSignedEnvelope(input.signer, {action})
  const res = await (input.fetch ?? globalThis.fetch)(`${input.relayUrl.replace(/\/+$/, '')}/api/message`, {
    method: 'POST',
    headers: {'Content-Type': 'application/cbor', Accept: 'application/cbor'},
    body: cbor.encode(envelope) as BodyInit,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const decoded = cbor.decode<api.AgentResponse>(new Uint8Array(await res.arrayBuffer()))
  if (!res.ok || decoded._ === 'Error') {
    throw new ConvertRelayError(
      res.status,
      decoded._ === 'Error' ? decoded.message : `The conversion service answered HTTP ${res.status}`,
    )
  }
  return decoded as Extract<api.AgentResponse, {_: T}>
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

/**
 * Uploads one document to the hosted server and polls until its conversion is done: the `convert`
 * tool on a server without a Datalab key.
 *
 * The local server inside the desktop app, and any self-hosted server without a key, asks a hosted
 * agents server to convert on its behalf: `ConvertDocument` uploads the document, `GetConversion`
 * polls until the result is ready. Both are ordinary signed actions, signed with the agent's own
 * identity key, so the hosted server bills that identity's account. Nothing here touches memory;
 * the result has the same shape as a direct Datalab conversion so the tool writes it the same way.
 */
export async function convertDocumentViaRelay(input: ConvertRelayInput): Promise<ConvertRelayResult> {
  input.onProgress?.(`Uploading ${input.fileName} to the conversion service`)
  let started: api.ConvertDocumentResponse
  try {
    started = await sendRelayAction<'ConvertDocumentResponse'>(
      input,
      {
        _: 'ConvertDocument',
        content: input.bytes,
        fileName: input.fileName,
        ...(input.mode ? {mode: input.mode} : {}),
        ...(input.maxPages !== undefined ? {maxPages: input.maxPages} : {}),
        ...(input.pageRange ? {pageRange: input.pageRange} : {}),
        // One id per call: a retried upload must not reserve pages twice.
        clientRequestId: crypto.randomUUID(),
      },
      UPLOAD_TIMEOUT_MS,
    )
  } catch (error) {
    if (error instanceof ConvertRelayError) throw error
    throw new ConvertRelayError(
      isAbortError(error) ? 504 : 502,
      isAbortError(error)
        ? `Uploading ${input.fileName} to the conversion service timed out`
        : `Could not reach the conversion service: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const startedAt = Date.now()
  const deadline = startedAt + (input.deadlineMs ?? CONVERT_RELAY_DEADLINE_MS)
  for (;;) {
    await Bun.sleep(input.pollIntervalMs ?? CONVERT_RELAY_POLL_INTERVAL_MS)
    if (Date.now() > deadline) {
      throw new ConvertRelayError(
        504,
        `Conversion of ${input.fileName} timed out after ${Math.round((Date.now() - startedAt) / 1000)}s`,
      )
    }
    let status: api.GetConversionResponse
    try {
      status = await sendRelayAction<'GetConversionResponse'>(
        input,
        {_: 'GetConversion', jobId: started.jobId},
        POLL_TIMEOUT_MS,
      )
    } catch (error) {
      // A dropped poll is not a failed conversion: the job is still there until the deadline.
      if ((error instanceof ConvertRelayError && error.status >= 500) || isAbortError(error)) continue
      throw error
    }
    if (status.status === 'processing') {
      input.onProgress?.(`Converting ${input.fileName} (${Math.round((Date.now() - startedAt) / 1000)}s)`)
      continue
    }
    if (status.status === 'failed') throw new ConvertRelayError(502, status.error ?? 'The conversion failed')
    return {
      markdown: status.markdown ?? '',
      images: new Map((status.images ?? []).map((image) => [image.name, image.content])),
      pageCount: status.pageCount ?? 0,
      parseQualityScore: status.parseQualityScore ?? null,
      costCents: status.costCents ?? null,
      requestId: started.jobId,
      droppedImages: status.droppedImages ?? [],
    }
  }
}

/** Most pages one conversion may bill, whatever the caller asks for. */
export const CONVERT_PAGES_PER_CALL_CAP = 200

/** A reservation older than this belongs to a call the process lost (crash, restart); it is released. */
const STALE_RESERVATION_MS = 30 * 60_000

/** Which limit stopped a reservation, reported so the result can say why a document was cut. */
export type ReservationBound = 'requested' | 'call_cap' | 'account_allowance' | 'server_ceiling'

/** Thrown when the account or the server has no shared pages left this month. */
export class ConversionQuotaError extends Error {
  constructor(
    readonly scope: 'account' | 'server',
    readonly used: number,
    readonly limit: number,
  ) {
    super(
      scope === 'account'
        ? `This account has used ${used} of its ${limit} shared conversion pages this month`
        : `This server has used ${used} of its ${limit} shared conversion pages this month`,
    )
    this.name = 'ConversionQuotaError'
  }
}

/** The UTC calendar month a timestamp falls in, as `YYYY-MM`. */
export function periodOf(now: number): string {
  return new Date(now).toISOString().slice(0, 7)
}

/** Pages counted against the period: reserved rows at their reservation, settled rows at their charge. */
export function pagesUsed(db: Database, input: {accountId?: string; period: string}): number {
  const row = input.accountId
    ? stmt<{pages: number | null}, [string, string]>(
        db,
        `SELECT SUM(CASE state WHEN 'reserved' THEN pages_reserved WHEN 'settled' THEN pages_charged ELSE 0 END) AS pages
           FROM conversion_usage WHERE account_id = ? AND period = ?`,
      ).get(input.accountId, input.period)
    : stmt<{pages: number | null}, [string]>(
        db,
        `SELECT SUM(CASE state WHEN 'reserved' THEN pages_reserved WHEN 'settled' THEN pages_charged ELSE 0 END) AS pages
           FROM conversion_usage WHERE period = ?`,
      ).get(input.period)
  return row?.pages ?? 0
}

/** What `reservePages` needs to know. `requested` is the caller's own page bound, if any. */
export type ReserveInput = {
  accountId: string
  agentId?: string
  sourceName: string
  requested?: number
  accountAllowance: number
  globalCeiling: number
  now: number
}

/** A reservation: the pages Datalab may bill for this call, and the limit that set that number. */
export type Reservation = {id: string; pages: number; boundBy: ReservationBound; accountRemaining: number}

/**
 * Reserves pages for one conversion on the server's shared Datalab key, or throws
 * `ConversionQuotaError` when nothing is left. Runs as one transaction so the allowance check and
 * the insert cannot interleave with another call.
 *
 * Every metered conversion reserves pages before the Datalab call, in the same transaction that
 * checks the account's monthly allowance and the server's monthly ceiling. The reservation is what
 * Datalab is told as `max_pages`, so the spend of a call is bounded before any money moves. On
 * success the row settles to the page count Datalab reports (`settleReservation`); on failure it
 * is released (`releaseReservation`). Reserved rows count as used until settled, so concurrent
 * calls cannot overshoot the allowance together.
 */
export function reservePages(db: Database, input: ReserveInput): Reservation {
  return db.transaction(() => {
    stmt<void, [number, number]>(
      db,
      `UPDATE conversion_usage SET state = 'released', updated_at = ? WHERE state = 'reserved' AND created_at < ?`,
    ).run(input.now, input.now - STALE_RESERVATION_MS)
    const period = periodOf(input.now)
    const accountUsed = pagesUsed(db, {accountId: input.accountId, period})
    const globalUsed = pagesUsed(db, {period})
    const accountRemaining = input.accountAllowance - accountUsed
    const globalRemaining = input.globalCeiling - globalUsed
    if (accountRemaining <= 0) throw new ConversionQuotaError('account', accountUsed, input.accountAllowance)
    if (globalRemaining <= 0) throw new ConversionQuotaError('server', globalUsed, input.globalCeiling)
    const candidates: [ReservationBound, number][] = [
      ['call_cap', CONVERT_PAGES_PER_CALL_CAP],
      ['account_allowance', accountRemaining],
      ['server_ceiling', globalRemaining],
    ]
    if (input.requested !== undefined) candidates.unshift(['requested', input.requested])
    // The smallest bound wins; on a tie the earlier (more specific) one names the reason.
    let [boundBy, pages] = candidates[0]!
    for (const [bound, limit] of candidates) {
      if (limit < pages) [boundBy, pages] = [bound, limit]
    }
    const id = crypto.randomUUID()
    stmt<void, [string, string, string | null, string, number, string | null, number, number]>(
      db,
      `INSERT INTO conversion_usage (id, account_id, agent_id, period, pages_reserved, pages_charged, state, request_id, source_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, 'reserved', NULL, ?, ?, ?)`,
    ).run(id, input.accountId, input.agentId ?? null, period, pages, input.sourceName, input.now, input.now)
    return {id, pages, boundBy, accountRemaining: accountRemaining - pages}
  })()
}

/** Charges the reservation what Datalab reported, never more than was reserved. */
export function settleReservation(
  db: Database,
  id: string,
  input: {pageCount: number; requestId?: string; now: number},
): void {
  stmt<void, [number, string | null, number, string]>(
    db,
    `UPDATE conversion_usage SET state = 'settled', pages_charged = MIN(?, pages_reserved), request_id = ?, updated_at = ?
       WHERE id = ? AND state = 'reserved'`,
  ).run(Math.max(0, Math.floor(input.pageCount)), input.requestId ?? null, input.now, id)
}

/** Frees a reservation whose conversion did not happen. */
export function releaseReservation(db: Database, id: string, now: number): void {
  stmt<void, [number, string]>(
    db,
    `UPDATE conversion_usage SET state = 'released', updated_at = ? WHERE id = ? AND state = 'reserved'`,
  ).run(now, id)
}

const FENCE_RE = /^\s*(```|~~~)/
const MATH_FENCE_RE = /^\s*\$\$\s*$/
const MATH_ONE_LINE_RE = /^\s*\$\$(.+?)\$\$\s*$/
const MATH_OPEN_RE = /^\s*\$\$(.+)$/
const MATH_CLOSE_RE = /^(.+?)\$\$\s*$/
const ANCHOR_RE = /<a\s+(?:id|name)="[^"]*"\s*>\s*<\/a>\s*/g
const INTERNAL_LINK_RE = /\[((?:[^[\]\\\n]|\\.)*)\]\(#(?:block|page)-\d+(?:-\d+)*\)/g
const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*(<!--\s*id:[^>]*-->)?\s*$/
const CAPTION_RE =
  /^\s*(?:\*\*|__)?\s*((?:Figure|Fig\.?|Table|Tab\.?|Chart|Plate|Scheme)\s*[A-Z]?\d+[a-z]?(?:\.\d+)?)\s*[.:：\-–—]?\s*(.*?)\s*(?:\*\*|__)?\s*$/i
const REFERENCES_HEADING_RE =
  /^(#{1,6})\s*(?:\d+[.)]?\s*)?(references?|reference list|bibliography|works cited|literature cited)\s*(<!--.*-->)?\s*$/i
const HEADING_RE = /^(#{1,6})\s/
const NUMERIC_ENTRY_RE = /^(\s*(?:[-*+]|\d+[.)])\s+)?\[?(\d{1,4})[\].]\s+(.*)$/
const LABELLED_ENTRY_RE = /^\s*(?:[-*+]\s+)?\[([^[\]]{1,80})\]\s+\S/
const ID_COMMENT_RE = /<!--\s*id:([A-Za-z0-9_-]+)[^>]*-->/
// Datalab escapes literal brackets, `\[49\]`, so a citation may carry backslashes.
const BRACKET_RE = /\\?\[([^[\]\n]{1,200}?)\\?\]/g
const RANGE_RE = /^(\d{1,4})\s*[-–]\s*(\d{1,4})$/
/** A bracket that was meant as a citation even though no entry matched: a number, or a label with a year. */
const LOOKS_CITED_RE = /^\d{1,4}$|\b(?:1[5-9]|20)\d\d[a-z]?\b|\bundated\b|\bn\.d\.?/i

/** What the post-processor changed, for the manifest and the summary. */
export type PostprocessReport = {
  markdown: string
  /** Datalab's PDF-internal links (`[…](#block-N-M)`) reduced to their text. */
  internalLinksUnwrapped: number
  /** One-line `$$…$$` formulas rewritten as fenced math blocks. */
  mathBlocksNormalized: number
  captionsFolded: number
  referenceEntries: number
  citationsLinked: number
  /** Citation keys (`12`, `Meyrowitz 1999`) with no bibliography entry, left as plain text. */
  citationsUnlinked: string[]
}

function unwrapInternalLinks(lines: string[]): {lines: string[]; unwrapped: number} {
  const out: string[] = []
  let unwrapped = 0
  let inFence = false
  for (const line of lines) {
    if (FENCE_RE.test(line)) inFence = !inFence
    if (inFence) {
      out.push(line)
      continue
    }
    const stripped = line.replace(ANCHOR_RE, '')
    // An anchor on a line of its own leaves nothing behind.
    if (stripped.trim() === '' && line.trim() !== '') continue
    out.push(
      stripped.replace(INTERNAL_LINK_RE, (_m, label: string) => {
        unwrapped++
        return label
      }),
    )
  }
  return {lines: out, unwrapped}
}

function normalizeDisplayMath(lines: string[]): {lines: string[]; normalized: number} {
  const out: string[] = []
  let normalized = 0
  let inFence = false
  let inMath = false
  for (const line of lines) {
    if (FENCE_RE.test(line)) inFence = !inFence
    if (inFence) {
      out.push(line)
      continue
    }
    if (MATH_FENCE_RE.test(line)) {
      inMath = !inMath
      out.push(line)
      continue
    }
    const oneLine = inMath ? null : MATH_ONE_LINE_RE.exec(line)
    const open = inMath || oneLine ? null : MATH_OPEN_RE.exec(line)
    const close = inMath ? MATH_CLOSE_RE.exec(line) : null
    if (oneLine) {
      out.push('$$', oneLine[1]!.trim(), '$$')
      normalized++
    } else if (open) {
      out.push('$$', open[1]!.trim())
      inMath = true
      normalized++
    } else if (close) {
      // The opening line already counted this block.
      out.push(close[1]!.trim(), '$$')
      inMath = false
    } else {
      out.push(line)
    }
  }
  return {lines: out, normalized}
}

/** The lookup key of a citation or entry label: emphasis and spacing differences do not matter. */
function citationKey(label: string): string {
  return label.replace(/[*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
}

/** The id a bibliography entry carries, by its number or label: `ref-3`, `ref-palay-et-al-1988`. */
export function referenceBlockId(label: string | number): string {
  const slug = citationKey(String(label))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `ref-${slug || 'entry'}`
}

function stripEmphasis(text: string): string {
  return text
    .replace(/^(\*\*|__)\s*/, '')
    .replace(/\s*(\*\*|__)$/, '')
    .trim()
}

/** True when the image's alt is empty or just the label (`Figure 3`), so the full caption should replace it. */
function altWantsCaption(alt: string, label: string): boolean {
  const a = alt.trim().toLowerCase().replace(/\s+/g, ' ')
  const l = label.trim().toLowerCase().replace(/\s+/g, ' ')
  return a === '' || a === l || a === l.replace(/[.:]$/, '')
}

function foldCaptions(lines: string[]): {lines: string[]; folded: number} {
  const out: string[] = []
  const drop = new Set<number>()
  let folded = 0
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (FENCE_RE.test(line)) inFence = !inFence
    if (inFence) continue
    const image = IMAGE_LINE_RE.exec(line)
    if (!image) continue
    // The caption is the nearest non-blank line after the image (Datalab's usual order), else before.
    for (const dir of [1, -1]) {
      let j = i + dir
      while (j >= 0 && j < lines.length && lines[j]!.trim() === '') j += dir
      if (j < 0 || j >= lines.length || drop.has(j) || IMAGE_LINE_RE.test(lines[j]!) || HEADING_RE.test(lines[j]!))
        continue
      const caption = CAPTION_RE.exec(lines[j]!)
      if (!caption) continue
      const label = caption[1]!
      const text = stripEmphasis(caption[2] ?? '')
      if (!altWantsCaption(image[1] ?? '', label)) continue
      const full = text ? `${label.replace(/[.:]$/, '')}: ${text}` : label
      lines[i] = line.replace(
        IMAGE_LINE_RE,
        (_m, _alt, url: string, id?: string) => `![${full}](${url})${id ? ` ${id}` : ''}`,
      )
      drop.add(j)
      // The blank line that separated the caption from its neighbour goes with it.
      if (lines[j + 1]?.trim() === '') drop.add(j + 1)
      else if (lines[j - 1]?.trim() === '') drop.add(j - 1)
      folded++
      break
    }
  }
  for (let i = 0; i < lines.length; i++) if (!drop.has(i)) out.push(lines[i]!)
  return {lines: out, folded}
}

/** Finds the references section: the heading line index and where the section ends (exclusive). */
function referencesSection(lines: string[]): {start: number; end: number} | undefined {
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i]!)) inFence = !inFence
    if (inFence) continue
    const heading = REFERENCES_HEADING_RE.exec(lines[i]!)
    if (!heading) continue
    const level = heading[1]!.length
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      const next = HEADING_RE.exec(lines[j]!)
      if (next && next[1]!.length <= level) {
        end = j
        break
      }
    }
    return {start: i, end}
  }
  return undefined
}

function linkCitations(lines: string[]): {lines: string[]; entries: number; linked: number; unlinked: string[]} {
  const section = referencesSection(lines)
  if (!section) return {lines, entries: 0, linked: 0, unlinked: []}
  // Citation key → block id of the entry.
  const ids = new Map<string, string>()
  const taken = new Set<string>()
  for (let i = section.start + 1; i < section.end; i++) {
    const label = NUMERIC_ENTRY_RE.exec(lines[i]!)?.[2] ?? LABELLED_ENTRY_RE.exec(lines[i]!)?.[1]
    if (!label) continue
    const key = citationKey(label)
    if (ids.has(key)) continue
    const existing = ID_COMMENT_RE.exec(lines[i]!)
    let id = existing ? existing[1]! : referenceBlockId(label)
    for (let n = 2; taken.has(id); n++) id = `${referenceBlockId(label)}-${n}`
    if (!existing) lines[i] = `${lines[i]!.replace(/\s+$/, '')} <!-- id:${id} -->`
    ids.set(key, id)
    taken.add(id)
  }
  if (ids.size === 0) return {lines, entries: 0, linked: 0, unlinked: []}
  let linked = 0
  const unlinked = new Set<string>()
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (FENCE_RE.test(line)) inFence = !inFence
    if (inFence || (i >= section.start && i < section.end) || IMAGE_LINE_RE.test(line)) continue
    // Link destinations `](…)` are kept verbatim; a bracketed number inside a URL is not a citation.
    lines[i] = line
      .split(/(\]\([^)]*\))/)
      .map((segment, k) => (k % 2 === 1 ? segment : linkCitationsInText(segment, ids, () => linked++, unlinked)))
      .join('')
  }
  return {lines, entries: ids.size, linked, unlinked: [...unlinked]}
}

function linkCitationsInText(
  text: string,
  ids: Map<string, string>,
  onLink: () => void,
  unlinked: Set<string>,
): string {
  return text.replace(BRACKET_RE, (whole: string, inner: string, offset: number) => {
    // Not a citation when it is a link label or follows one: `[text](url)`, `[a][b]`.
    const before = text[offset - 1]
    const after = text[offset + whole.length]
    if (before === '!' || before === ']' || after === '(' || after === '[' || after === ':') return whole
    // A label that contains the separator itself, `[Smith, 2001]`, is tried whole first.
    const wholeId = ids.get(citationKey(inner))
    if (wholeId) {
      onLink()
      return `[[${inner}](#${wholeId})]`
    }
    // Odd segments are the separators, kept as written.
    const segments = inner.split(/(\s*[;,]\s*)/)
    let changed = false
    const out = segments.map((segment, k) => {
      if (k % 2 === 1) return segment
      const range = RANGE_RE.exec(segment.trim())
      const keys = range ? expandRange(Number(range[1]), Number(range[2])) : [segment.trim()]
      const parts: string[] = []
      for (const key of keys) {
        const id = ids.get(citationKey(key))
        if (id) {
          parts.push(`[${key}](#${id})`)
          onLink()
          changed = true
        } else {
          parts.push(key)
          if (LOOKS_CITED_RE.test(key)) unlinked.add(citationKey(key))
        }
      }
      return parts.join(', ')
    })
    return changed ? `[${out.join('')}]` : whole
  })
}

function expandRange(from: number, to: number): string[] {
  if (to < from || to - from > 50) return []
  return Array.from({length: to - from + 1}, (_, k) => String(from + k))
}

/**
 * Runs every clean-up step over converted markdown before an agent reviews it. Fenced code is
 * never touched.
 *
 * Datalab returns a faithful but flat document: figure captions sit in their own paragraph next
 * to the image, and citations are plain `[3]` text with no way to reach the bibliography entry.
 * The import guide asks for both to be fixed, and both are mechanical, so `convert` does them
 * here instead of spending model turns on them:
 *
 * - A `Figure N: …` (or `Fig.`, `Table`) paragraph adjacent to a standalone image becomes that
 *   image's caption, the alt text of the image line, and the paragraph goes away.
 * - Entries of the references section get block ids (`<!-- id:ref-N -->`, which the markdown
 *   dialect keeps through publishing), and citations in the body become links to those ids
 *   written as `#ref-N`. `write ... fromPath` resolves such fragment links to the published
 *   document's own address. Both common bracket styles are handled: numeric entries (`[3]`,
 *   `3.`) cited as `[3]`, `[1, 2]`, `[4-6]`, and labelled entries (`[Meyrowitz 1986]`,
 *   `[Palay et al. 1988]`) cited by the same label, alone or in a `;`/`,` separated list.
 *
 * Parenthesised author-year citations, `(Meyrowitz, 1986)`, have no bracketed key to match
 * on and are left alone.
 *
 * Before either step, the PDF's own internal links are unwrapped. With the `extract_links`
 * extra Datalab keeps them as `[\[49\].](#block-9-2)` pointing at an `<a id="block-9-2"></a>`
 * anchor it writes before the target block. The anchors do not survive the markdown parser, so
 * published they would be dead links, and for citations they are coarser than the entry ids
 * anyway (one anchor per page block, not per entry). The label text stays; the anchors go.
 *
 * Display math is put on the parser's terms as well. Datalab writes `$$T_i = Y_i(1)$$` on one
 * line; the markdown dialect opens a math block at a line starting with `$$`, ignores the rest
 * of that line and reads until a line that is exactly `$$`, so one such formula would swallow
 * the rest of the document into a single block. Each one becomes `$$`, the formula, `$$`.
 */
export function postprocessConvertedMarkdown(markdown: string): PostprocessReport {
  const internal = unwrapInternalLinks(markdown.split('\n'))
  const math = normalizeDisplayMath(internal.lines)
  const captions = foldCaptions(math.lines)
  const citations = linkCitations(captions.lines)
  return {
    markdown: citations.lines.join('\n'),
    internalLinksUnwrapped: internal.unwrapped,
    mathBlocksNormalized: math.normalized,
    captionsFolded: captions.folded,
    referenceEntries: citations.entries,
    citationsLinked: citations.linked,
    citationsUnlinked: citations.unlinked,
  }
}
