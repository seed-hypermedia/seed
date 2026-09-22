/**
 * `space archive` / `space restore` against two real stacks (daemon + web server each, on
 * separate testnets so they never sync): build a space on A with history, a file, a move and
 * a comment, archive it, and restore it on B.
 *
 * Run: bun test src/test/space-archive.test.ts
 */
import {afterAll, beforeAll, describe, expect, test} from 'bun:test'
import {createComment, createSeedClient, type SeedClient} from '@seed-hypermedia/client'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {unzipSync} from 'fflate'
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSignerFromKey} from '../utils/signer'
import {importSpace} from '../utils/space-sync'
import type {ArchiveManifest} from '../utils/space-archive'
import {generateTestAccount, registerAccount, type TestAccount} from './account-helpers'
import {runCli, startFullIntegrationWithFixture, type FullTestContext} from './setup'

const TIMEOUT = 240000

// A real 1x1 PNG, so the archive has a file to carry.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

// Big enough to be chunked into a UnixFS DAG (a dag-pb root over raw leaves).
const BIG_PNG = Buffer.concat([PNG, Buffer.from(Array.from({length: 700_000}, (_, i) => (i * 7919) % 251))])

let a: FullTestContext
let b: FullTestContext
let work: string
let account: TestAccount
let clientA: SeedClient
let clientB: SeedClient

function readManifest(zip: string): {manifest: ArchiveManifest; entries: Record<string, Uint8Array>} {
  const entries = unzipSync(new Uint8Array(readFileSync(zip)))
  return {manifest: JSON.parse(new TextDecoder().decode(entries['manifest.json'])), entries}
}

async function resource(client: SeedClient, path: string) {
  return client.request('Resource', hmId(account.accountId, {path: path ? path.split('/') : []}))
}

describe('space archive', () => {
  beforeAll(async () => {
    ;[a, b] = await Promise.all([startFullIntegrationWithFixture(), startFullIntegrationWithFixture()])
    clientA = createSeedClient(a.webServerUrl)
    clientB = createSeedClient(b.webServerUrl)
    work = mkdtempSync(join(tmpdir(), 'seed-archive-test-'))
    account = generateTestAccount()
    await registerAccount(a.webServerUrl, account, 'Archive Test')

    const dir = join(work, 'site')
    mkdirSync(join(dir, 'about'), {recursive: true})
    writeFileSync(join(dir, 'pic.png'), PNG)
    writeFileSync(join(dir, 'big.png'), BIG_PNG)
    writeFileSync(
      join(dir, 'notes.md'),
      '# Notes\n\nFirst draft.\n\n![A pixel](./pic.png)\n\n![A big one](./big.png)\n',
    )
    writeFileSync(join(dir, 'about/team.md'), '# Team\n\nWho we are.\n')
    const opts = {client: clientA, signer: createSignerFromKey(account.keyPair), account: account.accountId, dir}
    await importSpace({...opts, only: ['notes.md', 'about/team.md']})

    // History: a second change on notes.
    writeFileSync(
      join(dir, 'notes.md'),
      '# Notes\n\nSecond draft.\n\n![A pixel](./pic.png)\n\n![A big one](./big.png)\n',
    )
    await importSpace({...opts, only: ['notes.md']})

    // A move: /about/team -> /people (Version Ref at the new path, Redirect Ref at the old).
    await clientA.request('Resource', hmId(account.accountId, {path: ['about', 'team']}))
    const exported = join(work, 'exported')
    await runCli(['space', 'export', `hm://${account.accountId}`, '--dir', exported], {server: a.webServerUrl})
    const teamMd = readFileSync(join(exported, 'about/team.md'), 'utf8')
    writeFileSync(join(dir, 'people.md'), teamMd)
    rmSync(join(dir, 'about'), {recursive: true})
    await importSpace({...opts, only: ['people.md']})

    // A comment on notes.
    const notes = await resource(clientA, 'notes')
    if (notes.type !== 'document') throw new Error('notes did not publish')
    await clientA.publish(
      await createComment(
        {
          content: [{block: {id: 'c1', type: 'Paragraph', text: 'Nice notes', annotations: []}, children: []}] as any,
          docId: hmId(account.accountId, {path: ['notes']}),
          docVersion: notes.document.version,
        } as any,
        createSignerFromKey(account.keyPair),
      ),
    )
  }, TIMEOUT)

  afterAll(async () => {
    await Promise.all([a?.cleanup(), b?.cleanup()])
    if (work) rmSync(work, {recursive: true, force: true})
  }, TIMEOUT)

  test('ListRefs lists the Refs at a path, redirects included', async () => {
    const {refs} = await clientA.request('ListRefs', {
      targetId: hmId(account.accountId, {path: ['about', 'team']}),
    })
    expect(refs).toHaveLength(2)
    expect(refs[0]!.target?.redirect).toEqual({account: account.accountId, path: '/people'})
    expect(refs[1]!.target?.version?.genesis).toBeTruthy()
  })

  test(
    'a blob archive restores the space byte for byte on another server',
    async () => {
      const zip = join(work, 'blobs.zip')
      const archived = await runCli(['space', 'archive', `hm://${account.accountId}`, '--format', 'blobs', '-o', zip], {
        server: a.webServerUrl,
      })
      expect(archived.exitCode).toBe(0)

      const {manifest, entries} = readManifest(zip)
      expect(manifest.kind).toBe('blobs')
      expect(manifest.missing).toEqual([])
      const types = new Set(manifest.blobs!.map((blob) => blob.type))
      for (const t of ['Change', 'Ref', 'Comment', 'raw', 'unixfs']) expect(types.has(t)).toBe(true)
      for (const blob of manifest.blobs!) expect(entries[`blobs/${blob.cid}`]?.length).toBe(blob.size)
      expect(manifest.documents.map((d) => d.path)).toEqual(['', '/notes', '/people'])

      expect((await resource(clientB, 'notes')).type).toBe('not-found')
      const restored = await runCli(['space', 'restore', zip], {server: b.webServerUrl})
      expect(restored.exitCode).toBe(0)

      for (const path of ['', 'notes', 'people']) {
        const [onA, onB] = await Promise.all([resource(clientA, path), resource(clientB, path)])
        expect(onB.type).toBe('document')
        if (onA.type !== 'document' || onB.type !== 'document') continue
        expect(onB.document.version).toBe(onA.document.version)
        expect(onB.document.content).toEqual(onA.document.content)
      }
      // Known gap: the Redirect Ref left at a moved document's old path is not archived, because
      // nothing lists the paths a space no longer has a document at.

      const [commentsA, commentsB] = await Promise.all(
        [clientA, clientB].map((c) =>
          c.request('ListComments', {targetId: hmId(account.accountId, {path: ['notes']})}),
        ),
      )
      expect(commentsB.comments.map((c) => c.version)).toEqual(commentsA.comments.map((c) => c.version))

      const notes = await resource(clientB, 'notes')
      const images = [
        ...JSON.stringify(notes.type === 'document' ? notes.document.content : null).matchAll(/ipfs:\/\/([a-z0-9]+)/g),
      ].map((m) => m[1]!)
      expect(images).toHaveLength(2)
      const files = await Promise.all(
        images.map(async (cid) =>
          Buffer.from(await (await fetch(`${b.webServerUrl}/hm/api/file/${cid}`)).arrayBuffer()),
        ),
      )
      expect(files[0]!.equals(PNG)).toBe(true)
      expect(files[1]!.equals(BIG_PNG)).toBe(true)
    },
    TIMEOUT,
  )

  test(
    'a markdown archive carries its assets and imports into another space',
    async () => {
      const zip = join(work, 'markdown.zip')
      const archived = await runCli(['space', 'archive', `hm://${account.accountId}`, '-o', zip], {
        server: a.webServerUrl,
      })
      expect(archived.exitCode).toBe(0)

      const {manifest, entries} = readManifest(zip)
      expect(manifest.kind).toBe('markdown')
      expect(manifest.assets).toHaveLength(2)
      const asset = manifest.assets!.find((x) => x.size === PNG.length)!
      expect(asset.file).toMatch(/^assets\/[a-z0-9]+\.png$/)
      expect(Buffer.from(entries[asset.file]!).equals(PNG)).toBe(true)
      const notesMd = new TextDecoder().decode(entries['notes.md'])
      expect(notesMd).toContain(`](./${asset.file})`)
      expect(notesMd).not.toContain('ipfs://')

      const other = generateTestAccount()
      await registerAccount(b.webServerUrl, other, 'Archive Copy')
      const restored = await runCli(['space', 'restore', zip], {
        server: b.webServerUrl,
        env: {SEED_CLI_MNEMONIC: other.mnemonic},
      })
      expect(restored.exitCode).toBe(0)

      const copy = await clientB.request('Resource', hmId(other.accountId, {path: ['notes']}))
      expect(copy.type).toBe('document')
      const text = JSON.stringify(copy.type === 'document' ? copy.document.content : null)
      expect(text).toContain('Second draft.')
      const images = [...text.matchAll(/ipfs:\/\/([a-z0-9]+)/g)].map((m) => m[1]!)
      const files = await Promise.all(
        images.map(async (cid) =>
          Buffer.from(await (await fetch(`${b.webServerUrl}/hm/api/file/${cid}`)).arrayBuffer()),
        ),
      )
      expect(files.map((f) => f.length)).toEqual([PNG.length, BIG_PNG.length])
      expect(files[1]!.equals(BIG_PNG)).toBe(true)
      expect((await clientB.request('Resource', hmId(other.accountId, {path: ['people']}))).type).toBe('document')
    },
    TIMEOUT,
  )

  test('restore refuses a damaged blob archive', async () => {
    const zip = join(work, 'blobs.zip')
    const entries = unzipSync(new Uint8Array(readFileSync(zip)))
    const {manifest} = readManifest(zip)
    const victim = manifest.blobs!.find((blob) => blob.type === 'Change')!
    entries[`blobs/${victim.cid}`] = new Uint8Array([1, 2, 3])
    const {zipSync} = await import('fflate')
    const damaged = join(work, 'damaged.zip')
    writeFileSync(damaged, zipSync(entries))
    const result = await runCli(['space', 'restore', damaged, '--dry-run'], {server: b.webServerUrl})
    expect(result.exitCode).toBe(1)
    expect(result.stderr + result.stdout).toContain('bytes do not match the CID')
  })

  test('restore --dry-run verifies a blob archive without publishing', async () => {
    const result = await runCli(['space', 'restore', join(work, 'blobs.zip'), '--dry-run'], {server: b.webServerUrl})
    expect(result.exitCode).toBe(0)
    expect(result.stdout + result.stderr).toContain('would publish')
  })

  test(
    'a blob archive without comments leaves the Comment blobs out',
    async () => {
      const zip = join(work, 'no-comments.zip')
      const archived = await runCli(
        ['space', 'archive', `hm://${account.accountId}`, '--format', 'blobs', '--no-comments', '-o', zip],
        {server: a.webServerUrl},
      )
      expect(archived.exitCode).toBe(0)
      const {manifest} = readManifest(zip)
      expect(manifest.blobs!.some((blob) => blob.type === 'Comment')).toBe(false)
      expect(manifest.blobs!.some((blob) => blob.type === 'Change')).toBe(true)
    },
    TIMEOUT,
  )

  test('archive refuses a format it does not know', async () => {
    const result = await runCli(
      ['space', 'archive', `hm://${account.accountId}`, '--format', 'tar', '-o', join(work, 'never.zip')],
      {server: a.webServerUrl},
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr + result.stdout).toContain('--format must be markdown or blobs')
    expect(existsSync(join(work, 'never.zip'))).toBe(false)
  })

  test('restore refuses to import a markdown archive into a space the key does not own', async () => {
    const stranger = generateTestAccount()
    const result = await runCli(
      ['space', 'restore', join(work, 'markdown.zip'), '--into', `hm://${account.accountId}`, '--dry-run'],
      {server: b.webServerUrl, env: {SEED_CLI_MNEMONIC: stranger.mnemonic}},
    )
    expect(result.exitCode).toBe(1)
    expect(result.stderr + result.stdout).toContain('does not own space')
  })

  test(
    'space export --assets downloads the linked files beside the markdown',
    async () => {
      const dir = join(work, 'exported-assets')
      const result = await runCli(['space', 'export', `hm://${account.accountId}`, '--dir', dir, '--assets'], {
        server: a.webServerUrl,
      })
      expect(result.exitCode).toBe(0)
      const notesMd = readFileSync(join(dir, 'notes.md'), 'utf8')
      expect(notesMd).not.toContain('ipfs://')
      const links = [...notesMd.matchAll(/\]\(\.\/(assets\/[a-z0-9]+\.png)\)/g)].map((m) => m[1]!)
      expect(links).toHaveLength(2)
      expect(readFileSync(join(dir, links[0]!)).equals(PNG)).toBe(true)
      expect(readFileSync(join(dir, links[1]!)).equals(BIG_PNG)).toBe(true)
    },
    TIMEOUT,
  )
})
