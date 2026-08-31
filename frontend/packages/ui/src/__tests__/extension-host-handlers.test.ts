import {buildSignDataPayload, ExtensionError} from '@seed-hypermedia/client/extensions'
import type {HMDocument, HMResource, HMSigner} from '@seed-hypermedia/client/hm-types'
import type {UniversalClient} from '@shm/shared/universal-client'
import {describe, expect, it, vi} from 'vitest'
import type {ExtensionHostAdapter} from '../extensions/extension-host-context'
import {
  buildMetadataOps,
  buildReplaceBodyOps,
  createExtensionHandlers,
  createSessionAllowStore,
  diffAttributes,
  ensureBlockIds,
  markdownToBlockNodes,
  MAX_FILE_READ_MAX_BYTES,
  sessionAllowKey,
  type ExtensionHandlerDeps,
} from '../extensions/host-handlers'
import {decode as cborDecode} from '@ipld/dag-cbor'

const SITE_UID = 'z6MkpTHzQyPsLa6Vn2XZbbvDQZmyAkgMSjT8fMXk1NoMFSGh'
const USER_UID = 'z6MkgY6SDHqU6TpGZtbfGi6qrHdT2hzWFHbtx7gJ3bEbn9kM'
const EXT_ID = 'hm://z6MkAuthorExtensionAuthorAuthorAuthorAuthorAu/kanban'
const GENESIS = 'bafyreibopuwahkkqplrgl3hvwu2wrbnfgoj2eau5eqjzjglsmwq2ewxpyy'
const HEAD = 'bafyreigks6arfsq3xxfpvqrrwonchxcnu6do76auprhhfomao6c273sixm'
const LIST_CHANGES = {
  changes: [
    {id: GENESIS, deps: []},
    {id: HEAD, deps: [GENESIS]},
  ],
  latestVersion: HEAD,
}

type DecodedChange = {
  body: {
    ops: Array<{type: string; attrs?: Array<{key: string[]; value: unknown}>; blocks?: string[]; block?: {id: string}}>
  }
  genesis?: unknown
  deps?: unknown[]
  depth?: number
}
function decodeChange(publishInput: unknown): DecodedChange {
  const first = (publishInput as {blobs: Array<{data: Uint8Array}>}).blobs[0]!
  return cborDecode(first.data) as DecodedChange
}

function fakeSigner(): HMSigner & {calls: Uint8Array[]} {
  const calls: Uint8Array[] = []
  const publicKey = new Uint8Array(34)
  publicKey.set([0xed, 0x01])
  for (let i = 2; i < 34; i++) publicKey[i] = i
  return {
    calls,
    getPublicKey: async () => publicKey,
    sign: async (data) => {
      calls.push(data)
      return new Uint8Array(64).fill(7)
    },
  }
}

function makeDocument(overrides: Partial<HMDocument> = {}): HMDocument {
  return {
    content: [],
    version: 'bafyreigks6arfsq3xxfpvqrrwonchxcnu6do76auprhhfomao6c273sixm',
    account: SITE_UID,
    authors: [SITE_UID],
    path: '/board',
    createTime: '',
    updateTime: '',
    metadata: {name: 'Board'},
    genesis: GENESIS,
    generationInfo: {generation: 5n, genesis: GENESIS} as never,
    visibility: 'PUBLIC' as never,
    ...overrides,
  }
}

type Deps = {
  client: UniversalClient & {publishDocument: NonNullable<UniversalClient['publishDocument']>}
  adapter: ExtensionHostAdapter
  storage: Map<string, string>
  signer: ReturnType<typeof fakeSigner>
  confirmSign: ReturnType<typeof vi.fn>
  requests: Array<{key: string; input: unknown}>
  published: unknown[]
  publishedDocs: unknown[]
}

function makeDeps(opts: {resource?: (input: unknown) => HMResource; user?: {accountId: string} | null} = {}): {
  deps: ExtensionHandlerDeps
  d: Deps
} {
  const storage = new Map<string, string>()
  const signer = fakeSigner()
  const requests: Array<{key: string; input: unknown}> = []
  const published: unknown[] = []
  const publishedDocs: unknown[] = []
  const resource =
    opts.resource ??
    ((input: unknown) =>
      ({
        type: 'document',
        id: input as never,
        document: makeDocument(),
      }) as HMResource)
  const client = {
    request: vi.fn(async (key: string, input: unknown) => {
      requests.push({key, input})
      if (key === 'Resource') return resource(input)
      if (key === 'ListCapabilities') return {capabilities: []}
      if (key === 'ListChanges') return LIST_CHANGES
      if (key === 'Search') return {entities: [], searchTerm: ''}
      throw new Error(`unexpected request ${key}`)
    }),
    publish: vi.fn(async (input: unknown) => {
      published.push(input)
      return {cids: []}
    }),
    publishDocument: vi.fn(async (input: unknown) => {
      publishedDocs.push(input)
    }),
    getSigner: () => signer,
  } as unknown as Deps['client']
  const adapter: ExtensionHostAdapter = {
    platform: 'web',
    user: opts.user === undefined ? {accountId: USER_UID, name: 'Alice'} : opts.user,
    theme: 'light',
    fetchEntryHtml: async () => '<html></html>',
    fileUrl: (cid) => `https://site/hm/api/file/${cid}`,
    readFile: async (cid) => ({bytes: new Uint8Array([1, 2, 3]), contentType: `text/${cid}`}),
    navigate: vi.fn(),
    openExternal: vi.fn(),
    setRoute: vi.fn(),
    toast: vi.fn(),
    storage: {
      getItem: (k) => storage.get(k) ?? null,
      setItem: (k, v) => void storage.set(k, v),
      removeItem: (k) => void storage.delete(k),
      key: (i) => Array.from(storage.keys())[i] ?? null,
      get length() {
        return storage.size
      },
    },
  }
  const confirmSign = vi.fn(async () => ({allowSession: false}))
  const deps: ExtensionHandlerDeps = {
    client,
    adapter,
    extension: {id: EXT_ID, name: 'Kanban', version: 'bafyExt'},
    site: {uid: SITE_UID, name: 'Site'},
    getUser: () => adapter.user,
    confirmSign,
    sessionAllow: createSessionAllowStore(),
  }
  return {deps, d: {client, adapter, storage, signer, confirmSign, requests, published, publishedDocs}}
}

describe('api.query', () => {
  it('unpacks hm:// ids and forwards to the universal client', async () => {
    const {deps, d} = makeDeps()
    const handlers = createExtensionHandlers(deps)
    const result = (await handlers['api.query']({key: 'Resource', input: {id: `hm://${SITE_UID}/board`}})) as {
      document: HMDocument
    }
    expect(d.requests[0]?.key).toBe('Resource')
    expect(d.requests[0]?.input).toMatchObject({uid: SITE_UID, path: ['board'], latest: true})
    // bigint generation converted for postMessage
    expect((result.document.generationInfo as {generation: unknown}).generation).toBe(5)
  })

  it('forwards non-id inputs untouched', async () => {
    const {deps, d} = makeDeps()
    const handlers = createExtensionHandlers(deps)
    await handlers['api.query']({key: 'Search', input: {query: 'x', accountUid: SITE_UID}})
    expect(d.requests[0]).toEqual({key: 'Search', input: {query: 'x', accountUid: SITE_UID}})
  })
})

describe('file + navigation + storage + ui', () => {
  it('file.url / file.read go through the adapter', async () => {
    const {deps} = makeDeps()
    const handlers = createExtensionHandlers(deps)
    expect(await handlers['file.url']({cid: 'bafk'})).toEqual({url: 'https://site/hm/api/file/bafk'})
    expect(await handlers['file.read']({cid: 'bafk'})).toEqual({base64: 'AQID', contentType: 'text/bafk'})
  })

  it('file.read clamps maxBytes to the hard ceiling', async () => {
    const {deps, d} = makeDeps()
    const readFile = vi.fn(async () => ({bytes: new Uint8Array(), contentType: 'x'}))
    const handlers = createExtensionHandlers({...deps, adapter: {...d.adapter, readFile}})
    await handlers['file.read']({cid: 'bafk'})
    expect(readFile).toHaveBeenLastCalledWith('bafk', 10 * 1024 * 1024)
    await handlers['file.read']({cid: 'bafk', maxBytes: 1000})
    expect(readFile).toHaveBeenLastCalledWith('bafk', 1000)
    await handlers['file.read']({cid: 'bafk', maxBytes: Number.MAX_SAFE_INTEGER})
    expect(readFile).toHaveBeenLastCalledWith('bafk', MAX_FILE_READ_MAX_BYTES)
  })

  it('validates navigate / openExternal urls', async () => {
    const {deps, d} = makeDeps()
    const handlers = createExtensionHandlers(deps)
    await handlers.navigate({url: '/docs', replace: true})
    expect(d.adapter.navigate).toHaveBeenCalledWith('/docs', {replace: true})
    await expect(handlers.navigate({url: 'https://x.com'})).rejects.toMatchObject({code: 'invalid_params'})
    await handlers.openExternal({url: 'https://x.com/a'})
    expect(d.adapter.openExternal).toHaveBeenCalledWith('https://x.com/a')
    await expect(handlers.openExternal({url: 'javascript:1'})).rejects.toMatchObject({code: 'invalid_params'})
    await handlers['route.set']({subPath: ['card', '1'], query: {q: '1'}})
    expect(d.adapter.setRoute).toHaveBeenCalledWith(['card', '1'], {q: '1'}, {replace: undefined})
  })

  it('namespaces storage per extension and site', async () => {
    const {deps, d} = makeDeps()
    const handlers = createExtensionHandlers(deps)
    d.storage.set('unrelated', 'x')
    await handlers['storage.set']({key: 'a', value: '1'})
    await handlers['storage.set']({key: 'b', value: '2'})
    expect(Array.from(d.storage.keys())).toContain(`seed.ext.${EXT_ID}.${SITE_UID}.a`)
    expect(await handlers['storage.get']({key: 'a'})).toEqual({value: '1'})
    expect(await handlers['storage.keys']({})).toEqual({keys: ['a', 'b']})
    await handlers['storage.remove']({key: 'a'})
    expect(await handlers['storage.get']({key: 'a'})).toEqual({value: null})
  })

  it('ui.toast / ui.setTitle / ui.resize', async () => {
    const {deps, d} = makeDeps()
    const setTitle = vi.fn()
    const handlers = createExtensionHandlers({...deps, setTitle})
    await handlers['ui.toast']({message: 'hi'})
    expect(d.adapter.toast).toHaveBeenCalledWith('hi', 'info')
    await handlers['ui.setTitle']({title: 'T'})
    expect(setTitle).toHaveBeenCalledWith('T')
    expect(await handlers['ui.resize']({height: 100})).toBeNull()
  })
})

describe('sign.data', () => {
  it('requires a user', async () => {
    const {deps} = makeDeps({user: null})
    const handlers = createExtensionHandlers(deps)
    await expect(handlers['sign.data']({base64: 'AA==', purpose: 'p'})).rejects.toMatchObject({
      code: 'not_signed_in',
    })
  })

  it('confirms, signs the domain-separated payload and returns the principal', async () => {
    const {deps, d} = makeDeps()
    const handlers = createExtensionHandlers(deps)
    const result = await handlers['sign.data']({base64: 'aGk=', purpose: 'login'})
    expect(d.confirmSign).toHaveBeenCalledTimes(1)
    expect(d.confirmSign.mock.calls[0]?.[0]).toMatchObject({
      extension: {id: EXT_ID, name: 'Kanban'},
      account: {accountId: USER_UID},
      detail: {kind: 'data', purpose: 'login', byteLength: 2, hexPreview: '6869'},
    })
    expect(d.signer.calls[0]).toEqual(buildSignDataPayload(EXT_ID, new Uint8Array([104, 105])))
    expect(result.accountId).toBe(USER_UID)
    expect(result.signer.startsWith('z')).toBe(true)
    expect(result.signature).toBe(Buffer.from(new Uint8Array(64).fill(7)).toString('base64'))
  })

  it('propagates user_rejected and honours the session allow list', async () => {
    const {deps, d} = makeDeps()
    const handlers = createExtensionHandlers(deps)
    d.confirmSign.mockRejectedValueOnce(new ExtensionError('user_rejected', 'no'))
    await expect(handlers['sign.data']({base64: 'AA==', purpose: 'p'})).rejects.toMatchObject({
      code: 'user_rejected',
    })
    d.confirmSign.mockResolvedValueOnce({allowSession: true})
    await handlers['sign.data']({base64: 'AA==', purpose: 'p'})
    await handlers['sign.data']({base64: 'AA==', purpose: 'p'})
    expect(d.confirmSign).toHaveBeenCalledTimes(2)
    expect(d.confirmSign.mock.calls[1]?.[0]).toMatchObject({sessionAllowBypassed: false})
  })

  it('a session grant does not carry over to a different code source (dev override)', async () => {
    const {deps, d} = makeDeps()
    const published = createExtensionHandlers(deps)
    d.confirmSign.mockResolvedValueOnce({allowSession: true})
    await published['sign.data']({base64: 'AA==', purpose: 'p'})
    await published['sign.data']({base64: 'AA==', purpose: 'p'})
    expect(d.confirmSign).toHaveBeenCalledTimes(1)

    // Same extension, site, account and allow store — but override code is asking.
    const overridden = createExtensionHandlers({
      ...deps,
      extension: {...deps.extension, devUrl: 'http://localhost:5181'},
    })
    await overridden['sign.data']({base64: 'AA==', purpose: 'p'})
    expect(d.confirmSign).toHaveBeenCalledTimes(2)
    expect(d.confirmSign.mock.calls[1]?.[0]).toMatchObject({extension: {devUrl: 'http://localhost:5181'}})
    expect(sessionAllowKey('e', 's', 'a')).not.toBe(sessionAllowKey('e', 's', 'a', 'http://localhost:5181'))
  })
})

describe('sign.comment', () => {
  it('builds blocks from markdown, confirms, publishes and returns the comment id', async () => {
    const {deps, d} = makeDeps()
    const handlers = createExtensionHandlers(deps)
    const result = await handlers['sign.comment']({targetId: `hm://${SITE_UID}/board`, markdown: 'Hello **world**'})
    expect(d.requests[0]).toMatchObject({key: 'Resource', input: {uid: SITE_UID, path: ['board'], latest: true}})
    expect(d.confirmSign.mock.calls[0]?.[0]).toMatchObject({
      detail: {kind: 'comment', targetName: 'Board', targetPath: '/board', preview: 'Hello world', isReply: false},
    })
    expect(d.published).toHaveLength(1)
    expect(result.commentId).toMatch(/^z[1-9A-HJ-NP-Za-km-z]+\/[A-Za-z0-9_-]+$/)
  })

  it('uses an explicit targetVersion and rejects empty bodies', async () => {
    const {deps, d} = makeDeps()
    const handlers = createExtensionHandlers(deps)
    await expect(
      handlers['sign.comment']({targetId: `hm://${SITE_UID}/board`, markdown: '   \n'}),
    ).rejects.toMatchObject({code: 'invalid_params'})
    await handlers['sign.comment']({
      targetId: `hm://${SITE_UID}/board`,
      targetVersion: 'bafyreibopuwahkkqplrgl3hvwu2wrbnfgoj2eau5eqjzjglsmwq2ewxpyy',
      markdown: 'x',
    })
    expect(d.requests.at(-1)?.input).toMatchObject({
      version: 'bafyreibopuwahkkqplrgl3hvwu2wrbnfgoj2eau5eqjzjglsmwq2ewxpyy',
      latest: false,
    })
  })

  it('accepts explicit blocks and rejects malformed ones', async () => {
    const {deps} = makeDeps()
    const handlers = createExtensionHandlers(deps)
    await expect(
      handlers['sign.comment']({targetId: `hm://${SITE_UID}/board`, blocks: [{nope: true}]}),
    ).rejects.toMatchObject({code: 'invalid_params'})
    const ok = await handlers['sign.comment']({
      targetId: `hm://${SITE_UID}/board`,
      blocks: [{block: {id: 'b1', type: 'Paragraph', text: 'hi', annotations: [], attributes: {}}}],
    })
    expect(ok.commentId).toBeTruthy()
  })

  it('derives the thread root from the parent comment when only replyCommentVersion is given', async () => {
    const ROOT = GENESIS
    const PARENT = HEAD
    const {deps, d} = makeDeps()
    const baseRequest = d.client.request as ReturnType<typeof vi.fn>
    const original = baseRequest.getMockImplementation() as (key: string, input: unknown) => Promise<unknown>
    baseRequest.mockImplementation(async (key: string, input: unknown) => {
      if (key === 'Comment') {
        d.requests.push({key, input})
        if (input === PARENT) {
          return {id: `${USER_UID}/p1`, version: PARENT, threadRoot: `${USER_UID}/r1`, threadRootVersion: ROOT}
        }
        if (input === ROOT) return {id: `${USER_UID}/r1`, version: ROOT}
        throw new Error('not found')
      }
      return original(key, input)
    })
    const handlers = createExtensionHandlers(deps)

    // Reply to a reply: threadRoot must be the root, not the parent.
    await handlers['sign.comment']({targetId: `hm://${SITE_UID}/board`, markdown: 'x', replyCommentVersion: PARENT})
    expect(d.requests.find((r) => r.key === 'Comment')?.input).toBe(PARENT)
    expect(d.confirmSign.mock.calls[0]?.[0]).toMatchObject({detail: {kind: 'comment', isReply: true}})
    let blob = cborDecode((d.published[0] as {blobs: Array<{data: Uint8Array}>}).blobs[0]!.data) as {
      replyParent?: unknown
      threadRoot?: unknown
    }
    expect(String(blob.replyParent)).toBe(PARENT)
    expect(String(blob.threadRoot)).toBe(ROOT)

    // Reply to a root comment: the root is its own thread root.
    await handlers['sign.comment']({targetId: `hm://${SITE_UID}/board`, markdown: 'y', replyCommentVersion: ROOT})
    blob = cborDecode((d.published[1] as {blobs: Array<{data: Uint8Array}>}).blobs[0]!.data) as typeof blob
    expect(String(blob.replyParent)).toBe(ROOT)
    expect(String(blob.threadRoot)).toBe(ROOT)

    // Explicit rootReplyCommentVersion is used as-is, without a lookup.
    const before = d.requests.filter((r) => r.key === 'Comment').length
    await handlers['sign.comment']({
      targetId: `hm://${SITE_UID}/board`,
      markdown: 'z',
      replyCommentVersion: PARENT,
      rootReplyCommentVersion: ROOT,
    })
    expect(d.requests.filter((r) => r.key === 'Comment').length).toBe(before)

    // Unknown parent → invalid_params, nothing published.
    await expect(
      handlers['sign.comment']({targetId: `hm://${SITE_UID}/board`, markdown: 'w', replyCommentVersion: 'bafynope'}),
    ).rejects.toMatchObject({code: 'invalid_params'})
    expect(d.published).toHaveLength(3)
  })
})

describe('sign.document', () => {
  it('publishes metadata (whole arrays, floats, nested objects) + body replace on an existing document', async () => {
    const existing = makeDocument({
      content: [
        {block: {id: 'old1', type: 'Paragraph', text: 'old', annotations: [], attributes: {}} as never},
        {block: {id: 'keep', type: 'Paragraph', text: 'keep', annotations: [], attributes: {}} as never},
      ],
      metadata: {name: 'Board', summary: 'old summary', kanban: {columns: ['a'], stale: true}} as never,
    })
    const {deps, d} = makeDeps({
      resource: (input) => ({type: 'document', id: input as never, document: existing}) as HMResource,
    })
    // Owner publishes: no capability lookup.
    d.adapter.user = {accountId: SITE_UID}
    const handlers = createExtensionHandlers(deps)
    const board = {
      columns: [
        {id: 'c1', title: 'Todo', cards: []},
        {id: 'c2', title: 'Done', cards: ['x']},
      ],
      ratio: 0.75,
    }
    const result = await handlers['sign.document']({
      id: `hm://${SITE_UID}/board`,
      metadata: {name: 'Board', summary: null, kanban: board},
      blocks: [
        {block: {id: 'keep', type: 'Paragraph', text: 'keep', annotations: [], attributes: {}}},
        {
          block: {type: 'Heading', text: 'New', annotations: [], attributes: {childrenType: 'Group'}},
          children: [{block: {id: 'c1', type: 'Paragraph', text: 'child', annotations: [], attributes: {}}}],
        },
      ],
      summary: 'Rebuild the board',
    })

    expect(d.confirmSign.mock.calls[0]?.[0]).toMatchObject({
      detail: {
        kind: 'document',
        exists: true,
        name: 'Board',
        summary: 'Rebuild the board',
        replaceBody: true,
        blockCount: 3,
        metadataRequested: true,
        // `name` is unchanged → not listed
        metadataChanges: [
          {key: 'summary', before: 'old summary', after: null},
          {key: 'kanban', before: {columns: ['a'], stale: true}, after: board},
        ],
      },
    })
    expect(d.requests.some((r) => r.key === 'ListCapabilities')).toBe(false)
    expect(d.requests.find((r) => r.key === 'ListChanges')?.input).toMatchObject({targetId: {uid: SITE_UID}})

    // One publish: the signed change + the version ref, built on the existing DAG.
    expect(d.published).toHaveLength(1)
    const change = decodeChange(d.published[0])
    expect(String(change.genesis)).toBe(GENESIS)
    expect(change.deps?.map(String)).toEqual([HEAD])
    expect(change.depth).toBe(2)

    const setAttrs = change.body.ops.find((op) => op.type === 'SetAttributes')
    expect(setAttrs?.attrs).toEqual([
      {key: ['summary'], value: null},
      {key: ['kanban', 'columns'], value: board.columns}, // array kept whole
      {key: ['kanban', 'stale'], value: null}, // removed leaf deleted
      {key: ['kanban', 'ratio'], value: 0.75}, // float preserved
    ])
    const types = change.body.ops.map((op) => op.type)
    expect(types.filter((t) => t === 'ReplaceBlock')).toHaveLength(2) // heading + child; keep unchanged
    expect(change.body.ops.find((op) => op.type === 'DeleteBlocks')?.blocks).toEqual(['old1'])
    expect(result).toEqual({id: `hm://${SITE_UID}/board`, version: expect.stringMatching(/^bafy/)})
    const blobs = (d.published[0] as {blobs: Array<{cid?: string}>}).blobs
    expect(blobs[0]?.cid).toBe(result.version)
    expect(blobs.length).toBeGreaterThan(1)
  })

  it('creates a missing document (change becomes genesis) and resolves a capability for non-owners', async () => {
    const {deps, d} = makeDeps({
      resource: (input) => ({type: 'not-found', id: input as never}) as HMResource,
    })
    ;(d.client.request as ReturnType<typeof vi.fn>).mockImplementation(async (key: string, input: unknown) => {
      d.requests.push({key, input})
      if (key === 'Resource') return {type: 'not-found', id: input as never} as HMResource
      if (key === 'ListCapabilities') {
        return {
          capabilities: [
            {
              id: 'bafyreib6epubmabzlffdhckpmvsodmjuro6xuaei2qwevs3t52xnlhaatu',
              delegate: USER_UID,
              role: 'WRITER',
              account: SITE_UID,
            },
          ],
        }
      }
      throw new Error(`unexpected ${key}`)
    })
    const handlers = createExtensionHandlers(deps)
    const result = await handlers['sign.document']({id: `hm://${SITE_UID}/new-doc`, metadata: {name: 'New'}})
    expect(d.confirmSign.mock.calls[0]?.[0]).toMatchObject({detail: {kind: 'document', exists: false, name: 'New'}})
    expect(d.requests.find((r) => r.key === 'ListCapabilities')?.input).toMatchObject({
      targetId: {uid: SITE_UID, path: ['new-doc']},
    })
    expect(d.requests.some((r) => r.key === 'ListChanges')).toBe(false)
    const change = decodeChange(d.published[0])
    expect(change.genesis).toBeUndefined()
    expect(change.body.ops).toEqual([{type: 'SetAttributes', attrs: [{key: ['name'], value: 'New'}]}])
    expect(result.version).toMatch(/^bafy/)
  })

  it('denies non-owners without a capability before publishing', async () => {
    const {deps, d} = makeDeps()
    const handlers = createExtensionHandlers(deps)
    await expect(
      handlers['sign.document']({id: `hm://${SITE_UID}/board`, metadata: {name: 'X'}}),
    ).rejects.toMatchObject({code: 'permission_denied'})
    expect(d.published).toHaveLength(0)
  })

  it('rejects redirects and no-op changes', async () => {
    const {deps} = makeDeps({
      resource: (input) =>
        ({type: 'redirect', id: input as never, redirectTarget: input as never, republish: false}) as HMResource,
    })
    const handlers = createExtensionHandlers(deps)
    await expect(
      handlers['sign.document']({id: `hm://${SITE_UID}/board`, metadata: {name: 'X'}}),
    ).rejects.toMatchObject({code: 'not_supported'})

    // Nothing differs on an existing document: no dialog, no publish, current version returned.
    const {deps: deps2, d: d2} = makeDeps()
    d2.adapter.user = {accountId: SITE_UID}
    const handlers2 = createExtensionHandlers(deps2)
    await expect(
      handlers2['sign.document']({id: `hm://${SITE_UID}/board`, metadata: {name: 'Board'}}),
    ).resolves.toEqual({
      id: `hm://${SITE_UID}/board`,
      version: HEAD,
    })
    expect(d2.confirmSign).not.toHaveBeenCalled()
    expect(d2.published).toHaveLength(0)
  })
})

describe('sign.document + session grant', () => {
  it('always confirms writes to extension install records / manifests, even with a session grant', async () => {
    const {deps, d} = makeDeps()
    d.adapter.user = {accountId: SITE_UID}
    const handlers = createExtensionHandlers(deps)
    d.confirmSign.mockResolvedValueOnce({allowSession: true})
    await handlers['sign.data']({base64: 'AA==', purpose: 'p'})
    expect(d.confirmSign).toHaveBeenCalledTimes(1)

    // Ordinary metadata: covered by the grant, no dialog.
    await handlers['sign.document']({id: `hm://${SITE_UID}/board`, metadata: {name: 'Renamed'}})
    expect(d.confirmSign).toHaveBeenCalledTimes(1)

    // Install record on the home document: confirmed despite the grant.
    await handlers['sign.document']({
      id: `hm://${SITE_UID}`,
      metadata: {extensions: {board: {ext: 'hm://z6MkAttacker/ext'}}},
    })
    expect(d.confirmSign).toHaveBeenCalledTimes(2)
    expect(d.confirmSign.mock.calls[1]?.[0]).toMatchObject({
      sessionAllowBypassed: true,
      detail: {kind: 'document', metadataChanges: [{key: 'extensions'}]},
    })

    // Manifest on an extension document: also confirmed.
    await handlers['sign.document']({
      id: `hm://${SITE_UID}/ext`,
      metadata: {seedExtension: {manifestVersion: 1, kind: 'page', version: '2', entry: 'ipfs://bafk'}},
    })
    expect(d.confirmSign).toHaveBeenCalledTimes(3)

    // Denying the forced confirmation blocks the publish.
    const publishedBefore = d.published.length
    d.confirmSign.mockRejectedValueOnce(new ExtensionError('user_rejected', 'no'))
    await expect(
      handlers['sign.document']({id: `hm://${SITE_UID}`, metadata: {extensions: {x: {ext: 'hm://z6MkA/e'}}}}),
    ).rejects.toMatchObject({code: 'user_rejected'})
    expect(d.published).toHaveLength(publishedBefore)
  })
})

describe('helpers', () => {
  it('markdownToBlockNodes splits paragraphs and headings', () => {
    const nodes = markdownToBlockNodes('# Title\n\nOne\n\nTwo')
    expect(nodes[0]?.block.type).toBe('Heading')
    expect(nodes[0]?.children?.map((n) => (n.block as {text: string}).text)).toEqual(['One', 'Two'])
  })

  it('ensureBlockIds fills missing and duplicate ids', () => {
    const nodes = ensureBlockIds([
      {block: {id: 'a', type: 'Paragraph', text: '', annotations: [], attributes: {}}},
      {block: {id: 'a', type: 'Paragraph', text: '', annotations: [], attributes: {}}},
      {block: {type: 'Paragraph', text: '', annotations: [], attributes: {}}},
    ])
    const ids = nodes.map((n) => (n as {block: {id: string}}).block.id)
    expect(ids[0]).toBe('a')
    expect(new Set(ids).size).toBe(3)
    expect(ids.every((id) => id.length === 8 || id === 'a')).toBe(true)
  })

  it('buildMetadataOps merges: untouched keys are never emitted, arrays stay arrays, null deletes', () => {
    const {op, summary} = buildMetadataOps(
      {name: 'New', tags: ['a', 'b'], score: 1.5, gone: null, obj: null, same: 'x'},
      {name: 'Old', summary: 'keep me', gone: 'bye', obj: {a: 1, b: {c: 2}}, same: 'x'},
    )
    expect((op as unknown as {attrs: unknown[]}).attrs).toEqual([
      {key: ['name'], value: 'New'},
      {key: ['tags'], value: ['a', 'b']},
      {key: ['score'], value: 1.5},
      {key: ['gone'], value: null},
      {key: ['obj', 'a'], value: null},
      {key: ['obj', 'b', 'c'], value: null},
    ])
    expect(summary.map((c) => c.key)).toEqual(['name', 'tags', 'score', 'gone', 'obj'])
    expect(buildMetadataOps({same: 'x'}, {same: 'x'}).op).toBeNull()
  })

  it('diffAttributes writes shape changes at the key itself', () => {
    // object → string: the requested value is written (not just the old leaves nulled)
    expect(diffAttributes(['layout'], 'grid', {cols: 3})).toEqual([{key: ['layout'], value: 'grid'}])
    // object → array
    expect(diffAttributes(['tags'], ['a', 'b'], {a: 1})).toEqual([{key: ['tags'], value: ['a', 'b']}])
    // string → object: nested leaves written; the daemon drops the old ancestor register
    expect(diffAttributes(['layout'], {cols: 3}, 'grid')).toEqual([{key: ['layout', 'cols'], value: 3}])
    // array → object
    expect(diffAttributes(['tags'], {a: 1}, ['a'])).toEqual([{key: ['tags', 'a'], value: 1}])
    // object → object still diffs leaf-wise
    expect(diffAttributes(['o'], {a: 1, b: 2}, {a: 1, c: 3})).toEqual([
      {key: ['o', 'c'], value: null},
      {key: ['o', 'b'], value: 2},
    ])
    // object removal still nulls every leaf
    expect(diffAttributes(['obj'], undefined, {a: 1, b: {c: 2}})).toEqual([
      {key: ['obj', 'a'], value: null},
      {key: ['obj', 'b', 'c'], value: null},
    ])
    // scalar → scalar, unchanged → nothing
    expect(diffAttributes(['n'], 'x', 'x')).toEqual([])
    expect(diffAttributes(['n'], 2, 1)).toEqual([{key: ['n'], value: 2}])
    // via buildMetadataOps: the op carries the new value and the summary matches it
    const {op, summary} = buildMetadataOps({layout: 'grid'}, {layout: {cols: 3}})
    expect((op as unknown as {attrs: unknown[]}).attrs).toEqual([{key: ['layout'], value: 'grid'}])
    expect(summary).toEqual([{key: 'layout', before: {cols: 3}, after: 'grid'}])
  })

  it('buildReplaceBodyOps deletes descendants of removed blocks', () => {
    const ops = buildReplaceBodyOps(
      [],
      [
        {
          block: {id: 'p', type: 'Paragraph', text: '', annotations: [], attributes: {}} as never,
          children: [{block: {id: 'c', type: 'Paragraph', text: '', annotations: [], attributes: {}} as never}],
        },
      ],
    )
    expect(ops).toEqual([{type: 'DeleteBlocks', blocks: expect.arrayContaining(['p', 'c'])}])
  })
})
