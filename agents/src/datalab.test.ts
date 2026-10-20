import {Database} from 'bun:sqlite'
import {afterEach, beforeEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as blobs from '@shm/shared/blobs'
import * as agentMemory from '@/agent-memory'
import * as apisvc from '@/api-service'
import * as auth from '@/auth'
import * as config from '@/config'
import * as datalab from '@/datalab'
import {createAPIRoutes} from '@/main'
import * as sqlite from '@/sqlite'

/** Behaviour knobs for one fake server. */
type FakeDatalabOptions = {
  /** How many polls answer `processing` before `complete`. */
  processingPolls?: number
  /** HTTP statuses forced on the first submits, e.g. `[429]`; later submits behave normally. */
  submitStatuses?: number[]
  /** Final poll bodies in submission order; the last one repeats. */
  completions?: Record<string, unknown>[]
  /** Every poll says processing, forever. */
  neverComplete?: boolean
}

/** What the fake saw for one submitted document. */
type FakeDatalabSubmission = {
  fields: Record<string, string>
  fileName: string
  fileType: string
  fileBytes: number
  apiKey: string | null
}

/** Completion the fake answers when a test gives none: a short document with two images. */
const FAKE_DATALAB_COMPLETION = {
  status: 'complete',
  success: true,
  markdown: '# Title\n\nText ![Figure 1](fig1.png) more text.\n\n![](_page_0_Picture_2.jpeg)\n',
  images: {
    'fig1.png': Buffer.from('PNGDATA').toString('base64'),
    '_page_0_Picture_2.jpeg': Buffer.from('JPG').toString('base64'),
  },
  page_count: 3,
  parse_quality_score: 4.5,
  cost_breakdown: {total_cost: 1.2},
}

/** Starts the fake on a random loopback port. Stop it in `finally`. */
function startFakeDatalab(options: FakeDatalabOptions = {}) {
  const submissions: FakeDatalabSubmission[] = []
  const pollKeys: (string | null)[] = []
  let polls = 0
  let submitCount = 0
  let inFlight = 0
  let peakInFlight = 0
  let port = 0
  const server = Bun.serve({
    port: 0,
    async fetch(req): Promise<Response> {
      const url = new URL(req.url)
      if (req.method === 'POST' && url.pathname === '/convert') {
        const forced = options.submitStatuses?.[submitCount++]
        if (forced !== undefined) return Response.json({error: 'slow down'}, {status: forced})
        const form = await req.formData()
        const fields: Record<string, string> = {}
        let fileName = ''
        let fileType = ''
        let fileBytes = 0
        for (const [key, value] of form.entries()) {
          const part: unknown = value
          if (part instanceof File) {
            fileName = part.name
            fileType = part.type
            fileBytes = part.size
          } else fields[key] = String(value)
        }
        submissions.push({fields, fileName, fileType, fileBytes, apiKey: req.headers.get('x-api-key')})
        inFlight++
        peakInFlight = Math.max(peakInFlight, inFlight)
        const id = `req-${submissions.length}`
        return Response.json({
          success: true,
          request_id: id,
          request_check_url: `http://127.0.0.1:${port}/convert/${id}`,
        })
      }
      if (req.method === 'GET' && url.pathname.startsWith('/convert/')) {
        pollKeys.push(req.headers.get('x-api-key'))
        polls++
        if (options.neverComplete || polls <= (options.processingPolls ?? 0)) {
          return Response.json({status: 'processing', success: null})
        }
        const completions = options.completions ?? [FAKE_DATALAB_COMPLETION]
        const requestIndex = Number(url.pathname.slice('/convert/req-'.length)) - 1
        const body = completions[Math.min(Math.max(requestIndex, 0), completions.length - 1)]!
        inFlight = Math.max(0, inFlight - 1)
        return Response.json(body)
      }
      return new Response('not found', {status: 404})
    },
  })
  port = server.port ?? 0
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    submissions,
    pollKeys,
    get polls() {
      return polls
    },
    get peakInFlight() {
      return peakInFlight
    },
    stop: () => server.stop(true),
  }
}

const baseInput = (fake: ReturnType<typeof startFakeDatalab>, extra: Partial<datalab.ConvertDocumentInput> = {}) =>
  ({
    bytes: new TextEncoder().encode('%PDF-1.4 fake'),
    fileName: 'paper.pdf',
    mimeType: 'application/pdf',
    apiKey: 'secret-key',
    mode: 'accurate',
    extras: 'extract_links,chart_understanding',
    baseUrl: fake.baseUrl,
    pollIntervalMs: 10,
    retryBaseMs: 5,
    ...extra,
  }) satisfies datalab.ConvertDocumentInput

describe('convertDocument', () => {
  test('submits the multipart request, polls until complete and decodes the result', async () => {
    const fake = startFakeDatalab({processingPolls: 2})
    try {
      const progress: string[] = []
      const result = await datalab.convertDocument(
        baseInput(fake, {maxPages: 12, pageRange: '0-11', onProgress: (p) => progress.push(p.stage)}),
      )
      expect(fake.submissions).toHaveLength(1)
      const submission = fake.submissions[0]!
      expect(submission.apiKey).toBe('secret-key')
      expect(submission.fileName).toBe('paper.pdf')
      expect(submission.fileType).toBe('application/pdf')
      expect(submission.fileBytes).toBe(13)
      expect(submission.fields).toMatchObject({
        output_format: 'markdown',
        mode: 'accurate',
        extras: 'extract_links,chart_understanding',
        disable_image_captions: 'true',
        max_pages: '12',
        page_range: '0-11',
      })
      expect(fake.polls).toBe(3)
      expect(fake.pollKeys.every((key) => key === 'secret-key')).toBe(true)
      expect(result.requestId).toBe('req-1')
      expect(result.pageCount).toBe(3)
      expect(result.parseQualityScore).toBe(4.5)
      expect(result.costCents).toBe(1.2)
      expect(result.markdown).toContain('# Title')
      expect(new TextDecoder().decode(result.images.get('fig1.png'))).toBe('PNGDATA')
      expect(result.images.size).toBe(2)
      expect(progress[0]).toBe('submitting')
      expect(progress.filter((stage) => stage === 'processing').length).toBe(3)
    } finally {
      fake.stop()
    }
  })

  test('a failed job surfaces its error', async () => {
    const fake = startFakeDatalab({
      completions: [{status: 'complete', success: false, error: 'Could not parse the file'}],
    })
    try {
      const error = await datalab.convertDocument(baseInput(fake)).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(datalab.DatalabError)
      expect((error as datalab.DatalabError).kind).toBe('failed')
      expect((error as Error).message).toBe('Could not parse the file')
    } finally {
      fake.stop()
    }
  })

  test('401 is an auth error that never echoes the key', async () => {
    const fake = startFakeDatalab({submitStatuses: [401]})
    try {
      const error = (await datalab.convertDocument(baseInput(fake)).catch((e: unknown) => e)) as datalab.DatalabError
      expect(error.kind).toBe('auth')
      expect(error.message).not.toContain('secret-key')
    } finally {
      fake.stop()
    }
  })

  test('500 is a request error with the server message', async () => {
    const fake = startFakeDatalab({submitStatuses: [500]})
    try {
      const error = (await datalab.convertDocument(baseInput(fake)).catch((e: unknown) => e)) as datalab.DatalabError
      expect(error.kind).toBe('request')
      expect(error.message).toBe('slow down')
    } finally {
      fake.stop()
    }
  })

  test('429 on submit is retried with backoff', async () => {
    const fake = startFakeDatalab({submitStatuses: [429, 429]})
    try {
      const result = await datalab.convertDocument(baseInput(fake))
      expect(result.pageCount).toBe(3)
      expect(fake.submissions).toHaveLength(1)
    } finally {
      fake.stop()
    }
  })

  test('the page concurrency limit reported on a completed job is retried', async () => {
    const fake = startFakeDatalab({
      completions: [
        {status: 'complete', success: false, error: 'Page rate limit exceeded. Your team has 5000 pages in flight'},
        {status: 'complete', success: true, markdown: 'ok', images: {}, page_count: 1},
      ],
    })
    try {
      const result = await datalab.convertDocument(baseInput(fake))
      expect(result.markdown).toBe('ok')
      expect(fake.submissions).toHaveLength(2)
    } finally {
      fake.stop()
    }
  })

  test('gives up after repeated rate limits', async () => {
    const fake = startFakeDatalab({submitStatuses: [429, 429, 429, 429, 429, 429]})
    try {
      const error = (await datalab.convertDocument(baseInput(fake)).catch((e: unknown) => e)) as datalab.DatalabError
      expect(error.kind).toBe('rate_limited')
    } finally {
      fake.stop()
    }
  })

  test('times out when the job never completes', async () => {
    const fake = startFakeDatalab({neverComplete: true})
    try {
      const startedAt = Date.now()
      const error = (await datalab
        .convertDocument(baseInput(fake, {timeoutMs: 200}))
        .catch((e: unknown) => e)) as datalab.DatalabError
      expect(error.kind).toBe('timeout')
      expect(Date.now() - startedAt).toBeLessThan(2_000)
    } finally {
      fake.stop()
    }
  })

  test('an abort signal stops polling', async () => {
    const fake = startFakeDatalab({neverComplete: true})
    try {
      const controller = new AbortController()
      const pending = datalab.convertDocument(baseInput(fake, {signal: controller.signal, pollIntervalMs: 20}))
      setTimeout(() => controller.abort(), 50)
      const error = (await pending.catch((e: unknown) => e)) as datalab.DatalabError
      expect(error.kind).toBe('aborted')
    } finally {
      fake.stop()
    }
  })

  test('network failures are reported without the key', async () => {
    const error = (await datalab
      .convertDocument({
        bytes: new Uint8Array([1]),
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        apiKey: 'secret-key',
        mode: 'fast',
        extras: '',
        baseUrl: 'http://127.0.0.1:1',
      })
      .catch((e: unknown) => e)) as datalab.DatalabError
    expect(error.kind).toBe('network')
    expect(error.message).not.toContain('secret-key')
  })
})

describe('rewriteImageReferences', () => {
  const resolve = (ref: string) => (ref.endsWith('.png') || ref.endsWith('.jpeg') ? `assets/${ref}` : undefined)

  test('moves inline images onto their own lines and keeps the alt text', () => {
    const out = datalab.rewriteImageReferences('Text ![Figure 1](fig1.png) more text.', resolve)
    expect(out.markdown).toBe('Text\n\n![Figure 1](assets/fig1.png)\n\nmore text.')
    expect(out.rewritten).toBe(1)
    expect(out.unresolved).toEqual([])
  })

  test('leaves standalone images in place, only rewriting the path', () => {
    const out = datalab.rewriteImageReferences('# Title\n\n![](_page_0_Picture_2.jpeg)\n\nAfter', resolve)
    expect(out.markdown).toBe('# Title\n\n![](assets/_page_0_Picture_2.jpeg)\n\nAfter')
  })

  test('remote images stay inline and are reported as unresolved', () => {
    const src = 'See ![logo](https://example.com/logo.svg) here.'
    const out = datalab.rewriteImageReferences(src, resolve)
    expect(out.markdown).toBe(src)
    expect(out.unresolved).toEqual(['https://example.com/logo.svg'])
  })

  test('decodes percent-encoded references and skips fenced code', () => {
    const src = 'A ![x](my%20fig.png) b\n\n```\n![x](code.png)\n```\n'
    const out = datalab.rewriteImageReferences(src, (ref) => (ref === 'my fig.png' ? 'assets/my-fig.png' : undefined))
    expect(out.markdown).toBe('A\n\n![x](assets/my-fig.png)\n\nb\n\n```\n![x](code.png)\n```\n')
    expect(out.rewritten).toBe(1)
  })
})

describe('helpers', () => {
  test('validatePageRange', () => {
    expect(datalab.validatePageRange('0-5,10')).toBe(true)
    expect(datalab.validatePageRange('3')).toBe(true)
    expect(datalab.validatePageRange('a-b')).toBe(false)
    expect(datalab.validatePageRange('5-')).toBe(false)
    expect(datalab.validatePageRange(' ')).toBe(false)
  })

  test('supportedDocumentType and looksLikePdf', () => {
    expect(datalab.supportedDocumentType('papers/My Paper.PDF')).toEqual({ext: 'pdf', mimeType: 'application/pdf'})
    expect(datalab.supportedDocumentType('deck.pptx')?.mimeType).toContain('presentation')
    expect(datalab.supportedDocumentType('notes.md')).toBeUndefined()
    expect(datalab.supportedDocumentType('Makefile')).toBeUndefined()
    expect(datalab.looksLikePdf(new TextEncoder().encode('junk\n%PDF-1.7'))).toBe(true)
    expect(datalab.looksLikePdf(new TextEncoder().encode('hello'))).toBe(false)
  })

  test('slugForFileName and uniqueName', () => {
    expect(datalab.slugForFileName('papers/Édition Spéciale (2024).pdf')).toBe('edition-speciale-2024')
    expect(datalab.slugForFileName('...')).toBe('document')
    const used = new Set<string>()
    expect(datalab.uniqueName('paper', used)).toBe('paper')
    expect(datalab.uniqueName('paper', used)).toBe('paper-2')
    expect(datalab.uniqueName('paper', used)).toBe('paper-3')
  })

  test('assetFileNames sanitizes and keeps names unique', () => {
    const names = datalab.assetFileNames(['_page_0_Picture_2.jpeg', 'dir/odd name?.png', 'odd-name-.png', '../x.PNG'])
    expect(names.get('_page_0_Picture_2.jpeg')).toBe('_page_0_Picture_2.jpeg')
    expect(names.get('dir/odd name?.png')).toBe('odd-name-.png')
    expect(names.get('odd-name-.png')).toBe('odd-name-.png-2')
    expect(names.get('../x.PNG')).toBe('x.png')
  })

  test('cheaperDatalabMode and parseDatalabMode', () => {
    expect(datalab.cheaperDatalabMode('accurate', 'balanced')).toBe('balanced')
    expect(datalab.cheaperDatalabMode('fast', 'accurate')).toBe('fast')
    expect(datalab.parseDatalabMode('balanced')).toBe('balanced')
    expect(datalab.parseDatalabMode('turbo')).toBeUndefined()
  })

  test('boundConversionResult drops the largest images first and refuses huge markdown', () => {
    const result: datalab.ConvertDocumentResult = {
      markdown: 'ok',
      images: new Map([
        ['a.png', new Uint8Array(10)],
        ['b.png', new Uint8Array(30)],
        ['c.png', new Uint8Array(20)],
      ]),
      pageCount: 1,
      parseQualityScore: null,
      costCents: null,
      requestId: 'r',
    }
    const bounded = datalab.boundConversionResult(result, {maxMarkdownBytes: 100, maxImagesBytes: 25})
    expect(bounded.droppedImages).toEqual(['b.png', 'c.png'])
    expect([...bounded.images.keys()]).toEqual(['a.png'])
    expect(() =>
      datalab.boundConversionResult(
        {...result, markdown: 'x'.repeat(200)},
        {maxMarkdownBytes: 100, maxImagesBytes: 25},
      ),
    ).toThrow(/larger than/)
  })

  test('runWithConcurrency bounds in-flight work and keeps order', async () => {
    let inFlight = 0
    let peak = 0
    const results = await datalab.runWithConcurrency([30, 10, 20, 5], 2, async (ms, index) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await Bun.sleep(ms)
      inFlight--
      return index * 10
    })
    expect(results).toEqual([0, 10, 20, 30])
    expect(peak).toBe(2)
  })
})

function openDb(): Database {
  const db = new Database(':memory:', {create: true, strict: true})
  const opened = sqlite.openWithDatabase(db)
  if (!opened.ok) throw new Error('schema failed')
  const now = Date.now()
  db.run(`INSERT INTO accounts (id, created_at, updated_at) VALUES ('acc-a', ?, ?), ('acc-b', ?, ?)`, [
    now,
    now,
    now,
    now,
  ])
  return db
}

const NOW = Date.UTC(2026, 9, 15, 12, 0, 0)
const base = {accountAllowance: 1000, globalCeiling: 20000, now: NOW, sourceName: 'paper.pdf'}

describe('conversion ledger', () => {
  test('periodOf is the UTC month', () => {
    expect(datalab.periodOf(NOW)).toBe('2026-10')
    expect(datalab.periodOf(Date.UTC(2026, 11, 31, 23, 59))).toBe('2026-12')
  })

  test('the reservation is the smallest of request, call cap, account and server remaining', () => {
    const db = openDb()
    try {
      expect(datalab.reservePages(db, {...base, accountId: 'acc-a'})).toMatchObject({
        pages: datalab.CONVERT_PAGES_PER_CALL_CAP,
        boundBy: 'call_cap',
      })
      expect(datalab.reservePages(db, {...base, accountId: 'acc-a', requested: 12})).toMatchObject({
        pages: 12,
        boundBy: 'requested',
      })
      expect(datalab.reservePages(db, {...base, accountId: 'acc-a', accountAllowance: 250})).toMatchObject({
        pages: 38,
        boundBy: 'account_allowance',
        accountRemaining: 0,
      })
      expect(datalab.reservePages(db, {...base, accountId: 'acc-b', globalCeiling: 300})).toMatchObject({
        pages: 50,
        boundBy: 'server_ceiling',
      })
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('refuses when the account or the server has nothing left', () => {
    const db = openDb()
    try {
      datalab.reservePages(db, {...base, accountId: 'acc-a', accountAllowance: 200})
      expect(() => datalab.reservePages(db, {...base, accountId: 'acc-a', accountAllowance: 200})).toThrow(
        datalab.ConversionQuotaError,
      )
      try {
        datalab.reservePages(db, {...base, accountId: 'acc-a', accountAllowance: 200})
      } catch (error) {
        expect((error as datalab.ConversionQuotaError).scope).toBe('account')
        expect((error as datalab.ConversionQuotaError).used).toBe(200)
      }
      try {
        datalab.reservePages(db, {...base, accountId: 'acc-b', globalCeiling: 200})
      } catch (error) {
        expect((error as datalab.ConversionQuotaError).scope).toBe('server')
        expect((error as Error).message).toContain('200 of its 200')
      }
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('settle charges at most the reservation and release frees it', () => {
    const db = openDb()
    try {
      const a = datalab.reservePages(db, {...base, accountId: 'acc-a', requested: 50})
      const b = datalab.reservePages(db, {...base, accountId: 'acc-a', requested: 50})
      expect(datalab.pagesUsed(db, {accountId: 'acc-a', period: '2026-10'})).toBe(100)
      datalab.settleReservation(db, a.id, {pageCount: 120, requestId: 'req-1', now: NOW + 1})
      datalab.releaseReservation(db, b.id, NOW + 1)
      expect(datalab.pagesUsed(db, {accountId: 'acc-a', period: '2026-10'})).toBe(50)
      // Settling or releasing twice is a no-op.
      datalab.settleReservation(db, a.id, {pageCount: 1, now: NOW + 2})
      datalab.releaseReservation(db, a.id, NOW + 2)
      expect(datalab.pagesUsed(db, {accountId: 'acc-a', period: '2026-10'})).toBe(50)
      const row = db
        .query<{request_id: string; state: string}, [string]>(
          `SELECT request_id, state FROM conversion_usage WHERE id = ?`,
        )
        .get(a.id)
      expect(row).toEqual({request_id: 'req-1', state: 'settled'})
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('a stale reservation is released by the next reserve', () => {
    const db = openDb()
    try {
      datalab.reservePages(db, {...base, accountId: 'acc-a', accountAllowance: 200})
      const later = NOW + 31 * 60_000
      const next = datalab.reservePages(db, {...base, accountId: 'acc-a', accountAllowance: 200, now: later})
      expect(next.pages).toBe(200)
    } finally {
      sqlite.closeDatabase(db)
    }
  })

  test('usage is isolated per month and per account', () => {
    const db = openDb()
    try {
      const a = datalab.reservePages(db, {...base, accountId: 'acc-a', requested: 70})
      datalab.settleReservation(db, a.id, {pageCount: 70, now: NOW})
      expect(datalab.pagesUsed(db, {accountId: 'acc-a', period: '2026-11'})).toBe(0)
      expect(datalab.pagesUsed(db, {accountId: 'acc-b', period: '2026-10'})).toBe(0)
      expect(datalab.pagesUsed(db, {period: '2026-10'})).toBe(70)
      const next = datalab.reservePages(db, {...base, accountId: 'acc-a', now: Date.UTC(2026, 10, 1)})
      expect(next.accountRemaining).toBe(1000 - datalab.CONVERT_PAGES_PER_CALL_CAP)
    } finally {
      sqlite.closeDatabase(db)
    }
  })
})

// Shapes taken from a real Datalab conversion of an ACM paper: captions as plain or bold
// paragraphs next to the image, a `#### 5. REFERENCES` heading with `- [n]` entries, and
// citations as `[1, 2]`, `[3]` in prose.
const PAPER = `# Higher-Order Rank Analysis

The text ![](assets/fig1.jpg) more text.

![](assets/fig1.jpg)

Figure 1: Regular and irregular structures

is easy to handle. Irregular arcs were studied in [1, 2] and the Web as a graph in [3]. See also [4-6], [9] and [12].

**Figure 3: Higher-order rank: rank<sub>0</sub>(A) on a Web graph**

![Figure 3](assets/fig3.jpg)

A [link label](https://example.com/[1]) and a reference-style [x][1] stay as they are.

\`\`\`
code [1] stays
![](assets/code.jpg)
\`\`\`

#### 5. REFERENCES

- [1] Ikumi Horie, "Structural Analysis," 2004.
- [2] Ikumi Horie, "Structural Analysis by the Non-Well-Founded Set," 2004.
- [3] Andrei Broder, "Graph structure in the web," 2000.
- [4] Rodrigo A. Botafofo, "Identifying aggregates," 1991.
- [5] Rodrigo A. Botafofo, "Structural Analysis of Hypertexts," 1992.
- [6] John E. McEneaney, "Graphic and numerical methods," 2001.
- [9] Wang, "Discovering Typical Structures," 1998.

## 6. Appendix

Nothing cites [2] here? It does, and it is linked. But [99] has no entry.
`

describe('postprocessConvertedMarkdown', () => {
  const out = datalab.postprocessConvertedMarkdown(PAPER)

  test('folds the adjacent caption paragraph into the image caption', () => {
    expect(out.captionsFolded).toBe(2)
    expect(out.markdown).toContain('![Figure 1: Regular and irregular structures](assets/fig1.jpg)')
    expect(out.markdown).not.toContain('\nFigure 1: Regular and irregular structures\n')
    expect(out.markdown).toContain(
      '![Figure 3: Higher-order rank: rank<sub>0</sub>(A) on a Web graph](assets/fig3.jpg)',
    )
    expect(out.markdown).not.toContain('**Figure 3')
    // The inline image in prose is not a standalone image line and is left for the image rewrite.
    expect(out.markdown).toContain('The text ![](assets/fig1.jpg) more text.')
  })

  test('gives bibliography entries ids and links numeric citations, groups and ranges to them', () => {
    expect(out.referenceEntries).toBe(7)
    expect(out.markdown).toContain('- [1] Ikumi Horie, "Structural Analysis," 2004. <!-- id:ref-1 -->')
    expect(out.markdown).toContain('- [9] Wang, "Discovering Typical Structures," 1998. <!-- id:ref-9 -->')
    expect(out.markdown).toContain('studied in [[1](#ref-1), [2](#ref-2)] and the Web as a graph in [[3](#ref-3)]')
    expect(out.markdown).toContain('See also [[4](#ref-4), [5](#ref-5), [6](#ref-6)], [[9](#ref-9)] and [12].')
    expect(out.markdown).toContain('cites [[2](#ref-2)] here')
    expect(out.citationsLinked).toBe(8)
    expect(out.citationsUnlinked).toEqual(['12', '99'])
  })

  // Shapes from a real conversion of the Sherman et al. ATK paper: `[Author year]` labels on
  // both the entries and the citations, emphasis inside a label, a comma-separated pair.
  test('links labelled author-year citations to entries carrying the same label', () => {
    const src = [
      'Links for hypertext [Meyrowitz 1989]. Built atop ATK [Borenstein *et al.* 1988] had no plan.',
      'The Help system [Langston 1988, Ogura & Robertson 1989] provides help; see [Olivetti undated].',
      'Not cited: [Meyrowitz 1999], [sic] and [Figure 2].',
      '',
      '## References',
      '',
      '- [Atkinson 1987] Atkinson, B., *HyperCard*, Apple Computer, 1987.',
      '- [Borenstein *et al.* 1988] Borenstein, Nathaniel, "A Multi-media Message System for Andrew", 1988.',
      '- [Langston 1988] Langston, Diane, "Background and Initial Problems for the Andrew Help System," 1988.',
      '- [Meyrowitz 1989] Meyrowitz, N., "Hypertext—Does it Reduce Cholesterol, too?", 1989.',
      '- [Ogura & Robertson 1989] Ogura, Ayami, Jennifer Robertson, "Designing Hypermedia Help Systems", 1989.',
      '- [Olivetti undated] "Hypermedia Help System", Olivetti Internal Memo, undated.',
      '',
    ].join('\n')
    const out = datalab.postprocessConvertedMarkdown(src)
    expect(out.referenceEntries).toBe(6)
    expect(out.markdown).toContain(
      '- [Atkinson 1987] Atkinson, B., *HyperCard*, Apple Computer, 1987. <!-- id:ref-atkinson-1987 -->',
    )
    expect(out.markdown).toContain('1988. <!-- id:ref-borenstein-et-al-1988 -->')
    expect(out.markdown).toContain('1989. <!-- id:ref-ogura-robertson-1989 -->')
    expect(out.markdown).toContain(
      'Links for hypertext [[Meyrowitz 1989](#ref-meyrowitz-1989)]. Built atop ATK [[Borenstein *et al.* 1988](#ref-borenstein-et-al-1988)] had no plan.',
    )
    expect(out.markdown).toContain(
      'The Help system [[Langston 1988](#ref-langston-1988), [Ogura & Robertson 1989](#ref-ogura-robertson-1989)] provides help; see [[Olivetti undated](#ref-olivetti-undated)].',
    )
    expect(out.markdown).toContain('Not cited: [Meyrowitz 1999], [sic] and [Figure 2].')
    expect(out.citationsLinked).toBe(5)
    expect(out.citationsUnlinked).toEqual(['meyrowitz 1999'])
  })

  // Shapes from a real conversion with the extract_links extra (an ACM paper on migration):
  // the PDF's internal links wrap each citation, `[\[49\].](#block-9-2)`, pointing at `<a id>`
  // anchors; literal brackets are escaped; display math is written on one line.
  test('unwraps Datalab internal links and anchors, reads escaped citations, fences one-line math', () => {
    const src = [
      '# Title',
      '',
      '<a id="block-5-4"></a>![](assets/fig1.jpg)',
      '',
      'Figure 1: A figure',
      '',
      'Migrants increased [\\[49\\].](#block-9-2) However [\\[37,](#block-9-0) [60,](#block-9-2) [64\\].](#block-9-2) and plain \\[34\\] too, see [Section 3](#block-3-0) and [the site](https://example.org/#block-1-1).',
      '',
      '$$T_i = Y_i(1) - Y_i(0).$$',
      '',
      '$$\\begin{aligned} a &= b \\\\',
      'c &= d \\end{aligned}$$',
      '',
      '$$',
      'already fenced',
      '$$',
      '',
      '## REFERENCES',
      '',
      '<a id="block-9-0"></a>',
      '',
      '- [34] Entry thirty-four.',
      '- [37] Entry thirty-seven.',
      '- [49] Entry forty-nine.',
      '- [60] Entry sixty.',
      '- [64] Entry sixty-four.',
      '',
    ].join('\n')
    const out = datalab.postprocessConvertedMarkdown(src)
    expect(out).toMatchObject({
      internalLinksUnwrapped: 5,
      mathBlocksNormalized: 2,
      captionsFolded: 1,
      referenceEntries: 5,
      citationsLinked: 5,
      citationsUnlinked: [],
    })
    expect(out.markdown).not.toContain('<a id=')
    expect(out.markdown).not.toContain('](#block-')
    expect(out.markdown).toContain('![Figure 1: A figure](assets/fig1.jpg)')
    expect(out.markdown).toContain(
      'Migrants increased [[49](#ref-49)]. However [[37](#ref-37), [60](#ref-60), [64](#ref-64)]. and plain [[34](#ref-34)] too, see Section 3 and [the site](https://example.org/#block-1-1).',
    )
    expect(out.markdown).toContain('$$\nT_i = Y_i(1) - Y_i(0).\n$$')
    expect(out.markdown).toContain('$$\n\\begin{aligned} a &= b \\\\\nc &= d \\end{aligned}\n$$')
    expect(out.markdown).toContain('$$\nalready fenced\n$$')
    expect(out.markdown).toContain('- [34] Entry thirty-four. <!-- id:ref-34 -->')
  })

  test('leaves link labels, reference-style links, code and the bibliography itself alone', () => {
    expect(out.markdown).toContain('[link label](https://example.com/[1])')
    expect(out.markdown).toContain('[x][1] stay')
    expect(out.markdown).toContain('code [1] stays\n![](assets/code.jpg)')
    expect(out.markdown).not.toContain('- [[1](#ref-1)]')
  })

  test('a document without a references section or captions passes through unchanged', () => {
    const plain = '# Title\n\nJust prose with [1] and a table.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n'
    const result = datalab.postprocessConvertedMarkdown(plain)
    expect(result.markdown).toBe(plain)
    expect(result).toMatchObject({captionsFolded: 0, referenceEntries: 0, citationsLinked: 0, citationsUnlinked: []})
  })

  test('keeps an existing block id on a bibliography entry and does not stack captions', () => {
    const src =
      '![](a.png) <!-- id:imgAAAAA -->\n\nFig. 2. Two things\n\nAs in [1].\n\n## References\n\n1. First <!-- id:keepMe12 -->\n'
    const result = datalab.postprocessConvertedMarkdown(src)
    expect(result.markdown).toBe(
      '![Fig. 2: Two things](a.png) <!-- id:imgAAAAA -->\n\nAs in [[1](#keepMe12)].\n\n## References\n\n1. First <!-- id:keepMe12 -->\n',
    )
  })
})

type Fake = ReturnType<typeof startFakeDatalab>

/** Service, account and agent ready to call `convert`; the model call is failed fast by the fetch stub. */
async function setup(options: {fake?: Fake; convert?: Partial<apisvc.ConvertToolsConfig>; tools?: string[]}) {
  const db = new Database(':memory:', {create: true, strict: true})
  if (!sqlite.openWithDatabase(db).ok) throw new Error('schema failed')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-convert-'))
  const events: apisvc.ServiceEvent[] = []
  const svc = new apisvc.Service(db, dataDir, {
    onEvent: (event) => events.push(event),
    hmServerUrl: 'https://hm.test',
    convert: {
      ...config.CONVERT_DEFAULTS,
      pollIntervalMs: 20,
      ...(options.fake ? {datalabApiKey: 'server-key', datalabBaseUrl: options.fake.baseUrl} : {}),
      ...options.convert,
    },
  })
  const account = blobs.generateNobleKeyPair()
  const send = async (action: Parameters<typeof apisvc.createSignedEnvelope>[1]['action']) =>
    svc.message(await apisvc.createSignedEnvelope(account, {action}))
  await send({_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')})
  await send({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}}})
  const agent = await send({
    _: 'CreateAgent',
    definition: {
      name: 'Importer',
      systemPrompt: 'import',
      modelProvider: 'openai',
      model: 'gpt-test',
      tools: options.tools ?? ['convert'],
    },
  })
  if (agent._ !== 'CreateAgentResponse') throw new Error(`unexpected ${agent._}`)
  const session = await send({_: 'CreateSession', agentId: agent.agentId})
  if (session._ !== 'CreateSessionResponse') throw new Error(`unexpected ${session._}`)
  const agentRow = db
    .query<{state_dir: string}, [string]>(`SELECT state_dir FROM agents WHERE id = ?`)
    .get(agent.agentId)
  const stateDir = agentRow!.state_dir
  const convert = async (input: Record<string, unknown>) => {
    const invoked = await send({
      _: 'InvokeSessionTool',
      sessionId: session.sessionId,
      verb: 'call',
      input: {tool: 'convert', input},
    })
    if (invoked._ !== 'InvokeSessionToolResponse') throw new Error(`unexpected ${invoked._}`)
    await svc.awaitQueueIdle()
    return invoked
  }
  const write = (rel: string, content: string | Uint8Array) => agentMemory.writeMemoryFile(stateDir, rel, content)
  const read = (rel: string) => {
    const file = agentMemory.readMemoryFile(stateDir, rel)
    return file.encoding === 'binary' ? new TextDecoder().decode(file.data) : file.content ?? ''
  }
  const exists = (rel: string) => fs.existsSync(agentMemory.resolveMemoryPath(stateDir, rel).absPath)
  const accountId = blobs.principalToString(account.principal)
  const ledgerRows = () =>
    db
      .query<{state: string; pages_reserved: number; pages_charged: number}, []>(
        `SELECT state, pages_reserved, pages_charged FROM conversion_usage ORDER BY created_at`,
      )
      .all()
  return {
    svc,
    db,
    dataDir,
    events,
    send,
    convert,
    write,
    read,
    exists,
    accountId,
    agentId: agent.agentId,
    ledgerRows,
    stateDir,
  }
}

const PDF = new TextEncoder().encode('%PDF-1.4\nfake pdf body')

describe('convert builtin', () => {
  const realFetch = globalThis.fetch
  let cleanups: (() => void)[] = []
  beforeEach(() => {
    // Loopback traffic (the fake Datalab) passes through; the model call fails fast.
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('http://127.0.0.1')) return realFetch(input, init)
      return new Response('{"error":"no model in tests"}', {status: 401})
    }) as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    for (const cleanup of cleanups.splice(0)) cleanup()
  })
  const track = (fake: Fake, t: Awaited<ReturnType<typeof setup>>) => {
    cleanups.push(() => {
      fake.stop()
      sqlite.closeDatabase(t.db)
      fs.rmSync(t.dataDir, {recursive: true, force: true})
    })
  }

  test('converts a PDF with the shared key, writes the output tree and settles the ledger', async () => {
    const fake = startFakeDatalab({processingPolls: 1})
    const t = await setup({fake})
    track(fake, t)
    t.write('incoming/My Paper.pdf', PDF)
    const invoked = await t.convert({files: ['incoming/My Paper.pdf']})
    expect(invoked.error).toBeUndefined()
    const output = invoked.output as Record<string, unknown>
    expect(output.summary).toContain('Converted 1 document into datalab-imports/ (3 pages, 2 figures)')
    expect(output.documents).toEqual([
      {
        source: 'incoming/My Paper.pdf',
        outputDir: 'datalab-imports/my-paper',
        markdownPath: 'datalab-imports/my-paper/seed.md',
        pages: 3,
        images: 2,
        truncated: false,
        captions: 0,
        citationsLinked: 0,
        citationsUnlinked: 0,
      },
    ])
    expect(output.failures).toEqual([])
    expect(output).toMatchObject({keySource: 'server', pagesChargedThisCall: 3, pagesRemainingThisMonth: 997})

    expect(t.read('datalab-imports/my-paper/raw.md')).toBe(FAKE_DATALAB_COMPLETION.markdown)
    expect(t.read('datalab-imports/my-paper/seed.md')).toBe(
      '# Title\n\nText\n\n![Figure 1](assets/fig1.png)\n\nmore text.\n\n![](assets/_page_0_Picture_2.jpeg)\n',
    )
    expect(t.read('datalab-imports/my-paper/assets/fig1.png')).toBe('PNGDATA')
    const manifest = JSON.parse(t.read('datalab-imports/my-paper/manifest.json')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      source: 'incoming/My Paper.pdf',
      keySource: 'server',
      mode: 'accurate',
      pageCount: 3,
      maxPagesApplied: datalab.CONVERT_PAGES_PER_CALL_CAP,
      truncated: false,
      parseQualityScore: 4.5,
      costCents: 1.2,
      imagesRewritten: 2,
      requestId: 'req-1',
    })

    const submission = fake.submissions[0]!
    expect(submission.apiKey).toBe('server-key')
    expect(submission.fileType).toBe('application/pdf')
    expect(submission.fileName).toBe('My Paper.pdf')
    expect(submission.fields).toMatchObject({
      mode: 'accurate',
      extras: 'extract_links,chart_understanding',
      disable_image_captions: 'true',
      max_pages: String(datalab.CONVERT_PAGES_PER_CALL_CAP),
    })
    expect(t.ledgerRows()).toEqual([
      {state: 'settled', pages_reserved: datalab.CONVERT_PAGES_PER_CALL_CAP, pages_charged: 3},
    ])
    expect(
      t.events.some(
        (e) => e.type === 'account-change' && e.reason === 'agent-memory-changed' && e.agentId === t.agentId,
      ),
    ).toBe(true)
  })

  test('captions are attached to their figures and numeric citations linked to the references', async () => {
    const fake = startFakeDatalab({
      completions: [
        {
          ...FAKE_DATALAB_COMPLETION,
          markdown: [
            '# Paper',
            '',
            'Arcs were studied in [1, 2]. See [3].',
            '',
            '![](fig1.png)',
            '',
            'Figure 1: Regular and irregular structures',
            '',
            '#### 5. REFERENCES',
            '',
            '- [1] First, 2004.',
            '- [2] Second, 2004.',
            '',
          ].join('\n'),
          images: {'fig1.png': Buffer.from('PNG').toString('base64')},
        },
      ],
    })
    const t = await setup({fake})
    track(fake, t)
    t.write('paper.pdf', PDF)
    const output = (await t.convert({files: ['paper.pdf']})).output as Record<string, unknown>
    expect(output.summary).toContain(
      '1 caption attached to figures, 2 citations linked to the references, 1 citation without a reference entry left as text',
    )
    expect(output.documents).toEqual([expect.objectContaining({captions: 1, citationsLinked: 2, citationsUnlinked: 1})])
    expect(t.read('datalab-imports/paper/seed.md')).toBe(
      [
        '# Paper',
        '',
        'Arcs were studied in [[1](#ref-1), [2](#ref-2)]. See [3].',
        '',
        '![Figure 1: Regular and irregular structures](assets/fig1.png)',
        '',
        '#### 5. REFERENCES',
        '',
        '- [1] First, 2004. <!-- id:ref-1 -->',
        '- [2] Second, 2004. <!-- id:ref-2 -->',
        '',
      ].join('\n'),
    )
    const manifest = JSON.parse(t.read('datalab-imports/paper/manifest.json')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      captionsFolded: 1,
      referenceEntries: 2,
      citationsLinked: 2,
      citationsUnlinked: ['3'],
    })
  })

  test('a folder converts every supported file in parallel, skips the rest, and keeps going past one failure', async () => {
    const fake = startFakeDatalab({
      completions: [
        FAKE_DATALAB_COMPLETION,
        {status: 'complete', success: false, error: 'Could not parse the file'},
        {...FAKE_DATALAB_COMPLETION, page_count: 1, images: {}},
        {...FAKE_DATALAB_COMPLETION, page_count: 2, images: {}},
      ],
    })
    const t = await setup({fake, convert: {concurrency: 2}})
    track(fake, t)
    t.write('papers/a.pdf', PDF)
    t.write('papers/b.pdf', PDF)
    t.write('papers/nested/deck.pptx', new Uint8Array([1, 2, 3]))
    t.write('papers/scan.png', new Uint8Array([137, 80, 78, 71]))
    t.write('papers/notes.txt', 'not a document')
    const invoked = await t.convert({files: ['papers']})
    const output = invoked.output as {
      documents: {source: string}[]
      failures: {source: string; error: string}[]
      summary: string
    }
    expect(output.documents.map((d) => d.source)).toEqual([
      'papers/a.pdf',
      'papers/nested/deck.pptx',
      'papers/scan.png',
    ])
    expect(output.failures).toEqual([{source: 'papers/b.pdf', error: 'Could not parse the file'}])
    expect(output.summary).toContain('Converted 3 documents')
    expect(output.summary).toContain('1 failed')
    expect(output.summary).toContain('1 unsupported file skipped')
    expect(fake.peakInFlight).toBeLessThanOrEqual(2)
    expect(fake.submissions.map((s) => s.fileType).sort()).toEqual(
      [
        'application/pdf',
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'image/png',
      ].sort(),
    )
    const states = t
      .ledgerRows()
      .map((r) => r.state)
      .sort()
    expect(states).toEqual(['released', 'settled', 'settled', 'settled'])
    expect(t.exists('datalab-imports/b')).toBe(false)
  })

  test('overwrite is explicit: an existing output folder is a failure without it and replaced with it', async () => {
    const fake = startFakeDatalab()
    const t = await setup({fake})
    track(fake, t)
    t.write('a.pdf', PDF)
    t.write('datalab-imports/a/seed.md', 'old')
    t.write('datalab-imports/a/assets/stale.png', 'stale')
    const first = (await t.convert({files: ['a.pdf']})).output as {failures: {error: string}[]}
    expect(first.failures[0]?.error).toContain('already exists')
    expect(fake.submissions).toHaveLength(0)
    expect(t.ledgerRows()).toEqual([])
    const second = (await t.convert({files: ['a.pdf'], overwrite: true})).output as {documents: unknown[]}
    expect(second.documents).toHaveLength(1)
    expect(t.read('datalab-imports/a/seed.md')).toContain('# Title')
    expect(t.exists('datalab-imports/a/assets/stale.png')).toBe(false)
  })

  test("the account's own key is used unmetered and may ask for any mode", async () => {
    const fake = startFakeDatalab()
    const t = await setup({fake, convert: {mode: 'balanced'}})
    track(fake, t)
    await t.send({
      _: 'SetSecret',
      name: 'datalab-api-key',
      value: new TextEncoder().encode('own-key\n'),
      metadata: {kind: 'datalab-api-key'},
    })
    t.write('a.pdf', PDF)
    const output = (await t.convert({files: ['a.pdf'], mode: 'accurate', max_pages: 5})).output as Record<
      string,
      unknown
    >
    expect(output.keySource).toBe('own')
    expect(output.pagesChargedThisCall).toBeUndefined()
    expect(fake.submissions[0]).toMatchObject({apiKey: 'own-key', fields: {mode: 'accurate', max_pages: '5'}})
    expect(t.ledgerRows()).toEqual([])
    const manifest = JSON.parse(t.read('datalab-imports/a/manifest.json')) as Record<string, unknown>
    expect(manifest).toMatchObject({keySource: 'own', maxPagesApplied: 5, truncated: false})
  })

  test('on the shared key a more expensive mode is lowered to the server mode', async () => {
    const fake = startFakeDatalab()
    const t = await setup({fake, convert: {mode: 'balanced'}})
    track(fake, t)
    t.write('a.pdf', PDF)
    const output = (await t.convert({files: ['a.pdf'], mode: 'accurate'})).output as {summary: string}
    expect(fake.submissions[0]?.fields.mode).toBe('balanced')
    expect(output.summary).toContain('mode lowered to balanced')
    const manifest = JSON.parse(t.read('datalab-imports/a/manifest.json')) as Record<string, unknown>
    expect(manifest).toMatchObject({mode: 'balanced', modeDowngraded: true, modeRequested: 'accurate'})
    expect(fake.submissions).toHaveLength(1)
    const cheaper = (await t.convert({files: ['a.pdf'], mode: 'fast', overwrite: true})).output as {summary: string}
    expect(fake.submissions[1]?.fields.mode).toBe('fast')
    expect(cheaper.summary).not.toContain('lowered')
  })

  test('the reservation is what Datalab is told, and a cut document says so', async () => {
    const fake = startFakeDatalab({completions: [{...FAKE_DATALAB_COMPLETION, page_count: 10, images: {}}]})
    const t = await setup({fake, convert: {allowancePagesPerMonth: 10}})
    track(fake, t)
    t.write('long.pdf', PDF)
    const output = (await t.convert({files: ['long.pdf']})).output as {
      documents: {truncated: boolean}[]
      summary: string
    }
    expect(fake.submissions[0]?.fields.max_pages).toBe('10')
    expect(output.documents[0]?.truncated).toBe(true)
    expect(output.summary).toContain('1 cut at the page cap')
    const manifest = JSON.parse(t.read('datalab-imports/long/manifest.json')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      maxPagesApplied: 10,
      truncated: true,
      truncationReason: 'account allowance remaining this month',
    })
    // The allowance is now spent: the next call is refused before anything is sent.
    const refused = await t.convert({files: ['long.pdf'], overwrite: true})
    expect(refused.error).toContain('used 10 of its 10 shared conversion pages')
    expect(refused.error).toContain('datalab-api-key')
    expect(fake.submissions).toHaveLength(1)
  })

  test('a rejected server key stops the batch with a configuration error', async () => {
    const fake = startFakeDatalab({submitStatuses: [401]})
    const t = await setup({fake})
    track(fake, t)
    t.write('a.pdf', PDF)
    const invoked = await t.convert({files: ['a.pdf']})
    expect(invoked.error).toContain('rejected this server')
    expect(invoked.error).not.toContain('server-key')
    expect(t.ledgerRows()).toEqual([
      {state: 'released', pages_reserved: datalab.CONVERT_PAGES_PER_CALL_CAP, pages_charged: 0},
    ])
  })

  test('bad input is answered up front, bad files land in failures', async () => {
    const fake = startFakeDatalab()
    const t = await setup({fake})
    track(fake, t)
    t.write('fake.pdf', 'this is text, not a pdf')
    t.write('notes.md', '# notes')
    const output = (await t.convert({files: ['fake.pdf', 'notes.md', 'missing.pdf']})).output as {
      failures: {source: string; error: string}[]
      summary: string
    }
    expect(output.failures.map((f) => f.source)).toEqual(['missing.pdf', 'fake.pdf', 'notes.md'])
    expect(output.failures[1]?.error).toContain('Not a PDF')
    expect(output.failures[2]?.error).toContain('Unsupported document type')
    expect(output.summary).toBe('Converted nothing. 3 failed.')
    expect(fake.submissions).toHaveLength(0)
    expect((await t.convert({files: ['papers/*.pdf']})).error).toContain('Globs are not expanded')
    expect((await t.convert({files: ['a.pdf'], page_range: 'x-y'})).error).toContain('page_range')
  })

  test('without a key, a relay or an account secret the tool is not offered; with the secret it is', async () => {
    const t = await setup({})
    cleanups.push(() => {
      sqlite.closeDatabase(t.db)
      fs.rmSync(t.dataDir, {recursive: true, force: true})
    })
    expect(t.svc.convertCapabilities()).toEqual({available: false, source: 'none'})
    t.write('a.pdf', PDF)
    const missing = (await t.convert({files: ['a.pdf']})).output as {summary: string}
    expect(missing.summary).toContain('No callable tool named convert')
    const tools = await t.send({_: 'ListAgentTools', agentId: t.agentId})
    if (tools._ !== 'ListAgentToolsResponse') throw new Error('unexpected')
    expect(tools.tools.find((tool) => tool.name === 'convert')?.granted).toBe(false)
    await t.send({_: 'SetSecret', name: 'datalab-api-key', value: new TextEncoder().encode('own-key')})
    const offered = await t.send({_: 'ListAgentTools', agentId: t.agentId})
    if (offered._ !== 'ListAgentToolsResponse') throw new Error('unexpected')
    expect(offered.tools.find((tool) => tool.name === 'convert')?.granted).toBe(true)
  })

  test('capabilities report the key and the relay', () => {
    const db = new Database(':memory:', {create: true, strict: true})
    sqlite.openWithDatabase(db)
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-convert-'))
    try {
      expect(
        new apisvc.Service(db, dataDir, {
          convert: {...config.CONVERT_DEFAULTS, datalabApiKey: 'k'},
        }).convertCapabilities(),
      ).toEqual({
        available: true,
        source: 'key',
      })
      expect(
        new apisvc.Service(db, dataDir, {
          convert: {...config.CONVERT_DEFAULTS, relayUrl: 'http://127.0.0.1:1'},
        }).convertCapabilities(),
      ).toEqual({available: true, source: 'relay'})
    } finally {
      sqlite.closeDatabase(db)
      fs.rmSync(dataDir, {recursive: true, force: true})
    }
  })
})

function openService(options: Partial<apisvc.ConvertToolsConfig>, onEvent?: (event: apisvc.ServiceEvent) => void) {
  const db = new Database(':memory:', {create: true, strict: true})
  if (!sqlite.openWithDatabase(db).ok) throw new Error('schema failed')
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-agents-relay-'))
  const svc = new apisvc.Service(db, dataDir, {
    onEvent,
    hmServerUrl: 'https://hm.test',
    convert: {...config.CONVERT_DEFAULTS, pollIntervalMs: 20, ...options},
  })
  return {
    svc,
    db,
    dataDir,
    close: () => {
      sqlite.closeDatabase(db)
      fs.rmSync(dataDir, {recursive: true, force: true})
    },
  }
}

/** The hosted server behind a real HTTP route, the way the local server reaches it. */
function serveHosted(svc: apisvc.Service) {
  const server = Bun.serve({
    port: 0,
    routes: createAPIRoutes(svc),
    fetch: () => new Response('Not Found', {status: 404}),
  })
  return {url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true)}
}

describe('convert relay', () => {
  const realFetch = globalThis.fetch
  const cleanups: (() => void)[] = []
  beforeEach(() => {
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('http://127.0.0.1')) return realFetch(input, init)
      return new Response('{"error":"no model in tests"}', {status: 401})
    }) as typeof fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
    for (const cleanup of cleanups.splice(0)) cleanup()
  })

  /** A local server whose agent has its own identity and the convert grant, with the PDF in memory. */
  async function localAgent(relayUrl: string) {
    const events: apisvc.ServiceEvent[] = []
    const local = openService({relayUrl}, (event) => events.push(event))
    cleanups.push(local.close)
    const owner = blobs.generateNobleKeyPair()
    const identity = blobs.generateNobleKeyPair()
    const send = async (action: Parameters<typeof apisvc.createSignedEnvelope>[1]['action']) =>
      local.svc.message(await apisvc.createSignedEnvelope(owner, {action}))
    await send({_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')})
    await send({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}}})
    const imported = await send({_: 'ImportSigningIdentity', seed: identity.seed, label: 'Importer'})
    if (imported._ !== 'ImportSigningIdentityResponse') throw new Error(`unexpected ${imported._}`)
    const signingKey = imported.identity.name
    const agent = await send({
      _: 'CreateAgent',
      definition: {
        name: 'Importer',
        systemPrompt: 'import',
        modelProvider: 'openai',
        model: 'gpt-test',
        tools: ['convert'],
        signingKey,
        signingKeys: [signingKey],
      },
    })
    if (agent._ !== 'CreateAgentResponse') throw new Error(`unexpected ${agent._}`)
    const session = await send({_: 'CreateSession', agentId: agent.agentId})
    if (session._ !== 'CreateSessionResponse') throw new Error(`unexpected ${session._}`)
    const stateDir = local.db
      .query<{state_dir: string}, [string]>(`SELECT state_dir FROM agents WHERE id = ?`)
      .get(agent.agentId)!.state_dir
    agentMemory.writeMemoryFile(stateDir, 'incoming/paper.pdf', PDF)
    const convert = async (input: Record<string, unknown>) => {
      const invoked = await send({
        _: 'InvokeSessionTool',
        sessionId: session.sessionId,
        verb: 'call',
        input: {tool: 'convert', input},
      })
      if (invoked._ !== 'InvokeSessionToolResponse') throw new Error(`unexpected ${invoked._}`)
      await local.svc.awaitQueueIdle()
      return invoked
    }
    return {
      local,
      events,
      owner,
      identity,
      identityAccountId: blobs.principalToString(identity.principal),
      stateDir,
      convert,
      send,
      agentId: agent.agentId,
    }
  }

  test('a keyless server converts through the hosted one, which bills the agent identity', async () => {
    const fake = startFakeDatalab({processingPolls: 1})
    const hosted = openService({datalabApiKey: 'hosted-key', datalabBaseUrl: fake.baseUrl})
    const relay = serveHosted(hosted.svc)
    cleanups.push(fake.stop, hosted.close, relay.stop)
    const agent = await localAgent(relay.url)
    expect(agent.local.svc.convertCapabilities()).toEqual({available: true, source: 'relay'})

    const invoked = await agent.convert({files: ['incoming/paper.pdf'], max_pages: 50})
    expect(invoked.error).toBeUndefined()
    const output = invoked.output as Record<string, unknown>
    expect(output).toMatchObject({keySource: 'relay'})
    expect(output.documents).toEqual([
      {
        source: 'incoming/paper.pdf',
        outputDir: 'datalab-imports/paper',
        markdownPath: 'datalab-imports/paper/seed.md',
        pages: 3,
        images: 2,
        truncated: false,
        captions: 0,
        citationsLinked: 0,
        citationsUnlinked: 0,
      },
    ])
    const seed = agentMemory.readMemoryFile(agent.stateDir, 'datalab-imports/paper/seed.md')
    expect(seed.content).toContain('![Figure 1](assets/fig1.png)')
    // The fake's image bytes happen to be valid UTF-8, so the memory read returns them as text.
    const asset = agentMemory.readMemoryFile(agent.stateDir, 'datalab-imports/paper/assets/fig1.png')
    expect(asset.content ?? new TextDecoder().decode(asset.data)).toBe('PNGDATA')
    expect(fake.submissions[0]).toMatchObject({apiKey: 'hosted-key', fields: {max_pages: '50', mode: 'accurate'}})

    // Billed on the hosted server, to the identity account, not on the local one.
    const hostedRows = hosted.db
      .query<{account_id: string; state: string; pages_charged: number}, []>(
        `SELECT account_id, state, pages_charged FROM conversion_usage`,
      )
      .all()
    expect(hostedRows).toEqual([{account_id: agent.identityAccountId, state: 'settled', pages_charged: 3}])
    expect(agent.local.db.query(`SELECT COUNT(*) AS n FROM conversion_usage`).get()).toEqual({n: 0})
    expect(fs.existsSync(path.join(agent.local.dataDir, 'conversions'))).toBe(false)
    expect(
      agent.events.some(
        (e) => e.type === 'account-change' && e.reason === 'agent-memory-changed' && e.agentId === agent.agentId,
      ),
    ).toBe(true)
  })

  test('the hosted job is private to its account and refuses delegated signers', async () => {
    const fake = startFakeDatalab({neverComplete: true})
    const hosted = openService({datalabApiKey: 'hosted-key', datalabBaseUrl: fake.baseUrl})
    cleanups.push(fake.stop, hosted.close)
    const owner = blobs.generateNobleKeyPair()
    const started = await hosted.svc.message(
      await apisvc.createSignedEnvelope(owner, {
        action: {_: 'ConvertDocument', content: PDF, fileName: 'a.pdf', clientRequestId: 'once'},
      }),
    )
    if (started._ !== 'ConvertDocumentResponse') throw new Error(`unexpected ${started._}`)
    expect(started.reservedPages).toBe(datalab.CONVERT_PAGES_PER_CALL_CAP)

    // Same client request id, same job: no second reservation.
    const again = await hosted.svc.message(
      await apisvc.createSignedEnvelope(owner, {
        action: {_: 'ConvertDocument', content: PDF, fileName: 'a.pdf', clientRequestId: 'once'},
      }),
    )
    expect(again).toMatchObject({_: 'ConvertDocumentResponse', jobId: started.jobId})
    expect(hosted.db.query(`SELECT COUNT(*) AS n FROM conversion_usage`).get()).toEqual({n: 1})

    const polled = await hosted.svc.message(
      await apisvc.createSignedEnvelope(owner, {action: {_: 'GetConversion', jobId: started.jobId}}),
    )
    expect(polled).toMatchObject({_: 'GetConversionResponse', status: 'processing'})

    const stranger = blobs.generateNobleKeyPair()
    await expect(
      hosted.svc.message(
        await apisvc.createSignedEnvelope(stranger, {action: {_: 'GetConversion', jobId: started.jobId}}),
      ),
    ).rejects.toThrow('Conversion not found')

    // A device the owner delegated to is authorized for everything else, but not to spend.
    const device = blobs.generateNobleKeyPair()
    auth.setLocalAuthorization(hosted.db, {
      accountId: blobs.principalToString(owner.principal),
      signerId: blobs.principalToString(device.principal),
      role: 'AGENT',
      now: Date.now(),
    })
    const delegated = (action: Parameters<typeof apisvc.createSignedEnvelope>[1]['action']) =>
      apisvc.createSignedEnvelope(device, {account: owner.principal, action})
    await expect(hosted.svc.message(await delegated({_: 'GetConversion', jobId: started.jobId}))).rejects.toThrow(
      'signed by the account itself',
    )
    await expect(
      hosted.svc.message(await delegated({_: 'ConvertDocument', content: PDF, fileName: 'b.pdf'})),
    ).rejects.toThrow('signed by the account itself')

    // Sweeping past the TTL aborts the job and gives the pages back.
    hosted.svc.sweepConversionJobs(Date.now() + 31 * 60_000)
    await expect(
      hosted.svc.message(
        await apisvc.createSignedEnvelope(owner, {action: {_: 'GetConversion', jobId: started.jobId}}),
      ),
    ).rejects.toThrow('Conversion not found')
    expect(hosted.db.query<{state: string}, []>(`SELECT state FROM conversion_usage`).all()).toEqual([
      {state: 'released'},
    ])
  })

  test('a finished job is returned inline and the relay client maps failures', async () => {
    const fake = startFakeDatalab({
      completions: [{status: 'complete', success: false, error: 'Could not parse the file'}],
    })
    const hosted = openService({datalabApiKey: 'hosted-key', datalabBaseUrl: fake.baseUrl})
    const relay = serveHosted(hosted.svc)
    cleanups.push(fake.stop, hosted.close, relay.stop)
    const identity = blobs.generateNobleKeyPair()
    const error = (await datalab
      .convertDocumentViaRelay({
        relayUrl: relay.url,
        signer: identity,
        bytes: PDF,
        fileName: 'a.pdf',
        pollIntervalMs: 20,
      })
      .catch((e: unknown) => e)) as datalab.ConvertRelayError
    expect(error).toBeInstanceOf(datalab.ConvertRelayError)
    expect(error.message).toBe('Could not parse the file')
    expect(hosted.db.query<{state: string}, []>(`SELECT state FROM conversion_usage`).all()).toEqual([
      {state: 'released'},
    ])

    // Hosted-side validation reaches the client with the hosted message.
    const bad = (await datalab
      .convertDocumentViaRelay({
        relayUrl: relay.url,
        signer: identity,
        bytes: new Uint8Array([1]),
        fileName: 'a.exe',
        pollIntervalMs: 20,
      })
      .catch((e: unknown) => e)) as datalab.ConvertRelayError
    expect(bad.status).toBe(400)
    expect(bad.message).toContain('Unsupported document type')
  })

  test('a hosted server without a key never relays further', async () => {
    const hosted = openService({relayUrl: 'http://127.0.0.1:1'})
    cleanups.push(hosted.close)
    const owner = blobs.generateNobleKeyPair()
    await expect(
      hosted.svc.message(
        await apisvc.createSignedEnvelope(owner, {action: {_: 'ConvertDocument', content: PDF, fileName: 'a.pdf'}}),
      ),
    ).rejects.toThrow('no Datalab key is configured')
  })

  test('an agent without a signing identity gets a clear error', async () => {
    const fake = startFakeDatalab()
    const hosted = openService({datalabApiKey: 'hosted-key', datalabBaseUrl: fake.baseUrl})
    const relay = serveHosted(hosted.svc)
    cleanups.push(fake.stop, hosted.close, relay.stop)
    const local = openService({relayUrl: relay.url})
    cleanups.push(local.close)
    const owner = blobs.generateNobleKeyPair()
    const send = async (action: Parameters<typeof apisvc.createSignedEnvelope>[1]['action']) =>
      local.svc.message(await apisvc.createSignedEnvelope(owner, {action}))
    await send({_: 'SetSecret', name: 'openai-key', value: new TextEncoder().encode('sk-test')})
    await send({_: 'SetModelProvider', name: 'openai', provider: {type: 'openai', secretRefs: {apiKey: 'openai-key'}}})
    const agent = await send({
      _: 'CreateAgent',
      definition: {
        name: 'Importer',
        systemPrompt: 'import',
        modelProvider: 'openai',
        model: 'gpt-test',
        tools: ['convert'],
      },
    })
    if (agent._ !== 'CreateAgentResponse') throw new Error('unexpected')
    const session = await send({_: 'CreateSession', agentId: agent.agentId})
    if (session._ !== 'CreateSessionResponse') throw new Error('unexpected')
    const stateDir = local.db
      .query<{state_dir: string}, [string]>(`SELECT state_dir FROM agents WHERE id = ?`)
      .get(agent.agentId)!.state_dir
    agentMemory.writeMemoryFile(stateDir, 'a.pdf', PDF)
    const invoked = await send({
      _: 'InvokeSessionTool',
      sessionId: session.sessionId,
      verb: 'call',
      input: {tool: 'convert', input: {files: ['a.pdf']}},
    })
    await local.svc.awaitQueueIdle()
    expect(invoked).toMatchObject({_: 'InvokeSessionToolResponse'})
    expect((invoked as {error?: string}).error).toContain('needs a signing identity')
    expect(fake.submissions).toHaveLength(0)
  })

  test('validateConvertDocument guards the boundary', () => {
    const ok = apisvc.validateConvertDocument({
      content: PDF,
      fileName: 'dir/../My Paper.PDF',
      maxPages: 3,
      pageRange: '0-2',
      mode: 'fast',
    })
    expect(ok).toMatchObject({
      fileName: 'My Paper.PDF',
      type: {ext: 'pdf'},
      maxPages: 3,
      pageRange: '0-2',
      mode: 'fast',
    })
    expect(() =>
      apisvc.validateConvertDocument(
        {content: new Uint8Array(2 * 1024 * 1024 + 1), fileName: 'a.png'},
        2 * 1024 * 1024,
      ),
    ).toThrow('2 MiB')
    expect(() => apisvc.validateConvertDocument({content: new Uint8Array([1]), fileName: 'a.pdf'})).toThrow('not a PDF')
    expect(() => apisvc.validateConvertDocument({content: PDF, fileName: 'a.pdf', mode: 'turbo'})).toThrow(
      'Invalid mode',
    )
    expect(() => apisvc.validateConvertDocument({content: PDF, fileName: 'a.pdf', maxPages: 0})).toThrow('maxPages')
    expect(() => apisvc.validateConvertDocument({content: PDF, fileName: 'a.pdf', pageRange: '1-'})).toThrow(
      'pageRange',
    )
    expect(() => apisvc.validateConvertDocument({content: new Uint8Array(), fileName: 'a.pdf'})).toThrow('required')
  })
})
