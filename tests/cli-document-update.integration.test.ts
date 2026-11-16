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

    // Move the third block to the end: the client lists the whole level, the server stores one move.
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
    // Swapping the last two is one move either way; the server keeps the first that differs.
    expect(moveOps[0]!.blocks).toEqual([d])
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
    expect(result.stderr).toContain('Building this change locally')
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
      expect(result.stderr).toContain('Building this change locally')
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

    // And the space is settled again.
    const settled = await cliOk('space', 'import', 'self', '-d', dir)
    expect(settled.stderr).toContain('0 updated')
    expect(settled.stderr).toContain('0 moved')
  })
})
