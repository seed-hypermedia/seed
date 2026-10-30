import {afterEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {buildLambdaProgram, LAMBDA_CONTEXT_ENV, parseLambdaResult} from '@/code-exec'
import {validateJsonSchemaShape, validateJsonSchemaValue} from '@/json-schema'
import type {JsonSchema} from '@seed-hypermedia/agents-protocol'
import {parseFrontmatter} from '@seed-hypermedia/client'

/**
 * The Datalab converter's tool page, read the way a mount reads it and run the way the sandbox runs
 * it: the page's `code` names the tool's file and `inputSchema` its contract, and the docs sync
 * publishes the files beside the page as the blobs those attributes reference. The page lives in
 * the repo's `hypermedia/` library, outside this workspace; its files are read here as fixtures by
 * path, not imported as modules.
 */

const TOOL_DIR = path.resolve(import.meta.dir, '../../hypermedia/agent/apps/convert/tools')
// The frontmatter is parsed the way the docs sync parses it when it publishes the page.
const page = parseFrontmatter(fs.readFileSync(path.join(TOOL_DIR, 'convert.md'), 'utf8'))
const metadata = page.metadata as Record<string, unknown>
const fileBeside = (attribute: string): string => {
  const value = metadata[attribute]
  if (typeof value !== 'string' || !value.startsWith('./'))
    throw new Error(`${attribute} must name a file beside the page`)
  return path.join(TOOL_DIR, value)
}
const input = JSON.parse(fs.readFileSync(fileBeside('inputSchema'), 'utf8')) as JsonSchema
const output = JSON.parse(fs.readFileSync(fileBeside('outputSchema'), 'utf8')) as JsonSchema
const source = fs.readFileSync(fileBeside('code'), 'utf8')

type Convert = (
  input: Record<string, unknown>,
  ctx: Record<string, unknown>,
) => Promise<{summary: string; documents: Record<string, unknown>[]; failures: {source: string; error: string}[]}>

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

/** The page's code as a module, written to a file the way the sandbox would hand it to bun. */
async function loadConvert(): Promise<Convert> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-page-'))
  cleanups.push(() => fs.rmSync(dir, {recursive: true, force: true}))
  const file = path.join(dir, 'convert.ts')
  fs.writeFileSync(file, source)
  return (await import(file)).default as Convert
}

const PDF = new TextEncoder().encode('%PDF-1.4 a small fake')

const PAPER = [
  '# A paper',
  '',
  'As shown in [1] and [2, 3], and \\[4\\]. See [Meyrowitz 1986]. Link [text](https://x.test/[1]).',
  '',
  'Compare [Langston 1988, Ogura & Robertson 1989].',
  '',
  '![](fig1.png)',
  '',
  'Figure 1: The setup.',
  '',
  'Inline ![alt](fig2.png) here.',
  '',
  '$$E = mc^2$$',
  '',
  '## References',
  '',
  '1. Smith 2001',
  '2. Doe 2002',
  '3. Roe 2003',
  '- [Meyrowitz 1986] Meyrowitz, N.',
  '- [Langston 1988]** Langston, D.',
  '- **[Ogura & Robertson 1989]** Ogura, A.',
  '',
].join('\n')

/** A stand-in for Datalab: submit, then complete on the first poll, with a page count bounded by max_pages. */
function fakeDatalab(options: {pages?: number; reject?: boolean; markdown?: string} = {}) {
  const requests: {mode?: string; maxPages?: number; pageRange?: string; extras?: string; fileName?: string}[] = []
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/convert' && req.method === 'POST') {
        if (options.reject || req.headers.get('x-api-key') !== 'k') return Response.json({error: 'no'}, {status: 401})
        const form = await req.formData()
        const maxPages = Number(form.get('max_pages'))
        requests.push({
          mode: String(form.get('mode')),
          maxPages,
          pageRange: form.get('page_range') === null ? undefined : String(form.get('page_range')),
          extras: form.get('extras') === null ? undefined : String(form.get('extras')),
          fileName: (form.get('file') as File | null)?.name,
        })
        return Response.json({
          success: true,
          request_id: `r${requests.length}`,
          request_check_url: `${url.origin}/check/${maxPages}`,
        })
      }
      if (url.pathname.startsWith('/check/')) {
        const maxPages = Number(url.pathname.slice('/check/'.length))
        return Response.json({
          status: 'complete',
          success: true,
          page_count: Math.min(options.pages ?? 3, maxPages),
          parse_quality_score: 4.5,
          total_cost: 12,
          markdown: options.markdown ?? PAPER,
          images: {
            'fig1.png': Buffer.from('png-1').toString('base64'),
            'fig2.png': Buffer.from('png-2').toString('base64'),
          },
        })
      }
      return new Response('nope', {status: 404})
    },
  })
  cleanups.push(() => server.stop(true))
  return {baseUrl: `http://127.0.0.1:${server.port}`, requests}
}

function workspace(files: Record<string, string | Uint8Array>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'convert-memory-'))
  cleanups.push(() => fs.rmSync(dir, {recursive: true, force: true}))
  for (const [rel, data] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), {recursive: true})
    fs.writeFileSync(path.join(dir, rel), data)
  }
  return dir
}

const read = (dir: string, rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8')

describe('the convert tool page', () => {
  test('declares its runtime and a sound contract, carries its code, and documents itself in the body', () => {
    expect(metadata).toMatchObject({
      attributesSchema: 'hm://hyper.media/agent/app-tool',
      tool: 'convert',
      runtime: 'ts',
      timeoutSecs: 1800,
    })
    expect(validateJsonSchemaShape(input)).toEqual([])
    expect(validateJsonSchemaShape(output)).toEqual([])
    expect(source).toContain('export default async function')
    expect(page.content).toContain('# Calling it')
    expect(page.content).not.toContain('export default')
    // The page's input contract is what the model is validated against; the code agrees with it.
    expect(validateJsonSchemaValue(input, {files: ['a.pdf'], max_pages: 2})).toEqual([])
    expect(validateJsonSchemaValue(input, {files: []})).not.toEqual([])
  })

  test('converts a PDF, writes the output tree, folds captions and links citations, and reports its pages', async () => {
    const convert = await loadConvert()
    const datalab = fakeDatalab()
    const dir = workspace({'incoming/paper.pdf': PDF, 'incoming/notes.txt': 'skip'})
    const result = await convert(
      {files: ['incoming']},
      {
        args: {apiKey: 'k', baseUrl: datalab.baseUrl, pollIntervalMs: 5, mode: 'balanced', extras: 'extract_links'},
        usage: {unit: 'pages', reserved: 120},
        app: {slug: 'convert', scope: 'server'},
        workspace: dir,
      },
    )
    expect(validateJsonSchemaValue(output, result)).toEqual([])
    expect(result).toMatchObject({
      documents: [
        {
          source: 'incoming/paper.pdf',
          outputDir: 'datalab-imports/paper',
          markdownPath: 'datalab-imports/paper/seed.md',
          pages: 3,
          images: 2,
          truncated: false,
          captions: 1,
          citationsLinked: 6,
          citationsUnlinked: 1,
          markersRepaired: 1,
        },
      ],
      failures: [],
      keySource: 'server',
      usage: {units: 3},
    })
    expect(result.summary).toContain('Converted 1 document into datalab-imports/')
    expect(result.summary).toContain(
      '1 caption attached to figures, 6 citations linked to the references, 1 citation without a reference entry left as text',
    )
    expect(result.summary).toContain('1 unsupported file skipped')
    expect(datalab.requests).toEqual([
      {mode: 'balanced', maxPages: 120, extras: 'extract_links', fileName: 'paper.pdf'},
    ])

    const seed = read(dir, 'datalab-imports/paper/seed.md')
    // `[4]` has no entry, so it stays as Datalab wrote it, escaped, and is counted as unlinked.
    expect(seed).toContain('[[1](#ref-1)] and [[2](#ref-2), [3](#ref-3)], and \\[4\\]')
    expect(seed).toContain('[[Meyrowitz 1986](#ref-meyrowitz-1986)]')
    // Datalab bolds entry labels and sometimes loses the opening marker; neither form hides an entry.
    expect(seed).toContain('[[Langston 1988](#ref-langston-1988), [Ogura & Robertson 1989](#ref-ogura-robertson-1989)]')
    expect(seed).toContain('[text](https://x.test/[1])')
    expect(seed).toContain('![Figure 1: The setup.](assets/fig1.png)')
    expect(seed).not.toContain('\nFigure 1: The setup.\n')
    expect(seed).toContain('\n![alt](assets/fig2.png)\n')
    expect(seed).toContain('$$\nE = mc^2\n$$')
    expect(seed).toContain('1. Smith 2001 <!-- id:ref-1 -->')
    expect(seed).toContain('- [Meyrowitz 1986] Meyrowitz, N. <!-- id:ref-meyrowitz-1986 -->')
    expect(seed).toContain('- [Langston 1988] Langston, D. <!-- id:ref-langston-1988 -->')
    expect(seed).toContain('- **[Ogura & Robertson 1989]** Ogura, A. <!-- id:ref-ogura-robertson-1989 -->')
    expect(read(dir, 'datalab-imports/paper/raw.md')).toBe(PAPER)
    expect(read(dir, 'datalab-imports/paper/assets/fig1.png')).toBe('png-1')
    const manifest = JSON.parse(read(dir, 'datalab-imports/paper/manifest.json')) as Record<string, unknown>
    expect(manifest).toMatchObject({
      source: 'incoming/paper.pdf',
      keySource: 'server',
      mode: 'balanced',
      pageCount: 3,
      maxPagesApplied: 120,
      truncated: false,
      captionsFolded: 1,
      referenceEntries: 6,
      citationsLinked: 6,
      citationsUnlinked: ['4'],
      // The Langston entry's stray bold closer, the artifact of 2026-10-27, is repaired and named.
      markersRepaired: ['line 25: unpaired ** removed from "- [Langston 1988] Langston, D."'],
      imagesRewritten: 2,
      images: [
        {file: 'fig1.png', originalName: 'fig1.png', bytes: 5},
        {file: 'fig2.png', originalName: 'fig2.png', bytes: 5},
      ],
    })
  })

  test("the call's page budget bounds every document, and a document past it is a failure, not a charge", async () => {
    const convert = await loadConvert()
    const datalab = fakeDatalab({pages: 50})
    const dir = workspace({'a.pdf': PDF, 'b.pdf': PDF, 'c.pdf': PDF})
    const result = await convert(
      {files: ['a.pdf', 'b.pdf', 'c.pdf'], max_pages: 30},
      {
        args: {apiKey: 'k', baseUrl: datalab.baseUrl, pollIntervalMs: 5},
        usage: {unit: 'pages', reserved: 40},
        app: {slug: 'convert', scope: 'server'},
        workspace: dir,
      },
    )
    // 30 for the first (max_pages), the 10 left for the second, nothing for the third.
    expect(datalab.requests.map((request) => request.maxPages).sort()).toEqual([10, 30])
    expect(result.documents.map((doc) => [doc.source, doc.pages, doc.truncated])).toEqual([
      ['a.pdf', 30, true],
      ['b.pdf', 10, true],
    ])
    expect(result.failures).toEqual([{source: 'c.pdf', error: expect.stringContaining('No shared pages left')}])
    expect(result).toMatchObject({usage: {units: 40}})
    expect(JSON.parse(read(dir, 'datalab-imports/a/manifest.json')).truncationReason).toBe('max_pages input')
    expect(JSON.parse(read(dir, 'datalab-imports/b/manifest.json')).truncationReason).toBe(
      'shared pages remaining this month',
    )
    expect(result.summary).toContain('2 cut at the page cap')
  })

  test("a space's own key is unmetered and runs any mode; the shared key lowers a mode above the mount's", async () => {
    const convert = await loadConvert()
    const datalab = fakeDatalab()
    const dir = workspace({'a.pdf': PDF, 'b.pdf': PDF})
    const own = await convert(
      {files: ['a.pdf'], mode: 'accurate'},
      {
        args: {apiKey: 'k', baseUrl: datalab.baseUrl, pollIntervalMs: 5, mode: 'fast'},
        app: {slug: 'convert', scope: 'space'},
        workspace: dir,
      },
    )
    expect(own).toMatchObject({keySource: 'own'})
    expect(own).not.toHaveProperty('usage')
    expect(datalab.requests[0]).toMatchObject({mode: 'accurate', maxPages: 200})
    const shared = await convert(
      {files: ['b.pdf'], mode: 'accurate'},
      {
        args: {apiKey: 'k', baseUrl: datalab.baseUrl, pollIntervalMs: 5, mode: 'fast'},
        usage: {unit: 'pages', reserved: 200},
        app: {slug: 'convert', scope: 'server'},
        workspace: dir,
      },
    )
    expect(datalab.requests[1]).toMatchObject({mode: 'fast'})
    expect(shared.summary).toContain('mode lowered to fast on the shared key')
  })

  test('bad input is answered up front, bad files land in failures, and overwrite is explicit', async () => {
    const convert = await loadConvert()
    const datalab = fakeDatalab()
    const dir = workspace({'a.pdf': PDF, 'fake.pdf': 'not a pdf', 'page.html': '<p>hi</p>'})
    const ctx = {
      args: {apiKey: 'k', baseUrl: datalab.baseUrl, pollIntervalMs: 5},
      app: {slug: 'convert', scope: 'space'},
      workspace: dir,
    }
    await expect(convert({files: ['*.pdf']}, ctx)).rejects.toThrow('Globs are not expanded')
    await expect(convert({files: ['a.pdf'], page_range: '1-'}, ctx)).rejects.toThrow('page_range must look like')
    await expect(convert({files: ['../outside.pdf']}, ctx)).rejects.toThrow('outside memory')
    await expect(convert({files: ['a.pdf'], output_dir: '.'}, ctx)).rejects.toThrow(
      'output_dir cannot be the memory root',
    )
    const first = await convert({files: ['a.pdf', 'fake.pdf', 'missing.pdf', 'page.html'], page_range: '0-2'}, ctx)
    expect(first.documents.map((doc) => doc.source)).toEqual(['a.pdf', 'page.html'])
    // A path that is not there is answered while the list is read; a file that is not what its
    // name says, once it is.
    expect(first.failures).toEqual([
      {source: 'missing.pdf', error: 'Not found in memory'},
      {source: 'fake.pdf', error: 'Not a PDF (no %PDF- header)'},
    ])
    expect(datalab.requests[0]).toMatchObject({pageRange: '0-2'})
    const again = await convert({files: ['a.pdf']}, ctx)
    expect(again.failures).toEqual([
      {source: 'a.pdf', error: 'Output datalab-imports/a/ already exists; pass overwrite: true to replace it'},
    ])
    expect(datalab.requests).toHaveLength(2)
    const replaced = await convert({files: ['a.pdf'], overwrite: true}, ctx)
    expect(replaced.documents).toHaveLength(1)
  })

  test('a rejected key stops the batch with a configuration error that names who can fix it', async () => {
    const convert = await loadConvert()
    const datalab = fakeDatalab({reject: true})
    const dir = workspace({'a.pdf': PDF})
    await expect(
      convert(
        {files: ['a.pdf']},
        {
          args: {apiKey: 'k', baseUrl: datalab.baseUrl, pollIntervalMs: 5},
          app: {slug: 'convert', scope: 'space'},
          workspace: dir,
        },
      ),
    ).rejects.toThrow('Datalab rejected the mounted key; replace it from the Apps dialog')
    await expect(
      convert(
        {files: ['a.pdf']},
        {
          args: {apiKey: 'k', baseUrl: datalab.baseUrl, pollIntervalMs: 5},
          usage: {unit: 'pages', reserved: 10},
          app: {slug: 'convert', scope: 'server'},
          workspace: dir,
        },
      ),
    ).rejects.toThrow('Datalab rejected this server’s key; tell the operator')
    await expect(
      convert({files: ['a.pdf']}, {args: {}, app: {slug: 'convert', scope: 'space'}, workspace: dir}),
    ).rejects.toThrow('mounted without a Datalab key')
  })

  test('runs under bun through the lambda wrapper with the context from the environment, as the sandbox runs it', async () => {
    const datalab = fakeDatalab()
    const dir = workspace({'a.pdf': PDF})
    const context = {
      args: {apiKey: 'k', baseUrl: datalab.baseUrl, pollIntervalMs: 5},
      usage: {unit: 'pages', reserved: 7},
      app: {slug: 'convert', scope: 'server'},
      workspace: dir,
    }
    // Spawned, not spawnSync: the fake Datalab lives in this process, which must stay free to answer.
    const run = Bun.spawn(['bun', '-e', buildLambdaProgram('ts', source, {files: ['a.pdf']})], {
      env: {...process.env, [LAMBDA_CONTEXT_ENV]: JSON.stringify(context)},
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(run.stdout).text(),
      new Response(run.stderr).text(),
      run.exited,
    ])
    expect({exitCode, stderr}).toMatchObject({exitCode: 0})
    const parsed = parseLambdaResult(stdout)
    expect(parsed.result).toMatchObject({documents: [{source: 'a.pdf', pages: 3}], usage: {units: 3}})
    // Progress goes to stderr, where the sandbox's output tail shows it live.
    expect(stderr).toContain('Converting a.pdf (1/1)')
    expect(fs.existsSync(path.join(dir, 'datalab-imports/a/seed.md'))).toBe(true)
  })
})
