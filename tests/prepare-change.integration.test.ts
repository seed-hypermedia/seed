/**
 * Document updates through the daemon's PrepareDocumentChange, against a real daemon.
 *
 * A Change built on the client is stored as written, redundant ops included. These tests publish
 * through the client package's daemon path (`prepareDocumentUpdateBlobs` and the helpers on top of
 * it) and then decode the Change blob the daemon stored, to show that:
 *
 *  - an auto-link card appended to a parent stores the new block and one move, not a re-move of
 *    every root block;
 *  - applying the same ops a second time is not a change at all;
 *  - block content survives the trip native op → proto JSON → stored block unchanged;
 *  - the agents service's write tool, editing one block of a document, stores that one block, and
 *    writing the same document again stores nothing (apps/scripts/prepare-change-write.ts).
 *
 * The Seed API is served in process (the same handlers the web and desktop apps mount) on top of
 * the daemon's gRPC, so no web server is needed.
 */

import {createGrpcWebTransport} from '@connectrpc/connect-node'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {execSync, spawn} from 'child_process'
import {mkdtempSync, rmSync} from 'fs'
import {createServer, type Server} from 'http'
import {tmpdir} from 'os'
import * as path from 'path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {generateTestAccount, type TestAccount} from '../frontend/apps/cli/src/test/account-helpers'
import {createSignerFromKey} from '../frontend/apps/cli/src/utils/signer'
import {createDocumentUpdateBlobs} from '../frontend/packages/client/src/apps'
import {
  computeReplaceOps,
  createBlocksMap,
  hmBlockNodeToBlockNode,
  toAPIBlockNode,
} from '../frontend/packages/client/src/block-diff'
import {
  autoLinkChildToParent,
  createDocumentBlobs,
  createSeedClient,
  documentOperationsToChanges,
  documentUpdateBlobs,
  isEmptyPreparedChange,
  prepareDocumentUpdateBlobs,
  resolveEditableDocument,
  SeedClientError,
  unpackHmId,
  type DocumentOperation,
  type HMBlockNode,
  type SeedClient,
} from '../frontend/packages/client/src/index'
import {handleApiAction, handleApiRequest} from '../frontend/packages/shared/src/api-server'
import {createGRPCClient} from '../frontend/packages/shared/src/grpc-client'
import {spawnDaemon, type DaemonInstance} from './integration/daemon'
import {
  cloneTree,
  createTreeFuzzer,
  flatTree,
  newFuzzStats,
  recordFuzzRound,
  reportStats,
  treeShape,
  type Tree,
} from './integration/tree-fuzz'

const HTTP_PORT = 59411
const DAEMON_URL = `http://localhost:${HTTP_PORT}`

let daemon: DaemonInstance
let dataDir: string
let client: SeedClient
let account: TestAccount
let signer: ReturnType<typeof createSignerFromKey>

/** A fetch that answers `/api/*` with the Seed API handlers, on top of the daemon's gRPC. */
function inProcessSeedApi(): typeof globalThis.fetch {
  const grpcClient = createGRPCClient(createGrpcWebTransport({baseUrl: DAEMON_URL, httpVersion: '1.1'}))
  const queryDaemon = async <T>(pathAndQuery: string): Promise<T> => {
    const response = await fetch(`${DAEMON_URL}${pathAndQuery}`)
    if (!response.ok) throw new Error(`Failed to fetch ${pathAndQuery}: ${response.statusText}`)
    return (await response.json()) as T
  }
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const result =
      init?.method === 'POST'
        ? await handleApiAction(
            url.pathname.replace(/^\/api\//, '').split('/')[0]!,
            new Uint8Array(init.body as ArrayBuffer),
            grpcClient,
            queryDaemon,
          )
        : await handleApiRequest(url, grpcClient, queryDaemon)
    return new Response(result.body, {status: result.status, headers: result.headers})
  }) as typeof globalThis.fetch
}

/**
 * The same Seed API on a real port, for a process that is not this one (the agents service runs
 * under Bun). `/ipfs/` goes to the daemon, as it does on a site.
 */
async function serveSeedApi(port: number): Promise<Server> {
  const api = inProcessSeedApi()
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = Buffer.concat(chunks)
      const isApi = req.url?.startsWith('/api/')
      const init: RequestInit = {
        method: req.method,
        ...(req.method === 'POST' ? {body: new Uint8Array(body).buffer} : {}),
      }
      const response = isApi
        ? await api(`http://localhost:${port}${req.url}`, init)
        : req.url?.startsWith('/ipfs/')
          ? await fetch(`${DAEMON_URL}${req.url}`, init)
          : new Response('Not found', {status: 404})
      res.writeHead(response.status, Object.fromEntries(response.headers))
      res.end(Buffer.from(await response.arrayBuffer()))
    } catch (error) {
      res.writeHead(500, {'Content-Type': 'application/json'})
      res.end(JSON.stringify({error: (error as Error).message}))
    }
  })
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve))
  return server
}

/** The ops of a stored Change blob, read back from the daemon's blob store. */
async function storedOps(cid: string): Promise<Array<Record<string, any>>> {
  const response = await fetch(`${DAEMON_URL}/ipfs/${cid}`)
  if (!response.ok) throw new Error(`blob ${cid}: ${response.status}`)
  const change = cborDecode(new Uint8Array(await response.arrayBuffer())) as {body?: {ops?: any[]}}
  return change.body?.ops ?? []
}

/**
 * Decodes CBOR keeping what a JSON-style decode loses: whether a number was written as an
 * integer (`{int}`) or as a float (`{float}`). Enough of CBOR for a Change blob.
 */
function typedCbor(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 0
  const length = (info: number): number => {
    if (info < 24) return info
    const size = 1 << (info - 24)
    const value =
      size === 8
        ? Number(view.getBigUint64(at))
        : size === 4
          ? view.getUint32(at)
          : size === 2
            ? view.getUint16(at)
            : view.getUint8(at)
    at += size
    return value
  }
  const read = (): unknown => {
    const head = view.getUint8(at++)
    const major = head >> 5
    const info = head & 31
    if (major === 0) return {int: length(info)}
    if (major === 1) return {int: -1 - length(info)}
    if (major === 2 || major === 3) {
      const size = length(info)
      const slice = bytes.subarray(at, at + size)
      at += size
      return major === 3 ? new TextDecoder().decode(slice) : `bytes:${size}`
    }
    if (major === 4) return Array.from({length: length(info)}, read)
    if (major === 5) {
      const out: Record<string, unknown> = {}
      for (let count = length(info); count > 0; count--) out[String(read())] = read()
      return out
    }
    if (major === 6) {
      length(info)
      return {tag: read()}
    }
    if (info === 20) return false
    if (info === 21) return true
    if (info === 22) return null
    if (info === 27) {
      at += 8
      return {float: view.getFloat64(at - 8)}
    }
    if (info === 26) {
      at += 4
      return {float: view.getFloat32(at - 4)}
    }
    throw new Error(`typedCbor: unsupported head ${head}`)
  }
  return read()
}

/** The blocks a stored Change replaces, by id, decoded with {@link typedCbor}. */
async function storedTypedBlocks(cid: string): Promise<Record<string, Record<string, unknown>>> {
  const response = await fetch(`${DAEMON_URL}/ipfs/${cid}`)
  const change = typedCbor(new Uint8Array(await response.arrayBuffer())) as {body?: {ops?: any[]}}
  const byId: Record<string, Record<string, unknown>> = {}
  for (const op of change.body?.ops ?? []) {
    if (op.type === 'ReplaceBlock') byId[op.block.id] = op.block
  }
  return byId
}

async function readDocument(docPath: string) {
  const resource = await client.request('Resource', {
    ...unpackHmId(`hm://${account.accountId}${docPath}`)!,
    latest: true,
  })
  if (resource.type !== 'document') throw new Error(`${docPath} is ${resource.type}`)
  return resource.document
}

/** Content without the per-block `revision`, which names the Change that last wrote the block. */
function withoutRevisions(nodes: HMBlockNode[] | undefined): unknown {
  return (nodes ?? []).map((node) => {
    const {revision: _revision, ...block} = node.block as Record<string, unknown>
    return {block, children: withoutRevisions(node.children)}
  })
}

async function createDocument(docPath: string, ops: DocumentOperation[]) {
  const created = await createDocumentBlobs(signer, {space: account.accountId, path: docPath, ops})
  await client.publish({blobs: created.blobs})
}

function paragraph(id: string, text: string): DocumentOperation {
  return {type: 'ReplaceBlock', block: {id, type: 'Paragraph', text, annotations: []}}
}

describe('document updates through PrepareDocumentChange', () => {
  beforeAll(async () => {
    dataDir = mkdtempSync(path.join(tmpdir(), 'seed-prepare-change-test-'))
    daemon = await spawnDaemon({httpPort: HTTP_PORT, grpcPort: HTTP_PORT + 1, p2pPort: HTTP_PORT + 2, dataDir})
    await daemon.waitForReady()
    client = createSeedClient('http://seed-api.test', {fetch: inProcessSeedApi()})
    account = generateTestAccount()
    signer = createSignerFromKey(account.keyPair)
    await createDocument('', [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'Prepare change test'}]}])
  }, 120_000)

  afterAll(async () => {
    await daemon?.kill()
    if (dataDir) rmSync(dataDir, {recursive: true, force: true})
  })

  it('appends an auto-link card as one new block and one move, leaving the root blocks alone', async () => {
    const roots = ['r1', 'r2', 'r3', 'r4']
    await createDocument('/parent', [
      {type: 'SetAttributes', attrs: [{key: ['name'], value: 'Parent'}]},
      ...roots.map((id) => paragraph(id, `Root ${id}`)),
      {type: 'MoveBlocks', blocks: roots, parent: ''},
    ])
    await createDocument('/parent/child', [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'Child'}]}])
    const before = await readDocument('/parent')
    const childHmUrl = `hm://${account.accountId}/parent/child`

    const linked = await autoLinkChildToParent({
      client,
      account: account.accountId,
      path: '/parent/child',
      childHmUrl,
      signer,
    })
    expect(linked).toBe(true)

    const after = await readDocument('/parent')
    expect(after.version).not.toBe(before.version)
    expect(after.genesis).toBe(before.genesis)
    const blocks = (after.content ?? []).map((node) => node.block)
    expect(blocks.map((block) => block.id).slice(0, 4)).toEqual(roots)
    expect(blocks).toHaveLength(5)
    const card = blocks[4]!
    expect(card).toMatchObject({type: 'Embed', link: childHmUrl, attributes: {view: 'Card'}})

    // The stored Change: the new block placed once, and its content. No root block is re-moved.
    const ops = await storedOps(after.version)
    expect(ops).toHaveLength(2)
    const move = ops.find((op) => op.type === 'MoveBlocks')!
    expect(move.blocks).toEqual([card.id])
    expect(move.ref).toBeDefined() // anchored after the last root block, not at the start
    expect(ops.find((op) => op.type === 'ReplaceBlock')!.block).toEqual({
      id: card.id,
      type: 'Embed',
      link: childHmUrl,
      view: 'Card',
    })

    // The parent now links the child, so a second call adds nothing.
    expect(
      await autoLinkChildToParent({client, account: account.accountId, path: '/parent/child', childHmUrl, signer}),
    ).toBe(false)
    expect((await readDocument('/parent')).version).toBe(after.version)
  })

  it('drops the moves of blocks already in place when ops re-list a whole level', async () => {
    // What a client-built Change used to store verbatim: the new block plus a MoveBlocks naming
    // every block of the level.
    const roots = ['a1', 'a2', 'a3']
    await createDocument('/relist', [
      ...roots.map((id) => paragraph(id, `Root ${id}`)),
      {type: 'MoveBlocks', blocks: roots, parent: ''},
    ])
    const update = await createDocumentUpdateBlobs({
      client,
      signer,
      id: unpackHmId(`hm://${account.accountId}/relist`)!,
      ops: [
        {type: 'ReplaceBlock', block: {id: 'a4', type: 'Paragraph', text: 'Root a4', annotations: []}},
        {type: 'MoveBlocks', blocks: [...roots, 'a4'], parent: ''},
      ],
    })
    expect(update.changed).toBe(true)
    await client.publish({blobs: update.blobs})

    const after = await readDocument('/relist')
    expect((after.content ?? []).map((node) => node.block.id)).toEqual([...roots, 'a4'])
    const moves = (await storedOps(after.version)).filter((op) => op.type === 'MoveBlocks')
    expect(moves).toHaveLength(1)
    expect(moves[0]!.blocks).toEqual(['a4'])
  })

  it('makes no change when the same ops are applied a second time', async () => {
    await createDocument('/twice', [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'Twice'}]}])
    const id = unpackHmId(`hm://${account.accountId}/twice`)!
    const ops: DocumentOperation[] = [
      {type: 'SetAttributes', attrs: [{key: ['summary'], value: 'Applied twice'}]},
      {type: 'ReplaceBlock', block: {id: 'h1', type: 'Heading', text: 'Title', annotations: []}},
      {
        type: 'ReplaceBlock',
        block: {
          id: 'p1',
          type: 'Paragraph',
          text: 'hello world',
          annotations: [
            {type: 'Bold', starts: [0], ends: [5]},
            {type: 'Link', link: 'https://example.com', starts: [6], ends: [11]},
          ],
        },
      },
      {type: 'ReplaceBlock', block: {id: 'c1', type: 'Code', text: 'let a = 1', language: 'ts', annotations: []}},
      {type: 'ReplaceBlock', block: {id: 'e1', type: 'Embed', link: `hm://${account.accountId}/parent`, view: 'Card'}},
      {type: 'MoveBlocks', blocks: ['p1', 'c1'], parent: 'h1'},
      {type: 'MoveBlocks', blocks: ['h1', 'e1'], parent: ''},
    ]

    const first = await createDocumentUpdateBlobs({client, signer, id, ops})
    expect(first.changed).toBe(true)
    expect(first.blobs).toHaveLength(2) // the Change and its Ref
    await client.publish({blobs: first.blobs})
    const applied = await readDocument('/twice')
    expect(applied.metadata.summary).toBe('Applied twice')
    expect((applied.content ?? []).map((node) => node.block.id)).toEqual(['h1', 'e1'])
    expect((applied.content?.[0]?.children ?? []).map((node) => node.block.id)).toEqual(['p1', 'c1'])

    // What the daemon itself answers for changes that are all already true: an unsigned Change
    // with no operations, not an error.
    const {unsignedChange} = await client.request('PrepareDocumentChange', {
      account: account.accountId,
      path: '/twice',
      baseVersion: applied.version,
      changes: documentOperationsToChanges(ops),
    })
    const prepared = cborDecode(unsignedChange) as {body?: {ops?: unknown[]; opCount?: number}; deps?: unknown[]}
    expect(prepared.body?.ops ?? []).toEqual([])
    expect(prepared.body?.opCount ?? 0).toBe(0)
    expect(prepared.deps).toHaveLength(1)
    expect(isEmptyPreparedChange(unsignedChange)).toBe(true)

    // So the helpers report "no change" and hand back nothing to publish.
    const second = await createDocumentUpdateBlobs({client, signer, id, ops})
    expect(second.changed).toBe(false)
    expect(second.blobs).toEqual([])
    const direct = await prepareDocumentUpdateBlobs({
      client,
      signer,
      account: account.accountId,
      path: '/twice',
      baseVersion: applied.version,
      ops,
      content: applied.content,
    })
    expect(direct).toEqual({changed: false, blobs: [], version: applied.version})
    expect((await readDocument('/twice')).version).toBe(applied.version)

    // One block edited among the same ops: only that block is stored.
    const edited = ops.map((op) =>
      op.type === 'ReplaceBlock' && (op.block as {id: string}).id === 'c1'
        ? {...op, block: {...(op.block as object), text: 'let a = 2'}}
        : op,
    )
    const third = await createDocumentUpdateBlobs({client, signer, id, ops: edited})
    expect(third.changed).toBe(true)
    await client.publish({blobs: third.blobs})
    const final = await readDocument('/twice')
    expect(await storedOps(final.version)).toEqual([
      {type: 'ReplaceBlock', block: {id: 'c1', type: 'Code', text: 'let a = 2', language: 'ts'}},
    ])
  })

  it('stores the same blocks through the daemon as a client-built Change does', async () => {
    const image = 'ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'
    const blocks: Record<string, unknown>[] = [
      {id: 'h1', type: 'Heading', text: 'Round trip — ünïcödé 👩‍💻', annotations: []},
      {
        id: 'p1',
        type: 'Paragraph',
        text: 'bold italic link and a mention ￼ here',
        annotations: [
          {type: 'Bold', starts: [0], ends: [4]},
          {type: 'Italic', starts: [5, 12], ends: [11, 16]},
          {type: 'Link', link: 'https://example.com/a?b=c#d', starts: [12], ends: [16]},
          {type: 'Embed', link: `hm://${account.accountId}`, starts: [31], ends: [32]},
        ],
      },
      {id: 'p2', type: 'Paragraph', text: '', annotations: []},
      {
        id: 'l1',
        type: 'Paragraph',
        text: 'A list',
        childrenType: 'Ordered',
        listLevel: '1',
        start: '3',
        annotations: [],
      },
      {id: 'li1', type: 'Paragraph', text: 'item', annotations: []},
      {id: 'c1', type: 'Code', text: 'const a = 1\n\tb()\n', language: 'typescript', annotations: []},
      {id: 'm1', type: 'Math', text: 'e^{i\\pi} + 1 = 0', annotations: []},
      {id: 'i1', type: 'Image', text: 'caption', link: image, width: 640, name: 'photo.png', annotations: []},
      {id: 'v1', type: 'Video', link: image, autoplay: true, loop: false, width: 512.5},
      {id: 'e1', type: 'Embed', link: `hm://${account.accountId}/parent?l`, view: 'Card'},
      {id: 'w1', type: 'WebEmbed', link: 'https://example.com/post/1'},
      {
        id: 'q1',
        type: 'Query',
        style: 'Card',
        columnCount: 3,
        banner: false,
        query: {
          includes: [{space: account.accountId, path: 'parent', mode: 'Children'}],
          sort: [{term: 'UpdateTime', reverse: true}],
          limit: 10,
          ratio: 0.25,
          nested: {deep: [1, 'two', false, null, {three: 3}]},
        },
      },
      {id: 't1', type: 'Table'},
      {id: 'tc1', type: 'TableColumn', width: 120, isHeader: true},
      {id: 'tc2', type: 'TableColumn'},
      {id: 'tr1', type: 'TableRow', isHeader: true},
      {id: 'cell1', type: 'Paragraph', text: 'Name', columnId: 'tc1', annotations: []},
      {id: 'cell2', type: 'Paragraph', text: 'Value', columnId: 'tc2', annotations: []},
      // A null attribute beside the block's fields (an attribute cleared in place).
      {id: 'n1', type: 'Paragraph', text: 'cleared', childrenType: null, annotations: []},
      // The older native form: attributes nested in an `attributes` map.
      {id: 'old1', type: 'Embed', link: `hm://${account.accountId}/twice`, attributes: {view: 'Content'}},
    ]
    const ops: DocumentOperation[] = [
      {
        type: 'SetAttributes',
        attrs: [
          {key: ['summary'], value: 'Every kind of value'},
          {key: ['count'], value: 5},
          {key: ['published'], value: true},
          {key: ['theme', 'headerLayout'], value: 'Center'},
          {key: ['cleared'], value: null},
        ],
      },
      ...blocks.map((block) => ({type: 'ReplaceBlock', block}) as DocumentOperation),
      {type: 'MoveBlocks', blocks: ['li1'], parent: 'l1'},
      {type: 'MoveBlocks', blocks: ['cell1', 'cell2'], parent: 'tr1'},
      {type: 'MoveBlocks', blocks: ['tc1', 'tc2', 'tr1'], parent: 't1'},
      {
        type: 'MoveBlocks',
        blocks: ['h1', 'p1', 'p2', 'l1', 'c1', 'm1', 'i1', 'v1', 'e1', 'w1', 'q1', 't1', 'n1', 'old1'],
        parent: '',
      },
    ]
    const name: DocumentOperation = {type: 'SetAttributes', attrs: [{key: ['name'], value: 'Round trip'}]}

    // Client-built: the ops are encoded and stored exactly as written.
    await createDocument('/native', [name, ...ops])
    // Daemon-built: the same ops, converted and applied by PrepareDocumentChange.
    await createDocument('/prepared', [name])
    const base = await readDocument('/prepared')
    const update = await prepareDocumentUpdateBlobs({
      client,
      signer,
      account: account.accountId,
      path: '/prepared',
      baseVersion: base.version,
      ops,
      content: base.content ?? [],
    })
    expect(update.changed).toBe(true)
    await client.publish({blobs: update.blobs})

    const native = await readDocument('/native')
    const prepared = await readDocument('/prepared')
    expect(prepared.version).toBe(update.changed ? update.version : '')

    // The documents read the same: tree, text, annotations, links and attributes.
    expect((prepared.content ?? []).length).toBe(14)
    expect(withoutRevisions(prepared.content)).toEqual(withoutRevisions(native.content))
    expect(prepared.metadata).toEqual(native.metadata)

    // And the stored blocks are the same values. The daemon leaves out an empty `text` and an
    // empty `annotations` list and writes nested attributes inline; a reader sees no difference.
    const storedBlocks = async (version: string) => {
      const byId: Record<string, unknown> = {}
      for (const op of await storedOps(version)) {
        if (op.type !== 'ReplaceBlock') continue
        const {attributes, ...block} = op.block as Record<string, any>
        if (block.text === '') delete block.text
        if (Array.isArray(block.annotations) && !block.annotations.length) delete block.annotations
        byId[block.id] = {...block, ...(attributes ?? {})}
      }
      return byId
    }
    const nativeBlocks = await storedBlocks(native.version)
    const preparedBlocks = await storedBlocks(prepared.version)
    expect(Object.keys(preparedBlocks).sort()).toEqual(blocks.map((block) => block.id as string).sort())
    expect(preparedBlocks).toEqual(nativeBlocks)
    // No protobuf Struct shape leaked into the stored attributes.
    expect(JSON.stringify(preparedBlocks)).not.toMatch(/"fields"|"kind"|"structValue"|"numberValue"/)

    // The numbers are the same kind of number in the stored bytes, which a decode to JS numbers
    // cannot show: a whole number is a CBOR integer both ways, nested ones included (the request
    // carries attributes as a protobuf Struct, whose numbers are all doubles), and a fraction is
    // a float both ways.
    const nativeTyped = await storedTypedBlocks(native.version)
    const preparedTyped = await storedTypedBlocks(prepared.version)
    const query = (typed: typeof nativeTyped) => (typed.q1!.attributes ?? typed.q1!) as Record<string, any>
    for (const typed of [nativeTyped, preparedTyped]) {
      expect(query(typed).columnCount).toEqual({int: 3})
      expect(query(typed).query.limit).toEqual({int: 10})
      expect(query(typed).query.ratio).toEqual({float: 0.25})
      expect(query(typed).query.nested.deep[0]).toEqual({int: 1})
      expect(query(typed).query.nested.deep[4].three).toEqual({int: 3})
      expect((typed.i1!.attributes ?? typed.i1!).width).toEqual({int: 640})
      expect((typed.v1!.attributes ?? typed.v1!).width).toEqual({float: 512.5})
      // The null attribute is stored as a null, not dropped and not turned into something else.
      expect('childrenType' in ((typed.n1!.attributes as object) ?? typed.n1!)).toBe(true)
      expect(((typed.n1!.attributes as any) ?? typed.n1!).childrenType).toBeNull()
    }
    expect(query(preparedTyped).query).toEqual(query(nativeTyped).query)

    const attrs = (version: string) =>
      storedOps(version).then((stored) =>
        stored
          .filter((op) => op.type === 'SetAttributes')
          .flatMap((op) => op.attrs as {key: string[]; value: unknown}[])
          .filter((attr) => attr.key.join('.') !== 'name')
          .sort((a, b) => a.key.join('.').localeCompare(b.key.join('.'))),
      )
    expect(await attrs(prepared.version)).toEqual(await attrs(native.version))
    expect(await attrs(prepared.version)).toHaveLength(5)
  })

  /** The document's block ids as a nested list: `['a', ['b', ['c']]]` is `a`, then `b` with child `c`. */
  const shape = (content: HMBlockNode[] | undefined): unknown[] =>
    (content ?? []).map((n) => (n.children?.length ? [n.block.id, shape(n.children)] : n.block.id))

  const flat = flatTree
  const toShape = treeShape
  const toNodes = (tree: Tree): HMBlockNode[] =>
    tree.map(
      (t) =>
        ({
          block: {id: t.id, type: 'Paragraph', text: `Text ${t.id}`, annotations: [], attributes: {}},
          children: toNodes(t.children),
        }) as unknown as HMBlockNode,
    )

  /** The ops that bring the document to `tree`, with the base they were computed against. */
  async function opsFor(docPath: string, tree: Tree) {
    const id = unpackHmId(`hm://${account.accountId}${docPath}`)!
    const base = await resolveEditableDocument(client, id)
    const ops = computeReplaceOps(
      createBlocksMap((base.document.content ?? []).map(toAPIBlockNode)),
      toNodes(tree).map(hmBlockNodeToBlockNode),
    )
    return {id, base, ops}
  }

  /** Brings the document to `tree` through createDocumentUpdateBlobs and reads its block tree back. */
  async function writeTree(docPath: string, tree: Tree) {
    const {id, base, ops} = await opsFor(docPath, tree)
    if (!ops.length) return {got: shape(base.document.content), moves: [] as string[][], published: false}
    const update = await createDocumentUpdateBlobs({client, signer, id, ops})
    if (update.blobs.length) await client.publish({blobs: update.blobs})
    const after = await readDocument(docPath)
    const stored = update.changed ? await storedOps(after.version) : []
    return {
      got: shape(after.content),
      moves: stored.filter((op) => op.type === 'MoveBlocks').map((op) => op.blocks as string[]),
      ops: stored,
      published: update.changed,
      builtBy: update.builtBy,
      localReason: update.localReason,
      version: after.version,
    }
  }

  /** The same through documentUpdateBlobs itself, for the options createDocumentUpdateBlobs does not pass on. */
  async function updateTree(
    docPath: string,
    tree: Tree,
    options: Partial<Parameters<typeof documentUpdateBlobs>[0]> = {},
  ) {
    const {base, ops} = await opsFor(docPath, tree)
    const update = await documentUpdateBlobs({
      client,
      signer,
      account: account.accountId,
      path: docPath,
      state: base.state,
      ops,
      content: base.document.content ?? [],
      documentVersion: base.document.version,
      currentGeneration: base.document.generationInfo?.generation,
      ...options,
    })
    if (update.changed) await client.publish({blobs: update.blobs})
    const after = await readDocument(docPath)
    return {update, got: shape(after.content), version: after.version, headTs: base.state.headTs}
  }

  /** A new document holding `tree`. */
  async function startTree(docPath: string, tree: Tree) {
    await createDocument(docPath, [{type: 'SetAttributes', attrs: [{key: ['name'], value: docPath}]}])
    const written = await writeTree(docPath, tree)
    expect(written.got).toEqual(toShape(tree))
  }

  /** The timestamp of a stored Change. */
  async function storedTs(cid: string): Promise<number> {
    const response = await fetch(`${DAEMON_URL}/ipfs/${cid}`)
    return Number((cborDecode(new Uint8Array(await response.arrayBuffer())) as {ts: number | bigint}).ts)
  }

  /** The daemon's CPU use right now, in percent of one core. */
  const daemonCpu = () => Number(execSync(`ps -o %cpu= -p ${daemon.process.pid}`).toString().trim())

  it('places blocks where the ops put them: after the first block, moved to the end, moved together', async () => {
    const start = async (docPath: string, ...ids: string[]) => {
      await createDocument(docPath, [
        {type: 'SetAttributes', attrs: [{key: ['name'], value: docPath}]},
        ...ids.map((id) => paragraph(id, `Text ${id}`)),
        {type: 'MoveBlocks', blocks: ids, parent: ''},
      ])
    }
    // A new block after the unchanged first block (the daemon put it first when the level was
    // re-listed from its first block).
    await start('/place-insert', 'f1', 'f2', 'f3')
    const inserted = await writeTree('/place-insert', flat('f1', 'n1', 'f2', 'f3'))
    expect(inserted.got).toEqual(['f1', 'n1', 'f2', 'f3'])
    expect(inserted.moves).toEqual([['n1']])

    // One block moved to the end (sent as a chain, the daemon stored only the move of `c`).
    await start('/place-end', 'a', 'b', 'c', 'd')
    const toEnd = await writeTree('/place-end', flat('a', 'c', 'd', 'b'))
    expect(toEnd.got).toEqual(['a', 'c', 'd', 'b'])
    expect(toEnd.moves).toEqual([['b']])

    // Neighbours that move together cannot be asked of the daemon: built here, as listed.
    await start('/place-together', 'a', 'b', 'c', 'd')
    const together = await writeTree('/place-together', flat('c', 'd', 'a', 'b'))
    expect(together.got).toEqual(['c', 'd', 'a', 'b'])
    expect(together.moves).toEqual([['c', 'd', 'a', 'b']])
  })

  it('adds two or more new parents with their children in one update', async () => {
    const node = (id: string, ...children: Tree): Tree[number] => ({id, children})
    // The daemon refused these ("desired parent block is not in the tree") when a move came
    // before the content of a new parent.
    await startTree('/new-parents', flat('a', 'b'))
    const sections: Tree = [
      node('a', node('x1')),
      node('b'),
      node('P', node('c'), node('d')),
      node('Q', node('e', node('f'))),
    ]
    const added = await writeTree('/new-parents', sections)
    expect(added.got).toEqual(toShape(sections))
    expect(added.builtBy).toBe('server')
    // Each new block is placed once and stored once; `a` and `b` are not touched.
    expect(added.moves.flat().sort()).toEqual(['P', 'Q', 'c', 'd', 'e', 'f', 'x1'])
    expect(added.ops!.filter((op) => op.type === 'ReplaceBlock')).toHaveLength(7)

    // A nested list with two new parents under an existing block, and a delete in the same update.
    const list: Tree = [
      node('a', node('x1'), node('L1', node('i1'), node('i2')), node('L2', node('i3'))),
      node('P', node('c'), node('d')),
      node('Q', node('e', node('f'))),
    ]
    const nested = await writeTree('/new-parents', list)
    expect(nested.got).toEqual(toShape(list))
    expect(nested.builtBy).toBe('server')
  })

  it('builds a parent and child swapping places here, and never sends it', async () => {
    const before: Tree = [{id: 'a', children: [{id: 'b', children: flat('c')}]}]
    await startTree('/swap', before)
    const swapped: Tree = [{id: 'b', children: [{id: 'a', children: []}, ...flat('c')]}]
    const cpu = daemonCpu()
    const result = await writeTree('/swap', swapped)
    expect(result.got).toEqual(toShape(swapped))
    expect(result.builtBy).toBe('local')
    expect(result.localReason).toContain('under a block that is, or was, inside it')
    expect(daemonCpu()).toBeLessThan(Math.max(50, cpu + 40))
  })

  it('stores a small Change for one new leaf in a nested document with a long history of moves', async () => {
    // Every block of the path to the leaf has been moved back and forth among its siblings, which
    // leaves a stale entry per move in the daemon's lists. A daemon that walks those entries
    // repeats each move of the request once per entry, multiplied down the path: a one-block
    // insert came back as 196 MoveBlocks ops, and megabytes after more moves.
    const node = (id: string, ...children: Tree): Tree[number] => ({id, children})
    const build = (order: boolean): Tree => {
      const pair = (a: Tree[number], b: Tree[number]) => (order ? [a, b] : [b, a])
      return pair(
        node(
          'A',
          ...pair(node('B', ...pair(node('C', ...pair(node('D', node('leaf')), node('d2'))), node('c2'))), node('b2')),
        ),
        node('a2'),
      )
    }
    await startTree('/move-history', build(true))
    for (let round = 0; round < 6; round++) {
      const written = await writeTree('/move-history', build(round % 2 === 1))
      expect(written.got).toEqual(toShape(build(round % 2 === 1)))
    }
    const tree = build(true)
    const withLeaf = cloneTree(tree)
    const parentOfLeaf = (nodes: Tree): Tree[number] =>
      nodes.find((n) => n.id === 'D') ?? parentOfLeaf(nodes.flatMap((n) => n.children))
    parentOfLeaf(withLeaf).children.push({id: 'leaf2', children: []})

    const inserted = await writeTree('/move-history', withLeaf)
    expect(inserted.got).toEqual(toShape(withLeaf))
    // Minimal from the daemon (one move, one block), or built here as listed (one block, the
    // level's two blocks): either way a handful of ops and well under a kilobyte.
    const placed = inserted.moves.flat()
    expect(inserted.ops!.length).toBeLessThanOrEqual(3)
    expect(placed.length).toBeLessThanOrEqual(2)
    expect(placed).toContain('leaf2')
    const bytes = (await (await fetch(`${DAEMON_URL}/ipfs/${inserted.version}`)).arrayBuffer()).byteLength
    expect(bytes).toBeLessThan(1024)
    reportStats(
      `MOVE-HISTORY one-leaf insert: builtBy=${inserted.builtBy} ops=${inserted.ops!.length} bytes=${bytes}` +
        (inserted.localReason ? ` reason=${inserted.localReason}` : ''),
    )
  })

  it('keeps every Change later than the Changes it builds on, whichever clock is behind', async () => {
    const tooLarge: Pick<SeedClient, 'request'> = {
      request: (async (key: string, input: never, options?: never) => {
        if (key === 'PrepareDocumentChange') {
          throw new SeedClientError('HTTP 413 from PrepareDocumentChange: Payload Too Large', 413, '')
        }
        return client.request(key as never, input, options)
      }) as SeedClient['request'],
    }
    /** The document still reads, holds `tree`, and takes a further prepared update. */
    const stillWorks = async (docPath: string, tree: Tree) => {
      expect(shape((await readDocument(docPath)).content)).toEqual(toShape(tree))
      const further = [...cloneTree(tree), {id: `after-${docPath.slice(1)}`, children: []}]
      const next = await updateTree(docPath, further)
      expect(next.got).toEqual(toShape(further))
      return next
    }

    // 1. This machine's clock is behind the site's. The heads carry the site's clock (a prepared
    //    Change), and a Change built here on top must still be later than them.
    const lagging = () => Date.now() - 5_000
    for (const [name, route] of [
      ['unpreparable', {}],
      ['too-large', {client: tooLarge}],
    ] as const) {
      const docPath = `/lag-${name}`
      await startTree(docPath, flat('a', 'b', 'c', 'd'))
      const prepared = await updateTree(docPath, flat('a', 'n', 'b', 'c', 'd'))
      expect(prepared.update.changed && prepared.update.builtBy).toBe('server')
      // Neighbours moving together are unpreparable; the other route is refused with a 413.
      const tree = name === 'unpreparable' ? flat('c', 'd', 'a', 'n', 'b') : flat('a', 'b', 'c', 'd')
      const local = await updateTree(docPath, tree, {...route, now: lagging})
      if (!local.update.changed) throw new Error('expected a change')
      expect(local.update.builtBy).toBe('local')
      expect(local.got).toEqual(toShape(tree))
      const headTs = await storedTs(prepared.version)
      // ListChanges reports the head's time exactly, to the millisecond.
      expect(local.headTs).toBe(headTs)
      expect(await storedTs(local.version)).toBe(headTs + 1)
      expect(local.update.ts).toBe(headTs + 1)
      const next = await stillWorks(docPath, tree)
      expect(next.update.changed && next.update.builtBy).toBe('server')
    }

    // 2. This machine's clock is ahead of the site's. A Change built here is then later than the
    //    site's clock; the site cannot prepare the next one ("must be greater than ts of its
    //    dependency"), so that one is built here too, one millisecond after the head.
    // (Under the 40 seconds the daemon tolerates: a Change stamped further ahead than that is
    // stored and then not read, which no client-side stamp can repair.)
    const ahead = () => Date.now() + 20_000
    for (const [name, route] of [
      ['unpreparable', {}],
      ['too-large', {client: tooLarge}],
    ] as const) {
      const docPath = `/ahead-${name}`
      await startTree(docPath, flat('a', 'b', 'c', 'd'))
      const tree = name === 'unpreparable' ? flat('c', 'd', 'a', 'b') : flat('a', 'n', 'b', 'c', 'd')
      const local = await updateTree(docPath, tree, {...route, now: ahead})
      if (!local.update.changed) throw new Error('expected a change')
      expect(local.update.builtBy).toBe('local')
      expect(local.update.ts).toBeGreaterThan(Date.now() + 10_000)
      const next = await stillWorks(docPath, tree)
      if (!next.update.changed) throw new Error('expected a change')
      expect(next.update.builtBy).toBe('local')
      expect(next.update.localReason).toContain("clock is not past the time of the document's latest change")
      expect(next.update.ts).toBe(local.update.ts + 1)
      // And once more, so the Change after a fallback is checked too.
      const again = [...cloneTree(tree), {id: `after-${docPath.slice(1)}`, children: []}, {id: 'last', children: []}]
      expect((await updateTree(docPath, again)).got).toEqual(toShape(again))
    }
  })

  it('reads back every edit as written (seeded random edits through createDocumentUpdateBlobs)', async () => {
    const stats = newFuzzStats()
    const failures: string[] = []
    // Six documents, forty rounds of edits each, none of which leaves a parent/child inversion in
    // the document's history: a daemon without Seed PR #1375 never answers a request that moves
    // blocks in a document with one, and the daemon binary under plz-out/ may be that old (CI
    // builds the daemon from the branch). Each document then ends with one swap of a parent and
    // its child, which is built here and never sent, and is not written to again.
    for (const seed of [20261116, 7, 424242, 99991, 31337, 2718]) {
      const fuzzer = createTreeFuzzer(seed, {inversions: false})
      const docPath = `/random-${seed}`
      let tree: Tree = flat('a', 'b', 'c', 'd', 'e')
      tree[1]!.children = flat('p', 'q', 'r')
      await startTree(docPath, tree)
      for (let round = 0; round <= 40; round++) {
        const next = round < 40 ? fuzzer.mutate(tree) : fuzzer.swap(tree)
        if (!next) throw new Error(`seed ${seed}: no parent to swap in ${JSON.stringify(toShape(tree))}`)
        const label = `seed ${seed} round ${round} (${next.edits.join(', ')}): ${JSON.stringify(
          toShape(tree),
        )} -> ${JSON.stringify(toShape(next.tree))}`
        try {
          const result = await writeTree(docPath, next.tree)
          const right = JSON.stringify(result.got) === JSON.stringify(toShape(next.tree))
          recordFuzzRound(stats, {...result, edits: next.edits, right})
          if (!right) failures.push(`${label}: read back ${JSON.stringify(result.got)}`)
        } catch (error) {
          failures.push(`${label}: ${(error as Error).message}`)
          break
        }
        tree = next.tree
      }
    }
    reportStats(`FUZZ-STATS createDocumentUpdateBlobs ${JSON.stringify(stats)}`)
    expect(failures).toEqual([])
    expect(stats.rounds).toBe(246)
    expect(stats.server).toBeGreaterThan(20)
    expect(stats.wrong).toBe(0)
    expect(stats.edits.swap).toBe(6)
    // No round waited for a daemon that was never going to answer.
    expect(Object.keys(stats.reasons).filter((reason) => reason.includes('did not answer'))).toEqual([])
  }, 600_000)

  // The agents service is Bun-only, so its write tool runs in apps/scripts/prepare-change-write.ts
  // against this daemon, through the Seed API on a real port, and reports one JSON line per step.
  it('the agent write tool stores only what an edit changes, and survives what the daemon cannot prepare', async () => {
    const port = HTTP_PORT + 10
    const server = await serveSeedApi(port)
    try {
      const output = await new Promise<{code: number | null; stdout: string; stderr: string}>((resolve, reject) => {
        const proc = spawn('bun', ['scripts/prepare-change-write.ts', '--hm-server', `http://127.0.0.1:${port}`], {
          cwd: path.resolve(__dirname, '../apps'),
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = ''
        let stderr = ''
        proc.stdout.on('data', (chunk) => (stdout += chunk))
        proc.stderr.on('data', (chunk) => (stderr += chunk))
        proc.on('error', reject)
        proc.on('close', (code) => resolve({code, stdout, stderr}))
      })
      const lines = output.stdout.split('\n')
      const steps = lines
        .filter((line) => line.startsWith('{"step"'))
        .map((line) => JSON.parse(line) as {step: string; status: string; detail?: string})
      const stats = lines.find((line) => line.startsWith('{"stats"'))
      if (stats) reportStats(`FUZZ-STATS agents-write-tool ${JSON.stringify(JSON.parse(stats).stats)}`)
      const all = `${output.stdout}\n${output.stderr}`
      expect(
        steps.map((step) => step.step),
        all,
      ).toEqual([
        'an agent creates a multi-block document',
        'changing one block stores a change with only that block',
        'writing the same document again stores nothing',
        'adding a block at the end stores the block and one move',
        'removing a section deletes its blocks and moves nothing',
        'inserting a block after the first block of a level keeps the order',
        'a metadata map keeps its unchanged entries and loses the removed one',
        'a list and a fraction in metadata are stored, once, beside what the site prepared',
        'moving a block to the end, past blocks that stay, keeps the order',
        'moving two neighbouring blocks together keeps the order',
        'two new sections, a nested list with two parents and a new table arrive in one update',
        'with the service clock behind the site, Changes built here still follow the ones under them',
        'with the service clock ahead of the site, the next update is built here and the document still reads',
        'seeded random edits of a nested document all read back as written',
        'a document of every block kind writes back as nothing, exactly as read',
        'a body that lost its id comments keeps the ids of the blocks with text',
        'edits change the blocks they name and nothing else',
        'an edit that cannot apply publishes nothing',
        'a body that leaves out most of the document is refused unless forced',
        'one page of a long document cannot be its body, and is enough to edit it',
      ])
      for (const step of steps) expect(step.status, `${step.step}: ${step.detail}`).toBe('pass')
      expect(output.code, all).toBe(0)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  }, 600_000)

  // Last: against a daemon without Seed PR #1375 it leaves the daemon busy, and restarts it.
  it('gives up on a daemon that never answers and builds the Change here', async () => {
    // `q` was under `p`; then they swapped. The swap is built here and never sent (see above),
    // but the document's history now holds both placements. A daemon without Seed PR #1375 walks
    // them without end: any request that moves or deletes a block in this document makes it spin.
    // That is the daemon a developer is likely to have under plz-out/. CI builds the daemon from
    // the branch, so once the fix is on main the request below is simply answered.
    await startTree('/turned', [{id: 'p', children: flat('q')}])
    const swapped: Tree = [{id: 'q', children: flat('p')}]
    const swap = await writeTree('/turned', swapped)
    expect(swap.got).toEqual(toShape(swapped))
    expect(swap.builtBy).toBe('local')
    expect(swap.localReason).toContain('under a block that is, or was, inside it')

    // An update that moves nothing is prepared by either daemon: only the walk over moves hangs.
    const {base} = await opsFor('/turned', swapped)
    const text = await documentUpdateBlobs({
      client,
      signer,
      account: account.accountId,
      path: '/turned',
      state: base.state,
      ops: [{type: 'ReplaceBlock', block: {id: 'p', type: 'Paragraph', text: 'edited', annotations: []}}],
      content: base.document.content ?? [],
      documentVersion: base.document.version,
    })
    expect(text.changed && text.builtBy).toBe('server')
    if (text.changed) await client.publish({blobs: text.blobs})

    // A new block moves blocks, and nothing here looks at the history first: the request is sent.
    const more: Tree = [...cloneTree(swapped), ...flat('y')]
    const waited = Date.now()
    const edited = await updateTree('/turned', more, {prepareTimeoutMs: 1_500})
    expect(Date.now() - waited).toBeLessThan(6_000)
    expect(edited.got).toEqual(toShape(more))
    if (!edited.update.changed) throw new Error('expected a change')
    if (edited.update.builtBy === 'server') {
      reportStats('UNANSWERED the daemon answered for a document with an inversion in its history (it has the fix)')
      return
    }

    // The daemon never answered; the helper stopped waiting after its timeout and built the
    // Change here.
    expect(edited.update.localReason).toContain('did not answer within 1.5 s')

    // The abandoned request is still running in the daemon and will not stop. Kill the daemon
    // and start it again on the same data, so nothing is left spinning and the rest is checked
    // against a clean process.
    await new Promise((resolve) => setTimeout(resolve, 500))
    const busy = daemonCpu()
    reportStats(`UNANSWERED daemon CPU after the abandoned request: ${busy}%`)
    daemon.process.kill('SIGKILL')
    await new Promise((resolve) => daemon.process.once('close', resolve))
    daemon = await spawnDaemon({httpPort: HTTP_PORT, grpcPort: HTTP_PORT + 1, p2pPort: HTTP_PORT + 2, dataDir})
    await daemon.waitForReady()
    expect(shape((await readDocument('/turned')).content)).toEqual(toShape(more))
    // The helper remembers the unanswered document and does not ask again for a while.
    const after: Tree = [...cloneTree(more), ...flat('x')]
    const remembered = await updateTree('/turned', after, {prepareTimeoutMs: 1_500})
    expect(remembered.got).toEqual(toShape(after))
    expect(remembered.update.changed && remembered.update.localReason).toContain('did not answer an earlier request')
    expect(daemonCpu()).toBeLessThan(50)
  }, 60_000)
})
