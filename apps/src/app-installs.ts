/**
 * App installs: which apps are installed for which spaces on this server, found from typed documents.
 *
 * An app is a page typed `agent/app` whose attributes declare its slug, arguments and usage,
 * whose body is the skill doc the model reads, and whose `tools` folder holds one `agent/app-tool`
 * page per tool, each carrying its contract and its code in its attributes and its documentation in
 * its body. A space installs an app by publishing a page typed `agent/app-install` that links the
 * app's page (the reference form), or a copy of that page with its `install` attributes set (the copy
 * form). Nobody tells this server about either: every pass asks the daemon for all documents of
 * those types and keeps the ones that are its own to act on.
 *
 * Which server an install belongs to follows from a binding the space declares and this server proves.
 * A space names its app environment in its home document (`appEnvironmentUrl`, or the older
 * `agentServerUrl`), or its site does in
 * `/hm/api/config`; a server believes a URL is itself only after fetching that URL's `/health` and
 * seeing its own `serverUid` come back, the way a custom domain is proven by what DNS points at.
 * The same handshake names the operator's space: the one registered on the site this server reads
 * through, whose advertised app environment proves to be this one. An install with `scope: server` is
 * honored there and nowhere else, and applies to every space the server serves.
 *
 * What a pass stores is a snapshot of the app and its tools, so projection and execution never
 * read the network, and the secret arguments it pairs with the install stay on this server
 * (`app-<slug>-<arg>` in `secrets`), never in a document. See hypermedia/agent/agent-apps.md.
 */
import type {Database} from 'bun:sqlite'
import type * as api from '@/api'
import * as cbor from '@/cbor'
import {MAX_APP_EXEC_TIMEOUT_SECS, type CodeExecRuntime} from '@/code-exec'
import {resolveDocsUrl} from '@/docs-space'
import {validateJsonSchemaShape} from '@/json-schema'
import {stmt} from '@/statements'
import {callableToolRegistry, seedVerbRegistry, type JsonSchema} from '@seed-hypermedia/apps-protocol'
import {createSeedClient, documentToResolvedMarkdown, packHmId} from '@seed-hypermedia/client'
import type {HMDocument, HMDocumentFilter, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {unpackHmId} from '@seed-hypermedia/client/hm-types'
import {checkDocumentSchema} from '@seed-hypermedia/client/schema-resolve'
import {closeOverSubtypes, libraryCandidates} from '@seed-hypermedia/client/schema-subtypes'
import {CID} from 'multiformats/cid'
import {sha256} from 'multiformats/hashes/sha2'
import * as fs from 'node:fs'
import * as path from 'node:path'

/** The library names of the three types, as the schema registry spells them. */
export const APP_SCHEMA = 'hm://hyper.media/agent/app'
export const APP_TOOL_SCHEMA = 'hm://hyper.media/agent/app-tool'
export const APP_INSTALL_SCHEMA = 'hm://hyper.media/agent/app-install'

/** `account_id` of a server-wide install row. */
export const SERVER_SCOPE_ACCOUNT = ''

/** The secret an account kept its own Datalab key under before installs existed; still honored as an install of `convert`. */
export const LEGACY_DATALAB_SECRET = 'datalab-api-key'

const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/
const TOOL_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/
const MAX_QUERY_PAGES = 20
const MAX_TOOLS_PER_APP = 32
/**
 * The most one file of a tool's code may hold: one UnixFS chunk, so every file is a single raw
 * block whose CID is the hash of its bytes, checked here. A file past this is a dag-pb DAG, refused.
 */
const MAX_TOOL_FILE_BYTES = 256 * 1024
/** A code folder's bounds: files, bytes and nesting. Well under the importer's HAMT sharding threshold. */
const MAX_TOOL_FILES = 64
const MAX_TOOL_CODE_BYTES = 2 * 1024 * 1024
const MAX_TOOL_FOLDER_DEPTH = 8
/** Multicodec codes of the blobs a tool page may reference: a raw file, a dag-pb folder, a DAG-CBOR object. */
const RAW_CODEC = 0x55
const DAG_PB_CODEC = 0x70
const DAG_CBOR_CODEC = 0x71
const SHA256_CODE = 0x12
/** How long a proven (or disproven) binding is believed before `/health` is asked again. */
const BINDING_FRESH_MS = 24 * 60 * 60 * 1000
/** How long a failed probe is believed, so an unreachable server is not asked on every pass. */
const BINDING_RETRY_MS = 10 * 60 * 1000

export type AppScope = 'server' | 'space'

/** One argument as the app declares it. */
export type AppArgumentDeclaration = {
  type: 'string' | 'integer' | 'boolean'
  secret: boolean
  required: boolean
  order?: number
  description?: string
  choices?: Record<string, string>
}

/** The runtimes a tool page may name: `ts` runs with bun, `python` with the interpreter. */
export type AppToolRuntime = 'ts' | 'python'

/**
 * Where a tool's code is: the page's `code` reference, its CID, and the entry file the sandbox
 * runs (`index.ts` or `main.py` of a folder, or the single file under that name). The bytes sit in
 * the server's cache under the CID (see appCodePath), fetched at install and checked against it.
 */
export type AppToolCode = {url: string; cid: string; entry: string}

/** One tool as the app's `tools` folder declares it: the contract and code its page references, and the text the model reads. */
export type AppToolSnapshot = {
  tool: string
  summary: string
  runtime: AppToolRuntime
  /** How long one call may run; the server's default when the page sets none. */
  timeoutSecs?: number
  input: JsonSchema
  output?: JsonSchema
  /** The `inputSchema` and `outputSchema` references, as the page spells them, for clients that show them. */
  inputSchema: string
  outputSchema?: string
  /** The page's `code` reference resolved: what the sandbox runs per the lambda ABI. */
  code: AppToolCode
  /** The page's body: the tool's documentation, which the model reads with the contract. */
  instructions: string
}

/** Everything a pass took from an app page and its tools, kept on the install row. */
export type AppSnapshot = {
  slug: string
  name: string
  summary: string
  arguments: Record<string, AppArgumentDeclaration>
  permissions: Record<string, boolean>
  /** The hosts the app's code may reach, keyed by the app's labels; the sandbox allows exactly these. */
  network: Record<string, string>
  usage?: {meter: 'none' | 'per-unit'; unit?: string; period?: 'month'; callCap?: number}
  skillDoc: string
  tools: AppToolSnapshot[]
}

/** What a server-wide install page gives away of a metered app: units per space and for the whole server, per period. */
export type AppInstallUsage = {allowance?: number; ceiling?: number}

export type AppInstallRow = {
  accountId: string
  scope: AppScope
  slug: string
  /** The install page (or the app page, in the copy form); `legacy:<secret>` for the shim. */
  installId: string
  appId: string
  version?: string
  snapshot?: AppSnapshot
  /** Non-secret argument values the install carries. */
  args: Record<string, string | number | boolean | null>
  /** Argument name → secret name on this server, for the app's secret arguments. */
  secretRefs: Record<string, string>
  /** The allowance and ceiling a server-wide install page sets; absent on a space install. */
  usage?: AppInstallUsage
  status: api.AppInstallStatus
  createdAt: number
  updatedAt: number
}

/** What the pass needs from the server that runs it. */
export type AppInstallDeps = {
  db: Database
  hmServerUrl: string
  /** The endpoint serving `/ipfs/<cid>`: where a tool's code and schemas are fetched from. */
  ipfsServerUrl: string
  /** The server's data directory; a tool's code is cached under `app-code/<cid>` in it. */
  dataDir: string
  /** This server's identity principal, as `/health` publishes it. */
  serverUid: string
  /** The fetch every network call goes through (deadlines and test stubs live here). */
  fetch: typeof fetch
  /** The runtimes this server's sandbox offers; a tool written in another is refused at install. Empty when code execution is off. */
  runtimes: readonly CodeExecRuntime[]
  /** A server-scope secret argument's value from this server's own configuration, when it has one. */
  serverArgValue: (slug: string, arg: string) => string | undefined
  signal?: AbortSignal
  now?: number
}

/** The secret name an install's secret argument is stored under. */
export function appSecretName(slug: string, arg: string): string {
  return `app-${slug}-${arg}`
}

/**
 * Normalizes an app environment URL the way clients store it: origin plus the canonical
 * `/hm/api/agents` path when present, nothing else (mirrors `normalizeAgentServerUrl` in the UI).
 */
export function normalizeAgentServerUrl(input: string): string {
  const value = input.trim().replace(/\/+$/, '')
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Agent server URL must be http(s)')
  if (url.pathname === '/agents' || url.pathname === '/agents/') url.pathname = '/'
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/+$/, '')
}

/** The URL of one public endpoint of an app environment, on the canonical install or the legacy host layout. */
export function agentServerEndpointUrl(serverUrl: string, endpoint: 'health'): string {
  const base = normalizeAgentServerUrl(serverUrl)
  return new URL(base).pathname.endsWith('/hm/api/agents') ? `${base}/${endpoint}` : `${base}/agents/api/${endpoint}`
}

/**
 * Every spelling a stored `attributesSchema` may use for a library type and its subtypes: the
 * library name, the docs space's key in its place, and the schema blob's CID.
 */
export function schemaSpellings(name: string): string[] {
  const refs = closeOverSubtypes(name, libraryCandidates()).refs
  const out = new Set(refs)
  for (const ref of refs) {
    const resolved = resolveDocsUrl(ref)
    if (resolved !== ref) out.add(resolved)
  }
  return [...out]
}

const typedBy = (refs: string[]): HMDocumentFilter => ({
  or: {
    filters: refs.map((ref) => ({comparison: {key: 'attributesSchema', operator: 'EQUAL', value: {stringValue: ref}}})),
  },
})

type SeedClient = ReturnType<typeof createSeedClient>
type DocumentInfo = {account: string; path?: string; metadata?: Record<string, unknown>; version?: string}

async function queryAll(client: SeedClient, filter: HMDocumentFilter): Promise<DocumentInfo[]> {
  const out: DocumentInfo[] = []
  let pageToken: string | undefined
  for (let page = 0; page < MAX_QUERY_PAGES; page++) {
    const output = await client.request('QueryDocuments', {filter, pageSize: 100, ...(pageToken ? {pageToken} : {})})
    out.push(...((output.documents ?? []) as unknown as DocumentInfo[]))
    if (!output.nextPageToken) break
    pageToken = output.nextPageToken
  }
  return out
}

async function fetchJson(deps: AppInstallDeps, url: string): Promise<Record<string, unknown>> {
  const response = await deps.fetch(url, {signal: deps.signal, headers: {accept: 'application/json'}})
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const body = (await response.json()) as unknown
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(`${url} did not answer JSON`)
  return body as Record<string, unknown>
}

/**
 * Whether `url` is this server: the answer `/health` gives, remembered in `server_bindings` for a
 * day (ten minutes after a failed probe). A server cannot claim a URL it does not answer at.
 */
export async function isThisServer(deps: AppInstallDeps, url: string): Promise<boolean> {
  let normalized: string
  try {
    normalized = normalizeAgentServerUrl(url)
  } catch {
    return false
  }
  const now = deps.now ?? Date.now()
  const cached = stmt<{server_uid: string | null; checked_at: number; error: string | null}, [string]>(
    deps.db,
    `SELECT server_uid, checked_at, error FROM server_bindings WHERE url = ?`,
  ).get(normalized)
  if (cached && now - cached.checked_at < (cached.error ? BINDING_RETRY_MS : BINDING_FRESH_MS)) {
    return cached.server_uid === deps.serverUid
  }
  let serverUid: string | null = null
  let error: string | null = null
  try {
    const health = await fetchJson(deps, agentServerEndpointUrl(normalized, 'health'))
    if (typeof health.serverUid === 'string' && health.serverUid) serverUid = health.serverUid
    else error = 'no serverUid in /health (an older app environment)'
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  stmt(
    deps.db,
    `INSERT INTO server_bindings (url, server_uid, checked_at, error) VALUES (?, ?, ?, ?)
     ON CONFLICT(url) DO UPDATE SET server_uid = excluded.server_uid, checked_at = excluded.checked_at, error = excluded.error`,
  ).run([normalized, serverUid, now, error])
  return serverUid === deps.serverUid
}

export type SpaceBindingResult = api.SpaceBinding & {siteUrl?: string}

/**
 * Which app environment a space is bound to: its home document's `appEnvironmentUrl` (or the older
 * `agentServerUrl`), else the one its site advertises at `<siteUrl>/hm/api/config`, and whether that
 * is this server.
 */
export async function spaceBinding(
  deps: AppInstallDeps,
  client: SeedClient,
  accountId: string,
): Promise<SpaceBindingResult> {
  const homeId = unpackHmId(`hm://${accountId}`)
  const home = homeId ? await client.request('Resource', homeId).catch(() => undefined) : undefined
  const metadata = home?.type === 'document' ? (home.document.metadata as Record<string, unknown>) : undefined
  const siteUrl = typeof metadata?.siteUrl === 'string' && metadata.siteUrl ? metadata.siteUrl : undefined
  // `appEnvironmentUrl` is the binding's name since the app environment rename; `agentServerUrl`
  // is the one spaces bound before it carry, and released clients still write.
  const declared = metadata?.appEnvironmentUrl ?? metadata?.agentServerUrl
  let agentServerUrl = typeof declared === 'string' ? declared.trim() : ''
  let source: api.SpaceBinding['source'] = agentServerUrl ? 'home' : 'none'
  if (!agentServerUrl && siteUrl) {
    const config = await fetchJson(deps, `${siteUrl.replace(/\/+$/, '')}/hm/api/config`).catch(() => undefined)
    const advertised = config?.appEnvironmentUrl ?? config?.agentServerUrl
    if (typeof advertised === 'string' && advertised) {
      agentServerUrl = advertised
      source = 'site'
    }
  }
  if (!agentServerUrl) return {source: 'none', isThisServer: false, ...(siteUrl ? {siteUrl} : {})}
  return {
    agentServerUrl,
    source,
    isThisServer: await isThisServer(deps, agentServerUrl),
    ...(siteUrl ? {siteUrl} : {}),
  }
}

/**
 * The operator's space: the one registered on the site this server reads through, when the agents
 * server that site advertises proves to be this one. Null when the site names no space (the
 * desktop's local daemon) or advertises another server.
 */
export async function operatorSpace(deps: AppInstallDeps): Promise<string | null> {
  const config = await fetchJson(deps, `${deps.hmServerUrl.replace(/\/+$/, '')}/hm/api/config`).catch(() => undefined)
  const registered = typeof config?.registeredAccountUid === 'string' ? config.registeredAccountUid : ''
  const declared = config?.appEnvironmentUrl ?? config?.agentServerUrl
  const advertised = typeof declared === 'string' ? declared : ''
  if (!registered || !advertised) return null
  return (await isThisServer(deps, advertised)) ? registered : null
}

/** Why an install offers nothing; carries the app's slug once its page has said it, so the row can still name the app. */
class InstallProblem extends Error {
  slug?: string
}

/**
 * Removes the block id comments the markdown export writes at the end of a block's first line, so
 * a page reads as its author wrote it. Fenced code is left alone: an example in a page may well show
 * `<!-- id:… -->` itself (the converter's documentation does, since its output carries such ids).
 */
export function stripBlockIds(markdown: string): string {
  const out: string[] = []
  let open: string | undefined
  for (const line of markdown.split('\n')) {
    if (open) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)
      if (close && close[1]![0] === open[0] && close[1]!.length >= open.length) open = undefined
      out.push(line)
      continue
    }
    const stripped = line.replace(/[ \t]*<!-- id:[A-Za-z0-9_-]+ -->\s*$/, '')
    const fence = /^\s*(`{3,}|~{3,})/.exec(stripped)
    if (fence) open = fence[1]
    out.push(stripped)
  }
  return out.join('\n')
}

/**
 * A page's body as the model reads it: the resolved markdown without the frontmatter (the
 * attributes are the declaration, not the text) and without block id comments.
 */
async function bodyMarkdown(client: SeedClient, document: HMDocument): Promise<string> {
  const markdown = await documentToResolvedMarkdown(document, {client, maxDepth: 1})
  return stripBlockIds(markdown.replace(/^---\n[\s\S]*?\n---\n\n?/, '')).trim()
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

function documentUrl(info: DocumentInfo): string {
  const path = (info.path ?? '').replace(/^\/+/, '')
  return `hm://${info.account}${path ? `/${path}` : ''}`
}

/** Parses the app page's attributes into the snapshot's declaration half. */
function parseAppAttributes(metadata: Record<string, unknown>): Omit<AppSnapshot, 'skillDoc' | 'tools'> {
  const slug = typeof metadata.slug === 'string' ? metadata.slug : ''
  if (!SLUG_PATTERN.test(slug)) throw new InstallProblem('The app page has no valid slug')
  const args: Record<string, AppArgumentDeclaration> = {}
  for (const [name, raw] of Object.entries(asRecord(metadata.arguments) ?? {})) {
    const decl = asRecord(raw)
    const type = decl?.type
    if (!decl || (type !== 'string' && type !== 'integer' && type !== 'boolean')) {
      throw new InstallProblem(`Argument ${name} has no valid type`)
    }
    const choices = asRecord(decl.choices)
    args[name] = {
      type,
      secret: decl.secret === true,
      required: decl.required === true,
      ...(typeof decl.order === 'number' ? {order: decl.order} : {}),
      ...(typeof decl.description === 'string' ? {description: decl.description} : {}),
      ...(choices
        ? {
            choices: Object.fromEntries(
              Object.entries(choices).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
            ),
          }
        : {}),
    }
  }
  const permissions = Object.fromEntries(
    Object.entries(asRecord(metadata.permissions) ?? {}).filter(
      (entry): entry is [string, boolean] => entry[1] === true,
    ),
  )
  const network: Record<string, string> = {}
  for (const [label, host] of Object.entries(asRecord(metadata.network) ?? {})) {
    if (typeof host !== 'string' || !/^[a-z0-9.-]+$/i.test(host)) {
      throw new InstallProblem(`Network entry ${label} is not a host name`)
    }
    network[label] = host.toLowerCase()
  }
  const usageRaw = asRecord(metadata.usage)
  const meter = usageRaw?.meter
  const callCap = usageRaw?.callCap
  if (callCap !== undefined && !(Number.isInteger(callCap) && (callCap as number) > 0)) {
    throw new InstallProblem('usage.callCap must be a positive integer')
  }
  const usage: AppSnapshot['usage'] =
    meter === 'none' || meter === 'per-unit'
      ? {
          meter,
          ...(typeof usageRaw?.unit === 'string' ? {unit: usageRaw.unit} : {}),
          ...(usageRaw?.period === 'month' ? {period: 'month' as const} : {}),
          ...(callCap !== undefined ? {callCap: callCap as number} : {}),
        }
      : undefined
  return {
    slug,
    name: typeof metadata.name === 'string' ? metadata.name : slug,
    summary: typeof metadata.summary === 'string' ? metadata.summary : '',
    arguments: args,
    permissions,
    network,
    ...(usage ? {usage} : {}),
  }
}

/** A document must say it is of the type, and satisfy it; the daemon checks neither on publish. */
async function assertTyped(
  client: SeedClient,
  id: UnpackedHypermediaId,
  document: HMDocument,
  typeName: string,
  what: string,
): Promise<void> {
  const check = await checkDocumentSchema(client, id, document.metadata as Record<string, unknown>)
  if (check.error) throw new InstallProblem(`${what} ${packHmId(id)}: ${check.error}`)
  if (!check.schema || !schemaSpellings(typeName).includes(check.schema)) {
    throw new InstallProblem(`${what} ${packHmId(id)} is not typed by ${typeName}`)
  }
  if (check.violations.length) {
    throw new InstallProblem(`${what} ${packHmId(id)} does not satisfy ${typeName}: ${check.violations.join('; ')}`)
  }
}

async function readDocument(
  client: SeedClient,
  url: string,
): Promise<{id: UnpackedHypermediaId; document: HMDocument}> {
  const id = unpackHmId(resolveDocsUrl(url))
  if (!id) throw new InstallProblem(`${url} is not a document address`)
  const resource = await client.request('Resource', id).catch((error: unknown) => {
    throw new InstallProblem(`Could not read ${url}: ${error instanceof Error ? error.message : String(error)}`)
  })
  if (resource.type !== 'document') throw new InstallProblem(`${url} is not a document`)
  return {id, document: resource.document as HMDocument}
}

/** Reads an app page and its tools folder into a snapshot, refusing anything the server will not run. */
async function readAppSnapshot(
  deps: AppInstallDeps,
  client: SeedClient,
  appUrl: string,
): Promise<{snapshot: AppSnapshot; version?: string}> {
  const {id, document} = await readDocument(client, appUrl)
  await assertTyped(client, id, document, APP_SCHEMA, 'The app page')
  const declared = parseAppAttributes(document.metadata as Record<string, unknown>)
  try {
    return await readAppTools(deps, client, id, document, declared)
  } catch (error) {
    if (error instanceof InstallProblem) error.slug = declared.slug
    throw error
  }
}

/** Where the server keeps a tool's code: one directory per CID under the data directory, immutable by construction. */
export function appCodePath(dataDir: string, cid: string): string {
  return path.join(dataDir, 'app-code', cid)
}

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const sameBytes = (a: Uint8Array, b: Uint8Array) => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0

/** The CID an `ipfs://<cid>` attribute names; a missing or malformed value is the tool's problem, named. */
function ipfsReference(tool: string, attribute: string, value: unknown): CID {
  if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) {
    throw new InstallProblem(`Tool ${tool} has no ${attribute}`)
  }
  const match = typeof value === 'string' ? /^ipfs:\/\/([A-Za-z0-9]+)$/.exec(value.trim()) : null
  if (!match) throw new InstallProblem(`Tool ${tool}'s ${attribute} must be an ipfs:// reference`)
  try {
    return CID.parse(match[1]!)
  } catch {
    throw new InstallProblem(`Tool ${tool}'s ${attribute} is not a valid ipfs:// reference`)
  }
}

/** A schema reference resolved: the DAG-CBOR object it names, held to the subset the server validates against. */
async function readSchemaReference(
  client: SeedClient,
  tool: string,
  attribute: string,
  value: unknown,
): Promise<JsonSchema> {
  const cid = ipfsReference(tool, attribute, value)
  if (cid.code !== DAG_CBOR_CODEC) {
    throw new InstallProblem(`Tool ${tool}'s ${attribute} must name a DAG-CBOR object, not a file`)
  }
  const got = await client.request('GetCID', {cid: cid.toString()}).catch((error: unknown) => {
    throw new InstallProblem(`Tool ${tool}'s ${attribute} ipfs://${cid} could not be read: ${describe(error)}`)
  })
  const schema = (got as {value?: unknown} | undefined)?.value
  const errors = validateJsonSchemaShape(schema)
  if (errors.length) {
    throw new InstallProblem(
      `Tool ${tool}'s ${attribute}: ${errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`,
    )
  }
  return schema as JsonSchema
}

/** A raw block by CID from the IPFS endpoint, proven: the bytes must hash to the CID. */
async function fetchRawBlock(deps: AppInstallDeps, cid: CID, what: string): Promise<Uint8Array> {
  const url = `${deps.ipfsServerUrl.replace(/\/+$/, '')}/ipfs/${cid}`
  const response = await deps.fetch(url, {signal: deps.signal}).catch((error: unknown) => {
    throw new InstallProblem(`${what} ipfs://${cid} could not be fetched: ${describe(error)}`)
  })
  if (!response.ok) throw new InstallProblem(`${what} ipfs://${cid} could not be fetched (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_TOOL_FILE_BYTES) {
    throw new InstallProblem(`${what} is larger than ${MAX_TOOL_FILE_BYTES / 1024} KiB`)
  }
  const digest = await sha256.digest(bytes)
  if (cid.multihash.code !== SHA256_CODE || !sameBytes(digest.digest, cid.multihash.digest)) {
    throw new InstallProblem(`${what} ipfs://${cid} does not match its content id`)
  }
  return bytes
}

/** A UnixFS folder's entries from the dag-json view of its node: named links, each a file (raw) or a folder (dag-pb). */
async function fetchFolderListing(
  client: SeedClient,
  cid: CID,
  what: string,
): Promise<Array<{name: string; cid: CID}>> {
  const got = await client.request('GetCID', {cid: cid.toString()}).catch((error: unknown) => {
    throw new InstallProblem(`${what} ipfs://${cid} could not be listed: ${describe(error)}`)
  })
  const links = asRecord((got as {value?: unknown} | undefined)?.value)?.Links
  if (!Array.isArray(links) || !links.length) throw new InstallProblem(`${what} ipfs://${cid} is an empty folder`)
  return links.map((link) => {
    const record = asRecord(link)
    const name = record?.Name
    const hash = asRecord(record?.Hash)?.['/']
    if (typeof name !== 'string' || !name) {
      throw new InstallProblem(
        `${what} ipfs://${cid} is a file in several blocks, larger than ${MAX_TOOL_FILE_BYTES / 1024} KiB`,
      )
    }
    if (typeof hash !== 'string') throw new InstallProblem(`${what} ipfs://${cid} has an entry without a content id`)
    try {
      return {name, cid: CID.parse(hash)}
    } catch {
      throw new InstallProblem(`${what} ipfs://${cid} has an entry with an invalid content id`)
    }
  })
}

const ENTRY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** Every file of a tool's code, fetched and proven: the one raw file a CID names, or a folder walked to its leaves. */
async function fetchToolTree(
  deps: AppInstallDeps,
  client: SeedClient,
  tool: string,
  cid: CID,
): Promise<{kind: 'file' | 'folder'; files: Array<{path: string; bytes: Uint8Array}>}> {
  const what = `Tool ${tool}'s code`
  if (cid.code === RAW_CODEC) return {kind: 'file', files: [{path: '', bytes: await fetchRawBlock(deps, cid, what)}]}
  if (cid.code !== DAG_PB_CODEC) throw new InstallProblem(`${what} must name a file or a folder`)
  const files: Array<{path: string; bytes: Uint8Array}> = []
  let total = 0
  const walk = async (folder: CID, prefix: string, depth: number): Promise<void> => {
    if (depth > MAX_TOOL_FOLDER_DEPTH) {
      throw new InstallProblem(`${what} nests folders deeper than ${MAX_TOOL_FOLDER_DEPTH}`)
    }
    for (const entry of await fetchFolderListing(client, folder, what)) {
      const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (!ENTRY_NAME.test(entry.name))
        throw new InstallProblem(`${what} has an entry with an unusable name: ${entryPath}`)
      if (entry.cid.code === DAG_PB_CODEC) {
        await walk(entry.cid, entryPath, depth + 1)
        continue
      }
      if (entry.cid.code !== RAW_CODEC) throw new InstallProblem(`${what}: ${entryPath} is neither a file nor a folder`)
      if (files.length >= MAX_TOOL_FILES) throw new InstallProblem(`${what} has more than ${MAX_TOOL_FILES} files`)
      const bytes = await fetchRawBlock(deps, entry.cid, `${what}: ${entryPath}`)
      total += bytes.byteLength
      if (total > MAX_TOOL_CODE_BYTES) {
        throw new InstallProblem(`${what} is larger than ${MAX_TOOL_CODE_BYTES / 1024 / 1024} MiB`)
      }
      files.push({path: entryPath, bytes})
    }
  }
  await walk(cid, '', 1)
  return {kind: 'folder', files}
}

/** Writes a fetched tree under its cache directory: a temp directory renamed into place, or files added one by one when the directory already exists. */
function writeToolTree(dir: string, files: Array<{path: string; bytes: Uint8Array}>): void {
  fs.mkdirSync(path.dirname(dir), {recursive: true})
  const temp = fs.mkdtempSync(`${dir}.tmp-`)
  try {
    for (const file of files) {
      const target = path.join(temp, ...file.path.split('/'))
      fs.mkdirSync(path.dirname(target), {recursive: true})
      fs.writeFileSync(target, file.bytes)
    }
    try {
      fs.renameSync(temp, dir)
    } catch {
      // Another writer got there first: the content is the same by construction, so only a file
      // the directory lacks (a single file under another runtime's entry name) is added.
      for (const file of files) {
        const target = path.join(dir, ...file.path.split('/'))
        if (fs.existsSync(target)) continue
        fs.mkdirSync(path.dirname(target), {recursive: true})
        fs.renameSync(path.join(temp, ...file.path.split('/')), target)
      }
    }
  } finally {
    fs.rmSync(temp, {recursive: true, force: true})
  }
}

/** Fetches of a tool's code in flight, by CID, so overlapping passes fetch and write it once. */
const inflightToolCode = new Map<string, Promise<void>>()

/**
 * Resolves a tool page's `code` reference: the code is fetched into the server's cache under its
 * CID, every file proven against its content id and the whole held to the bounds above, and the
 * entry the sandbox will run is found. A CID already in the cache is not fetched again, whoever
 * installed it: content never changes under a CID.
 */
async function fetchToolCode(
  deps: AppInstallDeps,
  client: SeedClient,
  tool: string,
  runtime: AppToolRuntime,
  value: unknown,
): Promise<AppToolCode> {
  const cid = ipfsReference(tool, 'code', value)
  const entry = runtime === 'python' ? 'main.py' : 'index.ts'
  const dir = appCodePath(deps.dataDir, cid.toString())
  if (!fs.existsSync(path.join(dir, entry))) {
    const key = `${cid}\n${entry}`
    let pending = inflightToolCode.get(key)
    if (!pending) {
      pending = (async () => {
        if (fs.existsSync(path.join(dir, entry))) return
        const tree = await fetchToolTree(deps, client, tool, cid)
        const files = tree.kind === 'file' ? [{path: entry, bytes: tree.files[0]!.bytes}] : tree.files
        if (!files.some((file) => file.path === entry)) {
          throw new InstallProblem(`Tool ${tool}'s code folder has no ${entry}`)
        }
        writeToolTree(dir, files)
      })().finally(() => inflightToolCode.delete(key))
      inflightToolCode.set(key, pending)
    }
    await pending
  }
  return {url: `ipfs://${cid}`, cid: cid.toString(), entry}
}

/**
 * The cache directory of a tool's code, for a run about to start: the one the install pass filled,
 * fetched again when the data directory lost it. Throws the install's problem when the code cannot
 * be had.
 */
export async function ensureToolCode(deps: AppInstallDeps, tool: string, code: AppToolCode): Promise<string> {
  const dir = appCodePath(deps.dataDir, code.cid)
  if (!fs.existsSync(path.join(dir, code.entry))) {
    const client = createSeedClient(deps.hmServerUrl, {fetch: deps.fetch})
    const runtime: AppToolRuntime = code.entry === 'main.py' ? 'python' : 'ts'
    await fetchToolCode(deps, client, tool, runtime, code.url)
  }
  return dir
}

async function readAppTools(
  deps: AppInstallDeps,
  client: SeedClient,
  id: UnpackedHypermediaId,
  document: HMDocument,
  declared: Omit<AppSnapshot, 'skillDoc' | 'tools'>,
): Promise<{snapshot: AppSnapshot; version?: string}> {
  const {runtimes} = deps
  const skillDoc = await bodyMarkdown(client, document)
  const toolsPath = `/${[...(id.path ?? []), 'tools'].join('/')}`
  const toolInfos = await queryAll(client, {
    and: {
      filters: [
        {spaceMatch: {space: id.uid}},
        {pathMatch: {path: toolsPath, prefix: true}},
        typedBy(schemaSpellings(APP_TOOL_SCHEMA)),
      ],
    },
  })
  if (toolInfos.length > MAX_TOOLS_PER_APP) throw new InstallProblem('The app declares too many tools')
  const tools: AppToolSnapshot[] = []
  for (const info of toolInfos.sort((a, b) => (a.path ?? '').localeCompare(b.path ?? ''))) {
    const page = await readDocument(client, documentUrl(info))
    await assertTyped(client, page.id, page.document, APP_TOOL_SCHEMA, 'The tool')
    const metadata = page.document.metadata as Record<string, unknown>
    const tool = typeof metadata.tool === 'string' ? metadata.tool : ''
    if (!TOOL_PATTERN.test(tool)) throw new InstallProblem(`Tool ${documentUrl(info)} has no valid tool name`)
    if (tool in callableToolRegistry || tool in seedVerbRegistry) {
      throw new InstallProblem(`Tool ${tool} takes the name of a builtin tool or verb`)
    }
    if (tools.some((other) => other.tool === tool)) throw new InstallProblem(`Tool ${tool} is declared twice`)
    const runtime = metadata.runtime
    if (runtime !== 'ts' && runtime !== 'python') throw new InstallProblem(`Tool ${tool} names no runtime`)
    if (!runtimes.includes(runtime)) {
      throw new InstallProblem(
        runtimes.length
          ? `Tool ${tool} is written in ${runtime}, which this server cannot run`
          : `Tool ${tool} needs code execution, which this server does not offer`,
      )
    }
    const timeoutSecs = metadata.timeoutSecs
    if (
      timeoutSecs !== undefined &&
      !(
        Number.isInteger(timeoutSecs) &&
        (timeoutSecs as number) >= 1 &&
        (timeoutSecs as number) <= MAX_APP_EXEC_TIMEOUT_SECS
      )
    ) {
      throw new InstallProblem(`Tool ${tool} asks for a timeout outside 1..${MAX_APP_EXEC_TIMEOUT_SECS} seconds`)
    }
    const input = await readSchemaReference(client, tool, 'inputSchema', metadata.inputSchema)
    const outputSchema = metadata.outputSchema
    const output =
      typeof outputSchema === 'string' && outputSchema.trim()
        ? await readSchemaReference(client, tool, 'outputSchema', outputSchema)
        : undefined
    const code = await fetchToolCode(deps, client, tool, runtime, metadata.code)
    tools.push({
      tool,
      summary: typeof metadata.summary === 'string' ? metadata.summary : '',
      runtime,
      ...(timeoutSecs !== undefined ? {timeoutSecs: timeoutSecs as number} : {}),
      input,
      ...(output ? {output} : {}),
      inputSchema: (metadata.inputSchema as string).trim(),
      ...(output ? {outputSchema: (outputSchema as string).trim()} : {}),
      code,
      instructions: await bodyMarkdown(client, page.document),
    })
  }
  return {snapshot: {...declared, skillDoc, tools}, version: document.version}
}

type ArgumentCheck = {args: AppInstallRow['args']; secretRefs: Record<string, string>}

/** The install's argument values against the app's declarations; a secret in a document is refused. */
function checkArguments(
  snapshot: AppSnapshot,
  rawValues: Record<string, unknown>,
  scope: AppScope,
  secretAvailable: (secretName: string) => boolean,
  serverArgValue: (arg: string) => string | undefined,
): ArgumentCheck {
  const args: AppInstallRow['args'] = {}
  const secretRefs: Record<string, string> = {}
  for (const [name, value] of Object.entries(rawValues)) {
    const decl = snapshot.arguments[name]
    if (!decl) throw new InstallProblem(`The install sets an argument the app does not declare: ${name}`)
    if (decl.secret) throw new InstallProblem(`The secret argument ${name} must not be written into a document`)
    const ok =
      value === null ||
      (decl.type === 'string' && typeof value === 'string') ||
      (decl.type === 'integer' && typeof value === 'number' && Number.isInteger(value)) ||
      (decl.type === 'boolean' && typeof value === 'boolean')
    if (!ok) throw new InstallProblem(`Argument ${name} must be a ${decl.type}`)
    if (decl.choices && typeof value === 'string' && !(value in decl.choices)) {
      throw new InstallProblem(`Argument ${name} must be one of ${Object.keys(decl.choices).join(', ')}`)
    }
    args[name] = value as string | number | boolean | null
  }
  for (const [name, decl] of Object.entries(snapshot.arguments)) {
    if (decl.secret) {
      const secretName = appSecretName(snapshot.slug, name)
      const present = scope === 'space' ? secretAvailable(secretName) : serverArgValue(name) !== undefined
      if (present) secretRefs[name] = secretName
      else if (decl.required) throw new InstallProblem(`missing secret ${name}`)
    } else if (decl.required && (args[name] === undefined || args[name] === null)) {
      throw new InstallProblem(`missing argument ${name}`)
    }
  }
  return {args, secretRefs}
}

type RowRecord = {
  account_id: string
  scope: string
  slug: string
  mount_id: string
  bundle_id: string
  version: string | null
  snapshot_cbor: Uint8Array | null
  args_cbor: Uint8Array | null
  secret_refs_cbor: Uint8Array | null
  usage_cbor: Uint8Array | null
  status_cbor: Uint8Array
  created_at: number
  updated_at: number
}

const ROW_COLUMNS =
  'account_id, scope, slug, mount_id, bundle_id, version, snapshot_cbor, args_cbor, secret_refs_cbor, usage_cbor, status_cbor, created_at, updated_at'

function rowToRecord(row: RowRecord): AppInstallRow {
  return {
    accountId: row.account_id,
    scope: row.scope as AppScope,
    slug: row.slug,
    installId: row.mount_id,
    appId: row.bundle_id,
    ...(row.version ? {version: row.version} : {}),
    ...(row.snapshot_cbor ? {snapshot: cbor.decode<AppSnapshot>(row.snapshot_cbor)} : {}),
    args: row.args_cbor ? cbor.decode<AppInstallRow['args']>(row.args_cbor) : {},
    secretRefs: row.secret_refs_cbor ? cbor.decode<Record<string, string>>(row.secret_refs_cbor) : {},
    ...(row.usage_cbor ? {usage: cbor.decode<AppInstallUsage>(row.usage_cbor)} : {}),
    status: cbor.decode<api.AppInstallStatus>(row.status_cbor),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function getRow(db: Database, accountId: string, slug: string): AppInstallRow | undefined {
  const row = stmt<RowRecord, [string, string]>(
    db,
    `SELECT ${ROW_COLUMNS} FROM app_mounts WHERE account_id = ? AND slug = ?`,
  ).get(accountId, slug)
  return row ? rowToRecord(row) : undefined
}

/** Writes an install row, reporting whether anything a reader could see changed. */
function upsertRow(db: Database, next: Omit<AppInstallRow, 'createdAt' | 'updatedAt'>, now: number): boolean {
  const current = getRow(db, next.accountId, next.slug)
  const encoded = {
    snapshot: next.snapshot ? cbor.encode(next.snapshot) : null,
    args: cbor.encode(next.args),
    secretRefs: cbor.encode(next.secretRefs),
    usage: next.usage ? cbor.encode(next.usage) : null,
    status: cbor.encode({...next.status, checkedAt: undefined}),
  }
  const unchanged =
    current &&
    current.scope === next.scope &&
    current.installId === next.installId &&
    current.appId === next.appId &&
    current.version === next.version &&
    (current.snapshot
      ? encoded.snapshot !== null && sameBytes(cbor.encode(current.snapshot), encoded.snapshot)
      : !encoded.snapshot) &&
    sameBytes(cbor.encode(current.args), encoded.args) &&
    sameBytes(cbor.encode(current.secretRefs), encoded.secretRefs) &&
    (current.usage ? encoded.usage !== null && sameBytes(cbor.encode(current.usage), encoded.usage) : !encoded.usage) &&
    sameBytes(cbor.encode({...current.status, checkedAt: undefined}), encoded.status)
  stmt(
    db,
    `INSERT INTO app_mounts (${ROW_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(account_id, slug) DO UPDATE SET
       scope = excluded.scope, mount_id = excluded.mount_id, bundle_id = excluded.bundle_id,
       version = excluded.version, snapshot_cbor = excluded.snapshot_cbor, args_cbor = excluded.args_cbor,
       secret_refs_cbor = excluded.secret_refs_cbor, usage_cbor = excluded.usage_cbor, status_cbor = excluded.status_cbor,
       updated_at = excluded.updated_at`,
  ).run([
    next.accountId,
    next.scope,
    next.slug,
    next.installId,
    next.appId,
    next.version ?? null,
    encoded.snapshot,
    encoded.args,
    encoded.secretRefs,
    encoded.usage,
    cbor.encode({...next.status, checkedAt: now}),
    current?.createdAt ?? now,
    unchanged ? current!.updatedAt : now,
  ])
  return !unchanged
}

/** What one pass found: the accounts whose visible installs changed; `serverChanged` means every account's did. */
export type RefreshResult = {serverChanged: boolean; changedAccounts: Set<string>}

type Candidate = {
  accountId: string
  scope: AppScope
  installId: string
  appUrl: string
  enabled: boolean
  values: Record<string, unknown>
  usage?: AppInstallUsage
}

/** The allowance and ceiling an install page sets, each a positive integer or left out. */
function installUsageOf(raw: unknown): AppInstallUsage | undefined {
  const record = asRecord(raw)
  const pick = (value: unknown) => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : undefined)
  const allowance = pick(record?.allowance)
  const ceiling = pick(record?.ceiling)
  if (allowance === undefined && ceiling === undefined) return undefined
  return {...(allowance !== undefined ? {allowance} : {}), ...(ceiling !== undefined ? {ceiling} : {})}
}

/** Turns a document of either form into what to install; null when it is neither. */
function candidateOf(info: DocumentInfo, installRefs: string[], appRefs: string[]): Candidate | null {
  const metadata = info.metadata ?? {}
  const typed = typeof metadata.attributesSchema === 'string' ? metadata.attributesSchema : ''
  const url = documentUrl(info)
  if (installRefs.includes(typed)) {
    if (typeof metadata.app !== 'string' || !metadata.app) return null
    return {
      accountId: info.account,
      scope: metadata.scope === 'server' ? 'server' : 'space',
      installId: url,
      appUrl: metadata.app,
      enabled: metadata.enabled !== false,
      values: asRecord(metadata.arguments) ?? {},
      ...(installUsageOf(metadata.usage) ? {usage: installUsageOf(metadata.usage)} : {}),
    }
  }
  const install = asRecord(metadata.install)
  if (appRefs.includes(typed) && install && (install.scope === 'space' || install.scope === 'server')) {
    return {
      accountId: info.account,
      scope: install.scope,
      installId: url,
      appUrl: url,
      enabled: install.enabled !== false,
      values: asRecord(install.arguments) ?? {},
      ...(installUsageOf(install.usage) ? {usage: installUsageOf(install.usage)} : {}),
    }
  }
  return null
}

/**
 * One pass: finds every install page this server is bound to act on, reads and validates what it
 * mounts, and brings `app_mounts` in line with it. With `accountId`, only that space is looked at
 * (the Apps dialog's refresh); server-wide installs and the legacy shim run on full passes.
 */
export async function refreshAppInstalls(
  deps: AppInstallDeps,
  options: {accountId?: string} = {},
): Promise<RefreshResult> {
  const now = deps.now ?? Date.now()
  const client = createSeedClient(deps.hmServerUrl, {fetch: deps.fetch})
  const result: RefreshResult = {serverChanged: false, changedAccounts: new Set()}
  const noteChange = (accountId: string) => {
    if (accountId === SERVER_SCOPE_ACCOUNT) result.serverChanged = true
    else result.changedAccounts.add(accountId)
  }
  const installRefs = schemaSpellings(APP_INSTALL_SCHEMA)
  const appRefs = schemaSpellings(APP_SCHEMA)
  const scopeTo = options.accountId ? [{spaceMatch: {space: options.accountId}} as HMDocumentFilter] : []
  const found = [
    ...(await queryAll(client, {and: {filters: [...scopeTo, typedBy(installRefs)]}})),
    ...(await queryAll(client, {and: {filters: [...scopeTo, typedBy(appRefs), {exists: {key: 'install.scope'}}]}})),
  ]
  const operator = await operatorSpace(deps)
  const bindings = new Map<string, Promise<SpaceBindingResult>>()
  const bindingOf = (accountId: string) => {
    let pending = bindings.get(accountId)
    if (!pending) {
      pending = spaceBinding(deps, client, accountId)
      bindings.set(accountId, pending)
    }
    return pending
  }
  const secretExists = (accountId: string, name: string) =>
    Boolean(
      stmt<{name: string}, [string, string]>(deps.db, `SELECT name FROM secrets WHERE account_id = ? AND name = ?`).get(
        accountId,
        name,
      ),
    )
  const seen = new Set<string>()
  const keyOf = (accountId: string, slug: string) => `${accountId}\n${slug}`

  for (const info of found) {
    const candidate = candidateOf(info, installRefs, appRefs)
    if (!candidate || !candidate.enabled) continue
    if (candidate.scope === 'server') {
      if (!operator || candidate.accountId !== operator) continue
    } else if (!(await bindingOf(candidate.accountId)).isThisServer) continue
    const rowAccount = candidate.scope === 'server' ? SERVER_SCOPE_ACCOUNT : candidate.accountId
    const previous = (() => {
      try {
        const appId = packHmId(unpackHmId(resolveDocsUrl(candidate.appUrl))!)
        return {appId}
      } catch {
        return {appId: candidate.appUrl}
      }
    })()
    const base = {
      accountId: rowAccount,
      scope: candidate.scope,
      installId: candidate.installId,
      appId: previous.appId,
      // Only the operator's page says what is given away; a tenant's page cannot raise its own allowance.
      ...(candidate.scope === 'server' && candidate.usage ? {usage: candidate.usage} : {}),
    }
    let next: Omit<AppInstallRow, 'createdAt' | 'updatedAt'>
    try {
      const {snapshot, version} = await readAppSnapshot(deps, client, candidate.appUrl)
      const slug = snapshot.slug
      if (seen.has(keyOf(rowAccount, slug))) continue
      try {
        const checked = checkArguments(
          snapshot,
          candidate.values,
          candidate.scope,
          (name) => secretExists(candidate.accountId, name),
          (arg) => deps.serverArgValue(slug, arg),
        )
        next = {
          ...base,
          slug,
          version,
          snapshot,
          args: checked.args,
          secretRefs: checked.secretRefs,
          status: {state: 'ok'},
        }
      } catch (error) {
        if (!(error instanceof InstallProblem)) throw error
        // The app holds up but the install's arguments do not: keep the declaration so the Apps
        // dialog can show what is missing, and offer no tools until it is provided.
        next = {
          ...base,
          slug,
          version,
          snapshot,
          args: {},
          secretRefs: {},
          status: {state: 'error', error: error.message},
        }
      }
    } catch (error) {
      if (!(error instanceof InstallProblem)) throw error
      // An app page that cannot be read or does not hold up offers nothing, but the row stays so the
      // Apps dialog can say why. The slug is the one the page declared before failing, the one an
      // existing row carries, or the install page's own slug attribute (the copy form).
      const metadataSlug = typeof info.metadata?.slug === 'string' ? info.metadata.slug : ''
      const existing = stmt<{slug: string}, [string, string]>(
        deps.db,
        `SELECT slug FROM app_mounts WHERE account_id = ? AND mount_id = ?`,
      ).get(rowAccount, candidate.installId)
      const slug = error.slug || existing?.slug || (SLUG_PATTERN.test(metadataSlug) ? metadataSlug : '')
      if (!slug || seen.has(keyOf(rowAccount, slug))) continue
      next = {...base, slug, args: {}, secretRefs: {}, status: {state: 'error', error: error.message}}
    }
    seen.add(keyOf(rowAccount, next.slug))
    if (upsertRow(deps.db, next, now)) noteChange(rowAccount)
  }

  // Accounts that kept their own Datalab key before installs existed hold an install of `convert`
  // without a document: the server-wide app with their secret, until the Apps dialog turns it
  // into a real one.
  const serverConvert = getRow(deps.db, SERVER_SCOPE_ACCOUNT, 'convert')
  if (serverConvert?.snapshot && serverConvert.status.state === 'ok') {
    const legacy = stmt<{account_id: string}, [string]>(deps.db, `SELECT account_id FROM secrets WHERE name = ?`).all(
      LEGACY_DATALAB_SECRET,
    )
    for (const {account_id: accountId} of legacy) {
      if (options.accountId && accountId !== options.accountId) continue
      if (seen.has(keyOf(accountId, 'convert'))) continue
      seen.add(keyOf(accountId, 'convert'))
      const changed = upsertRow(
        deps.db,
        {
          accountId,
          scope: 'space',
          slug: 'convert',
          installId: `legacy:${LEGACY_DATALAB_SECRET}`,
          appId: serverConvert.appId,
          ...(serverConvert.version ? {version: serverConvert.version} : {}),
          snapshot: serverConvert.snapshot,
          args: {},
          secretRefs: {apiKey: LEGACY_DATALAB_SECRET},
          status: {state: 'ok'},
        },
        now,
      )
      if (changed) noteChange(accountId)
    }
  }

  // Whatever this pass did not see is gone: the document was deleted or disabled, the space moved
  // to another server, or a legacy secret was removed.
  const stale = stmt<{account_id: string; slug: string}, []>(deps.db, `SELECT account_id, slug FROM app_mounts`)
    .all()
    .filter((row) => !seen.has(keyOf(row.account_id, row.slug)))
    .filter((row) => (options.accountId ? row.account_id === options.accountId : true))
  for (const row of stale) {
    stmt(deps.db, `DELETE FROM app_mounts WHERE account_id = ? AND slug = ?`).run([row.account_id, row.slug])
    noteChange(row.account_id)
  }
  return result
}

/**
 * The installs an account's agents see: its own space installs and the server-wide ones, a space install
 * shadowing a server install of the same slug (an own key beats the shared one). Only installs that
 * hold up (`ok`) offer tools.
 */
export function listVisibleAppInstalls(db: Database, accountId: string): AppInstallRow[] {
  const rows = stmt<RowRecord, [string, string]>(
    db,
    `SELECT ${ROW_COLUMNS} FROM app_mounts WHERE account_id IN (?, ?) ORDER BY slug, account_id DESC`,
  )
    .all(SERVER_SCOPE_ACCOUNT, accountId)
    .map(rowToRecord)
  const bySlug = new Map<string, AppInstallRow>()
  for (const row of rows) {
    const current = bySlug.get(row.slug)
    if (!current || (current.scope === 'server' && row.scope === 'space')) bySlug.set(row.slug, row)
  }
  return [...bySlug.values()]
}

/** The tool names an account's agents may call through its visible, working installs. */
export function visibleAppToolNames(db: Database, accountId: string): string[] {
  return listVisibleAppInstalls(db, accountId).flatMap((row) =>
    row.status.state === 'ok' && row.snapshot ? row.snapshot.tools.map((appTool) => appTool.tool) : [],
  )
}

/** The working install that serves `slug` for an account, with the space's own first. */
export function visibleAppInstall(db: Database, accountId: string, slug: string): AppInstallRow | undefined {
  const row = listVisibleAppInstalls(db, accountId).find((candidate) => candidate.slug === slug)
  return row?.status.state === 'ok' && row.snapshot ? row : undefined
}

/** An install row as clients see it: the declaration, the values a document carries, and whether secrets are stored. */
export function appInstallInfo(row: AppInstallRow): api.AppInstallInfo {
  const snapshot = row.snapshot
  const declarations = Object.entries(snapshot?.arguments ?? {}).sort(
    ([, a], [, b]) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER),
  )
  return {
    slug: row.slug,
    scope: row.scope,
    ...(row.installId.startsWith('legacy:') ? {} : {installId: row.installId}),
    app: row.appId,
    ...(row.version ? {version: row.version} : {}),
    name: snapshot?.name ?? row.slug,
    summary: snapshot?.summary ?? '',
    arguments: declarations.map(([name, decl]) => ({
      name,
      type: decl.type,
      secret: decl.secret,
      required: decl.required,
      ...(decl.order !== undefined ? {order: decl.order} : {}),
      ...(decl.description ? {description: decl.description} : {}),
      ...(decl.choices ? {choices: decl.choices} : {}),
      ...(decl.secret ? {hasValue: row.secretRefs[name] !== undefined} : {}),
      ...(!decl.secret && row.args[name] !== undefined ? {value: row.args[name]} : {}),
    })),
    tools: (snapshot?.tools ?? []).map((appTool) => ({
      tool: appTool.tool,
      summary: appTool.summary,
      runtime: appTool.runtime,
      code: appTool.code.url,
      inputSchema: appTool.inputSchema,
      ...(appTool.outputSchema ? {outputSchema: appTool.outputSchema} : {}),
    })),
    network: snapshot?.network ?? {},
    ...(snapshot?.usage ? {usage: {...snapshot.usage, ...row.usage}} : {}),
    enabled: true,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** An install with every argument value in hand, secrets included, for the executor about to run. */
export type ResolvedAppInstall = {
  slug: string
  scope: AppScope
  version?: string
  args: Record<string, string | number | boolean | null>
  /** The allowance and ceiling of a server-wide install, from its page. */
  usage?: AppInstallUsage
  snapshot: AppSnapshot
}

/** Resolves a visible install's arguments: document values, then secrets decrypted from the store or read from the server's own configuration. */
export function resolveAppInstall(
  db: Database,
  accountId: string,
  slug: string,
  secrets: {
    decrypt: (accountId: string, secretName: string) => string | undefined
    serverArgValue: (slug: string, arg: string) => string | undefined
  },
): ResolvedAppInstall | undefined {
  const row = visibleAppInstall(db, accountId, slug)
  if (!row?.snapshot) return undefined
  const args: ResolvedAppInstall['args'] = {...row.args}
  for (const [name, decl] of Object.entries(row.snapshot.arguments)) {
    if (!decl.secret) {
      if (args[name] === undefined && row.scope === 'server') {
        const value = secrets.serverArgValue(slug, name)
        if (value !== undefined) args[name] = value
      }
      continue
    }
    const value =
      row.scope === 'space'
        ? row.secretRefs[name]
          ? secrets.decrypt(accountId, row.secretRefs[name])
          : undefined
        : secrets.serverArgValue(slug, name)
    if (value !== undefined) args[name] = value
  }
  return {
    slug,
    scope: row.scope,
    ...(row.version ? {version: row.version} : {}),
    args,
    ...(row.usage ? {usage: row.usage} : {}),
    snapshot: row.snapshot,
  }
}
