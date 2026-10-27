---
name: convert
summary: Convert documents from agent memory into markdown with the Datalab parser.
attributesSchema: hm://hyper.media/agent/app-tool
tool: convert
runtime: ts
timeoutSecs: 1800
inputSchema: |
  {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "files": {
        "type": "array",
        "minItems": 1,
        "maxItems": 50,
        "items": {
          "type": "string",
          "minLength": 1
        },
        "description": "Memory paths relative to ~/memory, such as \"incoming/paper.pdf\" or \"papers\" for a whole folder. Explicit paths only; globs are not expanded."
      },
      "output_dir": {
        "type": "string",
        "description": "Memory folder that receives one subfolder per document. Default \"datalab-imports\"."
      },
      "page_range": {
        "type": "string",
        "description": "Zero-indexed pages to convert, such as \"0-5,10\". Applies to every document in the call."
      },
      "max_pages": {
        "type": "integer",
        "minimum": 1,
        "description": "Convert at most this many pages per document. The per-document cap and the call's page budget apply as well."
      },
      "mode": {
        "type": "string",
        "enum": [
          "fast",
          "balanced",
          "accurate"
        ],
        "description": "Datalab mode. Leave unset unless the user asks for a specific one: the mount's mode is already the best it offers, and on the shared key a more expensive mode is lowered to it anyway."
      },
      "overwrite": {
        "type": "boolean",
        "description": "Replace an existing output folder for the same document. Default false: an existing folder is reported as a failure and no pages are spent."
      }
    },
    "required": [
      "files"
    ]
  }
outputSchema: |
  {
    "type": "object",
    "properties": {
      "summary": {
        "type": "string",
        "description": "One-line account of what was converted."
      },
      "documents": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "source": {
              "type": "string",
              "description": "Memory path of the converted document."
            },
            "outputDir": {
              "type": "string",
              "description": "Memory folder holding raw.md, seed.md, assets/ and manifest.json."
            },
            "markdownPath": {
              "type": "string",
              "description": "Memory path of seed.md, the file to review and publish."
            },
            "pages": {
              "type": "integer"
            },
            "images": {
              "type": "integer"
            },
            "truncated": {
              "type": "boolean",
              "description": "True when the document had more pages than were converted; manifest.json says why."
            },
            "captions": {
              "type": "integer",
              "description": "Figure captions folded into their images."
            },
            "citationsLinked": {
              "type": "integer"
            },
            "citationsUnlinked": {
              "type": "integer",
              "description": "Bracketed citations with no reference entry, left as text."
            },
            "markersRepaired": {
              "type": "integer",
              "description": "Markers Datalab left unpaired, a code fence, a $$ block or a **, that were repaired so they would not swallow what follows; manifest.json lists each with its line in raw.md."
            }
          }
        }
      },
      "failures": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "source": {
              "type": "string"
            },
            "error": {
              "type": "string"
            }
          }
        }
      },
      "keySource": {
        "type": "string",
        "enum": [
          "own",
          "server"
        ],
        "description": "Whose Datalab key paid: the space's own, or the server's shared one."
      },
      "usage": {
        "type": "object",
        "properties": {
          "units": {
            "type": "integer"
          }
        },
        "description": "Pages spent on the shared key; absent on a space's own key."
      }
    },
    "required": [
      "summary",
      "documents",
      "failures"
    ]
  }
code: |
  // The `convert` tool of the Datalab converter app. It runs in the agents server's sandbox with the
  // agent's memory mounted at /workspace, sends each document to the Datalab document parser with
  // the key the mount provides, and writes the markdown and the extracted figures back next to the
  // source. Nothing here talks to the agents server: the input is the call, the context is the
  // mount (its arguments, the page budget of a metered mount, the app), and the return value is the
  // result the model reads.
  import * as fs from 'node:fs'
  import * as path from 'node:path'

  type Mode = 'fast' | 'balanced' | 'accurate'

  type Input = {
    files: string[]
    output_dir?: string
    page_range?: string
    max_pages?: number
    mode?: Mode
    overwrite?: boolean
  }

  type Context = {
    /** The mount's arguments: `apiKey` is the Datalab key, `mode` the default and, on a metered mount, the ceiling. */
    args: {apiKey?: string; mode?: string; extras?: string; baseUrl?: string; pollIntervalMs?: number}
    /** Present on a metered mount: the pages this call may spend, reserved by the server before the run. */
    usage?: {unit: string; reserved: number}
    app: {slug: string; scope: 'space' | 'server'}
    /** Where the agent's memory is mounted: `/workspace` in the sandbox. */
    workspace: string
  }

  /** Conversion modes, cheapest first. Fast and balanced share a price; accurate costs 2.5x. */
  const MODES: readonly Mode[] = ['fast', 'balanced', 'accurate']
  const DATALAB_BASE_URL = 'https://www.datalab.to/api/v1'
  const DEFAULT_OUTPUT_DIR = 'datalab-imports'
  const MAX_FILE_BYTES = 100 * 1024 * 1024
  const MAX_FILES_PER_CALL = 50
  /** Most pages one document may bill, whatever the caller asks for. */
  const PAGES_PER_DOCUMENT_CAP = 200
  /** Documents converted at once. */
  const CONCURRENCY = 3
  const SUBMIT_TIMEOUT_MS = 120_000
  const POLL_REQUEST_TIMEOUT_MS = 15_000
  const POLL_INTERVAL_MS = 2_000
  const CONVERSION_TIMEOUT_MS = 10 * 60_000
  const RETRY_BASE_MS = 4_000
  const MAX_SUBMIT_ATTEMPTS = 5

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

  type DatalabErrorKind = 'auth' | 'request' | 'rate_limited' | 'failed' | 'timeout' | 'network'

  /** A conversion failure with a stable kind, so a rejected key stops the batch and bad input does not. */
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
    requestId: string
  }

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value)

  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

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

  type Request = {
    bytes: Uint8Array
    fileName: string
    mimeType: string
    apiKey: string
    mode: Mode
    extras: string
    maxPages: number
    pageRange?: string
    baseUrl: string
    pollIntervalMs: number
    onProgress: (stage: string) => void
  }

  /**
   * Converts one document: POST `/convert` with the document as a multipart part, then poll the
   * returned check URL until the job is `complete`. Rate limits (HTTP 429 on submit, or a completed
   * job that reports Datalab's page-concurrency limit) are retried with exponential backoff; every
   * other failure is reported once with a stable kind. The key only ever travels in the header.
   */
  async function convertDocument(input: Request): Promise<ConvertResult> {
    const headers = {'X-API-Key': input.apiKey}
    const startedAt = Date.now()
    for (let attempt = 0; ; attempt++) {
      input.onProgress('submitting')
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
          headers,
          body: form,
          signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
        })
        status = res.status
        submitted = await readJson(res)
      } catch (error) {
        throw new DatalabError('network', `Could not reach the conversion service: ${errorText(error)}`)
      }
      if (status === 401 || status === 403) throw new DatalabError('auth', 'The conversion service rejected the API key')
      if (status !== 429) {
        if (status < 200 || status >= 300) {
          throw new DatalabError('request', datalabMessage(submitted, `The conversion service answered HTTP ${status}`))
        }
        if (!isRecord(submitted) || submitted.success !== true || typeof submitted.request_check_url !== 'string') {
          throw new DatalabError('request', datalabMessage(submitted, 'The conversion service did not accept the document'))
        }
        const requestId = typeof submitted.request_id === 'string' ? submitted.request_id : ''
        const outcome = await pollUntilComplete(input, headers, submitted.request_check_url, startedAt)
        if (!isPageRateLimit(outcome)) return parseResult(outcome, requestId)
      }
      if (attempt + 1 >= MAX_SUBMIT_ATTEMPTS) {
        throw new DatalabError('rate_limited', 'The conversion service is rate limiting this key; try again in a minute')
      }
      await sleep(RETRY_BASE_MS * 2 ** attempt)
    }
  }

  /** Polls the check URL until Datalab reports `complete`, returning the final body. A dropped poll is retried. */
  async function pollUntilComplete(
    input: Request,
    headers: Record<string, string>,
    checkUrl: string,
    startedAt: number,
  ): Promise<Record<string, unknown>> {
    for (;;) {
      const elapsedMs = Date.now() - startedAt
      if (elapsedMs > CONVERSION_TIMEOUT_MS) {
        throw new DatalabError('timeout', `The conversion did not finish within ${Math.round(CONVERSION_TIMEOUT_MS / 1000)}s`)
      }
      await sleep(input.pollIntervalMs)
      input.onProgress(`processing ${Math.round((Date.now() - startedAt) / 1000)}s`)
      let status: number
      let body: unknown
      try {
        const res = await fetch(checkUrl, {headers, signal: AbortSignal.timeout(POLL_REQUEST_TIMEOUT_MS)})
        status = res.status
        body = await readJson(res)
      } catch {
        continue
      }
      if (status === 401 || status === 403) throw new DatalabError('auth', 'The conversion service rejected the API key')
      if (status < 200 || status >= 300 || !isRecord(body) || body.status !== 'complete') continue
      if (body.success === false) {
        if (isPageRateLimit(body)) return body
        throw new DatalabError('failed', datalabMessage(body, 'The conversion failed'))
      }
      return body
    }
  }

  function parseResult(body: Record<string, unknown>, requestId: string): ConvertResult {
    const images = new Map<string, Uint8Array>()
    if (isRecord(body.images)) {
      for (const [name, value] of Object.entries(body.images)) {
        if (typeof value === 'string' && value) images.set(name, new Uint8Array(Buffer.from(value, 'base64')))
      }
    }
    const pageCount =
      typeof body.page_count === 'number' && Number.isFinite(body.page_count) ? Math.max(0, Math.floor(body.page_count)) : 0
    const score = body.parse_quality_score
    const breakdown = body.cost_breakdown
    const total =
      typeof body.total_cost === 'number' ? body.total_cost : isRecord(breakdown) ? (breakdown.total_cost ?? breakdown.total) : undefined
    return {
      markdown: typeof body.markdown === 'string' ? body.markdown : '',
      images,
      pageCount,
      parseQualityScore: typeof score === 'number' && Number.isFinite(score) ? score : null,
      costCents: typeof total === 'number' && Number.isFinite(total) ? total : null,
      requestId,
    }
  }

  const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

  /** Turns a document file name into a stable folder slug: ascii, lowercase, dashes. */
  function slugForFileName(fileName: string): string {
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
      const ext = dot > 0 ? base.slice(dot + 1).replace(/[^A-Za-z0-9]+/g, '').toLowerCase() : ''
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
  function rewriteImageReferences(
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
        if (j < 0 || j >= lines.length || drop.has(j) || IMAGE_LINE_RE.test(lines[j]!) || HEADING_RE.test(lines[j]!)) continue
        const caption = CAPTION_RE.exec(lines[j]!)
        if (!caption) continue
        const label = caption[1]!
        const text = stripEmphasis(caption[2] ?? '')
        if (!altWantsCaption(image[1] ?? '', label)) continue
        const full = text ? `${label.replace(/[.:]$/, '')}: ${text}` : label
        lines[i] = line.replace(IMAGE_LINE_RE, (_m, _alt, url: string, id?: string) => `![${full}](${url})${id ? ` ${id}` : ''}`)
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

  function linkCitationsInText(text: string, ids: Map<string, string>, onLink: () => void, unlinked: Set<string>): string {
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
  function postprocessConvertedMarkdown(markdown: string): PostprocessReport {
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

  /** A memory path as the caller wrote it, resolved under the workspace and kept inside it. */
  function memoryPath(workspace: string, rel: string): {relPath: string; absPath: string} {
    const absPath = path.resolve(workspace, rel)
    if (absPath !== workspace && !absPath.startsWith(`${workspace}/`)) throw new Error(`${rel} is outside memory`)
    return {relPath: path.relative(workspace, absPath), absPath}
  }

  function supportedType(fileName: string): {ext: string; mimeType: string} | undefined {
    const dot = fileName.lastIndexOf('.')
    if (dot <= 0) return undefined
    const ext = fileName.slice(dot + 1).toLowerCase()
    const mimeType = SUPPORTED[ext]
    return mimeType ? {ext, mimeType} : undefined
  }

  /** Every supported document under a memory folder, deepest paths included, in path order. */
  function listConvertible(workspace: string, relDir: string): {files: string[]; skipped: number} {
    const files: string[] = []
    let skipped = 0
    const walk = (rel: string) => {
      const {absPath} = memoryPath(workspace, rel)
      for (const entry of fs.readdirSync(absPath, {withFileTypes: true}).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) walk(childRel)
        else if (entry.isFile()) {
          if (supportedType(entry.name)) files.push(childRel)
          else skipped++
        }
      }
    }
    walk(relDir)
    return {files, skipped}
  }

  const looksLikePdf = (bytes: Uint8Array) =>
    Buffer.from(bytes.subarray(0, Math.min(bytes.length, 1024))).toString('latin1').includes('%PDF-')

  const validPageRange = (value: string) => /^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(value)

  const parseMode = (value: unknown): Mode | undefined =>
    typeof value === 'string' && (MODES as readonly string[]).includes(value) ? (value as Mode) : undefined

  /** Runs `worker` over `items` with at most `limit` in flight; results keep the input order. */
  async function runWithConcurrency<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length)
    let next = 0
    const runners = Array.from({length: Math.max(1, Math.min(limit, items.length))}, async () => {
      for (;;) {
        const index = next++
        if (index >= items.length) return
        results[index] = await worker(items[index]!)
      }
    })
    await Promise.all(runners)
    return results
  }

  const boundedFailure = (message: string) => (message.length > 300 ? `${message.slice(0, 297)}...` : message)

  const writeFile = (workspace: string, relPath: string, data: string | Uint8Array) => {
    const {absPath} = memoryPath(workspace, relPath)
    fs.mkdirSync(path.dirname(absPath), {recursive: true})
    fs.writeFileSync(absPath, data)
  }

  type Job = {
    source: string
    fileName: string
    type: {ext: string; mimeType: string}
    bytes: Uint8Array
    outDir: string
    maxPages: number
    truncationReason: string
  }

  export default async function convert(input: Input, ctx: Context) {
    const apiKey = typeof ctx.args.apiKey === 'string' ? ctx.args.apiKey.trim() : ''
    if (!apiKey) {
      throw new Error(
        'Document conversion is not available: the convert app is mounted without a Datalab key. Mount the app with your own key from the Apps dialog, or ask the server operator to provide one.',
      )
    }
    const baseUrl = (typeof ctx.args.baseUrl === 'string' && ctx.args.baseUrl ? ctx.args.baseUrl : DATALAB_BASE_URL).replace(/\/+$/, '')
    const pollIntervalMs = typeof ctx.args.pollIntervalMs === 'number' ? ctx.args.pollIntervalMs : POLL_INTERVAL_MS
    const extras = typeof ctx.args.extras === 'string' ? ctx.args.extras : ''
    const mountMode = parseMode(ctx.args.mode) ?? 'accurate'
    const requestedMode = parseMode(input.mode)
    // On a metered mount the mount's mode is a ceiling, so a tenant cannot make the operator's key
    // pay for a mode the operator did not choose; a space's own key runs any mode it asks for.
    const metered = ctx.usage !== undefined
    const mode =
      metered && requestedMode && MODES.indexOf(requestedMode) > MODES.indexOf(mountMode) ? mountMode : (requestedMode ?? mountMode)
    const modeDowngraded = requestedMode !== undefined && mode !== requestedMode
    const keySource = ctx.app.scope === 'space' ? 'own' : 'server'
    const workspace = path.resolve(ctx.workspace || '/workspace')

    const outputDir =
      typeof input.output_dir === 'string' && input.output_dir.trim() ? memoryPath(workspace, input.output_dir).relPath : DEFAULT_OUTPUT_DIR
    if (!outputDir) throw new Error('output_dir cannot be the memory root')
    const pageRange = typeof input.page_range === 'string' ? input.page_range.trim() : undefined
    if (pageRange && !validPageRange(pageRange)) throw new Error('page_range must look like "0-5,10" (zero-indexed)')
    const maxPagesRequested = typeof input.max_pages === 'number' ? input.max_pages : undefined
    const overwrite = input.overwrite === true

    // Expand folders and check every path before anything is sent: a bad path is the caller's
    // mistake, answered up front, not a failure buried in the batch.
    const failures: {source: string; error: string}[] = []
    const sources: string[] = []
    let skippedUnsupported = 0
    for (const entry of Array.isArray(input.files) ? input.files : []) {
      if (/[*?[]/.test(entry)) throw new Error(`Globs are not expanded (${entry}); list the files or give a folder`)
      const {relPath, absPath} = memoryPath(workspace, entry)
      const stat = fs.statSync(absPath, {throwIfNoEntry: false})
      if (!stat) {
        failures.push({source: relPath || entry, error: 'Not found in memory'})
        continue
      }
      if (stat.isDirectory()) {
        const listed = listConvertible(workspace, relPath)
        sources.push(...listed.files)
        skippedUnsupported += listed.skipped
      } else sources.push(relPath)
    }
    const files = [...new Set(sources)]
    if (files.length > MAX_FILES_PER_CALL) {
      throw new Error(`${files.length} documents is more than the ${MAX_FILES_PER_CALL} one call can take; convert a subfolder at a time`)
    }

    // Preflight in list order so slugs and the page budget are deterministic; the network work runs in the pool below.
    let budget = ctx.usage?.reserved ?? Number.POSITIVE_INFINITY
    const slugs = new Set<string>()
    const jobs: Job[] = []
    for (const source of files) {
      const fileName = source.slice(source.lastIndexOf('/') + 1)
      const type = supportedType(fileName)
      if (!type) {
        failures.push({source, error: `Unsupported document type; supported: ${SUPPORTED_LIST}`})
        continue
      }
      let bytes: Uint8Array
      try {
        bytes = new Uint8Array(fs.readFileSync(memoryPath(workspace, source).absPath))
      } catch (error) {
        failures.push({source, error: boundedFailure(errorText(error))})
        continue
      }
      if (bytes.byteLength > MAX_FILE_BYTES) {
        failures.push({source, error: `Larger than ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MiB`})
        continue
      }
      if (type.ext === 'pdf' && !looksLikePdf(bytes)) {
        failures.push({source, error: 'Not a PDF (no %PDF- header)'})
        continue
      }
      const outDir = `${outputDir}/${uniqueName(slugForFileName(fileName), slugs)}`
      if (!overwrite && fs.existsSync(memoryPath(workspace, `${outDir}/seed.md`).absPath)) {
        failures.push({source, error: `Output ${outDir}/ already exists; pass overwrite: true to replace it`})
        continue
      }
      if (budget <= 0) {
        failures.push({
          source,
          error: 'No shared pages left for this document in this call; convert it in another call, or mount the convert app with your own Datalab key',
        })
        continue
      }
      // The smallest bound wins; on a tie the earlier (more specific) one names the reason.
      const bounds: [string, number][] = [
        ...(maxPagesRequested !== undefined ? [['max_pages input', maxPagesRequested] as [string, number]] : []),
        ['per-document cap (200 pages)', PAGES_PER_DOCUMENT_CAP],
        ['shared pages remaining this month', budget],
      ]
      let [truncationReason, maxPages] = bounds[0]!
      for (const [reason, limit] of bounds) if (limit < maxPages) [truncationReason, maxPages] = [reason, limit]
      budget -= maxPages
      jobs.push({source, fileName, type, bytes, outDir, maxPages, truncationReason})
    }

    const documents: Record<string, unknown>[] = []
    let started = 0
    let fatal: Error | undefined
    let pagesCharged = 0
    await runWithConcurrency(jobs, CONCURRENCY, async (job) => {
      if (fatal) return
      const label = `${job.fileName} (${++started}/${jobs.length})`
      console.error(`Converting ${label}`)
      let result: ConvertResult
      try {
        result = await convertDocument({
          bytes: job.bytes,
          fileName: job.fileName,
          mimeType: job.type.mimeType,
          apiKey,
          mode,
          extras,
          maxPages: job.maxPages,
          pageRange,
          baseUrl,
          pollIntervalMs,
          onProgress: (stage) => console.error(`Converting ${label}: ${stage}`),
        })
      } catch (error) {
        if (error instanceof DatalabError && error.kind === 'auth') {
          // Every later document would fail the same way: this is configuration, not this file.
          fatal = new Error(
            keySource === 'server'
              ? 'Datalab rejected this server’s key; tell the operator'
              : 'Datalab rejected the mounted key; replace it from the Apps dialog',
          )
          return
        }
        failures.push({source: job.source, error: boundedFailure(errorText(error))})
        return
      }
      try {
        if (overwrite) fs.rmSync(memoryPath(workspace, job.outDir).absPath, {recursive: true, force: true})
        const assetNames = assetFileNames(result.images.keys())
        const rewritten = rewriteImageReferences(result.markdown, (ref) => {
          const safe = assetNames.get(ref) ?? assetNames.get(ref.slice(ref.lastIndexOf('/') + 1))
          return safe ? `assets/${safe}` : undefined
        })
        const polished = postprocessConvertedMarkdown(rewritten.markdown)
        writeFile(workspace, `${job.outDir}/raw.md`, result.markdown)
        for (const [original, safe] of assetNames) {
          const bytes = result.images.get(original)
          if (bytes) writeFile(workspace, `${job.outDir}/assets/${safe}`, bytes)
        }
        writeFile(workspace, `${job.outDir}/seed.md`, polished.markdown)
        const truncated = result.pageCount >= job.maxPages
        const charged = Math.min(result.pageCount, job.maxPages)
        pagesCharged += charged
        const manifest = {
          source: job.source,
          fileName: job.fileName,
          bytes: job.bytes.byteLength,
          convertedAt: new Date().toISOString(),
          requestId: result.requestId,
          keySource,
          mode,
          ...(modeDowngraded ? {modeDowngraded: true, modeRequested: requestedMode} : {}),
          pageRange: pageRange ?? null,
          maxPagesRequested: maxPagesRequested ?? null,
          maxPagesApplied: job.maxPages,
          pageCount: result.pageCount,
          truncated,
          truncationReason: truncated ? job.truncationReason : null,
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
        }
        writeFile(workspace, `${job.outDir}/manifest.json`, JSON.stringify(manifest, null, 2))
        documents.push({
          source: job.source,
          outputDir: job.outDir,
          markdownPath: `${job.outDir}/seed.md`,
          pages: result.pageCount,
          images: assetNames.size,
          truncated,
          captions: polished.captionsFolded,
          citationsLinked: polished.citationsLinked,
          citationsUnlinked: polished.citationsUnlinked.length,
          markersRepaired: polished.markersRepaired.length,
        })
      } catch (error) {
        failures.push({source: job.source, error: boundedFailure(errorText(error))})
      }
    })
    if (fatal) throw fatal

    documents.sort((a, b) => files.indexOf(a.source as string) - files.indexOf(b.source as string))
    const sum = (key: string) => documents.reduce((total, doc) => total + (doc[key] as number), 0)
    const pages = sum('pages')
    const images = sum('images')
    const captions = sum('captions')
    const citations = sum('citationsLinked')
    const unlinked = sum('citationsUnlinked')
    const repaired = sum('markersRepaired')
    const cut = documents.filter((doc) => doc.truncated).length
    const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
    const notes = [
      ...(captions ? [`${plural(captions, 'caption')} attached to figures`] : []),
      ...(citations ? [`${plural(citations, 'citation')} linked to the references`] : []),
      ...(unlinked ? [`${plural(unlinked, 'citation')} without a reference entry left as text`] : []),
      ...(repaired ? [`${plural(repaired, 'unpaired marker')} repaired, each listed in manifest.json`] : []),
      ...(failures.length ? [`${failures.length} failed`] : []),
      ...(cut ? [`${cut} cut at the page cap`] : []),
      ...(skippedUnsupported ? [`${plural(skippedUnsupported, 'unsupported file')} skipped`] : []),
      ...(modeDowngraded ? [`mode lowered to ${mode} on the shared key`] : []),
    ]
    const lead = documents.length
      ? `Converted ${plural(documents.length, 'document')} into ${outputDir}/ (${plural(pages, 'page')}, ${plural(images, 'figure')}). Review and publish each seed.md with write ... fromPath.`
      : 'Converted nothing.'
    return {
      summary: notes.length ? `${lead} ${notes.join(', ')}.` : lead,
      documents,
      failures,
      keySource,
      ...(metered ? {usage: {units: pagesCharged}} : {}),
    }
  }
---
Converts documents in `~/memory/` with the [Datalab converter](../../convert.md) and writes the markdown and figures back into memory. Read that page for what it writes, the page cap and the keys.

# Calling it

```json
{"files": ["incoming/paper.pdf"]}
```

A folder converts every supported file under it, so a batch of papers is one call:

```json
{"files": ["papers"], "output_dir": "imports/papers"}
```

Other inputs: `page_range` (zero-indexed, `0-5,10`) and `max_pages` convert only part of each document; `mode` picks the Datalab mode (`fast`, `balanced`, `accurate`); `overwrite: true` replaces an output folder from an earlier run. Paths are relative to `~/memory/`; globs are not expanded. One call takes at most 50 documents.

The call runs as long as the conversions take (several documents are converted at once), and the chat shows which file is in progress. The result is small: one line per document with where its markdown is, plus a `failures` list for documents that could not be converted. A failed document never stops the others.

# What it writes

```text
datalab-imports/<slug>/
  raw.md          # the converter output as received
  seed.md         # the same markdown with every figure on its own line, ready to publish
  assets/         # the extracted images
  manifest.json   # pages, quality score, cost, mode, truncation, image mapping
```

`seed.md` is `raw.md` after the tool's post-processing, which does the mechanical part of a good import so the review does not have to:

- Markers Datalab left unpaired are repaired first, because one of them is not local damage: a code fence that never closes swallows the rest of the document, a `$$` block that never closes does the same, and a stray `**` or backtick runs to the end of its paragraph. A fence with no closing fence is dropped, an open `$$` block is closed at the end of its paragraph, and a paragraph, list item, heading or table row with an odd number of `**` or backticks loses the last one. `manifest.json` lists every repair under `markersRepaired` with its line in `raw.md` and the text it touched, and the result counts them.
- Every image reference is a paragraph of its own, `![alt](assets/<file>)`. The markdown parser keeps only standalone image lines as image blocks, and `write ... fromPath` uploads exactly those files, so publishing `seed.md` carries the figures along.
- A `Figure N: …` (or `Fig.`, `Table`) paragraph next to a figure becomes the figure's caption, the alt text of the image line, and the loose paragraph is gone. A figure has exactly one caption, in the image itself.
- Entries of the references section get block ids (`<!-- id:ref-3 -->`, `<!-- id:ref-meyrowitz-1986 -->`), and bracketed citations in the text become links to them: numeric ones, `[3]`, `[1, 2]`, `[4-6]`, and labelled ones, `[Meyrowitz 1986]`, `[Langston 1988, Ogura & Robertson 1989]`, written as `[[3](#ref-3)]`. Publishing resolves those `#ref-…` links to the document's own address, so readers jump from a citation to its entry. Citations with no matching entry, and parenthesised ones like `(Meyrowitz, 1986)`, are left as text and the former are counted in the result (`citationsUnlinked`); link those by hand only when the entry is unambiguous.
- Links the PDF itself carried (`extract_links` keeps them as `[\[49\].](#block-9-2)` with `<a id>` anchors) are reduced to their text, because the anchors do not survive publishing; the citations among them get the precise `#ref-…` links above instead. One-line display math `$$…$$` becomes a fenced `$$` block, which is the only form the markdown dialect reads.

# Before publishing

Review `seed.md`: headings, tables, where figures landed, every line `manifest.json` lists under `markersRepaired` (a repair is a guess about what the marker meant, so read the sentence), and the citations the result lists as unlinked: link each one whose entry exists by hand, `[[Olivetti undated](#ref-olivetti-undated)]`, giving the entry its `<!-- id:ref-… -->` comment when it has none, so no citation is left as plain text. Do not render pages, re-extract figures or verify metadata on the web: the figures are already in `assets/`, and the metadata comes from the document itself. Then put the document's metadata from the [Agent Guide](../../../guide.md) as YAML frontmatter at the top of `seed.md` and publish with `write hm://<account>/<path> {fromPath: "~/memory/datalab-imports/<slug>/seed.md"}`. `fromPath` reads `name`, `summary`, `displayAuthor` and `displayPublishTime` from that frontmatter and accepts no `name` or `metadata` options of its own. Charts come back as data tables with a description; links in the source are kept.

```markdown
---
name: Credit Suisse EUR 1.25bn 0.250% Senior Notes due 2028
summary: Final terms dated 27 August 2021 for the EUR 1,250,000,000 0.250% fixed-rate senior notes.
displayAuthor: Credit Suisse AG
displayPublishTime: 2021-08-27
---

## FINAL TERMS
```
