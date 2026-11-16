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
 *  - block content survives the trip native op → proto JSON → stored block unchanged.
 *
 * The Seed API is served in process (the same handlers the web and desktop apps mount) on top of
 * the daemon's gRPC, so no web server is needed.
 */

import {createGrpcWebTransport} from '@connectrpc/connect-node'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {mkdtempSync, rmSync} from 'fs'
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
  isEmptyPreparedChange,
  prepareDocumentUpdateBlobs,
  unpackHmId,
  type DocumentOperation,
  type HMBlockNode,
  type SeedClient,
} from '../frontend/packages/client/src/index'
import {handleApiAction, handleApiRequest} from '../frontend/packages/shared/src/api-server'
import {createGRPCClient} from '../frontend/packages/shared/src/grpc-client'
import {spawnDaemon, type DaemonInstance} from './integration/daemon'

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

/** The ops of a stored Change blob, read back from the daemon's blob store. */
async function storedOps(cid: string): Promise<Array<Record<string, any>>> {
  const response = await fetch(`${DAEMON_URL}/ipfs/${cid}`)
  if (!response.ok) throw new Error(`blob ${cid}: ${response.status}`)
  const change = cborDecode(new Uint8Array(await response.arrayBuffer())) as {body?: {ops?: any[]}}
  return change.body?.ops ?? []
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
        blocks: ['h1', 'p1', 'p2', 'l1', 'c1', 'm1', 'i1', 'v1', 'e1', 'w1', 'q1', 't1', 'old1'],
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
    expect((prepared.content ?? []).length).toBe(13)
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

  type Tree = Array<{id: string; children: Tree}>
  const flat = (...ids: string[]): Tree => ids.map((id) => ({id, children: []}))
  const toShape = (tree: Tree): unknown[] => tree.map((t) => (t.children.length ? [t.id, toShape(t.children)] : t.id))
  const toNodes = (tree: Tree): HMBlockNode[] =>
    tree.map(
      (t) =>
        ({
          block: {id: t.id, type: 'Paragraph', text: `Text ${t.id}`, annotations: [], attributes: {}},
          children: toNodes(t.children),
        }) as unknown as HMBlockNode,
    )

  /** Brings the document to `tree` through createDocumentUpdateBlobs and reads its block tree back. */
  async function writeTree(docPath: string, tree: Tree) {
    const id = unpackHmId(`hm://${account.accountId}${docPath}`)!
    const before = await readDocument(docPath)
    const ops = computeReplaceOps(
      createBlocksMap((before.content ?? []).map(toAPIBlockNode)),
      toNodes(tree).map(hmBlockNodeToBlockNode),
    )
    if (!ops.length) return {got: shape(before.content), moves: [] as string[][], published: false}
    const update = await createDocumentUpdateBlobs({client, signer, id, ops})
    if (update.blobs.length) await client.publish({blobs: update.blobs})
    const after = await readDocument(docPath)
    const moves = update.changed
      ? (await storedOps(after.version)).filter((op) => op.type === 'MoveBlocks').map((op) => op.blocks as string[])
      : []
    return {got: shape(after.content), moves, published: update.changed}
  }

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

  it('reads back every edit as written (seeded random edits through createDocumentUpdateBlobs)', async () => {
    let seed = 20261116
    const random = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed % n
    }
    const levels = (tree: Tree): Tree[] => [tree, ...tree.flatMap((t) => levels(t.children))]
    const clone = (tree: Tree): Tree => tree.map((t) => ({id: t.id, children: clone(t.children)}))
    let fresh = 0
    const mutate = (current: Tree): Tree => {
      const tree = clone(current)
      const all = levels(tree)
      const pick = () => all[random(all.length)]!
      const steps = 1 + random(2)
      for (let step = 0; step < steps; step++) {
        const kind = random(10)
        const from = pick()
        if (kind < 2 || from.length === 0) {
          const into = pick()
          into.splice(random(into.length + 1), 0, {id: `x${++fresh}`, children: []})
        } else if (kind < 3 && from.length > 1) {
          from.splice(random(from.length), 1)
        } else if (kind < 5) {
          // A run of one to three neighbours moves within its level.
          const length = 1 + random(Math.min(3, from.length))
          const run = from.splice(random(from.length - length + 1), length)
          from.splice(random(from.length + 1), 0, ...run)
        } else if (kind < 8) {
          const [block] = from.splice(random(from.length), 1)
          from.splice(random(from.length + 1), 0, block!)
        } else {
          // A childless block moves to another level (so it can never land inside itself).
          const leaves = from.filter((t) => t.children.length === 0)
          if (!leaves.length) continue
          const block = leaves[random(leaves.length)]!
          from.splice(from.indexOf(block), 1)
          const targets = levels(tree)
          const into = targets[random(targets.length)]!
          into.splice(random(into.length + 1), 0, block)
        }
      }
      return tree
    }

    await createDocument('/random', [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'Random'}]}])
    let tree: Tree = flat('a', 'b', 'c', 'd', 'e')
    tree[1]!.children = flat('p', 'q', 'r')
    expect((await writeTree('/random', tree)).got).toEqual(toShape(tree))
    let published = 0
    for (let round = 0; round < 60; round++) {
      const next = mutate(tree)
      const result = await writeTree('/random', next)
      if (result.published) published++
      expect(
        result.got,
        `round ${round}: ${JSON.stringify(toShape(tree))} -> ${JSON.stringify(toShape(next))}`,
      ).toEqual(toShape(next))
      tree = next
    }
    expect(published).toBeGreaterThan(30)
  }, 300_000)
})
