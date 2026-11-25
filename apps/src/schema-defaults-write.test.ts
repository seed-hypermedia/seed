import {afterEach, expect, test} from 'bun:test'
import {Database} from 'bun:sqlite'
import * as fs from 'node:fs'
import * as os from 'node:os'
import {serialize} from 'superjson'
import * as blobs from '@shm/shared/blobs'
import {unpackHmId} from '@seed-hypermedia/client'
import * as api from './api-service'
import * as sqlite from './sqlite'

// A new typed document starts from its schema's property defaults (hypermedia/schema/property.md).
// The type here is the library's example/task-doc: status "todo" (required), priority 2 and
// tags [] (optional), a required checklist with no default of its own, and an optional due date.
const TASK_TYPE = 'hm://hyper.media/example/task-doc'
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
  const dir = fs.mkdtempSync(os.tmpdir() + '/schema-defaults-')
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
    agentId: 'defaults-test',
    definition: {signingKeys: [imported.identity.name]},
    hmServerUrl: 'https://hm.test',
    ipfsServerUrl: 'https://hm.test',
    publishEnabled: true,
    stateDir: dir,
  } as api.AgentServicePiToolContext
}

/** A space holding only the documents given by path; every other read is not-found. */
function serve(accountId: string, documents: Record<string, Record<string, unknown>>) {
  const publishes: unknown[] = []
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const text = decodeURIComponent(String(url))
    if (text.includes('/api/PublishBlobs')) {
      publishes.push(init?.body)
      return Response.json(serialize({cids: [VERSION]}))
    }
    const requested = /[?&]id=hm:\/\/[^/?&]+([^?&]*)/.exec(text)?.[1] ?? ''
    const hit = requested in documents ? requested : undefined
    const id = unpackHmId(`hm://${accountId}${hit ?? '/missing'}`)
    if (!hit) return Response.json(serialize({type: 'not-found', id}))
    return Response.json(
      serialize({
        type: 'document',
        id,
        document: {
          version: VERSION,
          account: accountId,
          authors: [],
          path: hit,
          createTime: '',
          updateTime: '',
          genesis: VERSION,
          visibility: 'PUBLIC',
          metadata: documents[hit],
          content: [],
        },
      }),
    )
  }) as unknown as typeof fetch
  return publishes
}

const create = (ctx: api.AgentServicePiToolContext, path: string, metadata: Record<string, unknown> = {}) =>
  api.executeWriteVerb(ctx, {
    address: `hm://${ctx.accountId}${path}`,
    content: 'Write the docs.',
    options: {name: 'Write docs', metadata},
    dryRun: true,
  }) as Promise<{metadata: Record<string, unknown>; defaultsApplied?: Record<string, unknown>}>

test('a new document under a typed folder starts from the defaults of the folder type', async () => {
  const ctx = await context()
  serve(ctx.accountId, {'/tasks': {name: 'Tasks', childAttributesSchema: TASK_TYPE}})
  const result = await create(ctx, '/tasks/write-docs')
  expect(result.defaultsApplied).toEqual({status: 'todo', priority: 2, tags: []})
  expect(result.metadata).toMatchObject({name: 'Write docs', status: 'todo', priority: 2})
  // No default is invented: the required checklist and the optional due date are left to the author.
  expect('checklist' in result.metadata).toBe(false)
  expect('due' in result.metadata).toBe(false)
})

test('a new document with its own attributesSchema starts from the defaults of that type', async () => {
  const ctx = await context()
  serve(ctx.accountId, {'/notes': {name: 'Notes'}})
  const result = await create(ctx, '/notes/write-docs', {attributesSchema: TASK_TYPE})
  expect(result.defaultsApplied).toEqual({status: 'todo', priority: 2, tags: []})
})

test('an attribute the write sets is kept, and only the others are defaulted', async () => {
  const ctx = await context()
  serve(ctx.accountId, {'/tasks': {name: 'Tasks', childAttributesSchema: TASK_TYPE}})
  const result = await create(ctx, '/tasks/write-docs', {status: 'doing', priority: 1})
  expect(result.defaultsApplied).toEqual({tags: []})
  expect(result.metadata).toMatchObject({status: 'doing', priority: 1})
})

test('an untyped document gets no defaults and reports none', async () => {
  const ctx = await context()
  serve(ctx.accountId, {'/notes': {name: 'Notes'}})
  const result = await create(ctx, '/notes/write-docs')
  expect(result.defaultsApplied).toBeUndefined()
  expect('status' in result.metadata).toBe(false)
})

test('the published change carries the defaults as ordinary attributes', async () => {
  const ctx = await context()
  const publishes = serve(ctx.accountId, {'/tasks': {name: 'Tasks', childAttributesSchema: TASK_TYPE}})
  const result = await api.executeWriteVerb(ctx, {
    address: `hm://${ctx.accountId}/tasks/write-docs`,
    content: 'Write the docs.',
    // The required checklist has no default, so the author passes it: a new document that would
    // not conform to its type is refused.
    options: {name: 'Write docs', metadata: {checklist: {done: false, steps: []}}},
  })
  expect(result.defaultsApplied).toEqual({status: 'todo', priority: 2, tags: []})
  expect(publishes).toHaveLength(1)
})

test('a schema whose default does not match its property is refused when published as a schema', async () => {
  const ctx = await context()
  serve(ctx.accountId, {})
  const schema = (def: unknown) => ({
    type: 'hm://hyper.media/struct',
    properties: {priority: {value: {type: 'hm://hyper.media/integer'}, default: def}},
  })
  const write = (def: unknown) =>
    api.executeWriteVerb(ctx, {
      address: 'ipfs://',
      content: JSON.stringify(schema(def)),
      options: {schema: 'schema'},
      dryRun: true,
    })
  await expect(write('high')).rejects.toThrow('$.properties.priority.default: expected integer, got string')
  expect(await write(2)).toBeDefined()
})
