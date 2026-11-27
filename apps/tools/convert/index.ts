// The `convert` tool of the Converter app (hypermedia/agent/datalab-importer.md). It sends one
// document to the Datalab document parser with the key in the app's private config, and returns the
// Markdown, the extracted figures and a manifest. Like any tool it takes JSON and returns JSON: the
// document arrives, and every converted file leaves, as a `{name, mimeType, data}` object whose
// `data` is base64 (hypermedia/tool.md). Nothing here reads or writes Seed, or stores anything.
//
// This file is the whole tool: the app environment runs a tool's index.ts alone, so it imports
// nothing.

type Mode = 'fast' | 'balanced' | 'accurate'

/** A file inside a tool's JSON: its bytes are `data`, as base64. */
type ToolFile = {name: string; mimeType: string; data: string}

/** A call either starts a conversion (`file`) or resumes one (`job`). */
type Input = {
  file?: ToolFile
  job?: string
  pageRange?: string
  maxPages?: number
  mode?: Mode
}

type Context = {
  app: string
  callId?: string
  publicConfig: {
    /** The most expensive mode a call may use, and the default. */
    mode?: string
    /** The most pages one document may bill. */
    maxPages?: number
    extras?: string
    /** How long one call waits for Datalab before answering `pending`. Keep it under the tool's `timeoutSecs`. */
    pollSeconds?: number
    pollIntervalMs?: number
    baseUrl?: string
  }
  privateConfig: {datalabApiKey?: string}
}

/** Conversion modes, cheapest first. Fast and balanced share a price; accurate costs 2.5x. */
const MODES: readonly Mode[] = ['fast', 'balanced', 'accurate']
const DATALAB_BASE_URL = 'https://www.datalab.to/api/v1'
const DEFAULT_MODE: Mode = 'balanced'
// `infographic` is left out on purpose: it makes Datalab drop every figure.
const DEFAULT_EXTRAS = 'extract_links,chart_understanding'
/** As base64 inside JSON, a document this large still fits the 64 MiB a tool call takes. */
const MAX_FILE_BYTES = 45 * 1024 * 1024
/** Most pages one document may bill, unless the app's public config says otherwise. */
const DEFAULT_MAX_PAGES = 200
const SUBMIT_TIMEOUT_MS = 120_000
const POLL_REQUEST_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 2_000
/** Fits the 60 s a tool runs for when its document sets no `timeoutSecs`. */
const DEFAULT_POLL_SECONDS = 40
const RETRY_BASE_MS = 2_000
const MAX_SUBMIT_ATTEMPTS = 3

/** Input types Datalab converts, by extension, with the MIME type sent for the multipart part. */
const SUPPORTED: Record<string, string> = {
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
const SUPPORTED_LIST = Object.keys(SUPPORTED)
  .map((ext) => `.${ext}`)
  .join(', ')

type DatalabErrorKind = 'auth' | 'request' | 'rate_limited' | 'failed' | 'network'

/** A conversion failure with a stable kind. Its message never carries the key. */
class DatalabError extends Error {
  constructor(
    readonly kind: DatalabErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'DatalabError'
  }
}

type ConvertResult = {
  markdown: string
  images: Map<string, Uint8Array>
  pageCount: number
  parseQualityScore: number | null
  costCents: number | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Reads a Datalab failure message without echoing anything that could carry the key. */
function datalabMessage(body: unknown, fallback: string): string {
  if (isRecord(body)) {
    const error = body.error ?? body.detail ?? body.message
    if (typeof error === 'string' && error.trim()) return error.trim().slice(0, 300)
  }
  return fallback
}

const isPageRateLimit = (body: unknown) =>
  isRecord(body) && typeof body.error === 'string' && /page rate limit/i.test(body.error)

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

const REJECTED_KEY =
  'Datalab rejected the API key in this app’s private config; someone who runs the app must replace it'

type Submission = {
  bytes: Uint8Array
  fileName: string
  mimeType: string
  apiKey: string
  mode: Mode
  extras: string
  maxPages: number
  pageRange?: string
  baseUrl: string
}

/**
 * Sends one document: POST `/convert` with the document as a multipart part. Returns the URL the
 * job is checked at. HTTP 429 is retried a few times with backoff; every other failure is reported
 * once with a stable kind. The key only ever travels in the header.
 */
async function submitDocument(input: Submission): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    const form = new FormData()
    form.append('file', new Blob([input.bytes as BlobPart], {type: input.mimeType}), input.fileName)
    form.append('output_format', 'markdown')
    form.append('mode', input.mode)
    form.append('disable_image_captions', 'true')
    form.append('paginate', 'false')
    if (input.extras) form.append('extras', input.extras)
    form.append('max_pages', String(input.maxPages))
    if (input.pageRange) form.append('page_range', input.pageRange)

    let status: number
    let submitted: unknown
    try {
      const res = await fetch(`${input.baseUrl}/convert`, {
        method: 'POST',
        headers: {'X-API-Key': input.apiKey},
        body: form,
        signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      })
      status = res.status
      submitted = await readJson(res)
    } catch (error) {
      throw new DatalabError('network', `Could not reach the conversion service: ${errorText(error)}`)
    }
    if (status === 401 || status === 403) throw new DatalabError('auth', REJECTED_KEY)
    if (status !== 429) {
      if (status < 200 || status >= 300) {
        throw new DatalabError('request', datalabMessage(submitted, `The conversion service answered HTTP ${status}`))
      }
      if (!isRecord(submitted) || submitted.success !== true || typeof submitted.request_check_url !== 'string') {
        throw new DatalabError(
          'request',
          datalabMessage(submitted, 'The conversion service did not accept the document'),
        )
      }
      return submitted.request_check_url
    }
    if (attempt + 1 >= MAX_SUBMIT_ATTEMPTS) {
      throw new DatalabError('rate_limited', 'The conversion service is rate limiting this key; try again in a minute')
    }
    await sleep(RETRY_BASE_MS * 2 ** attempt)
  }
}

/**
 * Asks the check URL until Datalab reports `complete` or `deadline` passes. Returns the final body,
 * or undefined when the job is still running. A dropped request is tried again.
 */
async function pollUntil(
  checkUrl: string,
  apiKey: string,
  deadline: number,
  intervalMs: number,
): Promise<Record<string, unknown> | undefined> {
  for (;;) {
    let status = 0
    let body: unknown
    try {
      const res = await fetch(checkUrl, {
        headers: {'X-API-Key': apiKey},
        signal: AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS),
      })
      status = res.status
      body = await readJson(res)
    } catch {
      // Tried again below, until the deadline.
    }
    if (status === 401 || status === 403) throw new DatalabError('auth', REJECTED_KEY)
    if (status === 404) throw new DatalabError('request', 'The conversion service does not know this job')
    if (status >= 200 && status < 300 && isRecord(body) && body.status === 'complete') {
      if (body.success === false) {
        if (isPageRateLimit(body)) {
          throw new DatalabError(
            'rate_limited',
            'The conversion service is rate limiting this key; start the conversion again in a minute',
          )
        }
        throw new DatalabError('failed', datalabMessage(body, 'The conversion failed'))
      }
      return body
    }
    if (Date.now() + intervalMs > deadline) return undefined
    await sleep(intervalMs)
  }
}

function parseResult(body: Record<string, unknown>): ConvertResult {
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
  }
}

/** Appends `-2`, `-3`, ... until the name is not in `used`, then records it. */
function uniqueName(candidate: string, used: Set<string>): string {
  let name = candidate
  for (let n = 2; used.has(name); n++) name = `${candidate}-${n}`
  used.add(name)
  return name
}

/** Maps Datalab's image names to safe file names under `assets/`, keeping the extension. */
function assetFileNames(originalNames: Iterable<string>): Map<string, string> {
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
    out.set(original, uniqueName(`${stem || 'image'}${ext ? `.${ext}` : ''}`, used))
  }
  return out
}

const IMAGE_REF_RE = /!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g

/**
 * Rewrites image references so every resolved image sits alone on its own line: the markdown
 * parser keeps only standalone image lines as image blocks, and publishing uploads only those.
 * References `resolve` does not know, such as remote URLs, are left untouched and listed. Fenced
 * code is not touched.
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
    for (const piece of pieces.join('').split('\u0000')) {
      const trimmed = piece.trim()
      if (trimmed) out.push('', trimmed, '')
    }
  }
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
const LABELLED_ENTRY_RE = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?\[([^[\]]{1,80})\](?:\*\*|__)?\s+\S/
const ID_COMMENT_RE = /<!--\s*id:([A-Za-z0-9_-]+)[^>]*-->/
// Datalab escapes literal brackets, `\[49\]`, so a citation may carry backslashes.
const BRACKET_RE = /\\?\[([^[\]\n]{1,200}?)\\?\]/g
const RANGE_RE = /^(\d{1,4})\s*[-–]\s*(\d{1,4})$/
/** A bracket that was meant as a citation even though no entry matched: a number, or a label with a year. */
const LOOKS_CITED_RE = /^\d{1,4}$|\b(?:1[5-9]|20)\d\d[a-z]?\b|\bundated\b|\bn\.d\.?/i

type PostprocessReport = {
  markdown: string
  /** Markers Datalab left unpaired and what was done about each, with its line in raw.md. */
  markersRepaired: string[]
  internalLinksUnwrapped: number
  mathBlocksNormalized: number
  captionsFolded: number
  referenceEntries: number
  citationsLinked: number
  citationsUnlinked: string[]
}

/** A line that is a block of its own, a list item, a heading, a table row or a quote: an inline marker cannot pair across it. */
const OWN_BLOCK_RE = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|\||>)/

/**
 * Repairs the markers Datalab leaves unpaired, before any other pass reads the markdown, because
 * an unpaired marker is not local damage: a code fence that never closes swallows the rest of the
 * document, in the renderer and in the passes below, which skip fenced lines, and a stray `**` or
 * backtick runs to the end of its paragraph. A fence with no closing fence is dropped, and a
 * paragraph, list item, heading or table row with an odd number of `**` or of backtick runs loses
 * its last one. Every repair names its line in raw.md and the text it touched, so the review
 * looks exactly there. Single `*` and `_` are left alone: in a paper they are multiplication signs
 * and identifiers far more often than emphasis. Display math is normalizeDisplayMath's, which
 * closes a `$$` block still open at the end of its paragraph.
 */
function balanceMarkers(lines: string[]): {lines: string[]; repairs: string[]} {
  const out = [...lines]
  const origin = lines.map((_, i) => i + 1)
  const repairs: string[] = []
  const fenced = new Set<number>()
  for (let i = 0; i < out.length; i++) {
    if (!FENCE_RE.test(out[i]!)) continue
    const close = out.findIndex((line, j) => j > i && FENCE_RE.test(line))
    if (close === -1) {
      repairs.push(`line ${origin[i]}: code fence that never closes removed: "${out[i]!.trim().slice(0, 60)}"`)
      out.splice(i, 1)
      origin.splice(i, 1)
      i--
      continue
    }
    for (let j = i; j <= close; j++) fenced.add(j)
    i = close
  }
  const markers = [
    [/\*\*/g, '**'],
    [/`+/g, 'backtick'],
  ] as const
  let unit: number[] = []
  const flush = () => {
    for (const [marker, name] of markers) {
      const count = unit.reduce((n, i) => n + (out[i]!.match(marker) ?? []).length, 0)
      if (count % 2 === 0) continue
      const i = [...unit].reverse().find((k) => out[k]!.match(marker))!
      const hits = [...out[i]!.matchAll(marker)]
      const hit = hits[hits.length - 1]!
      const at = hit.index ?? 0
      out[i] = out[i]!.slice(0, at) + out[i]!.slice(at + hit[0].length)
      repairs.push(`line ${origin[i]}: unpaired ${name} removed from "${out[i]!.trim().slice(0, 60)}"`)
    }
    unit = []
  }
  // A unit is a paragraph, the lines between blank lines, or a line that is a block of its own.
  for (let i = 0; i <= out.length; i++) {
    const line = out[i]
    if (line === undefined || !line.trim() || fenced.has(i)) {
      flush()
      continue
    }
    if (OWN_BLOCK_RE.test(line)) flush()
    unit.push(i)
    if (OWN_BLOCK_RE.test(line)) flush()
  }
  return {lines: out, repairs}
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

function normalizeDisplayMath(lines: string[]): {lines: string[]; normalized: number; repairs: string[]} {
  const out: string[] = []
  const repairs: string[] = []
  let normalized = 0
  let inFence = false
  let inMath = false
  let opened = ''
  // A formula is one paragraph: a block still open at a blank line, a heading or the end is closed
  // there, or it would swallow the rest of the document.
  const closeOpen = (before: string) => {
    out.push('$$')
    inMath = false
    repairs.push(`${opened}: $$ block that never closes closed before ${before}`)
  }
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]!
    if (FENCE_RE.test(line)) inFence = !inFence
    if (inFence) {
      out.push(line)
      continue
    }
    if (inMath && (!line.trim() || HEADING_RE.test(line))) closeOpen(`line ${n + 1}`)
    if (MATH_FENCE_RE.test(line)) {
      inMath = !inMath
      if (inMath) opened = `line ${n + 1}`
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
      opened = `line ${n + 1}`
      normalized++
    } else if (close) {
      out.push(close[1]!.trim(), '$$')
      inMath = false
    } else {
      out.push(line)
    }
  }
  if (inMath) closeOpen('the end')
  return {lines: out, normalized, repairs}
}

/** The lookup key of a citation or entry label: emphasis and spacing differences do not matter. */
const citationKey = (label: string) => label.replace(/[*_]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

/** The id a bibliography entry carries, by its number or label: `ref-3`, `ref-palay-et-al-1988`. */
function referenceBlockId(label: string | number): string {
  const slug = citationKey(String(label))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `ref-${slug || 'entry'}`
}

const stripEmphasis = (text: string) =>
  text
    .replace(/^(\*\*|__)\s*/, '')
    .replace(/\s*(\*\*|__)$/, '')
    .trim()

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
    const before = text[offset - 1]
    const after = text[offset + whole.length]
    if (before === '!' || before === ']' || after === '(' || after === '[' || after === ':') return whole
    const wholeId = ids.get(citationKey(inner))
    if (wholeId) {
      onLink()
      return `[[${inner}](#${wholeId})]`
    }
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
 * Every clean-up step over converted markdown, before an agent reviews it. Datalab returns a
 * faithful but flat document; the mechanical part of a good import is done here so the review
 * does not spend model turns on it. A `Figure N: …` paragraph next to a standalone image becomes
 * the image's caption; entries of the references section get block ids (`<!-- id:ref-N -->`) and
 * bracketed citations become `#ref-N` links to them, which publishing resolves to the document's
 * own address; the PDF's internal links and anchors, which do not survive publishing, are reduced
 * to their text; and one-line `$$…$$` formulas become fenced math blocks, the only form the
 * markdown dialect reads. Fenced code is never touched. Markers left unpaired are repaired before
 * any of that (see balanceMarkers), because one of them would hide the rest of the document from
 * every pass here and from the reader.
 */
export function postprocessConvertedMarkdown(markdown: string): PostprocessReport {
  const balanced = balanceMarkers(markdown.split('\n'))
  const internal = unwrapInternalLinks(balanced.lines)
  const math = normalizeDisplayMath(internal.lines)
  const captions = foldCaptions(math.lines)
  const citations = linkCitations(captions.lines)
  return {
    markdown: citations.lines.join('\n'),
    markersRepaired: [...balanced.repairs, ...math.repairs],
    internalLinksUnwrapped: internal.unwrapped,
    mathBlocksNormalized: math.normalized,
    captionsFolded: captions.folded,
    referenceEntries: citations.entries,
    citationsLinked: citations.linked,
    citationsUnlinked: citations.unlinked,
  }
}

function supportedType(fileName: string): {ext: string; mimeType: string} | undefined {
  const dot = fileName.lastIndexOf('.')
  if (dot <= 0) return undefined
  const ext = fileName.slice(dot + 1).toLowerCase()
  const mimeType = SUPPORTED[ext]
  return mimeType ? {ext, mimeType} : undefined
}

const looksLikePdf = (bytes: Uint8Array) =>
  Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024)))
    .toString('latin1')
    .includes('%PDF-')

const validPageRange = (value: string) => /^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(value)

const parseMode = (value: unknown): Mode | undefined =>
  typeof value === 'string' && (MODES as readonly string[]).includes(value) ? (value as Mode) : undefined

const positiveInteger = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined

/**
 * A job is named by the URL Datalab checks it at. A resumed call sends the key there, so the URL
 * must belong to the conversion service the app is configured with.
 */
function checkedJobUrl(job: string, baseUrl: string): string {
  let url: URL
  let base: URL
  try {
    url = new URL(job)
    base = new URL(baseUrl)
  } catch {
    throw new Error('job must be the value an earlier call returned')
  }
  if (url.origin !== base.origin || !url.pathname.startsWith(`${base.pathname.replace(/\/+$/, '')}/`)) {
    throw new Error('job does not belong to this app’s conversion service')
  }
  return url.toString()
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** MIME types of the figures Datalab extracts, by extension. */
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
}

const toolFile = (name: string, mimeType: string, content: string | Uint8Array): ToolFile => ({
  name,
  mimeType,
  data: Buffer.from(content).toString('base64'),
})

/**
 * Builds what the caller gets for a converted document: the counts, and the files themselves.
 * `document` is the Markdown to publish and `raw` what Datalab returned. The figures are named
 * `assets/<file>`, which is how `document` links to them, so a caller that saves every file at its
 * name gets a folder that publishes as it is.
 */
function buildOutput(
  result: ConvertResult,
  details: {fileName?: string; job: string; mode?: Mode; maxPages?: number; pageRange?: string},
) {
  const assetNames = assetFileNames(result.images.keys())
  const rewritten = rewriteImageReferences(result.markdown, (ref) => {
    const safe = assetNames.get(ref) ?? assetNames.get(ref.slice(ref.lastIndexOf('/') + 1))
    return safe ? `assets/${safe}` : undefined
  })
  const polished = postprocessConvertedMarkdown(rewritten.markdown)
  const assets: ToolFile[] = []
  for (const [original, safe] of assetNames) {
    const bytes = result.images.get(original)
    const type = IMAGE_TYPES[safe.slice(safe.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'
    if (bytes) assets.push(toolFile(`assets/${safe}`, type, bytes))
  }
  // Only a call that started the conversion knows the page cap it asked for.
  const truncated = details.maxPages !== undefined && result.pageCount >= details.maxPages
  const manifest = toolFile(
    'manifest.json',
    'application/json',
    JSON.stringify(
      {
        fileName: details.fileName ?? null,
        convertedAt: new Date().toISOString(),
        job: details.job,
        mode: details.mode ?? null,
        pageRange: details.pageRange ?? null,
        maxPagesApplied: details.maxPages ?? null,
        pageCount: result.pageCount,
        truncated,
        parseQualityScore: result.parseQualityScore,
        costCents: result.costCents,
        images: [...assetNames].map(([original, file]) => ({
          file,
          originalName: original,
          bytes: result.images.get(original)?.byteLength ?? 0,
        })),
        imagesRewritten: rewritten.rewritten,
        imagesUnresolved: rewritten.unresolved,
        internalLinksUnwrapped: polished.internalLinksUnwrapped,
        mathBlocksNormalized: polished.mathBlocksNormalized,
        captionsFolded: polished.captionsFolded,
        referenceEntries: polished.referenceEntries,
        citationsLinked: polished.citationsLinked,
        citationsUnlinked: polished.citationsUnlinked,
        markersRepaired: polished.markersRepaired,
      },
      null,
      2,
    ),
  )
  const notes = [
    ...(polished.captionsFolded ? [`${plural(polished.captionsFolded, 'caption')} attached to figures`] : []),
    ...(polished.citationsLinked ? [`${plural(polished.citationsLinked, 'citation')} linked to the references`] : []),
    ...(polished.citationsUnlinked.length
      ? [`${plural(polished.citationsUnlinked.length, 'citation')} without a reference entry left as text`]
      : []),
    ...(polished.markersRepaired.length
      ? [`${plural(polished.markersRepaired.length, 'unpaired marker')} repaired, each listed in the manifest`]
      : []),
    ...(truncated ? ['cut at the page cap'] : []),
  ]
  const lead = `Converted ${plural(result.pageCount, 'page')} and ${plural(
    assetNames.size,
    'figure',
  )}. Review the document against the source, then publish it.`
  return {
    status: 'complete' as const,
    summary: notes.length ? `${lead} ${notes.join(', ')}.` : lead,
    job: details.job,
    pages: result.pageCount,
    images: assetNames.size,
    truncated,
    // Left out when Datalab does not say: the output schema has no null.
    ...(result.parseQualityScore !== null ? {parseQualityScore: result.parseQualityScore} : {}),
    ...(result.costCents !== null ? {costCents: result.costCents} : {}),
    captions: polished.captionsFolded,
    citationsLinked: polished.citationsLinked,
    citationsUnlinked: polished.citationsUnlinked.length,
    markersRepaired: polished.markersRepaired.length,
    document: toolFile('seed.md', 'text/markdown', polished.markdown),
    raw: toolFile('raw.md', 'text/markdown', result.markdown),
    manifest,
    assets,
  }
}

export default async function convert(input: Input, ctx: Context) {
  // The tool declares this secret by name (convert.private-config.schema.json) and its host supplies it.
  const apiKey = typeof ctx.privateConfig?.datalabApiKey === 'string' ? ctx.privateConfig.datalabApiKey.trim() : ''
  if (!apiKey) {
    throw new Error(
      'Document conversion is not available: there is no Datalab key. Set datalabApiKey under Private config, in the Settings of the app this tool is in, or on the tool’s own page.',
    )
  }
  const config = ctx.publicConfig ?? {}
  const baseUrl = (typeof config.baseUrl === 'string' && config.baseUrl ? config.baseUrl : DATALAB_BASE_URL).replace(
    /\/+$/,
    '',
  )
  const pollIntervalMs = positiveInteger(config.pollIntervalMs) ?? POLL_INTERVAL_MS
  const deadline = Date.now() + (positiveInteger(config.pollSeconds) ?? DEFAULT_POLL_SECONDS) * 1000
  const pending = (job: string) => ({
    status: 'pending' as const,
    summary: 'Datalab is still converting the document. Call again with {"job": …} and no file to collect it.',
    job,
  })

  if (typeof input.job === 'string' && input.job) {
    const job = checkedJobUrl(input.job, baseUrl)
    const body = await pollUntil(job, apiKey, deadline, pollIntervalMs)
    return body ? buildOutput(parseResult(body), {job}) : pending(job)
  }

  const file = input.file
  if (!isRecord(file) || typeof file.name !== 'string' || typeof file.data !== 'string' || !file.data) {
    throw new Error('Give file ({name, mimeType, data}, with data as base64) to start, or job to resume')
  }
  // Only the name's last part matters: its extension says what the document is.
  const fileName = file.name.trim().split(/[\\/]/).pop() ?? ''
  const type = supportedType(fileName)
  if (!type) throw new Error(`Unsupported document type; supported: ${SUPPORTED_LIST}`)
  if (Buffer.byteLength(file.data, 'base64') > MAX_FILE_BYTES) {
    throw new Error(`Larger than ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MiB`)
  }
  const bytes = new Uint8Array(Buffer.from(file.data, 'base64'))
  if (type.ext === 'pdf' && !looksLikePdf(bytes)) throw new Error('Not a PDF (no %PDF- header)')
  const pageRange = typeof input.pageRange === 'string' && input.pageRange.trim() ? input.pageRange.trim() : undefined
  if (pageRange && !validPageRange(pageRange)) throw new Error('pageRange must look like "0-5,10" (zero-indexed)')
  if (input.maxPages !== undefined && positiveInteger(input.maxPages) === undefined) {
    throw new Error('maxPages must be a whole number above zero')
  }
  // Every caller spends the app's key, so the app's settings are ceilings a call can only lower.
  const maxPages = Math.min(
    input.maxPages ?? Number.POSITIVE_INFINITY,
    positiveInteger(config.maxPages) ?? DEFAULT_MAX_PAGES,
  )
  const ceiling = parseMode(config.mode) ?? DEFAULT_MODE
  const requested = parseMode(input.mode)
  if (input.mode !== undefined && !requested) throw new Error(`mode is one of ${MODES.join(', ')}`)
  const mode = requested && MODES.indexOf(requested) < MODES.indexOf(ceiling) ? requested : ceiling

  const job = await submitDocument({
    bytes,
    fileName,
    mimeType: type.mimeType,
    apiKey,
    mode,
    extras: typeof config.extras === 'string' ? config.extras : DEFAULT_EXTRAS,
    maxPages,
    pageRange,
    baseUrl,
  })
  const body = await pollUntil(checkedJobUrl(job, baseUrl), apiKey, deadline, pollIntervalMs)
  return body ? buildOutput(parseResult(body), {fileName, job, mode, maxPages, pageRange}) : pending(job)
}
