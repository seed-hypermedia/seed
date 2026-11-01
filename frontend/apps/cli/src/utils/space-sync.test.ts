import {describe, expect, test} from 'bun:test'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {
  blocksToMarkdown,
  directoryToIpfsBlobs,
  fileToIpfsBlobs,
  markdownBlockNodesToHMBlockNodes,
  parseMarkdown,
} from '@seed-hypermedia/client'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {
  applySchemaMetadata,
  encodeSchemaBlob,
  exportDocument,
  findMovedFrom,
  importSpace,
  listMarkdownFiles,
  markdownEquivalent,
  metadataDiffOp,
  missingAttributeAssets,
  readAttributeAssets,
  restoreAttributeAssets,
  swapAuthority,
} from './space-sync'

function documentFromMarkdown(source: string): HMDocument {
  const {tree, metadata} = parseMarkdown(source)
  return {account: 'z6MkTest', path: '', metadata, content: markdownBlockNodesToHMBlockNodes(tree)} as HMDocument
}

describe('dev export preserves source (PR #1272)', () => {
  const source =
    '---\nsummary: A test page.\nname: Example\n---\n\n## Heading\n\nA soft-wrapped\nparagraph with *emphasis*.\n\n- one\n- two\n\n| Name | Value |\n| --- | --- |\n| a | b |\n'

  test('startup and repeated exports leave handwritten source byte-for-byte intact', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sync-source-'))
    try {
      const file = join(dir, 'index.md')
      writeFileSync(file, source)
      const doc = documentFromMarkdown(source)
      expect(blocksToMarkdown(doc)).not.toBe(source)
      const opts = {dir, client: {} as any, preserveSource: true}
      for (let i = 0; i < 2; i++) {
        expect((await exportDocument(opts, doc)).written).toEqual([])
        expect(readFileSync(file, 'utf8')).toBe(source)
      }
      // A real edit made in the app still reaches disk.
      const heading = doc.content![0]!.block
      if (heading.type !== 'Heading') throw new Error('fixture must start with a heading')
      heading.text = 'Changed heading'
      expect((await exportDocument(opts, doc)).written).toEqual(['index.md'])
      expect(readFileSync(file, 'utf8')).toContain('Changed heading')
      expect((await exportDocument(opts, doc)).written).toEqual([])
      // An explicit export retains its canonical serialization behavior.
      writeFileSync(file, source)
      expect((await exportDocument({dir, client: {} as any}, documentFromMarkdown(source))).written).toEqual([
        'index.md',
      ])
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  test('existing comments mixed with new blocks do not cause serialization churn', async () => {
    const partial = '# Heading <!-- id:heading -->\n\nExisting. <!-- id:existing -->\n\nNew paragraph.\n'
    const doc = documentFromMarkdown(partial)
    expect(markdownEquivalent(partial, blocksToMarkdown(doc))).toBe(true)
    const dir = mkdtempSync(join(tmpdir(), 'sync-partial-ids-'))
    try {
      writeFileSync(join(dir, 'index.md'), partial)
      const {importSpace} = await import('./space-sync')
      const client = {request: async () => ({type: 'document', document: doc})} as any
      for (let i = 0; i < 2; i++) {
        const result = await importSpace({client, signer: {} as any, account: doc.account, dir, dryRun: true})
        expect(result.unchanged).toEqual(['index.md'])
        expect(result.updated).toEqual([])
      }
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  test('content, metadata, structure, annotations and explicit identities remain meaningful', () => {
    const original = '# Heading <!-- id:heading -->\n\nText. <!-- id:paragraph -->\n'
    for (const changed of [
      original.replace('Text.', 'Edited.'),
      original.replace('Text.', '**Text.**'),
      original.replace('id:paragraph', 'id:replacement'),
      original.replace('Text. <!-- id:paragraph -->', 'New.\n\nText. <!-- id:paragraph -->'),
      original + '\nNew paragraph.\n',
      original.replace('Text.', '## Text.'),
      '---\nname: New name\n---\n' + original,
    ])
      expect(markdownEquivalent(original, blocksToMarkdown(documentFromMarkdown(changed)))).toBe(false)
  })

  test('does not hide the extra list container found in PR #1272 apps.md', () => {
    const original = '# See also <!-- id:heading -->\n\n- Link <!-- id:item -->\n'
    const wrapped = original.replace('- Link', '<!-- id:container -->\n- Link')
    expect(markdownEquivalent(original, wrapped)).toBe(false)
  })

  test('the checked-in documentation survives the initial export without cleanup diffs', () => {
    const dir = resolve(import.meta.dir, '../../../../../hypermedia')
    const files = listMarkdownFiles(dir).filter((f) => f !== 'README.md')
    expect(files.length).toBeGreaterThan(250)
    const changed = files.filter((file) => {
      const source = readFileSync(join(dir, file), 'utf8')
      return !markdownEquivalent(source, blocksToMarkdown(documentFromMarkdown(source), {ipfsGateway: false}))
    })
    expect(changed).toEqual([])
  }, 30_000)
})

describe('findMovedFrom', () => {
  const byBlock = new Map<string, string>([
    ['a1', '/foo'],
    ['a2', '/foo'],
    ['a3', '/foo'],
    ['b1', '/bar'],
  ])

  test('a file whose ids all belong to one document is that document, moved', () => {
    expect(findMovedFrom(byBlock, ['a1', 'a2', 'a3'])).toBe('/foo')
  })

  test('a majority of known ids is enough (edits add new blocks)', () => {
    expect(findMovedFrom(byBlock, ['a1', 'a2', 'new1', 'new2'])).toBeNull()
    expect(findMovedFrom(byBlock, ['a1', 'a2', 'a3', 'new1', 'new2'])).toBe('/foo')
  })

  test('ids from several documents pick the dominant one', () => {
    expect(findMovedFrom(byBlock, ['a1', 'a2', 'b1'])).toBe('/foo')
  })

  test('unknown ids mean a new document', () => {
    expect(findMovedFrom(byBlock, ['x1', 'x2'])).toBeNull()
    expect(findMovedFrom(byBlock, [])).toBeNull()
  })

  test('the home document has the empty path', () => {
    expect(findMovedFrom(new Map([['h1', '']]), ['h1'])).toBe('')
  })
})

describe('metadataDiffOp', () => {
  test('no change yields no op', () => {
    expect(
      metadataDiffOp({name: 'A', theme: {headerLayout: 'Center'}}, {name: 'A', theme: {headerLayout: 'Center'}}),
    ).toBeNull()
  })

  test('changed, added and removed leaves', () => {
    const op = metadataDiffOp(
      {name: 'A', summary: 'old', theme: {headerLayout: 'Center'}},
      {name: 'B', icon: 'ipfs://x'},
    )
    expect(op).toEqual({
      type: 'SetAttributes',
      attrs: [
        {key: ['name'], value: 'B'},
        {key: ['icon'], value: 'ipfs://x'},
        {key: ['summary'], value: null},
        {key: ['theme', 'headerLayout'], value: null},
      ],
    })
  })

  test('the home document keeps the keys the directory never names, and drops one named with a null', () => {
    // The desktop stores the space's agents server and its published agents in the home document;
    // a full import of the docs wiped both, unbinding the space from its server.
    const published = {name: 'Docs', agentServerUrl: 'http://localhost:3051', spaceAgents: {a: {id: 'x'}}}
    expect(metadataDiffOp(published, {name: 'Docs'}, {keepUnlisted: true})).toBeNull()
    expect(
      metadataDiffOp(published, {name: 'Docs', summary: 'New', agentServerUrl: null}, {keepUnlisted: true}),
    ).toEqual({
      type: 'SetAttributes',
      attrs: [
        {key: ['summary'], value: 'New'},
        {key: ['agentServerUrl'], value: null},
      ],
    })
  })
})

describe('importSpace file links', () => {
  test('resolves relative asset links against the page folder, not the working directory', async () => {
    const {mkdtempSync, mkdirSync, writeFileSync, rmSync} = await import('node:fs')
    const {tmpdir} = await import('node:os')
    const {join} = await import('node:path')
    const {importSpace} = await import('./space-sync')
    const dir = mkdtempSync(join(tmpdir(), 'space-sync-assets-'))
    const elsewhere = mkdtempSync(join(tmpdir(), 'space-sync-cwd-'))
    const cwd = process.cwd()
    try {
      mkdirSync(join(dir, 'assets'))
      mkdirSync(join(dir, 'guides'))
      writeFileSync(join(dir, 'assets', 'pic.png'), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))
      writeFileSync(join(dir, 'guides', 'intro.md'), '# Intro\n\n![A picture](../assets/pic.png)\n')
      process.chdir(elsewhere)
      const client = {request: async () => ({type: 'not-found'})} as any
      const result = await importSpace({client, signer: {} as any, account: 'z6MkTest', dir, dryRun: true})
      expect(result.created).toContain('guides/intro.md')
    } finally {
      process.chdir(cwd)
      rmSync(dir, {recursive: true, force: true})
      rmSync(elsewhere, {recursive: true, force: true})
    }
  })
})

describe('applySchemaMetadata', () => {
  const TYPE = 'hm://hyper.media/example/employee'

  test('a document carrying the old `schema` key loses it on import', () => {
    const out = applySchemaMetadata({name: 'Person', schema: TYPE} as any, {
      kind: 'type',
      cid: 'bafyabc',
      data: new Uint8Array(),
    })
    expect(out).toEqual({name: 'Person', schemaDefinition: 'ipfs://bafyabc'} as any)
  })

  test('a type file points schemaDefinition at its blob', () => {
    expect(applySchemaMetadata({name: 'Person'}, {kind: 'type', cid: 'bafyabc', data: new Uint8Array()})).toEqual({
      name: 'Person',
      schemaDefinition: 'ipfs://bafyabc',
    } as any)
  })

  test('the next import nulls the dropped `schema` attribute on the published document', () => {
    const published = {name: 'Bob', schema: TYPE, attributesSchema: TYPE}
    const next = applySchemaMetadata(published as any, null)
    expect(metadataDiffOp(published, next as any)).toEqual({
      type: 'SetAttributes',
      attrs: [{key: ['schema'], value: null}],
    })
  })
})

describe('swapAuthority', () => {
  const KEY = 'z6MkSpaceKeyForTests'

  test('rewrites the authority of an hm:// string', () => {
    expect(swapAuthority('hm://hyper.media/example/person', 'hyper.media', KEY)).toBe(`hm://${KEY}/example/person`)
    expect(swapAuthority('hm://hyper.media', 'hyper.media', KEY)).toBe(`hm://${KEY}`)
    expect(swapAuthority('hm://hyper.media?v=1', 'hyper.media', KEY)).toBe(`hm://${KEY}?v=1`)
    expect(swapAuthority('hm://hyper.media#blk', 'hyper.media', KEY)).toBe(`hm://${KEY}#blk`)
  })

  test('and back again', () => {
    expect(swapAuthority(`hm://${KEY}/protocol/documents`, KEY, 'hyper.media')).toBe(
      'hm://hyper.media/protocol/documents',
    )
  })

  test('rewrites strings nested in maps and lists, leaving other values alone', () => {
    const bytes = new Uint8Array([1, 2, 3])
    const value = {
      name: 'Person',
      attributesSchema: 'hm://hyper.media/example/person-doc',
      count: 3,
      flag: true,
      nothing: null,
      bytes,
      nav: [{link: 'hm://hyper.media/a'}, 'hm://hyper.media/b', 'plain text'],
    }
    expect(swapAuthority(value, 'hyper.media', KEY)).toEqual({
      name: 'Person',
      attributesSchema: `hm://${KEY}/example/person-doc`,
      count: 3,
      flag: true,
      nothing: null,
      bytes,
      nav: [{link: `hm://${KEY}/a`}, `hm://${KEY}/b`, 'plain text'],
    })
  })

  test('only a whole matching authority is rewritten', () => {
    for (const other of [
      'hm://hyper.media.evil/x',
      'hm://hyper.mediax/x',
      'hm://seed.hyper.media/x',
      'hm://hyperxmedia/x', // the dot is literal, not a regex wildcard
      'https://hyper.media/x',
      'see hm://hyper.media/x',
    ]) {
      expect(swapAuthority(other, 'hyper.media', KEY)).toBe(other)
    }
  })
})

describe('attribute assets', () => {
  const text = (value: string) => new TextEncoder().encode(value)
  const unpadded = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64').replace(/=+$/, '')
  /** A page beside a code file, a schema object and a folder, the way the converter's tool page is laid out. */
  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'sync-assets-'))
    mkdirSync(join(dir, 'tools', 'bundle', 'lib'), {recursive: true})
    writeFileSync(join(dir, 'tools', 'tool.ts'), 'export default () => 1')
    writeFileSync(join(dir, 'tools', 'tool.input.json'), '{"type": "object", "required": ["a"]}\n')
    writeFileSync(join(dir, 'tools', 'bundle', 'index.ts'), 'index')
    writeFileSync(join(dir, 'tools', 'bundle', 'lib', 'x.ts'), 'x')
    writeFileSync(join(dir, 'tools', 'bundle', '.hidden'), 'left out')
    return dir
  }
  const folderFiles = [
    {path: 'index.ts', content: text('index')},
    {path: 'lib/x.ts', content: text('x')},
  ]

  test('import publishes the files a frontmatter names and references them by CID', async () => {
    const dir = fixture()
    try {
      const metadata = {
        name: 'tool',
        code: './tool.ts',
        inputSchema: './tool.input.json',
        nested: {bundle: './bundle'},
        summary: './not-a-file',
      }
      const {metadata: out, blobs} = await readAttributeAssets(dir, 'tools/tool.md', metadata as any)
      const file = await fileToIpfsBlobs(text('export default () => 1'))
      const object = await encodeSchemaBlob({type: 'object', required: ['a']})
      const folder = await directoryToIpfsBlobs(folderFiles)
      expect(out).toEqual({
        name: 'tool',
        code: `ipfs://${file.cid}`,
        inputSchema: `ipfs://${object.cid}`,
        nested: {bundle: `ipfs://${folder.cid}`},
        summary: './not-a-file',
      } as any)
      // Every block of every asset rides with the change; the hidden file is no part of the folder.
      const cids = new Set(blobs.map((blob) => blob.cid))
      for (const blob of [...file.blobs, ...folder.blobs]) expect(cids.has(blob.cid)).toBe(true)
      expect(cids.has(object.cid)).toBe(true)
      // A folder's CID is a function of its files, whatever order they are listed in.
      expect(folder.cid).toBe((await directoryToIpfsBlobs([...folderFiles].reverse())).cid)
      // A path that names nothing is reported, and stops the import like a broken link.
      expect(missingAttributeAssets(dir, 'tools/tool.md', metadata as any)).toEqual([
        {file: 'tools/tool.md', link: './not-a-file', reason: 'summary names no file beside the page'},
      ])
      writeFileSync(join(dir, 'tools', 'tool.md'), '---\nname: tool\ncode: ./missing.ts\n---\nBody.\n')
      const client = {request: async () => ({type: 'not-found'})} as any
      await expect(importSpace({client, signer: {} as any, account: 'z6MkTest', dir, dryRun: true})).rejects.toThrow(
        'names no file beside the page',
      )
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  test('export keeps the path when the file encodes to the published CID, and writes the blob back when not', async () => {
    const dir = fixture()
    try {
      writeFileSync(
        join(dir, 'tools', 'tool.md'),
        '---\nname: tool\ncode: ./tool.ts\ninput: ./tool.input.json\nbundle: ./bundle\n---\nBody.\n',
      )
      const same = {
        code: (await fileToIpfsBlobs(text('export default () => 1'))).cid,
        input: (await encodeSchemaBlob({type: 'object', required: ['a']})).cid,
        bundle: (await directoryToIpfsBlobs(folderFiles)).cid,
      }
      // What the app published since: new code, a new object, a folder with one file gone and one added.
      const code2 = await fileToIpfsBlobs(text('export default () => 2'))
      const index2 = await fileToIpfsBlobs(text('index 2'))
      const y = await fileToIpfsBlobs(text('y'))
      const input2 = await encodeSchemaBlob({type: 'object', required: ['b']})
      const bundle2 = await directoryToIpfsBlobs([
        {path: 'index.ts', content: text('index 2')},
        {path: 'y.ts', content: text('y')},
      ])
      const served: Record<string, unknown> = {
        [code2.cid]: {'/': {bytes: unpadded(text('export default () => 2'))}},
        [index2.cid]: {'/': {bytes: unpadded(text('index 2'))}},
        [y.cid]: {'/': {bytes: unpadded(text('y'))}},
        [input2.cid]: {type: 'object', required: ['b']},
        [bundle2.cid]: {
          Data: {'/': {bytes: 'CAE'}},
          Links: [
            {Hash: {'/': index2.cid}, Name: 'index.ts', Tsize: 7},
            {Hash: {'/': y.cid}, Name: 'y.ts', Tsize: 1},
          ],
        },
      }
      const requested: string[] = []
      const client = {
        request: async (name: string, input: {cid: string}) => {
          requested.push(input.cid)
          if (name !== 'GetCID' || !(input.cid in served)) throw new Error(`no stand-in for ${name} ${input.cid}`)
          return {value: served[input.cid]}
        },
      } as any

      const kept = await restoreAttributeAssets(client, dir, 'tools/tool.md', {
        name: 'tool',
        code: `ipfs://${same.code}`,
        input: `ipfs://${same.input}`,
        bundle: `ipfs://${same.bundle}`,
      } as any)
      expect(kept.metadata).toEqual({
        name: 'tool',
        code: './tool.ts',
        input: './tool.input.json',
        bundle: './bundle',
      } as any)
      expect(kept.written).toEqual([])
      expect(kept.unchanged.sort()).toEqual(['tools/bundle', 'tools/tool.input.json', 'tools/tool.ts'])
      expect(requested).toEqual([])

      const changed = await restoreAttributeAssets(client, dir, 'tools/tool.md', {
        name: 'tool',
        code: `ipfs://${code2.cid}`,
        input: `ipfs://${input2.cid}`,
        bundle: `ipfs://${bundle2.cid}`,
      } as any)
      expect(changed.metadata).toEqual({
        name: 'tool',
        code: './tool.ts',
        input: './tool.input.json',
        bundle: './bundle',
      } as any)
      expect(changed.written.sort()).toEqual(['tools/bundle', 'tools/tool.input.json', 'tools/tool.ts'])
      expect(readFileSync(join(dir, 'tools', 'tool.ts'), 'utf8')).toBe('export default () => 2')
      expect(JSON.parse(readFileSync(join(dir, 'tools', 'tool.input.json'), 'utf8'))).toEqual({
        type: 'object',
        required: ['b'],
      })
      expect(readFileSync(join(dir, 'tools', 'bundle', 'index.ts'), 'utf8')).toBe('index 2')
      expect(readFileSync(join(dir, 'tools', 'bundle', 'y.ts'), 'utf8')).toBe('y')
      expect(existsSync(join(dir, 'tools', 'bundle', 'lib'))).toBe(false)
      expect(existsSync(join(dir, 'tools', 'bundle', '.hidden'))).toBe(true)
      // The files now encode to what was published: a second export writes nothing.
      expect((await restoreAttributeAssets(client, dir, 'tools/tool.md', changed.metadata)).written).toEqual([])

      // Through exportDocument, the page on disk names its files, never the CIDs.
      const doc = documentFromMarkdown('---\nname: tool\n---\nBody.\n')
      doc.path = '/tools/tool'
      doc.metadata = {
        name: 'tool',
        code: `ipfs://${code2.cid}`,
        input: `ipfs://${input2.cid}`,
        bundle: `ipfs://${bundle2.cid}`,
      } as any
      const result = await exportDocument({dir, client, preserveSource: true}, doc)
      expect(result.written).toEqual([])
      const page = readFileSync(join(dir, 'tools', 'tool.md'), 'utf8')
      expect(page).toContain('code: ./tool.ts')
      expect(page).not.toContain('ipfs://')
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })
})
