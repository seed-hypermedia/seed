import {afterEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as pages from '@/document-pages'
import * as memory from '@/agent-memory'
import * as hm from '@seed-hypermedia/client'

const directories: string[] = []
function state() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-document-page-test-'))
  directories.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, {recursive: true, force: true})
})

describe('document page folders', () => {
  test('collects a folder whole, skips dotfiles, and turns a single HTML file into index.html', () => {
    const dir = state()
    memory.writeMemoryFile(dir, 'pages/counter/index.html', '<script src="assets/page.js"></script>')
    memory.writeMemoryFile(dir, 'pages/counter/assets/page.js', 'console.log(1)')
    memory.writeMemoryFile(dir, 'pages/counter/assets/logo.png', new Uint8Array([137, 80, 78, 71]))
    memory.writeMemoryFile(dir, 'pages/counter/.notes.md', 'private')
    const folder = pages.collectDocumentPageFiles(dir, '~/memory/pages/counter/')
    expect(folder.files.map((file) => file.path).sort()).toEqual(['assets/logo.png', 'assets/page.js', 'index.html'])
    expect(folder.bytes).toBe(folder.files.reduce((sum, file) => sum + file.content.byteLength, 0))
    expect(Array.from(folder.files.find((file) => file.path === 'assets/logo.png')!.content)).toEqual([137, 80, 78, 71])

    memory.writeMemoryFile(dir, 'pages/single.html', '<h1>One</h1>')
    expect(pages.collectDocumentPageFiles(dir, '/workspace/pages/single.html')).toEqual({
      files: [{path: 'index.html', content: new TextEncoder().encode('<h1>One</h1>')}],
      bytes: 12,
    })
  })
  test('accepts folders and single HTML pages larger than 16 MiB', () => {
    const dir = state()
    const content = '<!doctype html>' + ' '.repeat(16 * 1024 * 1024)
    memory.writeMemoryFile(dir, 'pages/large/index.html', content)
    const folder = pages.collectDocumentPageFiles(dir, 'pages/large')
    const single = pages.collectDocumentPageFiles(dir, 'pages/large/index.html')
    expect(folder.bytes).toBe(content.length)
    expect(single.bytes).toBe(content.length)
    expect(folder.files).toHaveLength(1)
    expect(single.files).toHaveLength(1)
  })
  test('refuses folders without an index, non-HTML single files, and paths outside memory', () => {
    const dir = state()
    memory.writeMemoryFile(dir, 'pages/noindex/page.js', 'x')
    memory.writeMemoryFile(dir, 'pages/data.json', '{}')
    expect(() => pages.collectDocumentPageFiles(dir, 'pages/noindex')).toThrow('index.html')
    expect(() => pages.collectDocumentPageFiles(dir, 'pages/data.json')).toThrow('HTML')
    expect(() => pages.collectDocumentPageFiles(dir, '../outside')).toThrow()
    expect(() => pages.collectDocumentPageFiles(dir, 'pages/missing')).toThrow()
  })
})

describe('document page validation', () => {
  const bundle = (source: string) => [{path: 'index.html', content: new TextEncoder().encode(source)}]
  test('refuses the missing-brace failure before publication without running page code', () => {
    expect(() =>
      pages.validateDocumentPage(
        bundle(
          '<script>globalThis.DO_NOT_RUN = true; button.onclick = async () => { try { await fetch("x") } catch (e) {} );</script>',
        ),
      ),
    ).toThrow('syntax error')
    expect((globalThis as any).DO_NOT_RUN).toBeUndefined()
    const checked = pages.validateDocumentPage(
      bundle(
        '<script src="/.seed/client.js"></script><script>button.onclick = async () => { try { await seed.open("hm://alice/doc") } catch (e) {} };</script>',
      ),
    )
    expect(checked).toMatchObject({
      syntax: 'passed',
      scripts: 1,
      runtimeTested: false,
      interactionTested: false,
      localState: 'device-only',
      dataPersistenceTested: false,
    })
    expect(checked.sdk.methods).toContain('open')
  })
  test('makes runtime compatibility explicit, permitting bundled desktop assets only when requested', () => {
    const files = [
      ...bundle('<script src="page.js"></script>'),
      {path: 'page.js', content: new TextEncoder().encode('console.log(1)')},
    ]
    expect(() => pages.validateDocumentPage(files)).toThrow('external asset')
    expect(pages.validateDocumentPage(files, 'desktop').target).toBe('desktop')
    expect(() =>
      pages.validateDocumentPage(bundle('<script src="https://cdn.example/a.js"></script>'), 'desktop'),
    ).toThrow('unresolved')
    expect(() => pages.validateDocumentPage(bundle('<script type="module">import x from "./x.js"</script>'))).toThrow(
      'module',
    )
    expect(() => pages.validateDocumentPage(bundle('<style>@import "remote.css";</style>'))).toThrow('CSS')
    expect(() => pages.validateDocumentPage(bundle('<img src="logo.png">'))).toThrow('external asset')
    expect(() => pages.validateDocumentPage(bundle('<script>seed.context()</script>'))).toThrow('include')
    expect(
      pages.validateDocumentPage(bundle('<style>body {background:url("data:image/png;base64,AAA")}</style>')).syntax,
    ).toBe('passed')
    expect(pages.validateDocumentPage(bundle('<script>localStorage.getItem("x")</script>')).warnings[0]).toContain(
      'device only',
    )
  })
  test('warns about broker-local state without claiming it validates the page data layer', () => {
    const checked = pages.validateDocumentPage(
      bundle('<script src="/.seed/client.js"></script><script>seed.storage.set("tasks", [])</script>'),
    )
    expect(checked.warnings).toContain(
      'Local state is device only. Store durable page data in schema-bound Seed resources; reserve seed.storage for UI preferences or temporary unsaved drafts. Read ~/tools/write/pages. Static validation cannot verify persistence.',
    )
    expect(checked.dataPersistenceTested).toBe(false)
    const connected = pages.validateDocumentPage(
      bundle('<script src="/.seed/client.js"></script><script>seed.publishDocument({})</script>'),
    )
    expect(connected.dataPersistenceTested).toBe(false)
    expect(connected.writesDocuments).toBe(true)
    expect(connected.warnings).toEqual([])
  })
  test('identifies document writers through syntax, without treating comments or strings as writes', () => {
    expect(
      pages.validateDocumentPage(
        bundle(
          '<script src="/.seed/client.js"></script><script>/* seed.publishDocument({}) */ const text = "seed.publishDocument({})"</script>',
        ),
      ).writesDocuments,
    ).toBe(false)
    expect(
      pages.validateDocumentPage(
        bundle('<script src="/.seed/client.js"></script><script>window.seed["publishDocument"]({})</script>'),
      ).writesDocuments,
    ).toBe(true)
  })
})

describe('page data access preflight', () => {
  test('checks the user rather than the authoring agent, including child-path scope', async () => {
    const url = 'hm://author/pets'
    const root = {
      type: 'document',
      id: hm.unpackHmId(url),
      document: {
        path: '/pets',
        visibility: 'PRIVATE',
        metadata: {childAttributesSchema: 'hm://author/types/pet'},
      },
    }
    let capabilities: any[] = []
    const client = {
      request: async (key: string, input: any) => {
        if (key === 'Resource') return root
        expect(key).toBe('ListCapabilities')
        expect(input.targetId.path).toEqual(['pets', '_page_write_check'])
        return {capabilities}
      },
    } as Pick<hm.SeedClient, 'request'>
    const unavailable = await pages.checkDocumentPageData(client, [url], 'viewer')
    expect(unavailable.writeAccess).toBe('missing')
    expect(unavailable.missingAccess).toEqual([
      {
        collection: url,
        owner: 'author',
        delegate: 'viewer',
        role: 'WRITER',
        path: '/pets',
        canGrant: false,
      },
    ])
    const repair = await pages.checkDocumentPageData(client, [url], 'viewer', ['author'])
    expect(repair.missingAccess?.[0]).toMatchObject({
      canGrant: true,
      grant: {
        address: 'hm://author',
        options: {
          action: 'capability.grant',
          signer: {publicKey: 'author'},
          input: {delegate: 'viewer', role: 'WRITER', path: '/pets'},
        },
        dryRun: true,
      },
    })
    capabilities = [{id: 'cap', delegate: 'viewer', role: 'WRITER', path: '/pets', noRecursive: true}]
    expect((await pages.checkDocumentPageData(client, [url], 'viewer')).writeAccess).toBe('missing')
    capabilities[0].noRecursive = false
    expect(await pages.checkDocumentPageData(client, [url], 'viewer')).toEqual({
      viewer: 'viewer',
      writeAccess: 'passed',
      dataPersistenceTested: false,
      collections: [{url, schema: 'hm://author/types/pet', visibility: 'PRIVATE', capability: 'cap'}],
    })
    expect((await pages.checkDocumentPageData(client, [url], 'author')).writeAccess).toBe('passed')
    await expect(pages.checkDocumentPageData(client, [], 'viewer')).rejects.toThrow()
    await expect(pages.checkDocumentPageData(client, [url + '?v=old'], 'viewer')).rejects.toThrow('unversioned')
    root.document.metadata.childAttributesSchema = ''
    await expect(pages.checkDocumentPageData(client, [url], 'author')).rejects.toThrow('childAttributesSchema')
  })
})
