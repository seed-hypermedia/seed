import {afterEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {validate} from '@seed-hypermedia/client/schema-engine'
import {validateToolCode} from '@/tool-code'
import inputSchema from './convert.input.schema.json'
import outputSchema from './convert.output.schema.json'
import convert, {postprocessConvertedMarkdown, rewriteImageReferences} from './convert/index'

/**
 * The converter tool against a stand-in for the Datalab API: a local server that records what it
 * was sent and answers from a script. Every document here is written for the test.
 */

const KEY = 'test-datalab-key'
const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

type Submitted = {key: string | null; fields: Record<string, string>; fileName: string; fileText: string}

/** A fake Datalab: `checks` are the answers to successive status requests; the last one repeats. */
function datalab(options: {checks?: unknown[]; submitStatuses?: number[]} = {}) {
  const submitted: Submitted[] = []
  const checkKeys: (string | null)[] = []
  const submitStatuses = [...(options.submitStatuses ?? [])]
  const checks = [...(options.checks ?? [])]
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === 'POST' && url.pathname === '/api/v1/convert') {
        const status = submitStatuses.shift() ?? 200
        if (status !== 200) return Response.json({detail: 'refused'}, {status})
        const form = await request.formData()
        const file = form.get('file') as File
        const fields: Record<string, string> = {}
        for (const [name, value] of form.entries()) if (typeof value === 'string') fields[name] = value
        submitted.push({
          key: request.headers.get('X-API-Key'),
          fields,
          fileName: file.name,
          fileText: await file.text(),
        })
        return Response.json({success: true, request_id: 'r1', request_check_url: `${url.origin}/api/v1/convert/r1`})
      }
      if (request.method === 'GET' && url.pathname === '/api/v1/convert/r1') {
        checkKeys.push(request.headers.get('X-API-Key'))
        return Response.json(checks.length > 1 ? checks.shift() : checks[0] ?? {status: 'processing'})
      }
      return new Response('not found', {status: 404})
    },
  })
  cleanups.push(() => server.stop(true))
  return {baseUrl: `http://localhost:${server.port}/api/v1`, submitted, checkKeys}
}

/** A call's context, as the app environment hands it to the tool. */
function context(baseUrl: string, publicConfig: Record<string, unknown> = {}) {
  return {
    app: 'hm://z6MkSpace/converter',
    callId: 'call-1',
    publicConfig: {baseUrl, pollIntervalMs: 5, pollSeconds: 5, ...publicConfig},
    privateConfig: {datalabApiKey: KEY},
  }
}

type ToolFile = {name: string; mimeType: string; data: string}

/** A document as a caller sends it: a file inside the input's JSON. */
const file = (name: string, text = 'x'): ToolFile => ({
  name,
  mimeType: 'application/octet-stream',
  data: Buffer.from(text).toString('base64'),
})

const text = (sent: ToolFile) => Buffer.from(sent.data, 'base64').toString('utf8')

type Complete = {document: ToolFile; raw: ToolFile; manifest: ToolFile; assets: ToolFile[]}

const PDF = '%PDF-1.7 a paper written for this test'

const CONVERTED = {
  status: 'complete',
  success: true,
  page_count: 3,
  parse_quality_score: 4.5,
  total_cost: 1.2,
  images: {'_page_0_Figure_1.jpeg': Buffer.from('figure bytes').toString('base64')},
  markdown: [
    '# A Paper',
    '',
    'Earlier work [1] and [2, 3] is extended; see [Section 2](#page-1-0).',
    '',
    '![](_page_0_Figure_1.jpeg)',
    '',
    'Figure 1: The apparatus.',
    '',
    '$$E = mc^2$$',
    '',
    '## References',
    '',
    '- [1] First entry.',
    '- [2] Second entry.',
    '',
  ].join('\n'),
}

describe('convert tool', () => {
  test('its code is one file the app environment accepts as a tool', () => {
    const content = new Uint8Array(fs.readFileSync(path.join(import.meta.dir, 'convert/index.ts')))
    validateToolCode([{path: 'index.ts', content}])
    // The app environment loads index.ts alone, and the tool touches no file: it imports nothing.
    const imports = new Bun.Transpiler({loader: 'ts'}).scan(new TextDecoder().decode(content)).imports
    expect(imports).toEqual([])
  })

  test('a document is sent to Datalab and comes back as Markdown, figures and a manifest', async () => {
    const service = datalab({checks: [{status: 'processing'}, CONVERTED]})
    const result = (await convert(
      {file: file('paper.pdf', PDF), pageRange: '0-2'},
      context(service.baseUrl),
    )) as Complete

    expect(service.submitted).toHaveLength(1)
    const sent = service.submitted[0]!
    expect(sent.key).toBe(KEY)
    expect(sent.fileName).toBe('paper.pdf')
    expect(sent.fileText).toBe(PDF)
    expect(sent.fields).toEqual({
      output_format: 'markdown',
      mode: 'balanced',
      disable_image_captions: 'true',
      paginate: 'false',
      extras: 'extract_links,chart_understanding',
      max_pages: '200',
      page_range: '0-2',
    })
    expect(service.checkKeys).toEqual([KEY, KEY])

    expect(result).toMatchObject({
      status: 'complete',
      pages: 3,
      images: 1,
      truncated: false,
      parseQualityScore: 4.5,
      costCents: 1.2,
      captions: 1,
      citationsLinked: 2,
      citationsUnlinked: 1,
      markersRepaired: 0,
    })
    // Every converted file is in the result itself, each with its name and type.
    expect([result.document, result.raw, result.manifest, ...result.assets].map((f) => [f.name, f.mimeType])).toEqual([
      ['seed.md', 'text/markdown'],
      ['raw.md', 'text/markdown'],
      ['manifest.json', 'application/json'],
      ['assets/_page_0_Figure_1.jpeg', 'image/jpeg'],
    ])
    expect(text(result.raw)).toBe(CONVERTED.markdown)
    expect(text(result.assets[0]!)).toBe('figure bytes')
    const seed = text(result.document)
    // The figure points at its file and carries its caption; the caption paragraph is gone.
    expect(seed).toContain('![Figure 1: The apparatus.](assets/_page_0_Figure_1.jpeg)')
    expect(seed).not.toContain('\nFigure 1: The apparatus.\n')
    // Citations link to the entries they name, and only those; the PDF's own anchor is plain text.
    expect(seed).toContain('[[1](#ref-1)]')
    expect(seed).toContain('[[2](#ref-2), 3]')
    expect(seed).toContain('- [1] First entry. <!-- id:ref-1 -->')
    expect(seed).toContain('see Section 2.')
    // A one-line formula becomes a fenced block, the form the Seed parser reads.
    expect(seed).toContain('$$\nE = mc^2\n$$')
    expect(JSON.parse(text(result.manifest))).toMatchObject({
      fileName: 'paper.pdf',
      mode: 'balanced',
      pageRange: '0-2',
      maxPagesApplied: 200,
      pageCount: 3,
      citationsUnlinked: ['3'],
      images: [{file: '_page_0_Figure_1.jpeg', originalName: '_page_0_Figure_1.jpeg', bytes: 12}],
    })
    // The key reaches Datalab and nothing else.
    expect(JSON.stringify(result)).not.toContain(KEY)
    for (const f of [result.document, result.raw, result.manifest]) expect(text(f)).not.toContain(KEY)
  })

  test('a conversion that outlasts the call is collected by a second call', async () => {
    const service = datalab({checks: [{status: 'processing'}]})
    const started = await convert(
      {file: file('deck.pptx', 'slides')},
      context(service.baseUrl, {pollSeconds: 1, pollIntervalMs: 400}),
    )
    expect(started).toEqual({
      status: 'pending',
      summary: expect.any(String),
      job: `${service.baseUrl}/convert/r1`,
    })

    const finished = datalab({checks: [CONVERTED]})
    // The second call sends no file: the job is all it needs.
    const result = (await convert({job: `${finished.baseUrl}/convert/r1`}, context(finished.baseUrl))) as Complete
    expect(result).toMatchObject({status: 'complete', pages: 3})
    expect(finished.submitted).toEqual([])
    expect(text(result.document)).toContain('# A Paper')
    expect(JSON.parse(text(result.manifest))).toMatchObject({fileName: null, mode: null})
  })

  test('what the tool takes and returns matches its published schemas', async () => {
    const violations = (schema: unknown, value: unknown) => validate(schema as never, value, '$', {}, {})
    expect(violations(inputSchema, {file: file('a.pdf'), pageRange: '0-2', maxPages: 5, mode: 'fast'})).toEqual([])
    expect(violations(inputSchema, {job: 'https://www.datalab.to/api/v1/convert/r1'})).toEqual([])
    // A file is its three fields and nothing else.
    expect(violations(inputSchema, {file: {name: 'a.pdf', data: 'eA=='}})).not.toEqual([])
    // Datalab gave no score and no cost: the fields are left out rather than null.
    const {parse_quality_score, total_cost, ...unscored} = CONVERTED
    const complete = await convert({file: file('a.docx')}, context(datalab({checks: [unscored]}).baseUrl))
    expect(complete).not.toHaveProperty('costCents')
    expect(violations(outputSchema, complete)).toEqual([])
    const scored = await convert({file: file('a.docx')}, context(datalab({checks: [CONVERTED]}).baseUrl))
    expect(violations(outputSchema, scored)).toEqual([])
    const pending = await convert(
      {file: file('a.docx')},
      context(datalab().baseUrl, {pollSeconds: 1, pollIntervalMs: 400}),
    )
    expect(violations(outputSchema, pending)).toEqual([])
  })

  test('a job on another host is refused before the key is sent anywhere', async () => {
    const service = datalab({checks: [CONVERTED]})
    const ctx = context(service.baseUrl)
    await expect(convert({job: 'https://elsewhere.example/api/v1/convert/r1'}, ctx)).rejects.toThrow(
      'does not belong to this app’s conversion service',
    )
    await expect(convert({job: `http://localhost:1/api/v1/convert/r1`}, ctx)).rejects.toThrow('does not belong')
    await expect(convert({job: 'not a url'}, ctx)).rejects.toThrow('an earlier call returned')
    expect(service.checkKeys).toEqual([])
  })

  test('the app’s mode and page cap are ceilings a call can lower but not raise', async () => {
    const service = datalab({checks: [CONVERTED]})
    const config = {mode: 'balanced', maxPages: 50}
    const sent = async (input: Record<string, unknown>) => {
      await convert({file: file('notes.docx', 'text'), ...input}, context(service.baseUrl, config))
      const {mode, max_pages} = service.submitted.at(-1)!.fields
      return {mode, max_pages}
    }
    expect(await sent({mode: 'accurate', maxPages: 500})).toEqual({mode: 'balanced', max_pages: '50'})
    expect(await sent({mode: 'fast', maxPages: 10})).toEqual({mode: 'fast', max_pages: '10'})
    // A document as long as the cap may have been cut, and the result says so.
    expect(await convert({file: file('notes.docx', 'text')}, context(service.baseUrl, {maxPages: 3}))).toMatchObject({
      truncated: true,
    })
  })

  test('bad input is refused before anything is sent', async () => {
    const service = datalab()
    const refuses = (input: Record<string, unknown>) => expect(convert(input, context(service.baseUrl))).rejects
    await refuses({}).toThrow('Give file')
    await refuses({file: {name: 'a.pdf'}}).toThrow('Give file')
    await refuses({file: 'a.pdf'}).toThrow('Give file')
    await refuses({file: file('notes.txt')}).toThrow('Unsupported document type')
    await refuses({file: file('fake.pdf', 'plain text')}).toThrow('Not a PDF')
    await refuses({file: file('a.docx'), pageRange: 'first'}).toThrow('pageRange')
    await refuses({file: file('a.docx'), maxPages: 0}).toThrow('maxPages')
    await refuses({file: file('a.docx'), mode: 'best'}).toThrow('mode is one of')
    await expect(convert({file: file('a.docx')}, {...context(service.baseUrl), privateConfig: {}})).rejects.toThrow(
      'there is no Datalab key',
    )
    expect(service.submitted).toEqual([])
  })

  test('only the last part of a file’s name reaches Datalab', async () => {
    const service = datalab({checks: [CONVERTED]})
    await convert({file: file('inbox/2026/report.docx')}, context(service.baseUrl))
    expect(service.submitted[0]!.fileName).toBe('report.docx')
  })

  test('a rejected key and a failed conversion are reported without the key', async () => {
    const rejecting = datalab({submitStatuses: [401]})
    const rejected = await convert({file: file('a.docx')}, context(rejecting.baseUrl)).catch((error: Error) => error)
    expect(String(rejected)).toContain('rejected the API key')
    expect(String(rejected)).not.toContain(KEY)

    const failing = datalab({checks: [{status: 'complete', success: false, error: 'The file is encrypted'}]})
    await expect(convert({file: file('a.docx')}, context(failing.baseUrl))).rejects.toThrow('The file is encrypted')
  })

  test('a rate-limited submission is tried again', async () => {
    const service = datalab({submitStatuses: [429], checks: [CONVERTED]})
    const result = await convert({file: file('a.docx')}, context(service.baseUrl))
    expect(result).toMatchObject({status: 'complete'})
    expect(service.submitted).toHaveLength(1)
  })
})

describe('clean-up of converted Markdown', () => {
  test('markers left unpaired are repaired and each repair is listed', () => {
    const report = postprocessConvertedMarkdown(
      ['A **bold start with no end.', '', 'Text after.', '', '```', 'a fence that never closes'].join('\n'),
    )
    expect(report.markdown).toBe(
      ['A bold start with no end.', '', 'Text after.', '', 'a fence that never closes'].join('\n'),
    )
    expect(report.markersRepaired).toHaveLength(2)
    expect(report.markersRepaired.join('\n')).toContain('line 1: unpaired ** removed')
    expect(report.markersRepaired.join('\n')).toContain('line 5: code fence that never closes removed')
  })

  test('a formula left open is closed at the end of its paragraph', () => {
    const report = postprocessConvertedMarkdown(['$$a = b', '', 'Prose after the formula.'].join('\n'))
    expect(report.markdown).toBe(['$$', 'a = b', '$$', '', 'Prose after the formula.'].join('\n'))
    expect(report.markersRepaired).toEqual(['line 1: $$ block that never closes closed before line 2'])
  })

  test('author and year citations link to the entry with the same label', () => {
    const report = postprocessConvertedMarkdown(
      ['As shown [Rivera 1986] and [Okafor 2001].', '', '# Bibliography', '', '[Rivera 1986] A made-up entry.'].join(
        '\n',
      ),
    )
    expect(report.markdown).toContain('[[Rivera 1986](#ref-rivera-1986)]')
    expect(report.markdown).toContain('[Rivera 1986] A made-up entry. <!-- id:ref-rivera-1986 -->')
    expect(report.citationsUnlinked).toEqual(['okafor 2001'])
  })

  test('each resolved image gets a line of its own; unknown ones are listed and fenced code is left alone', () => {
    const rewritten = rewriteImageReferences(
      ['Text ![a](one.png) more ![b](https://example.com/two.png).', '', '```', '![c](one.png)', '```'].join('\n'),
      (ref) => (ref === 'one.png' ? 'assets/one.png' : undefined),
    )
    expect(rewritten.markdown).toBe(
      [
        'Text',
        '',
        '![a](assets/one.png)',
        '',
        'more ![b](https://example.com/two.png).',
        '',
        '```',
        '![c](one.png)',
        '```',
      ].join('\n'),
    )
    expect(rewritten).toMatchObject({rewritten: 1, unresolved: ['https://example.com/two.png']})
  })
})
