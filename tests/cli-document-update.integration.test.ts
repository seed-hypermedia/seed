/**
 * `seed-cli document update` against a real daemon.
 *
 * The CLI asks the server for the Change (`PrepareDocumentChange`), so the stored Change holds
 * only what the update changed. These tests run the real CLI as a subprocess against a Seed API
 * served over HTTP in this process (the handlers the web app mounts, on the daemon's gRPC), then
 * decode the Change blob the daemon stored.
 */

import {createGrpcWebTransport} from '@connectrpc/connect-node'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {spawn} from 'child_process'
import {existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync} from 'fs'
import {createServer, type Server} from 'http'
import {tmpdir} from 'os'
import * as path from 'path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {generateTestAccount, type TestAccount} from '../frontend/apps/cli/src/test/account-helpers'
import {createSignerFromKey} from '../frontend/apps/cli/src/utils/signer'
import {
  createDocumentBlobs,
  createSeedClient,
  unpackHmId,
  type HMBlockNode,
  type SeedClient,
} from '../frontend/packages/client/src/index'
import {handleApiAction, handleApiRequest} from '../frontend/packages/shared/src/api-server'
import {createGRPCClient} from '../frontend/packages/shared/src/grpc-client'
import {spawnDaemon, type DaemonInstance} from './integration/daemon'
import {
  createTreeFuzzer,
  flatTree,
  newFuzzStats,
  recordFuzzRound,
  reportStats,
  treeShape,
  type Tree,
} from './integration/tree-fuzz'

const HTTP_PORT = 59431
const API_PORT = 59435
const DAEMON_URL = `http://localhost:${HTTP_PORT}`
const API_URL = `http://localhost:${API_PORT}`
const CLI_ENTRY = path.resolve(__dirname, '../frontend/apps/cli/src/index.ts')

let daemon: DaemonInstance
let dataDir: string
let workDir: string
let apiServer: Server
let client: SeedClient
let account: TestAccount

/** When set, `/api` request bodies larger than this many bytes are refused with 413, as a capped site does. */
let apiBodyLimit: number | null = null
/** Keys of the API actions requested, in order. */
let apiActions: string[] = []
/**
 * When set, decides for each `PrepareDocumentChange` request (by its document path) whether the
 * daemon "fails" it: the message returned is answered as an HTTP 500, as a site relays a daemon error.
 */
let prepareFailure: ((docPath: string) => string | null) | null = null

/** The Seed API over HTTP: `/api/*` through the shared handlers, `/ipfs/*` passed to the daemon. */
function startSeedApi(): Promise<Server> {
  const grpcClient = createGRPCClient(createGrpcWebTransport({baseUrl: DAEMON_URL, httpVersion: '1.1'}))
  const queryDaemon = async <T>(pathAndQuery: string): Promise<T> => {
    const response = await fetch(`${DAEMON_URL}${pathAndQuery}`)
    if (!response.ok) throw new Error(`Failed to fetch ${pathAndQuery}: ${response.statusText}`)
    return (await response.json()) as T
  }
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = Buffer.concat(chunks)
      const url = new URL(req.url ?? '/', API_URL)
      if (url.pathname.startsWith('/ipfs/')) {
        const upstream = await fetch(`${DAEMON_URL}${url.pathname}`, {
          method: req.method,
          headers: req.method === 'POST' ? {'Content-Type': 'application/octet-stream'} : undefined,
          body: req.method === 'POST' ? new Uint8Array(body) : undefined,
        })
        res.writeHead(upstream.status)
        res.end(Buffer.from(await upstream.arrayBuffer()))
        return
      }
      if (req.method === 'POST') {
        const key = url.pathname.replace(/^\/api\//, '').split('/')[0]!
        apiActions.push(key)
        if (apiBodyLimit !== null && body.length > apiBodyLimit) {
          res.writeHead(413)
          res.end('Payload Too Large')
          return
        }
        if (key === 'PrepareDocumentChange' && prepareFailure) {
          const failure = prepareFailure((cborDecode(new Uint8Array(body)) as {path?: string}).path ?? '')
          if (failure) {
            res.writeHead(500)
            res.end(JSON.stringify({error: failure}))
            return
          }
        }
        const result = await handleApiAction(key, new Uint8Array(body), grpcClient, queryDaemon)
        res.writeHead(result.status, result.headers)
        res.end(result.body)
        return
      }
      const result = await handleApiRequest(url, grpcClient, queryDaemon)
      res.writeHead(result.status, result.headers)
      res.end(result.body)
    } catch (error) {
      res.writeHead(500)
      res.end(JSON.stringify({error: (error as Error).message}))
    }
  })
  return new Promise((resolve) => server.listen(API_PORT, () => resolve(server)))
}

/** Runs the real CLI, signing as the test account. */
function cli(...args: string[]): Promise<{stdout: string; stderr: string; exitCode: number}> {
  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', CLI_ENTRY, '--server', API_URL, ...args], {
      cwd: workDir,
      env: {...process.env, SEED_CLI_MNEMONIC: account.mnemonic, NO_COLOR: '1', FORCE_COLOR: '0'},
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (data) => (stdout += data.toString()))
    proc.stderr.on('data', (data) => (stderr += data.toString()))
    proc.on('close', (code) => resolve({stdout, stderr, exitCode: code ?? 0}))
  })
}

/** Runs the CLI and fails the test, with its output, when it exits non-zero. */
async function cliOk(...args: string[]) {
  const result = await cli(...args)
  if (result.exitCode !== 0) {
    throw new Error(`seed-cli ${args.join(' ')} exited ${result.exitCode}\n${result.stderr}\n${result.stdout}`)
  }
  return result
}

const hm = (docPath: string) => `hm://${account.accountId}${docPath}`

async function readResource(docPath: string) {
  return client.request('Resource', {...unpackHmId(hm(docPath))!, latest: true})
}

async function readDocument(docPath: string) {
  const resource = await readResource(docPath)
  if (resource.type !== 'document') throw new Error(`${docPath} is ${resource.type}`)
  return resource.document
}

/** The ops of the Change that is the document's current version, as the daemon stored them. */
async function latestOps(docPath: string): Promise<Array<Record<string, any>>> {
  const {version} = await readDocument(docPath)
  expect(version.includes('.')).toBe(false)
  const response = await fetch(`${DAEMON_URL}/ipfs/${version}`)
  if (!response.ok) throw new Error(`blob ${version}: ${response.status}`)
  const change = cborDecode(new Uint8Array(await response.arrayBuffer())) as {body?: {ops?: any[]}}
  return change.body?.ops ?? []
}

function rootTexts(content: HMBlockNode[] | undefined): string[] {
  return (content ?? []).map((node) => (node.block as {text?: string}).text ?? '')
}

function rootIds(content: HMBlockNode[] | undefined): string[] {
  return (content ?? []).map((node) => node.block.id)
}

function file(name: string, content: string): string {
  const filePath = path.join(workDir, name)
  writeFileSync(filePath, content)
  return filePath
}

/** Creates a document of paragraphs through the CLI and returns its markdown as `document get` prints it. */
async function createParagraphs(docPath: string, title: string, texts: string[]): Promise<string> {
  await cliOk('document', 'create', '-f', file('new.md', texts.join('\n\n') + '\n'), '-p', docPath, '--name', title)
  return getMarkdown(docPath)
}

async function getMarkdown(docPath: string): Promise<string> {
  const out = path.join(workDir, `get-${Date.now()}-${Math.random().toString(36).slice(2)}.md`)
  await cliOk('document', 'get', hm(docPath), '-o', out)
  return readFileSync(out, 'utf-8')
}

describe('seed-cli document update', () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'seed-cli-update-test-'))
    workDir = mkdtempSync(path.join(tmpdir(), 'seed-cli-update-work-'))
    daemon = await spawnDaemon({httpPort: HTTP_PORT, grpcPort: HTTP_PORT + 1, p2pPort: HTTP_PORT + 2, dataDir})
    await daemon.waitForReady()
    apiServer = await startSeedApi()
    client = createSeedClient(API_URL)
    account = generateTestAccount()
    const home = await createDocumentBlobs(createSignerFromKey(account.keyPair), {
      space: account.accountId,
      path: '',
      ops: [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'CLI update test'}]}],
    })
    await client.publish({blobs: home.blobs})
  }, 120_000)

  afterAll(async () => {
    await new Promise((resolve) => (apiServer ? apiServer.close(resolve) : resolve(null)))
    await daemon?.kill()
    if (dataDir) rmSync(dataDir, {recursive: true, force: true})
    if (workDir) rmSync(workDir, {recursive: true, force: true})
  })

  it('stores only the edited block, and only the move of the block that moved', async () => {
    const markdown = await createParagraphs('/edit', 'Edit', ['Alpha one', 'Beta two', 'Gamma three', 'Delta four'])
    const before = await readDocument('/edit')
    expect(rootTexts(before.content)).toEqual(['Alpha one', 'Beta two', 'Gamma three', 'Delta four'])
    const [a, b, c, d] = rootIds(before.content)

    // Edit one block. The file still carries the title and every other block.
    const edited = await cliOk(
      'document',
      'update',
      hm('/edit'),
      '-f',
      file('edit.md', markdown.replace('Beta two', 'Beta 2')),
    )
    expect(edited.stderr).toContain('Document updated')
    const afterEdit = await readDocument('/edit')
    expect(afterEdit.version).not.toBe(before.version)
    expect(rootTexts(afterEdit.content)).toEqual(['Alpha one', 'Beta 2', 'Gamma three', 'Delta four'])
    const editOps = await latestOps('/edit')
    expect(editOps).toHaveLength(1)
    expect(editOps[0]!.type).toBe('ReplaceBlock')
    expect(editOps[0]!.block.id).toBe(b)
    expect(editOps[0]!.block.text).toBe('Beta 2')

    // Move the third block to the end: one move is requested and one is stored.
    const current = await getMarkdown('/edit')
    const lines = current.split('\n')
    const gammaAt = lines.findIndex((line) => line.includes('Gamma three'))
    expect(gammaAt).toBeGreaterThan(-1)
    const [gammaLine] = lines.splice(gammaAt, 1)
    const reordered = [...lines.join('\n').trimEnd().split('\n'), '', gammaLine!, ''].join('\n')
    await cliOk('document', 'update', hm('/edit'), '-f', file('reorder.md', reordered))
    const afterMove = await readDocument('/edit')
    expect(rootIds(afterMove.content)).toEqual([a, b, d, c])
    const moveOps = await latestOps('/edit')
    expect(moveOps).toHaveLength(1)
    expect(moveOps[0]!.type).toBe('MoveBlocks')
    // The block that moved is the one sent; the rest of the level is not mentioned.
    expect(moveOps[0]!.blocks).toEqual([c])
  })

  it('publishes no new version when the same file is applied again', async () => {
    await createParagraphs('/same', 'Same', ['One', 'Two', 'Three'])
    const markdown = await getMarkdown('/same')
    const before = await readDocument('/same')

    const again = await cliOk('document', 'update', hm('/same'), '-f', file('same.md', markdown))
    expect(again.stderr).toContain('already up to date')
    expect(again.stderr).not.toContain('Document updated')
    expect((await readDocument('/same')).version).toBe(before.version)

    // A real edit, then the edited file once more.
    const edited = file('same-edited.md', markdown.replace('Two', 'Two!'))
    await cliOk('document', 'update', hm('/same'), '-f', edited)
    const afterEdit = await readDocument('/same')
    expect(afterEdit.version).not.toBe(before.version)
    const repeat = await cliOk('document', 'update', hm('/same'), '-f', edited)
    expect(repeat.stderr).toContain('already up to date')
    expect((await readDocument('/same')).version).toBe(afterEdit.version)

    // A file with no frontmatter and the same blocks asks for nothing at all, which is not an error.
    const body = (await getMarkdown('/same')).replace(/^---\n[\s\S]*?\n---\n/, '')
    const bare = await cliOk('document', 'update', hm('/same'), '-f', file('same-bare.md', body))
    expect(bare.stderr).toContain('already up to date')
    expect((await readDocument('/same')).version).toBe(afterEdit.version)
  })

  it('updates metadata alone, and only the attribute that changed', async () => {
    await createParagraphs('/meta', 'Meta', ['Body'])
    const before = await readDocument('/meta')

    await cliOk('document', 'update', hm('/meta'), '--name', 'Meta renamed', '--summary', 'A summary')
    const after = await readDocument('/meta')
    expect(after.metadata.name).toBe('Meta renamed')
    expect(after.metadata.summary).toBe('A summary')
    expect(rootTexts(after.content)).toEqual(['Body'])
    expect(after.version).not.toBe(before.version)

    // Same name, new summary: only the summary is written.
    await cliOk('document', 'update', hm('/meta'), '--name', 'Meta renamed', '--summary', 'Another summary')
    const ops = await latestOps('/meta')
    expect(ops).toEqual([{type: 'SetAttributes', attrs: [{key: ['summary'], value: 'Another summary'}]}])

    // Nothing new: no version.
    const latest = await readDocument('/meta')
    const repeat = await cliOk('document', 'update', hm('/meta'), '--name', 'Meta renamed')
    expect(repeat.stderr).toContain('already up to date')
    expect((await readDocument('/meta')).version).toBe(latest.version)

    // Nested and non-string values through --metadata.
    await cliOk(
      'document',
      'update',
      hm('/meta'),
      '--metadata',
      JSON.stringify({priority: 3, done: true, theme: {headerLayout: 'Center'}}),
    )
    const typed = (await readDocument('/meta')).metadata as Record<string, any>
    expect(typed.priority).toBe(3)
    expect(typed.done).toBe(true)
    expect(typed.theme.headerLayout).toBe('Center')
  })

  it('still refuses an update that asks for nothing', async () => {
    const result = await cli('document', 'update', hm('/meta'))
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('No updates specified')
  })

  it('deletes blocks with --delete-blocks', async () => {
    await createParagraphs('/delete', 'Delete', ['Keep one', 'Drop me', 'Keep two'])
    const before = await readDocument('/delete')
    const [, drop] = rootIds(before.content)

    await cliOk('document', 'update', hm('/delete'), '--delete-blocks', drop!)
    const after = await readDocument('/delete')
    expect(rootTexts(after.content)).toEqual(['Keep one', 'Keep two'])
    expect(await latestOps('/delete')).toEqual([{type: 'DeleteBlocks', blocks: [drop]}])

    // Deleting it again changes nothing.
    const repeat = await cliOk('document', 'update', hm('/delete'), '--delete-blocks', drop!)
    expect(repeat.stderr).toContain('nothing to delete')
    expect(repeat.stderr).toContain('already up to date')
    expect((await readDocument('/delete')).version).toBe(after.version)
  })

  it('takes over a redirected address: the Ref lands there, on the target’s history', async () => {
    await createParagraphs('/original', 'Original', ['Shared body'])
    await createParagraphs('/alias', 'Alias before', ['Replaced by the republish'])
    await cliOk('document', 'redirect', hm('/alias'), '--to', hm('/original'), '--republish')
    expect((await readResource('/alias')).type).toBe('redirect')
    const original = await readDocument('/original')

    // An update that changes nothing leaves the republish in place.
    const noop = await cliOk('document', 'update', hm('/alias'), '--name', 'Original')
    expect(noop.stderr).toContain('already up to date')
    expect(noop.stderr).toContain('still republishes')
    expect((await readResource('/alias')).type).toBe('redirect')

    const taken = await cliOk('document', 'update', hm('/alias'), '--name', 'Alias, edited')
    expect(taken.stderr).toContain('replaces the redirect')
    expect(taken.stderr).toContain('Document updated')

    const alias = await readDocument('/alias')
    expect(alias.metadata.name).toBe('Alias, edited')
    expect(rootTexts(alias.content)).toEqual(['Shared body'])
    // Same history: the alias continues the original's genesis, one change later.
    expect(alias.genesis).toBe(original.genesis)
    expect(alias.version).not.toBe(original.version)
    expect(await latestOps('/alias')).toEqual([
      {type: 'SetAttributes', attrs: [{key: ['name'], value: 'Alias, edited'}]},
    ])
    // The original is untouched.
    const originalAfter = await readDocument('/original')
    expect(originalAfter.version).toBe(original.version)
    expect(originalAfter.metadata.name).toBe('Original')

    // And the alias is now an ordinary document: a second update builds on its own version.
    await cliOk('document', 'update', hm('/alias'), '--summary', 'Now independent')
    const aliasAgain = await readDocument('/alias')
    expect(aliasAgain.metadata.summary).toBe('Now independent')
    expect(aliasAgain.metadata.name).toBe('Alias, edited')
  })

  it('builds the change locally, as written, for an attribute the server cannot prepare', async () => {
    const markdown = await createParagraphs('/local', 'Local', ['First', 'Second', 'Third'])
    const before = await readDocument('/local')
    const [a, b, c] = rootIds(before.content)
    apiActions = []

    // A fractional number, plus a new block at the top. Built locally, the change is stored as
    // written: the whole root level is listed again.
    const lines = markdown.split('\n')
    const firstAt = lines.findIndex((line) => line.includes('First'))
    lines.splice(firstAt, 0, 'Zeroth', '')
    const result = await cliOk(
      'document',
      'update',
      hm('/local'),
      '-f',
      file('local.md', lines.join('\n')),
      '--metadata',
      JSON.stringify({rating: 4.5}),
    )
    expect(result.stderr).toContain('built locally, as written, because')
    expect(result.stderr).toContain('"rating"')
    expect(apiActions).not.toContain('PrepareDocumentChange')

    const after = await readDocument('/local')
    expect((after.metadata as Record<string, any>).rating).toBe(4.5)
    expect(rootTexts(after.content)).toEqual(['Zeroth', 'First', 'Second', 'Third'])
    expect(rootIds(after.content).slice(1)).toEqual([a, b, c])
    const ops = await latestOps('/local')
    const moves = ops.filter((op) => op.type === 'MoveBlocks')
    expect(moves).toHaveLength(1)
    expect(moves[0]!.blocks).toEqual(rootIds(after.content))
  })

  it('falls back to a locally built change when the site refuses the request as too large', async () => {
    const markdown = await createParagraphs('/large', 'Large', ['Small'])
    const before = await readDocument('/large')
    apiActions = []
    apiBodyLimit = 2_000
    try {
      const big = 'A long paragraph. '.repeat(400)
      const result = await cliOk(
        'document',
        'update',
        hm('/large'),
        '-f',
        file('large.md', `${markdown.trimEnd()}\n\n${big}\n`),
      )
      expect(result.stderr).toContain('built locally, as written, because')
      expect(result.stderr).toContain('413')
      expect(result.stderr).toContain('Document updated')
    } finally {
      apiBodyLimit = null
    }
    expect(apiActions).toContain('PrepareDocumentChange')
    const after = await readDocument('/large')
    expect(after.version).not.toBe(before.version)
    expect(rootTexts(after.content)).toHaveLength(2)
    expect(rootTexts(after.content)[1]!.startsWith('A long paragraph.')).toBe(true)
  })

  /** A paragraph node for `-f blocks.json`, which carries block ids and nesting exactly. */
  const node = (id: string, children: unknown[] = []) => ({
    block: {id, type: 'Paragraph', text: `Text ${id}`, annotations: [], attributes: {}},
    children,
  })
  /** The document's block ids as a nested list: `['a', ['b', ['c']]]` is `a`, then `b` with child `c`. */
  const shape = (content: HMBlockNode[] | undefined): unknown[] =>
    (content ?? []).map((n) => (n.children?.length ? [n.block.id, shape(n.children)] : n.block.id))

  it('places inserted blocks where the file has them: after the first block, in the middle, nested', async () => {
    const write = async (name: string, tree: unknown[]) => {
      const result = await cliOk('document', 'update', hm('/insert'), '-f', file(name, JSON.stringify(tree)))
      expect(result.stderr).toContain('Document updated')
      return shape((await readDocument('/insert')).content)
    }
    await cliOk(
      'document',
      'create',
      '-f',
      file('insert-0.json', JSON.stringify([node('f1'), node('f2'), node('f3')])),
      '-p',
      '/insert',
      '--name',
      'Insert',
    )
    expect(shape((await readDocument('/insert')).content)).toEqual(['f1', 'f2', 'f3'])

    // After the unchanged first block.
    expect(await write('insert-1.json', [node('f1'), node('n1'), node('f2'), node('f3')])).toEqual([
      'f1',
      'n1',
      'f2',
      'f3',
    ])
    // One block moved, and nothing else.
    expect((await latestOps('/insert')).filter((op) => op.type === 'MoveBlocks').map((op) => op.blocks)).toEqual([
      ['n1'],
    ])

    // In the middle.
    expect(await write('insert-2.json', [node('f1'), node('n1'), node('f2'), node('n2'), node('f3')])).toEqual([
      'f1',
      'n1',
      'f2',
      'n2',
      'f3',
    ])

    // Nested: a first child, then one after that unchanged first child, then one in the middle.
    expect(
      await write('insert-3.json', [
        node('f1'),
        node('n1'),
        node('f2', [node('c1'), node('c2')]),
        node('n2'),
        node('f3'),
      ]),
    ).toEqual(['f1', 'n1', ['f2', ['c1', 'c2']], 'n2', 'f3'])
    expect(
      await write('insert-4.json', [
        node('f1'),
        node('n1'),
        node('f2', [node('c1'), node('c3'), node('c2')]),
        node('n2'),
        node('f3'),
      ]),
    ).toEqual(['f1', 'n1', ['f2', ['c1', 'c3', 'c2']], 'n2', 'f3'])
    expect(
      await write('insert-5.json', [
        node('f1'),
        node('n1'),
        node('f2', [node('c1'), node('c3'), node('c4'), node('c2', [node('g1')])]),
        node('n2'),
        node('f3'),
      ]),
    ).toEqual(['f1', 'n1', ['f2', ['c1', 'c3', 'c4', ['c2', ['g1']]]], 'n2', 'f3'])

    // At the very start, and at the very end.
    expect(
      await write('insert-6.json', [
        node('n0'),
        node('f1'),
        node('n1'),
        node('f2', [node('c1'), node('c3'), node('c4'), node('c2', [node('g1')])]),
        node('n2'),
        node('f3'),
        node('n9'),
      ]),
    ).toEqual(['n0', 'f1', 'n1', ['f2', ['c1', 'c3', 'c4', ['c2', ['g1']]]], 'n2', 'f3', 'n9'])

    // The second block moved to the end, behind the unchanged first.
    expect(
      await write('insert-7.json', [
        node('n0'),
        node('n1'),
        node('f2', [node('c1'), node('c3'), node('c4'), node('c2', [node('g1')])]),
        node('n2'),
        node('f3'),
        node('n9'),
        node('f1'),
      ]),
    ).toEqual(['n0', 'n1', ['f2', ['c1', 'c3', 'c4', ['c2', ['g1']]]], 'n2', 'f3', 'n9', 'f1'])
  })

  /** The document's block texts as a nested list: `['A', ['B', ['C']]]` is `A`, then `B` with child `C`. */
  const texts = (content: HMBlockNode[] | undefined): unknown[] =>
    (content ?? []).map((n) => {
      const text = (n.block as {text?: string}).text ?? `<${n.block.type}>`
      return n.children?.length ? [text, texts(n.children)] : text
    })
  /** Who built the Change of a `document update` run, read from what the CLI printed. */
  const builtBy = (stderr: string): {builtBy?: 'server' | 'local'; localReason?: string} => {
    const local = /built locally, as written, because (.*)\.\n/.exec(stderr)
    if (local) return {builtBy: 'local', localReason: local[1]}
    return stderr.includes('Document updated') ? {builtBy: 'server'} : {}
  }

  it('adds new parents with their children in one update: sections, a nested list, a table', async () => {
    // Each of these made the daemon refuse the request ("desired parent block is not in the
    // tree") when the content of a new parent was sent after a move.
    const update = async (docPath: string, markdown: string) => {
      const result = await cliOk('document', 'update', hm(docPath), '-f', file('parents.md', markdown))
      expect(result.stderr).toContain('Document updated')
      // The server built it: nothing was refused and nothing had to be built here.
      expect(result.stderr).not.toContain('built locally')
      return readDocument(docPath)
    }

    // Two new sections, each a heading with paragraphs under it.
    const sections = await createParagraphs('/sections', 'Sections', ['Intro', 'Outro'])
    const withSections = await update(
      '/sections',
      `${sections.trimEnd()}\n\n# Section one\n\nFirst of one\n\nSecond of one\n\n# Section two\n\nFirst of two\n`,
    )
    expect(texts(withSections.content)).toEqual([
      'Intro',
      'Outro',
      ['Section one', ['First of one', 'Second of one']],
      ['Section two', ['First of two']],
    ])
    // Only the new blocks are stored: five replaced, five placed, the two old ones untouched.
    const sectionOps = await latestOps('/sections')
    expect(sectionOps.filter((op) => op.type === 'ReplaceBlock')).toHaveLength(5)
    expect(sectionOps.filter((op) => op.type === 'MoveBlocks').flatMap((op) => op.blocks)).toHaveLength(5)

    // A nested list with two parents.
    const list = await createParagraphs('/list', 'List', ['Before'])
    const withList = await update(
      '/list',
      `${list.trimEnd()}\n\n- Parent A\n  - Child a1\n  - Child a2\n- Parent B\n  - Child b1\n`,
    )
    const flatTexts = JSON.stringify(texts(withList.content))
    for (const text of ['Parent A', 'Child a1', 'Child a2', 'Parent B', 'Child b1']) expect(flatTexts).toContain(text)
    expect(flatTexts).toContain(JSON.stringify(['Parent A', ['Child a1', 'Child a2']]))
    expect(flatTexts).toContain(JSON.stringify(['Parent B', ['Child b1']]))

    // A brand-new table: the table, its columns, its rows and their cells are all new parents.
    const table = await createParagraphs('/table', 'Table', ['Above'])
    const withTable = await update(
      '/table',
      `${table.trimEnd()}\n\n| Name | Value |\n| --- | --- |\n| alpha | 1 |\n| beta | 2 |\n`,
    )
    const tableNode = (withTable.content ?? []).find((n) => n.block.type === 'Table')!
    expect(tableNode).toBeDefined()
    const rows = (tableNode.children ?? []).filter((n) => n.block.type === 'TableRow')
    expect(rows.map((row) => (row.children ?? []).map((cell) => (cell.block as {text?: string}).text))).toEqual([
      ['Name', 'Value'],
      ['alpha', '1'],
      ['beta', '2'],
    ])
    // And the file as the CLI prints it back is a no-op.
    const again = await cliOk(
      'document',
      'update',
      hm('/table'),
      '-f',
      file('table-again.md', await getMarkdown('/table')),
    )
    expect(again.stderr).toContain('already up to date')
  })

  it('reads back every edit as written, whoever builds the change (seeded random edits through the CLI)', async () => {
    // One document per seed, walked through rounds of one to four edits each: blocks and whole
    // subtrees inserted, deleted and moved, indents and outdents, and parents swapped with their
    // children. Every round runs the real `document update -f blocks.json` and reads the tree back.
    const toNodes = (tree: Tree): unknown[] => tree.map((t) => node(t.id, toNodes(t.children)))
    const stats = newFuzzStats()
    const failures: string[] = []
    for (const [seed, swaps] of [
      [20261116, true],
      [424242, true],
      [31337, false],
    ] as const) {
      const fuzzer = createTreeFuzzer(seed, {swaps})
      const docPath = `/random-${seed}`
      let tree: Tree = flatTree('a', 'b', 'c', 'd', 'e')
      tree[1]!.children = flatTree('p', 'q', 'r')
      await cliOk(
        'document',
        'create',
        '-f',
        file('random-0.json', JSON.stringify(toNodes(tree))),
        '-p',
        docPath,
        '--name',
        'Random',
      )
      for (let round = 0; round < 25; round++) {
        const next = fuzzer.mutate(tree)
        const label = `seed ${seed} round ${round} (${next.edits.join(', ')}): ${JSON.stringify(
          treeShape(tree),
        )} -> ${JSON.stringify(treeShape(next.tree))}`
        const result = await cli(
          'document',
          'update',
          hm(docPath),
          '-f',
          file('random.json', JSON.stringify(toNodes(next.tree))),
        )
        if (result.exitCode !== 0) {
          failures.push(`${label}: exit ${result.exitCode}: ${result.stderr.trim()}`)
          break
        }
        const got = shape((await readDocument(docPath)).content)
        const right = JSON.stringify(got) === JSON.stringify(treeShape(next.tree))
        recordFuzzRound(stats, {...builtBy(result.stderr), edits: next.edits, right})
        if (!right) failures.push(`${label}: read back ${JSON.stringify(got)}`)
        tree = next.tree
      }
    }
    reportStats(`FUZZ-STATS cli-document-update ${JSON.stringify(stats)}`)
    expect(failures).toEqual([])
    expect(stats.rounds).toBe(75)
    expect(stats.wrong).toBe(0)
    expect(stats.server).toBeGreaterThan(5)
  }, 600_000)

  it('rewrites a metadata map entry by entry: one removed, one kept, one added', async () => {
    await createParagraphs('/map', 'Map', ['Body'])
    await cliOk(
      'document',
      'update',
      hm('/map'),
      '--metadata',
      JSON.stringify({labels: {red: 'r', green: 'g'}, plain: 'text'}),
    )
    expect(((await readDocument('/map')).metadata as Record<string, any>).labels).toEqual({red: 'r', green: 'g'})

    // Remove one entry, keep one as it is, add one.
    await cliOk(
      'document',
      'update',
      hm('/map'),
      '--metadata',
      JSON.stringify({labels: {red: null, green: 'g', blue: 'b'}}),
    )
    const after = (await readDocument('/map')).metadata as Record<string, any>
    expect(after.labels).toEqual({green: 'g', blue: 'b'})
    expect(after.plain).toBe('text')
    expect(after.name).toBe('Map')
  })

  it('space import updates existing documents the same way, including one that moved', async () => {
    // A space of its own, so the import sees only these documents.
    account = generateTestAccount()
    const home = await createDocumentBlobs(createSignerFromKey(account.keyPair), {
      space: account.accountId,
      path: '',
      ops: [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'Space import test'}]}],
    })
    await client.publish({blobs: home.blobs})
    await createParagraphs('/one', 'One', ['Alfa', 'Bravo', 'Charlie'])
    await createParagraphs('/two', 'Two', ['Delta', 'Echo'])
    const oneBefore = await readDocument('/one')
    const twoBefore = await readDocument('/two')

    const dir = path.join(workDir, 'space')
    await cliOk('space', 'export', 'self', '-d', dir)
    const oneFile = path.join(dir, 'one.md')
    const twoFile = path.join(dir, 'two.md')
    expect(existsSync(oneFile)).toBe(true)
    expect(existsSync(twoFile)).toBe(true)

    // Nothing edited: nothing published.
    const idle = await cliOk('space', 'import', 'self', '-d', dir)
    expect(idle.stderr).toContain('0 updated')
    expect((await readDocument('/one')).version).toBe(oneBefore.version)

    // One block edited in one file.
    writeFileSync(oneFile, readFileSync(oneFile, 'utf-8').replace('Bravo', 'Bravo!'))
    const edited = await cliOk('space', 'import', 'self', '-d', dir)
    expect(edited.stderr).toContain('1 updated')
    const oneAfter = await readDocument('/one')
    expect(rootTexts(oneAfter.content)).toEqual(['Alfa', 'Bravo!', 'Charlie'])
    const ops = await latestOps('/one')
    expect(ops).toHaveLength(1)
    expect(ops[0]!.type).toBe('ReplaceBlock')
    expect(ops[0]!.block.text).toBe('Bravo!')

    // A file renamed and edited: the document moves, and the edit lands at the new path.
    renameSync(twoFile, path.join(dir, 'second.md'))
    writeFileSync(
      path.join(dir, 'second.md'),
      readFileSync(path.join(dir, 'second.md'), 'utf-8').replace('Echo', 'Echo, moved'),
    )
    const moved = await cliOk('space', 'import', 'self', '-d', dir)
    expect(moved.stderr).toContain('1 moved')
    const second = await readDocument('/second')
    expect(rootTexts(second.content)).toEqual(['Delta', 'Echo, moved'])
    expect(second.genesis).toBe(twoBefore.genesis)
    expect((await readResource('/two')).type).toBe('redirect')
    const movedOps = await latestOps('/second')
    expect(movedOps).toHaveLength(1)
    expect(movedOps[0]!.block.text).toBe('Echo, moved')

    // A block inserted after the unchanged first block, and one in the middle.
    const oneSource = readFileSync(oneFile, 'utf-8')
    const oneLines = oneSource.split('\n')
    const alfaAt = oneLines.findIndex((line) => line.includes('Alfa'))
    const charlieAt = oneLines.findIndex((line) => line.includes('Charlie'))
    oneLines.splice(charlieAt, 0, 'Middle', '')
    oneLines.splice(alfaAt + 1, 0, '', 'After first')
    writeFileSync(oneFile, oneLines.join('\n'))
    await cliOk('space', 'import', 'self', '-d', dir)
    expect(rootTexts((await readDocument('/one')).content)).toEqual([
      'Alfa',
      'After first',
      'Bravo!',
      'Middle',
      'Charlie',
    ])

    // A metadata map: written, then rewritten with one entry removed, one kept and one added,
    // and a plain value turned into a map.
    const withFrontmatter = (source: string, extra: string) => source.replace(/^---\n/, `---\n${extra}\n`)
    await cliOk('space', 'export', 'self', '-d', dir)
    const exported = readFileSync(oneFile, 'utf-8')
    writeFileSync(oneFile, withFrontmatter(exported, 'labels:\n  red: r\n  green: g\nkind: plain'))
    await cliOk('space', 'import', 'self', '-d', dir)
    const mapped = (await readDocument('/one')).metadata as Record<string, any>
    expect(mapped.labels).toEqual({red: 'r', green: 'g'})
    expect(mapped.kind).toBe('plain')
    writeFileSync(oneFile, withFrontmatter(exported, 'labels:\n  green: g\n  blue: b\nkind:\n  of: map'))
    await cliOk('space', 'import', 'self', '-d', dir)
    const remapped = (await readDocument('/one')).metadata as Record<string, any>
    expect(remapped.labels).toEqual({green: 'g', blue: 'b'})
    expect(remapped.kind).toEqual({of: 'map'})
    expect(remapped.name).toBe('One')
    // And back from a map to a plain value.
    writeFileSync(oneFile, withFrontmatter(exported, 'labels:\n  green: g\n  blue: b\nkind: plain again'))
    await cliOk('space', 'import', 'self', '-d', dir)
    const plainAgain = (await readDocument('/one')).metadata as Record<string, any>
    expect(plainAgain.kind).toBe('plain again')
    expect(plainAgain.labels).toEqual({green: 'g', blue: 'b'})

    // New parents with their children in one file: two sections and a nested list.
    await cliOk('space', 'export', 'self', '-d', dir)
    writeFileSync(
      oneFile,
      `${readFileSync(
        oneFile,
        'utf-8',
      ).trimEnd()}\n\n# Part one\n\nIn part one\n\n# Part two\n\n- Item A\n  - Sub a1\n- Item B\n  - Sub b1\n`,
    )
    const parents = await cliOk('space', 'import', 'self', '-d', dir)
    expect(parents.stderr).toContain('1 updated')
    expect(parents.stderr).not.toContain('built locally')
    const withParents = JSON.stringify(texts((await readDocument('/one')).content))
    expect(withParents).toContain(JSON.stringify(['Part one', ['In part one']]))
    for (const text of ['Part two', 'Item A', 'Sub a1', 'Item B', 'Sub b1']) expect(withParents).toContain(text)

    // The server refuses to prepare one file's update. That file is built here; the import goes
    // on and the other file is prepared as usual.
    await cliOk('space', 'export', 'self', '-d', dir)
    const secondFile = path.join(dir, 'second.md')
    writeFileSync(oneFile, readFileSync(oneFile, 'utf-8').replace('In part one', 'In part one, edited'))
    writeFileSync(secondFile, readFileSync(secondFile, 'utf-8').replace('Delta', 'Delta, edited'))
    apiActions = []
    prepareFailure = (docPath) => (docPath === '/one' ? '[unknown] desired parent block X is not in the tree' : null)
    try {
      const refused = await cliOk('space', 'import', 'self', '-d', dir)
      expect(refused.stderr).toContain('2 updated')
      expect(refused.stderr).toContain('change built locally because the server could not prepare it')
      expect(refused.stderr).toContain('is not in the tree')
    } finally {
      prepareFailure = null
    }
    expect(apiActions.filter((key) => key === 'PrepareDocumentChange')).toHaveLength(2)
    expect(JSON.stringify(texts((await readDocument('/one')).content))).toContain('In part one, edited')
    expect(rootTexts((await readDocument('/second')).content)).toEqual(['Delta, edited', 'Echo, moved'])
    expect(await latestOps('/second')).toHaveLength(1)

    // A dry run says what a real run would do and asks the server for nothing.
    writeFileSync(secondFile, readFileSync(secondFile, 'utf-8').replace('Delta, edited', 'Delta, twice'))
    apiActions = []
    const dry = await cliOk('space', 'import', 'self', '-d', dir, '--dry-run')
    expect(dry.stderr).toContain('1 updated')
    expect(apiActions).not.toContain('PrepareDocumentChange')
    expect(rootTexts((await readDocument('/second')).content)).toEqual(['Delta, edited', 'Echo, moved'])
    await cliOk('space', 'import', 'self', '-d', dir)

    // And the space is settled again.
    const settled = await cliOk('space', 'import', 'self', '-d', dir)
    expect(settled.stderr).toContain('0 updated')
    expect(settled.stderr).toContain('0 moved')
  })
})
