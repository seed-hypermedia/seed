import {describe, expect, test} from 'bun:test'
import * as datalab from '@/datalab'
import {startFakeDatalab} from '@/datalab-test-server'

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
