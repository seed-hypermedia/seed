/**
 * The write tool's document update, which lets the site compute the Change
 * (`PrepareDocumentChange`) so that only what differs from the document is stored.
 *
 * The site here is a fetch mock: it records what was asked of `PrepareDocumentChange` and what
 * was published. What a real daemon then stores is covered by
 * tests/prepare-change.integration.test.ts, which runs scripts/prepare-change-write.ts.
 */
import {afterEach, expect, spyOn, test} from 'bun:test'
import {Database} from 'bun:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import {serialize} from 'superjson'
import * as blobs from '@shm/shared/blobs'
import {unpackHmId} from '@seed-hypermedia/client'
import * as api from './api-service'
import * as sqlite from './sqlite'
import * as cbor from './cbor'
import {fakePreparedChange} from './prepare-change-test-server'

const VERSION = 'bafyreiccaudhs737unopajz7k2tjonmqucburxp45yjzfvvgy75bm66y5q'
const originalFetch = globalThis.fetch
const cleanup: (() => void)[] = []
afterEach(() => {
  globalThis.fetch = originalFetch
  while (cleanup.length) cleanup.pop()!()
})

async function context() {
  const db = new Database(':memory:')
  sqlite.openWithDatabase(db)
  const dir = fs.mkdtempSync(os.tmpdir() + '/update-prepare-')
  cleanup.push(() => {
    sqlite.closeDatabase(db)
    fs.rmSync(dir, {recursive: true, force: true})
  })
  const owner = blobs.generateNobleKeyPair()
  const service = new api.Service(db, dir, {hmServerUrl: 'https://hm.test'})
  const imported = await service.message(
    await api.createSignedEnvelope(owner, {action: {_: 'ImportSigningIdentity', seed: owner.seed}}),
  )
  if (imported._ !== 'ImportSigningIdentityResponse') throw Error('unexpected import')
  return {
    db,
    accountId: blobs.principalToString(owner.principal),
    agentId: 'update-test',
    definition: {signingKeys: [imported.identity.name]},
    hmServerUrl: 'https://hm.test',
    ipfsServerUrl: 'https://hm.test',
    publishEnabled: true,
    stateDir: dir,
  } as api.AgentServicePiToolContext
}

type RequestedChange = {op: {case: string; value: any}}
type StoredChange = {
  type: string
  body: {ops: Array<Record<string, any>>}
  deps: unknown[]
  depth: number
  ts: number | bigint
  signer: unknown
}

/** An unsigned Change with no operations: what a daemon answers when every change is already true. */
function emptyPreparedChange(requestBody: Uint8Array): Uint8Array {
  const prepared = cbor.decode<Record<string, any>>(fakePreparedChange(requestBody))
  return Uint8Array.from(cbor.encode({...prepared, body: {ops: [], opCount: 0}}))
}

/**
 * A site holding one document at `/test`. `prepare` answers PrepareDocumentChange (by default the
 * requested changes as a Change); everything asked and published is recorded.
 */
function site(
  accountId: string,
  document: {metadata: Record<string, unknown>; content: unknown[]},
  prepare: (body: Uint8Array) => Uint8Array | Response = (body) => fakePreparedChange(body),
) {
  const id = unpackHmId(`hm://${accountId}/test`)!
  const prepared: {baseVersion: string; account: string; path: string; changes: RequestedChange[]}[] = []
  const published: {cid: string; data: Uint8Array}[][] = []
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const href = String(url)
    if (href.includes('/api/PublishBlobs')) {
      const batch = cbor.decode<{blobs: {cid: string; data: Uint8Array}[]}>(new Uint8Array(init?.body as ArrayBuffer))
      published.push(batch.blobs)
      // A Ref is sent without a CID; the site names it.
      return Response.json(serialize({cids: batch.blobs.map((blob, index) => blob.cid ?? `ref-${index}`)}))
    }
    if (href.includes('/api/PrepareDocumentChange')) {
      const body = new Uint8Array(init?.body as ArrayBuffer)
      prepared.push(cbor.decode(body))
      const answer = prepare(body)
      return answer instanceof Response ? answer : Response.json(serialize({unsignedChange: answer}))
    }
    if (href.includes('/api/ListChanges'))
      return Response.json(serialize({changes: [{id: VERSION, deps: [], author: accountId}]}))
    if (href.includes('/api/Resource'))
      return Response.json(
        serialize({
          type: 'document',
          id,
          document: {
            version: VERSION,
            account: accountId,
            authors: [accountId],
            path: '/test',
            createTime: '',
            updateTime: '',
            genesis: VERSION,
            visibility: 'PUBLIC',
            ...document,
          },
        }),
      )
    throw new Error(`Unexpected fetch: ${href}`)
  }) as unknown as typeof fetch
  /** The Change blobs of one publish, decoded, in the order they were sent. */
  const changes = (batch: {cid: string; data: Uint8Array}[]) =>
    batch
      .map((blob) => ({cid: blob.cid, value: cbor.decode<StoredChange>(blob.data)}))
      .filter((blob) => blob.value.type === 'Change')
  const refs = (batch: {cid: string; data: Uint8Array}[]) =>
    batch.map((blob) => cbor.decode<Record<string, any>>(blob.data)).filter((value) => value.type === 'Ref')
  return {id: `hm://${accountId}/test`, prepared, published, changes, refs}
}

const paragraph = (id: string, text: string) => ({
  block: {id, type: 'Paragraph', text, attributes: {}, annotations: []},
  children: [],
})

const THREE_BLOCKS = [paragraph('b1', 'First.'), paragraph('b2', 'Second.'), paragraph('b3', 'Third.')]
const content = (texts: string[]) => texts.map((text, index) => `${text} <!-- id:b${index + 1} -->`).join('\n\n')

test('an update asks the site to prepare the change and publishes what it prepared', async () => {
  const ctx = await context()
  const hm = site(ctx.accountId, {metadata: {name: 'Test'}, content: THREE_BLOCKS})
  const result = await api.executeWriteVerb(ctx, {
    address: hm.id,
    content: content(['First.', 'Second, edited.', 'Third.']),
    options: {action: 'update'},
  })

  // Built on the document's heads, and holding only the block that differs: no block is re-moved.
  expect(hm.prepared).toHaveLength(1)
  expect(hm.prepared[0]).toMatchObject({account: ctx.accountId, path: '/test', baseVersion: VERSION})
  expect(hm.prepared[0]!.changes.map((change) => change.op.case)).toEqual(['replaceBlock'])
  expect(hm.prepared[0]!.changes[0]!.op.value).toMatchObject({id: 'b2', text: 'Second, edited.'})

  // One publish: the prepared Change, signed here, and the Ref that makes it the latest version.
  expect(hm.published).toHaveLength(1)
  const [change] = hm.changes(hm.published[0]!)
  expect(hm.changes(hm.published[0]!)).toHaveLength(1)
  expect(change!.value.signer).not.toBeNull()
  expect(change!.value.body.ops).toEqual([
    {type: 'ReplaceBlock', block: {id: 'b2', type: 'Paragraph', text: 'Second, edited.'}},
  ])
  expect(hm.refs(hm.published[0]!)).toHaveLength(1)
  expect(result).toMatchObject({
    type: 'hypermedia_write_result',
    command: 'document.update',
    message: 'document.update completed',
    id: hm.id,
    resolvedDocumentId: hm.id,
    version: change!.cid,
  })
  expect(result.unchanged).toBeUndefined()
  expect(result.cids).toEqual([change!.cid, 'ref-1'])
})

test('a write the document already holds publishes nothing and says so', async () => {
  const ctx = await context()
  // The site finds every requested change already true: it answers with a Change holding no ops.
  const hm = site(ctx.accountId, {metadata: {name: 'Test'}, content: THREE_BLOCKS}, emptyPreparedChange)
  const result = await api.executeWriteVerb(ctx, {
    address: hm.id,
    content: content(['First.', 'Second.', 'Third.']),
    options: {action: 'update', name: 'Test'},
  })
  expect(hm.prepared).toHaveLength(1)
  expect(hm.published).toEqual([])
  expect(result).toMatchObject({
    type: 'hypermedia_write_result',
    command: 'document.update',
    unchanged: true,
    id: hm.id,
    version: VERSION,
    cids: [],
  })
  expect(result.message).toContain('already up to date')
  expect(result.message).toContain('no new version was published')
})

test('content identical to the document, with no metadata, is up to date and not an error', async () => {
  const ctx = await context()
  const hm = site(ctx.accountId, {metadata: {name: 'Test'}, content: THREE_BLOCKS})
  const result = await api.executeWriteVerb(ctx, {
    address: hm.id,
    content: content(['First.', 'Second.', 'Third.']),
    options: {action: 'update'},
  })
  // The diff is empty, so there is nothing to ask the site and nothing to publish.
  expect(hm.prepared).toEqual([])
  expect(hm.published).toEqual([])
  expect(result).toMatchObject({unchanged: true, version: VERSION})
  // Naming nothing to update is still a mistake in the call.
  await expect(api.executeWriteVerb(ctx, {address: hm.id, options: {action: 'update'}})).rejects.toThrow(
    'No document updates specified',
  )
})

test('a version conflict and a dry run stop before the site is asked to prepare anything', async () => {
  const ctx = await context()
  const hm = site(ctx.accountId, {metadata: {name: 'Test'}, content: THREE_BLOCKS})
  const conflict = await api.executeWriteVerb(ctx, {
    address: hm.id,
    content: content(['Changed.']),
    options: {
      action: 'update',
      input: {expectedVersion: 'bafyreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy'},
    },
  })
  expect(conflict).toMatchObject({type: 'hypermedia_write_error', details: {currentVersion: VERSION}})
  const preview = await api.executeWriteVerb(ctx, {
    address: hm.id,
    content: content(['Changed.']),
    dryRun: true,
    options: {action: 'update'},
  })
  expect(preview).toMatchObject({dryRun: true, blockCount: 1, resolvedDocumentId: hm.id})
  expect(hm.prepared).toEqual([])
  expect(hm.published).toEqual([])
})

test('a map in metadata is written entry by entry, with nulls only for the entries that went away', async () => {
  const ctx = await context()
  const hm = site(ctx.accountId, {
    metadata: {name: 'Test', source: {type: 'schedule', every: 'day', zone: 'UTC', days: {mon: true, tue: true}}},
    content: THREE_BLOCKS,
  })
  await api.executeWriteVerb(ctx, {
    address: hm.id,
    options: {action: 'update', metadata: {source: {type: 'schedule', every: 'week', days: {mon: true}}}},
  })
  const attributes = hm.prepared[0]!.changes.map(({op}) =>
    op.case === 'setMetadata'
      ? {key: [op.value.key], value: op.value.value}
      : {key: op.value.key, value: op.value.value.case === 'nullValue' ? null : op.value.value.value},
  )
  // Never a clear of `source` itself: the site drops the unchanged entries and keeps the clear,
  // which would remove the whole map.
  expect(attributes).toEqual([
    {key: ['source', 'type'], value: 'schedule'},
    {key: ['source', 'every'], value: 'week'},
    {key: ['source', 'days', 'mon'], value: true},
    {key: ['source', 'zone'], value: null},
    {key: ['source', 'days', 'tue'], value: null},
  ])
})

test('a whole number the document already holds is not sent again', async () => {
  const ctx = await context()
  const hm = site(ctx.accountId, {metadata: {name: 'Test', order: 3, count: 1}, content: THREE_BLOCKS})
  await api.executeWriteVerb(ctx, {address: hm.id, options: {action: 'update', metadata: {order: 3, count: 2}}})
  // The site would write an equal whole number again; `order` is left out here.
  expect(hm.prepared[0]!.changes).toEqual([
    {op: {case: 'setAttribute', value: {blockId: '', key: ['count'], value: {case: 'intValue', value: 2}}}},
  ])
  const same = await api.executeWriteVerb(ctx, {address: hm.id, options: {action: 'update', metadata: {order: 3}}})
  expect(same).toMatchObject({unchanged: true, version: VERSION})
  expect(hm.prepared).toHaveLength(1)
})

test('values the site cannot carry are stored in a second change on top of the prepared one', async () => {
  const ctx = await context()
  const hm = site(ctx.accountId, {metadata: {name: 'Test', tags: ['a', 'b'], ratio: 0.5}, content: THREE_BLOCKS})
  const result = await api.executeWriteVerb(ctx, {
    address: hm.id,
    options: {action: 'update', metadata: {summary: 'New', tags: ['a', 'b', 'c'], ratio: 0.5, weights: [1.5, 2]}},
  })
  // The site prepares what it can carry.
  expect(hm.prepared[0]!.changes).toEqual([{op: {case: 'setMetadata', value: {key: 'summary', value: 'New'}}}])
  // One publish: the prepared Change, the Change built here on top of it, and one Ref.
  expect(hm.published).toHaveLength(1)
  const [first, second] = hm.changes(hm.published[0]!)
  expect(hm.changes(hm.published[0]!)).toHaveLength(2)
  expect(first!.value.body.ops).toEqual([{type: 'SetAttributes', attrs: [{key: ['summary'], value: 'New'}]}])
  // Only the values that differ from the document: the unchanged `ratio` is not written again.
  expect(second!.value.body.ops).toEqual([
    {
      type: 'SetAttributes',
      attrs: [
        {key: ['tags'], value: ['a', 'b', 'c']},
        {key: ['weights'], value: [1.5, 2]},
      ],
    },
  ])
  expect(second!.value.deps.map(String)).toEqual([first!.cid])
  expect(second!.value.depth).toBe(first!.value.depth + 1)
  expect(BigInt(second!.value.ts) > BigInt(first!.value.ts)).toBe(true)
  const refs = hm.refs(hm.published[0]!)
  expect(refs).toHaveLength(1)
  expect(refs[0]!.heads.map(String)).toEqual([second!.cid])
  expect(result.version).toBe(second!.cid)

  // Such a value alone, unchanged: nothing to prepare, nothing to build, nothing published.
  const again = await api.executeWriteVerb(ctx, {
    address: hm.id,
    options: {action: 'update', metadata: {tags: ['a', 'b']}},
  })
  expect(again).toMatchObject({unchanged: true, version: VERSION})
  expect(hm.prepared).toHaveLength(1)
  expect(hm.published).toHaveLength(1)
})

test('a site that refuses the prepare request as too large still gets the update, built here', async () => {
  const ctx = await context()
  const hm = site(
    ctx.accountId,
    {metadata: {name: 'Test', source: {type: 'schedule', zone: 'UTC'}}, content: THREE_BLOCKS},
    () => new Response('Request Entity Too Large', {status: 413}),
  )
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  cleanup.push(() => warn.mockRestore())
  const result = await api.executeWriteVerb(ctx, {
    address: hm.id,
    content: content(['First.', 'Second, edited.', 'Third.']),
    options: {action: 'update', metadata: {source: {type: 'schedule'}}},
  })
  expect(hm.prepared).toHaveLength(1)
  expect(hm.published).toHaveLength(1)
  const [change] = hm.changes(hm.published[0]!)
  expect(hm.changes(hm.published[0]!)).toHaveLength(1)
  // Stored as written, so a map is the clear followed by its entries (which is right there).
  expect(change!.value.body.ops).toEqual([
    {
      type: 'SetAttributes',
      attrs: [
        {key: ['source'], value: null},
        {key: ['source', 'type'], value: 'schedule'},
      ],
    },
    {type: 'ReplaceBlock', block: expect.objectContaining({id: 'b2', text: 'Second, edited.'})},
  ])
  expect(change!.value.deps.map(String)).toEqual([VERSION])
  expect(result).toMatchObject({version: change!.cid, message: 'document.update completed'})
  expect(warn).toHaveBeenCalledTimes(1)
})

test('any other failure to prepare is an error, and nothing is published', async () => {
  const ctx = await context()
  const hm = site(
    ctx.accountId,
    {metadata: {name: 'Test'}, content: THREE_BLOCKS},
    () => new Response(JSON.stringify({error: 'base version not found'}), {status: 500}),
  )
  await expect(
    api.executeWriteVerb(ctx, {address: hm.id, content: content(['Changed.']), options: {action: 'update'}}),
  ).rejects.toThrow()
  expect(hm.published).toEqual([])
})

test('metadataUpdateAttributes: what goes to the site and what is stored as written', () => {
  const plan = (current: Record<string, unknown> | undefined, next: Record<string, unknown>) =>
    api.metadataUpdateAttributes(current, next as never)
  // Scalars go to the site as they are; it drops the ones already set.
  expect(plan({name: 'A'}, {name: 'A', count: 3, done: false, gone: null})).toEqual({
    prepared: [
      {key: ['name'], value: 'A'},
      {key: ['count'], value: 3},
      {key: ['done'], value: false},
      {key: ['gone'], value: null},
    ],
    verbatim: [],
  })
  // A map replacing a value, and a value replacing a map, need no clear.
  expect(plan({a: 'text', b: {x: {y: 1}}}, {a: {x: '1'}, b: {x: 'now text'}})).toEqual({
    prepared: [
      {key: ['a', 'x'], value: '1'},
      {key: ['b', 'x'], value: 'now text'},
    ],
    verbatim: [],
  })
  // An entry that became a map of other entries: the old entries under it are cleared one by one.
  expect(plan({a: {x: {p: 1, q: 2}}}, {a: {x: {p: 1}}})).toEqual({
    prepared: [
      {key: ['a', 'x', 'p'], value: 1},
      {key: ['a', 'x', 'q'], value: null},
    ],
    verbatim: [],
  })
  // An empty map clears what is there, and writes nothing when nothing is.
  expect(plan({a: {x: 1}}, {a: {}})).toEqual({prepared: [{key: ['a'], value: null}], verbatim: []})
  expect(plan({}, {a: {}})).toEqual({prepared: [], verbatim: []})
  // Lists, fractions, links and keys the site refuses are stored as written, when they differ.
  expect(
    plan(
      {tags: ['a'], ratio: 0.5, nested: {list: [1, 2]}},
      {
        tags: ['a'],
        ratio: 0.75,
        nested: {list: [1, 2, 3], ok: 'yes'},
        'dotted.key': 'v',
        $internal: 'v',
        link: {'/': 'bafyreiccaudhs737unopajz7k2tjonmqucburxp45yjzfvvgy75bm66y5q'},
      },
    ),
  ).toEqual({
    prepared: [{key: ['nested', 'ok'], value: 'yes'}],
    verbatim: [
      {key: ['ratio'], value: 0.75},
      {key: ['nested', 'list'], value: [1, 2, 3]},
      {key: ['dotted.key'], value: 'v'},
      {key: ['$internal'], value: 'v'},
      {key: ['link'], value: {'/': 'bafyreiccaudhs737unopajz7k2tjonmqucburxp45yjzfvvgy75bm66y5q'}},
    ],
  })
})
