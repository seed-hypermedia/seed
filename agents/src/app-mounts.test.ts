import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, test} from 'bun:test'
import {serialize} from 'superjson'
import {unpackHmId} from '@seed-hypermedia/client/hm-types'
import * as appMounts from '@/app-mounts'
import {decode as cborDecode, encode as cborEncode} from '@/cbor'
import * as sqlite from '@/sqlite'
import * as toolDocs from '@/tool-documents'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/**
 * Detection against a stand-in for the daemon and the servers around it: documents by address,
 * `QueryDocuments` over their attributes (with the folder rule the daemon applies), each site's
 * `/hm/api/config` and each agents server's `/health`. Nothing here touches the network; the pass
 * gets the stand-in as its `fetch`.
 */

const THIS_SERVER = 'https://agents.test/hm/api/agents'
const THIS_UID = 'z6MkThisServer'
const DOCS = 'z6MkDocsSpace'
const OPERATOR = 'z6MkOperatorSpace'
const CONVERT_APP = `hm://${DOCS}/agent/apps/convert`
const APP = 'hm://hyper.media/agent/app'
const APP_TOOL = 'hm://hyper.media/agent/app-tool'
const APP_MOUNT = 'hm://hyper.media/agent/app-mount'

type Doc = {account: string; path: string; metadata: Record<string, unknown>; body?: string; version?: string}

/** What the converter's tool page references by default: its contract as an object, its code as one file. */
const TOOL_INPUT = {type: 'object', properties: {files: {type: 'array', items: {type: 'string'}}}, required: ['files']}
const TOOL_CODE = 'export default async (input, ctx) => ({summary: `${input.files.length} with ${ctx.args.apiKey}`})'

const RAW_CODEC = 0x55
const DAG_PB_CODEC = 0x70
const DAG_CBOR_CODEC = 0x71

class FakeNetwork {
  readonly docs = new Map<string, Doc>()
  readonly json = new Map<string, Record<string, unknown>>()
  /** Raw blocks served at `/ipfs/<cid>`, and the dag-json of DAG-CBOR objects and folder nodes served by `GetCID`. */
  readonly blobs = new Map<string, Uint8Array>()
  readonly objects = new Map<string, unknown>()
  readonly requests: string[] = []

  constructor() {
    this.json.set(`https://hm.test/hm/api/config`, {registeredAccountUid: OPERATOR, agentServerUrl: THIS_SERVER})
    this.json.set(`${THIS_SERVER}/health`, {serverUid: THIS_UID})
    this.json.set(`https://elsewhere.test/hm/api/agents/health`, {serverUid: 'z6MkElsewhere'})
  }

  put(doc: Doc): void {
    this.docs.set(`hm://${doc.account}${doc.path ? `/${doc.path}` : ''}`, doc)
  }

  /** A file published as one raw block: its `ipfs://` URL is the hash of its bytes, as the daemon's chunker makes it. */
  async putFile(content: string | Uint8Array): Promise<string> {
    const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
    const cid = CID.createV1(RAW_CODEC, await sha256.digest(bytes)).toString()
    this.blobs.set(cid, bytes)
    return `ipfs://${cid}`
  }

  /** A DAG-CBOR object, read back through `GetCID` as dag-json. */
  async putObject(value: unknown): Promise<string> {
    const cid = CID.createV1(DAG_CBOR_CODEC, await sha256.digest(cborEncode(value))).toString()
    this.objects.set(cid, value)
    return `ipfs://${cid}`
  }

  /**
   * A UnixFS folder: a dag-pb node whose named links are its entries. `links` of a chunked file
   * carry no names, which is how a file larger than one block looks.
   */
  async putFolder(entries: Record<string, string>, options: {unnamed?: boolean} = {}): Promise<string> {
    const node = {
      Data: {'/': {bytes: 'CAE'}},
      Links: Object.entries(entries).map(([name, url]) => ({
        Hash: {'/': url.replace('ipfs://', '')},
        Name: options.unnamed ? '' : name,
        Tsize: 1,
      })),
    }
    const cid = CID.createV1(DAG_PB_CODEC, await sha256.digest(cborEncode(node))).toString()
    this.objects.set(cid, node)
    return `ipfs://${cid}`
  }

  /** The Datalab converter app with its one tool, as the docs space publishes it: the tool's contract and code are references. */
  async putConvertApp(
    options: {
      runtime?: string
      timeoutSecs?: number
      inputSchema?: string
      outputSchema?: string
      code?: string
    } = {},
  ): Promise<void> {
    const inputSchema = options.inputSchema ?? (await this.putObject(TOOL_INPUT))
    const code = options.code ?? (await this.putFile(TOOL_CODE))
    this.put({
      account: DOCS,
      path: 'agent/apps/convert',
      version: 'app-v1',
      metadata: {
        name: 'Datalab converter',
        summary: 'Converts documents from agent memory into markdown.',
        attributesSchema: APP,
        slug: 'convert',
        arguments: {
          apiKey: {type: 'string', secret: true, required: true, order: 1},
          mode: {type: 'string', order: 2},
        },
        network: {datalab: 'www.datalab.to'},
        usage: {meter: 'per-unit', unit: 'pages', period: 'month', callCap: 200},
      },
      body: 'Review seed.md before publishing.',
    })
    this.put({
      account: DOCS,
      path: 'agent/apps/convert/tools',
      metadata: {name: 'Tools', summary: 'The tools.', childAttributesSchema: APP_TOOL},
    })
    this.put({
      account: DOCS,
      path: 'agent/apps/convert/tools/convert',
      metadata: {
        name: 'convert',
        summary: 'Convert documents from memory.',
        attributesSchema: APP_TOOL,
        tool: 'convert',
        runtime: options.runtime ?? 'ts',
        ...(options.timeoutSecs !== undefined ? {timeoutSecs: options.timeoutSecs} : {}),
        inputSchema,
        ...(options.outputSchema !== undefined ? {outputSchema: options.outputSchema} : {}),
        code,
      },
      body: 'Pass memory paths in `files`.',
    })
  }

  /** A space bound to an agents server by its home document, with a reference-form mount of the app. */
  putTenant(
    account: string,
    options: {server?: string; siteUrl?: string; scope?: string; args?: unknown; enabled?: boolean; usage?: unknown},
  ) {
    this.put({
      account,
      path: '',
      metadata: {
        name: account,
        ...(options.server ? {agentServerUrl: options.server} : {}),
        ...(options.siteUrl ? {siteUrl: options.siteUrl} : {}),
      },
    })
    this.put({
      account,
      path: 'apps/convert',
      metadata: {
        name: 'Datalab converter',
        attributesSchema: APP_MOUNT,
        app: CONVERT_APP,
        ...(options.scope ? {scope: options.scope} : {}),
        ...(options.enabled === false ? {enabled: false} : {}),
        ...(options.args !== undefined ? {arguments: options.args} : {}),
        ...(options.usage !== undefined ? {usage: options.usage} : {}),
      },
    })
  }

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    this.requests.push(url.href)
    const canned = this.json.get(`${url.origin}${url.pathname}`)
    if (canned) return Response.json(canned)
    if (url.pathname === '/api/Resource') {
      const id = unpackHmId(url.searchParams.get('id') ?? '')
      const doc = id && this.docs.get(`hm://${id.uid}${id.path?.length ? `/${id.path.join('/')}` : ''}`)
      if (!doc) return Response.json({error: 'not found'}, {status: 404})
      return Response.json(serialize({type: 'document', id, document: this.document(doc)}))
    }
    if (url.pathname === '/api/GetCID') {
      const value = this.objects.get(url.searchParams.get('cid') ?? '')
      if (value === undefined) return Response.json({error: 'not found'}, {status: 404})
      return Response.json({value})
    }
    if (url.pathname.startsWith('/ipfs/')) {
      const bytes = this.blobs.get(url.pathname.slice('/ipfs/'.length))
      if (!bytes) return new Response('not found', {status: 404})
      return new Response(bytes as unknown as BodyInit)
    }
    if (url.pathname === '/api/QueryDocuments') {
      const body = cborDecode<{filter?: unknown}>(new Uint8Array(init?.body as ArrayBuffer))
      const documents = [...this.docs.values()]
        .filter((doc) => this.matches(doc, body.filter))
        .map((doc) => ({
          account: doc.account,
          path: `/${doc.path}`,
          metadata: doc.metadata,
          version: doc.version ?? 'v',
          updateTime: '',
        }))
      return Response.json({documents, nextPageToken: ''})
    }
    return Response.json({error: `no stand-in for ${url.href}`}, {status: 404})
  }) as unknown as typeof fetch

  /** The body as blocks: headings, code fences (closing on a fence of their kind at least as long) and paragraphs. */
  private blocksOf(body: string | undefined) {
    const blocks: Array<{block: Record<string, unknown>; children: never[]}> = []
    const lines = (body ?? '').split('\n')
    let index = 0
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      const fence = /^(`{3,}|~{3,})\s*(\S*)\s*$/.exec(line)
      if (fence) {
        const text: string[] = []
        for (i++; i < lines.length; i++) {
          const close = /^(`{3,}|~{3,})\s*$/.exec(lines[i]!)
          if (close && close[1]![0] === fence[1]![0] && close[1]!.length >= fence[1]!.length) break
          text.push(lines[i]!)
        }
        blocks.push({
          block: {id: `b${++index}`, type: 'Code', text: text.join('\n'), attributes: {language: fence[2] ?? ''}},
          children: [],
        })
        continue
      }
      const heading = /^#\s+(.+)$/.exec(line)
      if (heading) {
        blocks.push({block: {id: `b${++index}`, type: 'Heading', text: heading[1]!}, children: []})
        continue
      }
      if (line.trim()) blocks.push({block: {id: `b${++index}`, type: 'Paragraph', text: line}, children: []})
    }
    return blocks
  }

  private document(doc: Doc) {
    return {
      content: this.blocksOf(doc.body),
      version: doc.version ?? 'v',
      account: doc.account,
      authors: [],
      path: `/${doc.path}`,
      createTime: '',
      updateTime: '',
      metadata: doc.metadata,
      genesis: 'genesis',
      visibility: 'PUBLIC',
    }
  }

  private attribute(doc: Doc, key: string): unknown {
    let value: unknown = doc.metadata
    for (const part of key.split('.')) {
      if (!value || typeof value !== 'object') return undefined
      value = (value as Record<string, unknown>)[part]
    }
    return value
  }

  /** The daemon's filter semantics, including that `attributesSchema` also matches the parent's `childAttributesSchema`. */
  private matches(doc: Doc, filter: unknown): boolean {
    const f = filter as Record<string, Record<string, unknown>> | undefined
    if (!f) return true
    if (f.and) return (f.and.filters as unknown[]).every((part) => this.matches(doc, part))
    if (f.or) return (f.or.filters as unknown[]).some((part) => this.matches(doc, part))
    if (f.exists) return this.attribute(doc, String(f.exists.key)) !== undefined
    if (f.spaceMatch) return doc.account === f.spaceMatch.space
    if (f.pathMatch) {
      const path = `/${doc.path}`
      return path === f.pathMatch.path || (f.pathMatch.prefix === true && path.startsWith(`${f.pathMatch.path}/`))
    }
    if (f.comparison) {
      const wanted = (f.comparison.value as {stringValue?: string}).stringValue
      const key = String(f.comparison.key)
      if (this.attribute(doc, key) === wanted) return true
      if (key !== 'attributesSchema' || !doc.path.includes('/')) return false
      const parent = this.docs.get(`hm://${doc.account}/${doc.path.slice(0, doc.path.lastIndexOf('/'))}`)
      return parent?.metadata.childAttributesSchema === wanted
    }
    return false
  }
}

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

function makeDb(accounts: string[] = []): Database {
  const db = new Database(':memory:')
  sqlite.openWithDatabase(db)
  const now = Date.now()
  for (const id of accounts)
    db.run(`INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)`, [id, now, now])
  cleanups.push(() => sqlite.closeDatabase(db))
  return db
}

function storeSecret(db: Database, accountId: string, name: string): void {
  const now = Date.now()
  db.run(
    `INSERT INTO secrets (id, account_id, name, ciphertext, metadata_cbor, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?)`,
    [crypto.randomUUID(), accountId, name, new Uint8Array(40), now, now],
  )
}

/** A data directory for the code cache, removed after the test. */
function makeDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-mounts-test-'))
  cleanups.push(() => fs.rmSync(dir, {recursive: true, force: true}))
  return dir
}

function deps(db: Database, net: FakeNetwork, extra: Partial<appMounts.AppMountDeps> = {}): appMounts.AppMountDeps {
  return {
    db,
    hmServerUrl: 'https://hm.test',
    ipfsServerUrl: 'https://hm.test',
    dataDir: makeDataDir(),
    serverUid: THIS_UID,
    fetch: net.fetch,
    runtimes: ['ts', 'python'],
    serverArgValue: (slug, arg) => (slug === 'convert' && arg === 'apiKey' ? 'shared-key' : undefined),
    ...extra,
  }
}

const rows = (db: Database) =>
  db
    .query<{account_id: string; scope: string; slug: string; mount_id: string}, []>(
      `SELECT account_id, scope, slug, mount_id FROM app_mounts ORDER BY account_id, slug`,
    )
    .all()

describe('app mounts', () => {
  test("mounts a space's reference-form mount when its home document binds the space to this server", async () => {
    const net = new FakeNetwork()
    await net.putConvertApp()
    net.putTenant(OPERATOR, {server: THIS_SERVER, scope: 'server', usage: {allowance: 500, ceiling: 5000}})
    // A tenant's page cannot raise its own allowance: its usage block is ignored.
    net.putTenant('z6MkTenant', {server: THIS_SERVER, usage: {allowance: 1_000_000}})
    const db = makeDb(['z6MkTenant'])
    storeSecret(db, 'z6MkTenant', 'app-convert-apiKey')

    const serverDeps = deps(db, net)
    const result = await appMounts.refreshAppMounts(serverDeps)
    expect(result.serverChanged).toBe(true)
    expect([...result.changedAccounts]).toEqual(['z6MkTenant'])
    expect(rows(db)).toEqual([
      {account_id: '', scope: 'server', slug: 'convert', mount_id: `hm://${OPERATOR}/apps/convert`},
      {account_id: 'z6MkTenant', scope: 'space', slug: 'convert', mount_id: 'hm://z6MkTenant/apps/convert'},
    ])
    const mount = appMounts.visibleAppMount(db, 'z6MkTenant', 'convert')
    expect(mount?.scope).toBe('space')
    expect(mount?.version).toBe('app-v1')
    expect(mount?.secretRefs).toEqual({apiKey: 'app-convert-apiKey'})
    expect(mount?.usage).toBeUndefined()
    const codeUrl = await net.putFile(TOOL_CODE)
    const codeCid = codeUrl.replace('ipfs://', '')
    expect(mount?.snapshot).toMatchObject({
      slug: 'convert',
      name: 'Datalab converter',
      skillDoc: 'Review seed.md before publishing.',
      network: {datalab: 'www.datalab.to'},
      usage: {meter: 'per-unit', unit: 'pages', period: 'month', callCap: 200},
      tools: [
        {
          tool: 'convert',
          runtime: 'ts',
          input: {type: 'object', properties: {files: {type: 'array', items: {type: 'string'}}}, required: ['files']},
          inputSchema: await net.putObject(TOOL_INPUT),
          code: {url: codeUrl, cid: codeCid, entry: 'index.ts'},
          instructions: 'Pass memory paths in `files`.',
        },
      ],
    })
    expect(mount?.snapshot?.tools[0]?.output).toBeUndefined()
    // The code was fetched once, proven against its CID and cached under it for the sandbox to stage.
    expect(fs.readFileSync(path.join(appMounts.appCodePath(serverDeps.dataDir, codeCid), 'index.ts'), 'utf8')).toBe(
      TOOL_CODE,
    )
    expect(net.requests.filter((url) => url.includes(`/ipfs/${codeCid}`))).toHaveLength(1)
    expect(appMounts.visibleAppToolNames(db, 'z6MkTenant')).toEqual(['convert'])
    // The operator's page says what the server-wide mount gives away.
    const serverMount = appMounts.visibleAppMount(db, 'z6MkOther', 'convert')
    expect(serverMount?.usage).toEqual({allowance: 500, ceiling: 5000})
    expect(appMounts.appMountInfo(serverMount!).usage).toEqual({
      meter: 'per-unit',
      unit: 'pages',
      period: 'month',
      callCap: 200,
      allowance: 500,
      ceiling: 5000,
    })

    // The client's view never carries a secret value, only that one is stored.
    const info = appMounts.appMountInfo(mount!)
    expect(info.arguments).toEqual([
      {name: 'apiKey', type: 'string', secret: true, required: true, order: 1, hasValue: true},
      {name: 'mode', type: 'string', secret: false, required: false, order: 2},
    ])
    expect(info.tools).toEqual([
      {
        tool: 'convert',
        summary: 'Convert documents from memory.',
        runtime: 'ts',
        code: codeUrl,
        inputSchema: await net.putObject(TOOL_INPUT),
      },
    ])
    expect(info.network).toEqual({datalab: 'www.datalab.to'})
    expect(JSON.stringify(info)).not.toContain('shared-key')

    // Projection: the tool page becomes the agent's tool document, a lambda whose code is the
    // page's reference, with the page's contract under the app's text, and provenance on it.
    const now = Date.now()
    db.run(
      `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['agent', 'z6MkTenant', new Uint8Array([160]), 'x', 'ready', now, now],
    )
    expect(toolDocs.syncAppToolDocuments(db, 'z6MkTenant', 'agent')).toEqual({changed: true, conflicts: []})
    const doc = toolDocs.getToolDocument(db, 'z6MkTenant', 'agent', 'convert')
    expect(doc?.doc).toMatchObject({
      kind: 'lambda',
      runtime: 'typescript',
      app: {slug: 'convert', version: 'app-v1', scope: 'space', code: {url: codeUrl, entry: 'index.ts'}},
      summary: 'Convert documents from memory.',
    })
    expect(doc?.doc.source).toBeUndefined()
    expect(toolDocs.toolDocumentContractMarkdown(doc!)).toContain(`the code is \`${codeUrl}\`, entry \`index.ts\``)
    expect(doc?.doc.binding).toBeUndefined()
    expect(doc?.doc.description).toBe('Pass memory paths in `files`.\n\nReview seed.md before publishing.')
    expect((doc?.doc.input as {properties: Record<string, unknown>}).properties.files).toBeDefined()
    expect(toolDocs.toolDocumentContractMarkdown(doc!)).toContain('app tool · the convert app (space mount')
    // A second sync changes nothing, and a pass that finds the same documents reports no change.
    expect(toolDocs.syncAppToolDocuments(db, 'z6MkTenant', 'agent').changed).toBe(false)
    const again = await appMounts.refreshAppMounts(deps(db, net))
    expect(again).toEqual({serverChanged: false, changedAccounts: new Set()})
  })

  test('binds a space through its site when the home document names no agents server', async () => {
    const net = new FakeNetwork()
    await net.putConvertApp()
    net.putTenant('z6MkSiteSpace', {siteUrl: 'https://site.test'})
    net.json.set('https://site.test/hm/api/config', {
      registeredAccountUid: 'z6MkSiteSpace',
      agentServerUrl: THIS_SERVER,
    })
    const db = makeDb(['z6MkSiteSpace'])
    storeSecret(db, 'z6MkSiteSpace', 'app-convert-apiKey')
    await appMounts.refreshAppMounts(deps(db, net))
    expect(rows(db)).toEqual([
      {account_id: 'z6MkSiteSpace', scope: 'space', slug: 'convert', mount_id: 'hm://z6MkSiteSpace/apps/convert'},
    ])
    const client = {request: () => Promise.reject(new Error('unused'))} as never
    void client
  })

  test('ignores a space bound to another server, and a tenant that claims server scope', async () => {
    const net = new FakeNetwork()
    await net.putConvertApp()
    net.putTenant('z6MkElsewhereSpace', {server: 'https://elsewhere.test/hm/api/agents'})
    net.putTenant('z6MkAmbitious', {server: THIS_SERVER, scope: 'server'})
    net.putTenant('z6MkUnbound', {})
    const db = makeDb()
    await appMounts.refreshAppMounts(deps(db, net))
    expect(rows(db)).toEqual([])
  })

  test('copy form: an app page published with its mount attributes mounts itself in its space', async () => {
    const net = new FakeNetwork()
    net.put({account: 'z6MkAuthor', path: '', metadata: {name: 'Author', agentServerUrl: THIS_SERVER}})
    net.put({
      account: 'z6MkAuthor',
      path: 'apps/mine',
      version: 'mine-v3',
      metadata: {
        name: 'My converter',
        summary: 'A converter of my own.',
        attributesSchema: APP,
        slug: 'mine',
        arguments: {
          apiKey: {type: 'string', secret: true},
          mode: {type: 'string', choices: {fast: 'Fast', slow: 'Slow'}},
        },
        mount: {scope: 'space', arguments: {mode: 'fast'}},
      },
      body: 'Mine.',
    })
    net.put({
      account: 'z6MkAuthor',
      path: 'apps/mine/tools',
      metadata: {name: 'Tools', summary: 'x', childAttributesSchema: APP_TOOL},
    })
    net.put({
      account: 'z6MkAuthor',
      path: 'apps/mine/tools/go',
      metadata: {
        name: 'go',
        summary: 'Go.',
        tool: 'go',
        runtime: 'python',
        inputSchema: await net.putObject({type: 'object'}),
        outputSchema: await net.putObject({type: 'object'}),
        code: await net.putFile('def main(input):\n    return {}'),
      },
      body: 'Go.',
    })
    const db = makeDb(['z6MkAuthor'])
    await appMounts.refreshAppMounts(deps(db, net))
    const mount = appMounts.visibleAppMount(db, 'z6MkAuthor', 'mine')
    expect(mount).toMatchObject({
      mountId: 'hm://z6MkAuthor/apps/mine',
      appId: 'hm://z6MkAuthor/apps/mine',
      version: 'mine-v3',
    })
    expect(mount?.args).toEqual({mode: 'fast'})
    expect(mount?.snapshot?.network).toEqual({})
    expect(mount?.snapshot?.tools).toMatchObject([
      {tool: 'go', runtime: 'python', code: {entry: 'main.py'}, output: {type: 'object'}},
    ])
    expect(appMounts.appMountInfo(mount!).arguments.find((arg) => arg.name === 'mode')).toMatchObject({
      value: 'fast',
      choices: {fast: 'Fast', slow: 'Slow'},
    })
  })

  test('a secret written into a document, a missing required secret and a bad value are each a visible error', async () => {
    const net = new FakeNetwork()
    await net.putConvertApp()
    net.putTenant('z6MkLeaky', {server: THIS_SERVER, args: {apiKey: 'sk-oops'}})
    net.putTenant('z6MkForgetful', {server: THIS_SERVER})
    net.putTenant('z6MkWrong', {server: THIS_SERVER, args: {mode: 42}})
    const db = makeDb(['z6MkLeaky', 'z6MkForgetful', 'z6MkWrong'])
    storeSecret(db, 'z6MkLeaky', 'app-convert-apiKey')
    storeSecret(db, 'z6MkWrong', 'app-convert-apiKey')
    await appMounts.refreshAppMounts(deps(db, net))
    const statusOf = (account: string) =>
      appMounts.listVisibleAppMounts(db, account).find((row) => row.slug === 'convert')?.status
    expect(statusOf('z6MkLeaky')).toMatchObject({
      state: 'error',
      error: 'The secret argument apiKey must not be written into a document',
    })
    expect(statusOf('z6MkForgetful')).toMatchObject({state: 'error', error: 'missing secret apiKey'})
    expect(statusOf('z6MkWrong')).toMatchObject({state: 'error', error: 'Argument mode must be a string'})
    for (const account of ['z6MkLeaky', 'z6MkForgetful', 'z6MkWrong']) {
      expect(appMounts.visibleAppToolNames(db, account)).toEqual([])
    }
  })

  test('refuses a tool this server cannot run, and a page whose contract or code does not hold up', async () => {
    type Options = Parameters<FakeNetwork['putConvertApp']>[0]
    const unknownRaw = `ipfs://${CID.createV1(
      RAW_CODEC,
      await sha256.digest(new TextEncoder().encode('never published')),
    ).toString()}`
    const problems: Array<[(net: FakeNetwork) => Promise<Options>, Partial<appMounts.AppMountDeps>, string]> = [
      [async () => ({}), {runtimes: ['python']}, 'Tool convert is written in ts, which this server cannot run'],
      [async () => ({}), {runtimes: []}, 'Tool convert needs code execution, which this server does not offer'],
      [async () => ({timeoutSecs: 100_000}), {}, 'Tool convert asks for a timeout outside 1..1800 seconds'],
      [async () => ({inputSchema: ''}), {}, 'Tool convert has no inputSchema'],
      [async () => ({inputSchema: '{not a reference'}), {}, "Tool convert's inputSchema must be an ipfs:// reference"],
      [
        async (net) => ({inputSchema: await net.putFile('{"type": "object"}')}),
        {},
        "Tool convert's inputSchema must name a DAG-CBOR object, not a file",
      ],
      [
        async (net) => ({inputSchema: await net.putObject({type: 'array'})}),
        {},
        'Tool convert\'s inputSchema: $.type: the root must be type "object"',
      ],
      [
        async (net) => ({outputSchema: await net.putObject([])}),
        {},
        "Tool convert's outputSchema: $: schema must be an object",
      ],
      [async () => ({code: '   '}), {}, 'Tool convert has no code'],
      [
        async (net) => ({code: await net.putObject({not: 'code'})}),
        {},
        "Tool convert's code must name a file or a folder",
      ],
      [async () => ({code: unknownRaw}), {}, `Tool convert's code ${unknownRaw} could not be fetched (404)`],
      [
        async (net) => {
          // Bytes that do not hash to the CID the page names: a gateway serving the wrong thing.
          const url = await net.putFile(TOOL_CODE)
          net.blobs.set(url.replace('ipfs://', ''), new TextEncoder().encode('tampered'))
          return {code: url}
        },
        {},
        'does not match its content id',
      ],
      [
        async (net) => ({code: await net.putFolder({'': await net.putFile('chunk')}, {unnamed: true})}),
        {},
        'is a file in several blocks, larger than 256 KiB',
      ],
      [
        async (net) => ({code: await net.putFolder({'main.py': await net.putFile('def main(input): pass')})}),
        {},
        "Tool convert's code folder has no index.ts",
      ],
      [
        async (net) => ({code: await net.putFolder({'index.ts': await net.putObject({})})}),
        {},
        "Tool convert's code: index.ts is neither a file nor a folder",
      ],
      [
        async (net) => ({
          code: await net.putFolder({'index.ts': await net.putFile('x'), '../up': await net.putFile('y')}),
        }),
        {},
        "Tool convert's code has an entry with an unusable name: ../up",
      ],
    ]
    for (const [build, extra, message] of problems) {
      const net = new FakeNetwork()
      await net.putConvertApp(await build(net))
      net.putTenant('z6MkTenant', {server: THIS_SERVER})
      const db = makeDb(['z6MkTenant'])
      storeSecret(db, 'z6MkTenant', 'app-convert-apiKey')
      const serverDeps = deps(db, net, extra)
      await appMounts.refreshAppMounts(serverDeps)
      const row = appMounts.listVisibleAppMounts(db, 'z6MkTenant')[0]
      expect(row?.status.state).toBe('error')
      expect(row?.status.error).toContain(message)
      expect(row?.snapshot).toBeUndefined()
      // Nothing refused is cached, not even a temp directory of it.
      expect(fs.existsSync(path.join(serverDeps.dataDir, 'app-code'))).toBe(false)
    }
  })

  test("a tool's code may be a folder: its files land in the cache under the CID, fetched once for every mount", async () => {
    const net = new FakeNetwork()
    const lib = await net.putFolder({'util.ts': await net.putFile('export const x = 1')})
    const folder = await net.putFolder({'index.ts': await net.putFile('import {x} from "./lib/util"'), lib})
    await net.putConvertApp({code: folder})
    net.putTenant(OPERATOR, {server: THIS_SERVER, scope: 'server', usage: {allowance: 1, ceiling: 1}})
    net.putTenant('z6MkTenant', {server: THIS_SERVER})
    const db = makeDb(['z6MkTenant'])
    storeSecret(db, 'z6MkTenant', 'app-convert-apiKey')
    const serverDeps = deps(db, net)
    // Two passes at once, then one more: the folder is fetched a single time.
    await Promise.all([appMounts.refreshAppMounts(serverDeps), appMounts.refreshAppMounts(serverDeps)])
    await appMounts.refreshAppMounts(serverDeps)
    const mount = appMounts.visibleAppMount(db, 'z6MkTenant', 'convert')
    const cid = folder.replace('ipfs://', '')
    expect(mount?.snapshot?.tools[0]?.code).toEqual({url: folder, cid, entry: 'index.ts'})
    const cache = appMounts.appCodePath(serverDeps.dataDir, cid)
    expect(fs.readFileSync(path.join(cache, 'index.ts'), 'utf8')).toBe('import {x} from "./lib/util"')
    expect(fs.readFileSync(path.join(cache, 'lib', 'util.ts'), 'utf8')).toBe('export const x = 1')
    expect(net.requests.filter((url) => url.includes('/ipfs/')).length).toBe(2)
    expect(net.requests.filter((url) => url.includes('/api/GetCID?cid=' + cid)).length).toBe(1)
    // A run finds the cache where the pass left it, and fetches again only when it is gone.
    const code = mount!.snapshot!.tools[0]!.code
    expect(await appMounts.ensureToolCode(serverDeps, 'convert', code)).toBe(cache)
    fs.rmSync(cache, {recursive: true, force: true})
    expect(await appMounts.ensureToolCode(serverDeps, 'convert', code)).toBe(cache)
    expect(fs.readFileSync(path.join(cache, 'lib', 'util.ts'), 'utf8')).toBe('export const x = 1')
  })

  test('strips the block ids the export writes, but never inside a fence, where an example may show one', () => {
    const page = [
      '# Code <!-- id:Oqdsi15O -->',
      '',
      'Readers. <!-- id:DVQQE4ym -->',
      '',
      '````ts <!-- id:XbEC7VY0 -->',
      "const mark = ' <!-- id:ref-1 -->'",
      '```',
      'still code <!-- id:AAAAAAAA -->',
      '````',
      'after <!-- id:BBBBBBBB -->',
    ].join('\n')
    expect(appMounts.stripBlockIds(page)).toBe(
      [
        '# Code',
        '',
        'Readers.',
        '',
        '````ts',
        "const mark = ' <!-- id:ref-1 -->'",
        '```',
        'still code <!-- id:AAAAAAAA -->',
        '````',
        'after',
      ].join('\n'),
    )
  })

  test('removes a mount whose document was deleted or disabled by the next pass', async () => {
    const net = new FakeNetwork()
    await net.putConvertApp()
    net.putTenant('z6MkTenant', {server: THIS_SERVER})
    net.putTenant('z6MkOther', {server: THIS_SERVER})
    const db = makeDb(['z6MkTenant', 'z6MkOther'])
    storeSecret(db, 'z6MkTenant', 'app-convert-apiKey')
    storeSecret(db, 'z6MkOther', 'app-convert-apiKey')
    await appMounts.refreshAppMounts(deps(db, net))
    expect(rows(db).map((row) => row.account_id)).toEqual(['z6MkOther', 'z6MkTenant'])
    net.docs.delete('hm://z6MkTenant/apps/convert')
    net.putTenant('z6MkOther', {server: THIS_SERVER, enabled: false})
    const result = await appMounts.refreshAppMounts(deps(db, net))
    expect([...result.changedAccounts].sort()).toEqual(['z6MkOther', 'z6MkTenant'])
    expect(rows(db)).toEqual([])
  })

  test("keeps serving an account's legacy Datalab key as its own mount of convert", async () => {
    const net = new FakeNetwork()
    await net.putConvertApp()
    net.putTenant(OPERATOR, {server: THIS_SERVER, scope: 'server'})
    const db = makeDb(['z6MkOldTimer'])
    storeSecret(db, 'z6MkOldTimer', appMounts.LEGACY_DATALAB_SECRET)
    await appMounts.refreshAppMounts(deps(db, net))
    const mount = appMounts.visibleAppMount(db, 'z6MkOldTimer', 'convert')
    expect(mount).toMatchObject({
      scope: 'space',
      mountId: 'legacy:datalab-api-key',
      secretRefs: {apiKey: 'datalab-api-key'},
    })
    db.run(`DELETE FROM secrets WHERE account_id = ?`, ['z6MkOldTimer'])
    await appMounts.refreshAppMounts(deps(db, net))
    expect(appMounts.visibleAppMount(db, 'z6MkOldTimer', 'convert')?.scope).toBe('server')
  })

  test('a space mount shadows the server-wide one, and resolving it brings the secret along', async () => {
    const net = new FakeNetwork()
    await net.putConvertApp()
    net.putTenant(OPERATOR, {server: THIS_SERVER, scope: 'server'})
    net.putTenant('z6MkTenant', {server: THIS_SERVER})
    const db = makeDb(['z6MkTenant'])
    storeSecret(db, 'z6MkTenant', 'app-convert-apiKey')
    await appMounts.refreshAppMounts(deps(db, net))
    const secrets = {
      decrypt: (account: string, name: string) =>
        account === 'z6MkTenant' && name === 'app-convert-apiKey' ? 'own-key' : undefined,
      serverArgValue: (slug: string, arg: string) =>
        slug === 'convert' && arg === 'apiKey' ? 'shared-key' : undefined,
    }
    expect(appMounts.resolveAppMount(db, 'z6MkTenant', 'convert', secrets)).toMatchObject({
      scope: 'space',
      args: {apiKey: 'own-key'},
    })
    expect(appMounts.resolveAppMount(db, 'z6MkVisitor', 'convert', secrets)).toMatchObject({
      scope: 'server',
      args: {apiKey: 'shared-key'},
    })
    expect(appMounts.listVisibleAppMounts(db, 'z6MkTenant').map((row) => row.scope)).toEqual(['space'])
  })

  test('remembers whether a URL is this server instead of asking on every pass', async () => {
    const net = new FakeNetwork()
    await net.putConvertApp()
    net.putTenant('z6MkTenant', {server: THIS_SERVER})
    const db = makeDb(['z6MkTenant'])
    storeSecret(db, 'z6MkTenant', 'app-convert-apiKey')
    await appMounts.refreshAppMounts(deps(db, net))
    await appMounts.refreshAppMounts(deps(db, net))
    expect(net.requests.filter((href) => href.endsWith('/health'))).toHaveLength(1)
    expect(await appMounts.isThisServer(deps(db, net), 'https://agents.test/hm/api/agents/')).toBe(true)
    expect(await appMounts.isThisServer(deps(db, net), 'not a url')).toBe(false)
  })
})
