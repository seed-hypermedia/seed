/**
 * Running apps on this server (hypermedia/app.md). An app document names this server
 * with its `appEnvironmentUrl`; a writer of the app's space runs it here with its private config,
 * which the server keeps encrypted. While it runs, anyone may call its tools: each call runs the
 * tool's latest code in the sandbox as `(input, ctx)`, and is recorded for anyone who can read the
 * tool to see.
 */

import type {Database} from 'bun:sqlite'
import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  appEmbeddedChildren,
  HM_AGENT_TYPE,
  HM_TOOL_TYPE,
  hostListsChild,
  hostToolReference,
  hostToolReferences,
  isRunnableType,
  isToolHostType,
  parentDocumentId,
  TOOL_ENTRY_FILE,
} from '@seed-hypermedia/client/apps'
import {resolveCapability} from '@seed-hypermedia/client/capability'
import type {createSeedClient} from '@seed-hypermedia/client'
import {unpackHmId, packHmId, type HMDocument, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {structFields, validate as validateSchema} from '@seed-hypermedia/client/schema-engine'
import {loadSchemaRef} from '@seed-hypermedia/client/schema-resolve'
import {memoryRootPath} from '@/agent-memory'
import type * as api from '@/api'
import {
  APP_PRIVATE_CONFIG_ENV,
  APP_TOOL_CALL_DIR,
  APP_TOOL_INPUT_FILE,
  APP_TOOL_OUTPUT_FILE,
  APP_TOOL_SOURCE_FILE,
  buildAppToolProgram,
  type CodeExecutor,
} from '@/code-exec'
import {validateToolCode} from '@/tool-code'
import {MAX_TOOL_INPUT_BYTES, MAX_TOOL_OUTPUT_BYTES, recordedJson} from '@/tool-files'

type SeedClient = ReturnType<typeof createSeedClient>

/** What running apps needs from the server. */
export type AppRunDeps = {
  db: Database
  client: SeedClient
  ipfsServerUrl: string
  dataDir: string
  codeExec: CodeExecutor
  encrypt: (plain: Uint8Array) => Uint8Array
  decrypt: (ciphertext: Uint8Array) => Uint8Array
  /** This server's identity (its /health `serverId`), to recognize the server an app names as this one. */
  serverId: string
  /** The URL clients reach this server at, when configured: an app naming it needs no lookup. */
  publicUrl?: string
  /** What this server runs (tools on their own, apps, agents); all of them when omitted. */
  features?: readonly api.AppEnvironmentFeature[]
}

/** An error with an HTTP status, which the service turns into its own APIError. */
export class AppRunError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

type AppRunRow = {
  app_id: string
  space_uid: string
  started_by: string
  private_config_ciphertext: Uint8Array | null
  created_at: number
  updated_at: number
}

type ToolCallRow = {
  id: string
  app_id: string
  tool_id: string
  caller: string
  tool_version: string | null
  input_json: string
  output_json: string | null
  error: string | null
  duration_ms: number | null
  created_at: number
}

/**
 * Makes the folder of one call inside a host's workspace. Tool code can write anywhere in the
 * workspace and it outlives a call, so a link left where the calls' folder belongs is removed first:
 * the server must never write a call's input through it.
 */
function makeCallDir(workspace: string, callId: string): string {
  const root = path.join(workspace, APP_TOOL_CALL_DIR)
  const stat = fs.lstatSync(root, {throwIfNoEntry: false})
  if (stat && !stat.isDirectory()) fs.rmSync(root, {force: true})
  fs.mkdirSync(root, {recursive: true})
  const callDir = path.join(root, callId)
  fs.mkdirSync(callDir)
  return callDir
}

/** Whether a call's folder is still the real folder the server made, not a link put in its place. */
function isOwnCallDir(workspace: string, callDir: string): boolean {
  try {
    return fs.realpathSync(callDir) === path.join(fs.realpathSync(workspace), path.relative(workspace, callDir))
  } catch {
    return false
  }
}

/**
 * Reads the value a tool program left in its call folder. The tool controls that folder, so the
 * file is opened without following a link and must be a regular file inside the folder itself.
 */
function readToolOutput(workspace: string, callDir: string): {hasResult: false} | {hasResult: true; result: unknown} {
  if (!isOwnCallDir(workspace, callDir)) throw new AppRunError(400, 'The tool replaced its call folder')
  let fd: number
  try {
    fd = fs.openSync(path.join(callDir, APP_TOOL_OUTPUT_FILE), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {hasResult: false}
    throw new AppRunError(400, 'The tool left a result that is not a regular file')
  }
  try {
    const stat = fs.fstatSync(fd)
    if (!stat.isFile()) throw new AppRunError(400, 'The tool left a result that is not a regular file')
    if (stat.size > MAX_TOOL_OUTPUT_BYTES)
      throw new AppRunError(
        400,
        `The tool returned ${stat.size} bytes of JSON; a call returns at most ${MAX_TOOL_OUTPUT_BYTES}`,
      )
    return {hasResult: true, result: JSON.parse(fs.readFileSync(fd, 'utf8')) as unknown}
  } finally {
    fs.closeSync(fd)
  }
}

function versionless(raw: string, what: string): UnpackedHypermediaId {
  const id = unpackHmId(raw)
  if (!id) throw new AppRunError(400, `Not a valid hm:// ${what} id: ${raw}`)
  const plain = {...id, version: null, blockRef: null, blockRange: null, latest: true}
  return {...plain, id: packHmId(plain)}
}

async function loadDocument(
  client: SeedClient,
  id: UnpackedHypermediaId,
  type: string | ((type: unknown) => boolean),
  what: string,
) {
  let resource = await client.request('Resource', id).catch(() => null)
  // This server's node may simply not hold the document yet: it was published through another
  // node (the author's desktop, another site). Ask the node to find it before saying it is not there.
  if (resource?.type !== 'document' && (await discoverDocument(client, id))) {
    resource = await client.request('Resource', id).catch(() => null)
  }
  if (resource?.type !== 'document') throw new AppRunError(404, `No ${what} at ${id.id}`)
  const matches =
    typeof type === 'string' ? resource.document.metadata?.type === type : type(resource.document.metadata?.type)
  if (!matches)
    throw new AppRunError(400, `${id.id} is not ${what === 'app' ? 'an app, an agent or a tool' : 'a tool'}`)
  return resource.document as HMDocument
}

/** How long a request waits for this server's node to find a document it does not hold. */
const DISCOVERY_TIMEOUT_MS = 25_000
const DISCOVERY_POLL_MS = 1_500
/** How long RunApp waits for a newer version of an app that names another server. */
const STALE_APP_WAIT_MS = 8_000

/**
 * Asks this server's node to find the latest version of a document on the network and waits for
 * it (`DiscoveryStatus` starts the search and reports on it). True once the node holds it; false
 * when the search fails, runs out of time, or the node cannot be asked.
 */
async function discoverDocument(
  client: SeedClient,
  id: UnpackedHypermediaId,
  timeoutMs = DISCOVERY_TIMEOUT_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = await client
      .request('DiscoveryStatus', {uid: id.uid, path: id.path ?? [], latest: true})
      .catch(() => null)
    if (!status || status.state === 'failed') return false
    if (status.state === 'found') return true
    if (Date.now() + DISCOVERY_POLL_MS > deadline) return false
    await new Promise((resolve) => setTimeout(resolve, DISCOVERY_POLL_MS))
  }
}

/**
 * The server an app runs on, as the app itself says: its `appEnvironmentUrl` (an agent's
 * `agentServerUrl`), else the app environment the site of its space advertises (the space home's
 * `siteUrl`, whose `/hm/api/config` names it). Null when neither names one: the app runs nowhere.
 */
export async function appServerUrl(
  deps: AppRunDeps,
  appId: UnpackedHypermediaId,
  app: HMDocument,
): Promise<string | null> {
  const {appEnvironmentUrl, agentServerUrl} = app.metadata as {appEnvironmentUrl?: unknown; agentServerUrl?: unknown}
  if (typeof appEnvironmentUrl === 'string' && appEnvironmentUrl) return appEnvironmentUrl
  if (typeof agentServerUrl === 'string' && agentServerUrl) return agentServerUrl
  const home = await deps.client.request('Resource', unpackHmId(`hm://${appId.uid}`)!).catch(() => null)
  const siteUrl = home?.type === 'document' ? home.document.metadata.siteUrl : undefined
  if (typeof siteUrl !== 'string' || !siteUrl) return null
  try {
    const response = await fetch(`${siteUrl.replace(/\/$/, '')}/hm/api/config`)
    if (!response.ok) return null
    const config = (await response.json()) as {appEnvironmentUrl?: string; agentServerUrl?: string}
    return config.appEnvironmentUrl || config.agentServerUrl || null
  } catch {
    return null
  }
}

/** How long "that URL is (or is not) this server" is remembered. */
const SELF_CHECK_TTL_MS = 60_000
const selfChecks = new Map<string, {isThis: boolean; at: number}>()

/** The health endpoint of a server URL: canonical bases serve `/health`, legacy origins `/api/health`. */
function healthUrl(url: string): string {
  const base = url.replace(/\/+$/, '')
  return /\/hm\/api\/(apps|agents)$/.test(base) ? `${base}/health` : `${base}/api/health`
}

/** Whether `url` reaches this server: the configured public URL, or a server answering with this server's id. */
async function isThisServer(deps: AppRunDeps, url: string): Promise<boolean> {
  const normalized = url.replace(/\/+$/, '')
  if (deps.publicUrl && normalized === deps.publicUrl.replace(/\/+$/, '')) return true
  const key = `${deps.serverId} ${normalized}`
  const cached = selfChecks.get(key)
  if (cached && Date.now() - cached.at < SELF_CHECK_TTL_MS) return cached.isThis
  let isThis = false
  try {
    const response = await fetch(healthUrl(normalized), {signal: AbortSignal.timeout(5_000)})
    const health = response.ok ? ((await response.json()) as {serverId?: string}) : null
    isThis = health?.serverId === deps.serverId
  } catch {}
  selfChecks.set(key, {isThis, at: Date.now()})
  return isThis
}

/**
 * Throws unless this server runs what `host` is: an agent, an app, or a tool that is in neither
 * (a tool is its own host only then). A server may have any of the three turned off.
 */
function requireFeature(deps: AppRunDeps, host: HMDocument): void {
  if (!deps.features) return
  const type = host.metadata?.type
  const feature: api.AppEnvironmentFeature =
    type === HM_TOOL_TYPE ? 'tools' : type === HM_AGENT_TYPE ? 'agents' : 'apps'
  if (deps.features.includes(feature)) return
  const what = {tools: 'tools on their own', apps: 'apps', agents: 'agents'}[feature]
  throw new AppRunError(403, `This app environment does not run ${what}.`)
}

/** Throws unless the app names this server as the one it runs on: an app or its tools run nowhere else. */
async function requireRunsHere(deps: AppRunDeps, appId: UnpackedHypermediaId, app: HMDocument): Promise<void> {
  const url = await appServerUrl(deps, appId, app)
  if (!url)
    throw new AppRunError(
      409,
      'This app names no server, so it cannot run anywhere. Set its metadata.appEnvironmentUrl to the server that should run it (or have its space’s site advertise an app environment), then run it there.',
    )
  if (!(await isThisServer(deps, url))) throw new AppRunError(409, `This app runs on ${url}, not on this server.`)
}

/** Throws unless `signer` may write the app's space: its own space, or a WRITER/AGENT capability there. */
/** Whether `account` can write the space `id` lives in (its owner, or a writer capability at or above `id`). */
export async function isSpaceWriter(client: SeedClient, id: UnpackedHypermediaId, account: string): Promise<boolean> {
  if (id.uid === account) return true
  const path = id.path?.length ? `/${id.path.join('/')}` : ''
  return !!(await resolveCapability(client, id.uid, account, path).catch(() => undefined))
}

async function requireSpaceWriter(
  client: SeedClient,
  appId: UnpackedHypermediaId,
  signer: string,
  refusal = 'Only someone who can write to the app’s space can run or stop it',
) {
  if (!(await isSpaceWriter(client, appId, signer))) throw new AppRunError(403, refusal)
}

/**
 * The app or agent that lists `toolId` as one of its tools: its parent document, when that is a
 * host and carries the tool's card. Null for a tool that stands on its own, which is its own host.
 */
async function listingHost(
  client: SeedClient,
  toolId: UnpackedHypermediaId,
): Promise<{id: UnpackedHypermediaId; document: HMDocument} | null> {
  const parent = parentDocumentId(toolId)
  if (!parent) return null
  const parentId = versionless(packHmId(parent), 'app')
  const resource = await client.request('Resource', parentId).catch(() => null)
  if (resource?.type !== 'document') return null
  const document = resource.document as HMDocument
  return hostListsChild(parentId, document, toolId) ? {id: parentId, document} : null
}

/**
 * Loads what a server can run: an app, an agent, or a tool that stands on its own. A tool that an
 * app or an agent lists is refused: it runs under that host, with that host's config.
 */
async function loadRunHost(deps: AppRunDeps, appId: UnpackedHypermediaId): Promise<HMDocument> {
  const host = await loadDocument(deps.client, appId, isRunnableType, 'app')
  if (host.metadata?.type === HM_TOOL_TYPE) {
    const listing = await listingHost(deps.client, appId)
    if (listing) throw new AppRunError(400, `${appId.id} is a tool of ${listing.id.id}: run that instead`)
  }
  return host
}

/**
 * A tool with the document that hosts it: the app or agent that lists it, or the tool itself.
 * `referenced` is for a tool the host uses without holding it: a card of a tool that lives
 * somewhere else, at the version the card pins or at the latest.
 */
type ToolWithHost = {
  appId: UnpackedHypermediaId
  app: HMDocument
  tool: HMDocument
  standalone: boolean
  referenced: boolean
}

/** The tool a host references, at the version its card pins, or at the latest when it pins none. */
async function loadReferencedTool(
  deps: AppRunDeps,
  toolId: UnpackedHypermediaId,
  version: string | null,
): Promise<HMDocument> {
  if (!version) return loadDocument(deps.client, toolId, HM_TOOL_TYPE, 'tool')
  const pinned = {...toolId, version, latest: false}
  return loadDocument(deps.client, {...pinned, id: packHmId(pinned)}, HM_TOOL_TYPE, 'tool')
}

/**
 * Finds a tool's host. `rawAppId` is the host the caller names: an app or agent that lists the tool
 * as its own or references it, or the tool's own id for a tool that stands on its own. Without it
 * the host is worked out from the documents: the tool's parent when that lists it, else `preferHost`
 * (the agent that is calling) when that references it, else the tool itself.
 *
 * A tool can be referenced by many hosts, so nothing but the caller can say which one a call is
 * for: a referenced tool called with no host named is the tool on its own.
 */
async function resolveToolHost(
  deps: AppRunDeps,
  rawAppId: string | undefined,
  toolId: UnpackedHypermediaId,
  preferHost?: string,
): Promise<ToolWithHost> {
  const named = rawAppId ? versionless(rawAppId, 'app') : null
  if (named && named.id !== toolId.id) {
    const app = await loadDocument(deps.client, named, isToolHostType, 'app')
    if (appEmbeddedChildren(named, app.content).some((child) => child.id.id === toolId.id)) {
      const tool = await loadDocument(deps.client, toolId, HM_TOOL_TYPE, 'tool')
      return {appId: named, app, tool, standalone: false, referenced: false}
    }
    const reference = hostToolReference(named, app, toolId)
    if (!reference) throw new AppRunError(404, `${toolId.id} is not a tool of this app`)
    const tool = await loadReferencedTool(deps, toolId, reference.version)
    return {appId: named, app, tool, standalone: false, referenced: true}
  }
  const listing = await listingHost(deps.client, toolId)
  if (listing) {
    if (named) throw new AppRunError(400, `${toolId.id} is a tool of ${listing.id.id}: call it there`)
    const tool = await loadDocument(deps.client, toolId, HM_TOOL_TYPE, 'tool')
    return {appId: listing.id, app: listing.document, tool, standalone: false, referenced: false}
  }
  const calling = !named && preferHost ? unpackHmId(preferHost) : null
  if (calling) {
    const hostId = versionless(packHmId(calling), 'app')
    const host = await deps.client.request('Resource', hostId).catch(() => null)
    const document = host?.type === 'document' ? (host.document as HMDocument) : null
    const reference = hostToolReference(hostId, document, toolId)
    if (document && reference) {
      const tool = await loadReferencedTool(deps, toolId, reference.version)
      return {appId: hostId, app: document, tool, standalone: false, referenced: true}
    }
  }
  const tool = await loadDocument(deps.client, toolId, HM_TOOL_TYPE, 'tool')
  return {appId: toolId, app: tool, tool, standalone: true, referenced: false}
}

const NOT_RUNNING = 'This app is not running here. Run it from the app’s Settings first.'
const STANDALONE_ONLY_WRITERS =
  'This tool is in no app or agent, so only someone who can write its space can run it. Add it to an app or an agent to use it there.'

function toRunInfo(row: AppRunRow, deps: AppRunDeps): api.AppRunInfo {
  const privateConfig = readPrivateConfig(row, deps)
  return {
    appId: row.app_id,
    spaceUid: row.space_uid,
    startedBy: row.started_by,
    privateConfigKeys: Object.keys(privateConfig).sort(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function readPrivateConfig(row: AppRunRow, deps: AppRunDeps): Record<string, unknown> {
  if (!row.private_config_ciphertext) return {}
  const parsed = JSON.parse(new TextDecoder().decode(deps.decrypt(new Uint8Array(row.private_config_ciphertext))))
  return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
}

/**
 * How an app or agent runs here. An app runs once someone runs it (an `app_runs` row); an agent
 * mounted on this server is always running, so its tools run with no Run step (and, until it has
 * an explicit run with private config, no private config).
 */
function effectiveRun(db: Database, hostId: string): AppRunRow | null {
  const row = getRunRow(db, hostId)
  if (row) return row
  const agent = db.query('SELECT account_id, created_at, updated_at FROM agents WHERE id = ?').get(hostId) as {
    account_id: string
    created_at: number
    updated_at: number
  } | null
  if (!agent) return null
  return {
    app_id: hostId,
    space_uid: unpackHmId(hostId)?.uid ?? agent.account_id,
    started_by: agent.account_id,
    private_config_ciphertext: null,
    created_at: agent.created_at,
    updated_at: agent.updated_at,
  }
}

function getRunRow(db: Database, appId: string): AppRunRow | null {
  return (db.query('SELECT * FROM app_runs WHERE app_id = ?').get(appId) as AppRunRow | null) ?? null
}

/** Checks a value against an HM schema reference; returns readable violations, or none without a schema. */
/** A struct schema's fields as a caller reads them: `{owner?: string, perPage: integer}`, or null. */
async function expectedFields(client: SeedClient, ref: unknown): Promise<string | null> {
  if (typeof ref !== 'string' || !ref) return null
  const loaded = await loadSchemaRef(client, ref).catch(() => null)
  const fields = loaded ? structFields(loaded.schema) : []
  if (!fields.length) return null
  const kind = (schema: unknown) => {
    const type = (schema as {type?: unknown})?.type
    return typeof type === 'string' ? type.replace('hm://hyper.media/', '') : 'value'
  }
  return `{${fields.map((field) => `${field.name}${field.required ? '' : '?'}: ${kind(field.schema)}`).join(', ')}}`
}

async function schemaViolations(client: SeedClient, ref: unknown, value: unknown): Promise<string[]> {
  if (typeof ref !== 'string' || !ref) return []
  const loaded = await loadSchemaRef(client, ref).catch(() => null)
  if (!loaded) return [`schema ${ref} could not be loaded`]
  return validateSchema(loaded.schema, value, '$', {}, loaded.registry).map((violation) =>
    typeof violation === 'string' ? violation : JSON.stringify(violation),
  )
}

/**
 * Starts (or restarts) an app on this server. The signer must be able to write the app's space.
 * `privateConfig` replaces what was stored; omit it to keep the stored values.
 *
 * For a tool that is in no app or agent, this only gives the server the private config the tool's
 * writers run it with: such a tool is never open to other callers.
 */
export async function runApp(
  deps: AppRunDeps,
  signer: string,
  action: {appId: string; privateConfig?: Record<string, unknown>},
): Promise<api.AppRunInfo> {
  const appId = versionless(action.appId, 'app')
  let app = await loadRunHost(deps, appId)
  requireFeature(deps, app)
  // A tool on its own names no server: its writers keep its secrets on the server they use.
  if (app.metadata?.type !== HM_TOOL_TYPE) {
    try {
      await requireRunsHere(deps, appId, app)
    } catch (error) {
      // A client names this server on the app and runs it straight away, so this node can still
      // hold the version from before: look for a newer one once, then let the answer stand.
      if (!(error instanceof AppRunError) || !(await discoverDocument(deps.client, appId, STALE_APP_WAIT_MS)))
        throw error
      app = await loadRunHost(deps, appId)
      await requireRunsHere(deps, appId, app)
    }
  }
  await requireSpaceWriter(deps.client, appId, signer)
  const existing = getRunRow(deps.db, appId.id)
  let privateConfig = existing ? readPrivateConfig(existing, deps) : {}
  if (action.privateConfig !== undefined) {
    // New values replace the ones held for the same fields; fields not given keep theirs, so a
    // single secret can change without sending the others again.
    const merged = {...privateConfig, ...action.privateConfig}
    // The host's schema covers the fields it declares. The rest are kept for its tools, each of
    // which declares what it needs and is checked when it is called.
    const violations = await schemaViolations(
      deps.client,
      app.metadata.privateConfigSchema,
      await declaredPart(deps.client, app.metadata.privateConfigSchema, merged),
    )
    if (violations.length) throw new AppRunError(400, `Private config does not match the app: ${violations.join('; ')}`)
    privateConfig = merged
  }
  const ciphertext = Object.keys(privateConfig).length
    ? deps.encrypt(new TextEncoder().encode(JSON.stringify(privateConfig)))
    : null
  const now = Date.now()
  deps.db
    .query(
      `INSERT INTO app_runs (app_id, space_uid, started_by, private_config_ciphertext, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (app_id) DO UPDATE SET started_by = excluded.started_by,
         private_config_ciphertext = excluded.private_config_ciphertext, updated_at = excluded.updated_at`,
    )
    .run(appId.id, appId.uid, signer, ciphertext, existing?.created_at ?? now, now)
  return toRunInfo(getRunRow(deps.db, appId.id)!, deps)
}

/**
 * Whether this server would run the app for `signer`, without running it: the app exists and is an
 * app (or agent), and the signer can write its space. Which server the app names is not checked:
 * a client asks this before it publishes the choice.
 */
export async function checkAppRun(
  deps: AppRunDeps,
  signer: string,
  action: {appId: string},
): Promise<{allowed: boolean; reason?: string; run: api.AppRunInfo | null}> {
  const appId = versionless(action.appId, 'app')
  const run = getAppRun(deps, action)
  try {
    await loadRunHost(deps, appId)
    await requireSpaceWriter(deps.client, appId, signer)
    return {allowed: true, run}
  } catch (error) {
    if (error instanceof AppRunError) return {allowed: false, reason: error.message, run}
    throw error
  }
}

/** Stops an app and forgets its private config. The signer must be able to write the app's space. */
export async function stopApp(deps: AppRunDeps, signer: string, action: {appId: string}): Promise<void> {
  const appId = versionless(action.appId, 'app')
  await requireSpaceWriter(deps.client, appId, signer)
  deps.db.query('DELETE FROM app_runs WHERE app_id = ?').run(appId.id)
}

/** Whether an app runs here, with the names (never the values) of its private config. */
export function getAppRun(deps: AppRunDeps, action: {appId: string}): api.AppRunInfo | null {
  const row = effectiveRun(deps.db, versionless(action.appId, 'app').id)
  return row ? toRunInfo(row, deps) : null
}

function toCallInfo(row: ToolCallRow): api.AppToolCallInfo {
  return {
    id: row.id,
    appId: row.app_id,
    toolId: row.tool_id,
    caller: row.caller,
    ...(row.tool_version ? {toolVersion: row.tool_version} : {}),
    input: JSON.parse(row.input_json),
    ...(row.output_json !== null ? {output: JSON.parse(row.output_json)} : {}),
    ...(row.error !== null ? {error: row.error} : {}),
    ...(row.duration_ms !== null ? {durationMs: row.duration_ms} : {}),
    createdAt: row.created_at,
  }
}

async function fetchToolSource(ipfsServerUrl: string, code: unknown): Promise<string> {
  if (typeof code !== 'string' || !code.startsWith('ipfs://')) throw new AppRunError(400, 'This tool has no code')
  const cid = code.slice('ipfs://'.length).split(/[/?#]/, 1)[0]
  const response = await fetch(`${ipfsServerUrl.replace(/\/$/, '')}/ipfs/${cid}/${TOOL_ENTRY_FILE}`)
  if (!response.ok) throw new AppRunError(502, `Could not load the tool's ${TOOL_ENTRY_FILE} (HTTP ${response.status})`)
  return response.text()
}

/** What one execution of a tool's code needs. */
type ToolExecution = {
  appId: UnpackedHypermediaId
  source: string
  inputJson: string
  publicConfig: unknown
  privateConfig: Record<string, unknown>
  callId: string
  timeoutSecs?: unknown
}

/**
 * Runs a tool's code once in its host's sandbox and returns what it returned and what it printed.
 * The sandbox mounts the host's workspace as its working directory. The tool's source, the input
 * and the result cross it as files in a folder of this call (see buildAppToolProgram), which is
 * removed afterwards.
 */
async function executeTool(deps: AppRunDeps, run: ToolExecution): Promise<{output: unknown; logs: string}> {
  if (!deps.codeExec.runtimes.includes('ts')) throw new AppRunError(503, 'This server cannot run TypeScript tools')
  const stateDir = path.join(
    deps.dataDir,
    'app-runs',
    crypto.createHash('sha256').update(run.appId.id).digest('hex').slice(0, 24),
  )
  const workspace = memoryRootPath(stateDir)
  fs.mkdirSync(workspace, {recursive: true})
  const callDir = makeCallDir(workspace, run.callId)
  try {
    fs.writeFileSync(path.join(callDir, APP_TOOL_SOURCE_FILE), run.source)
    fs.writeFileSync(path.join(callDir, APP_TOOL_INPUT_FILE), run.inputJson)
    const execution = await deps.codeExec.execute({
      principal: {accountId: run.appId.uid, agentId: `app:${run.appId.id}`, sessionId: run.callId},
      stateDir,
      runtime: 'ts',
      code: buildAppToolProgram({
        app: run.appId.id,
        publicConfig: run.publicConfig ?? {},
        callId: run.callId,
        callDir: path.relative(workspace, callDir),
      }),
      env: {[APP_PRIVATE_CONFIG_ENV]: JSON.stringify(run.privateConfig)},
      // The executor clamps it to the longest a sandbox run may take.
      ...(typeof run.timeoutSecs === 'number' && Number.isFinite(run.timeoutSecs)
        ? {timeoutSecs: run.timeoutSecs}
        : {}),
    })
    if (!execution.success) {
      const detail = readableToolError(execution.stderr.trim() || execution.stdout.trim())
      throw new AppRunError(400, `The tool failed (exit ${execution.exitCode})${detail ? `:\n${detail}` : ''}`)
    }
    const parsed = readToolOutput(workspace, callDir)
    if (!parsed.hasResult) throw new AppRunError(400, 'The tool finished without returning a value')
    return {output: parsed.result, logs: execution.stdout.trim()}
  } finally {
    // Removing a link the tool put in the folder's place removes the link, not what it points at.
    // The calls' folder itself is checked, since a path through a link would be followed.
    if (fs.lstatSync(path.dirname(callDir), {throwIfNoEntry: false})?.isDirectory())
      fs.rmSync(callDir, {recursive: true, force: true})
  }
}

/** The call's input as JSON text, refused when it is over the limit. */
function inputJsonOf(input: unknown): string {
  const inputJson = JSON.stringify(input ?? null)
  const inputBytes = Buffer.byteLength(inputJson)
  if (inputBytes > MAX_TOOL_INPUT_BYTES)
    throw new AppRunError(413, `The input is ${inputBytes} bytes of JSON; a call takes at most ${MAX_TOOL_INPUT_BYTES}`)
  return inputJson
}

/** The part of a config that a struct schema declares, by field name. All of it without a schema. */
async function declaredPart(
  client: SeedClient,
  ref: unknown,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (typeof ref !== 'string' || !ref) return config
  const loaded = await loadSchemaRef(client, ref).catch(() => null)
  // A schema that cannot be loaded is reported by the check that follows.
  if (!loaded) return config
  const declared = new Set(structFields(loaded.schema).map((field) => field.name))
  return Object.fromEntries(Object.entries(config).filter(([name]) => declared.has(name)))
}

/**
 * The private config one tool runs with. The host holds the secrets, and a tool says which ones it
 * needs in its own `privateConfigSchema`: it then gets those fields, matched by name, and nothing
 * else the host holds. A tool that declares none gets all of the host's private config, as tools
 * always have. A missing field is refused, saying where to set it.
 */
async function privateConfigFor(
  deps: AppRunDeps,
  host: ToolWithHost,
  run: AppRunRow | null,
): Promise<Record<string, unknown>> {
  const held = run ? readPrivateConfig(run, deps) : {}
  const hostSchema = host.app.metadata.privateConfigSchema
  const own = await declaredPart(deps.client, hostSchema, held)
  const hostViolations = await schemaViolations(deps.client, hostSchema, own)
  if (hostViolations.length)
    throw new AppRunError(
      409,
      host.standalone
        ? `This tool needs private config it does not have: ${hostViolations.join('; ')}. Set it on the tool’s page.`
        : `The app’s private config is incomplete: ${hostViolations.join('; ')}. Set it in the app’s Settings.`,
    )
  const toolSchema = host.tool.metadata.privateConfigSchema
  if (host.standalone) return own
  // A tool the host holds and that declares nothing gets all the host's secrets, as tools always
  // have: its writers are the host's. A referenced tool is someone else's code, perhaps at a
  // version published after the host pointed at it: it gets what it declares, and nothing when it
  // declares nothing. Dropping the declaration must never be a way to be handed every secret.
  if (typeof toolSchema !== 'string' || !toolSchema) return host.referenced ? {} : held
  const needed = await declaredPart(deps.client, toolSchema, held)
  const toolViolations = await schemaViolations(deps.client, toolSchema, needed)
  if (toolViolations.length)
    throw new AppRunError(
      409,
      `This tool needs private config its app does not have: ${toolViolations.join(
        '; ',
      )}. Set it in the app’s Settings.`,
    )
  return needed
}

/**
 * Calls a tool of a running app: its latest code, with the app's public config and private config
 * as `ctx`. Anyone may call. The call is recorded whether it succeeds or fails.
 *
 * `appId` names the tool's host: the app or agent that lists it, or the tool itself when it stands
 * on its own. Without it the host is worked out from the documents.
 *
 * The answer carries the tool's whole output. The record is public, so it keeps what
 * {@link recordedJson} allows: a file as its name, type and size, and a long value as its size. The
 * answer's `input` is the recorded one, since the caller already has what it sent.
 */
export async function callAppTool(
  deps: AppRunDeps,
  caller: string,
  action: {
    appId?: string
    toolId: string
    input: unknown
    /** A host to try when none is named: the agent that is calling, which may reference the tool. */
    preferHost?: string
  },
): Promise<api.AppToolCallInfo> {
  const toolId = versionless(action.toolId, 'tool')
  // A host that does not run here is refused before any document is fetched.
  const named = action.appId ? versionless(action.appId, 'app') : null
  if (named && named.id !== toolId.id && !effectiveRun(deps.db, named.id)) throw new AppRunError(409, NOT_RUNNING)
  const host = await resolveToolHost(deps, action.appId, toolId, action.preferHost)
  const {appId, app, tool, standalone} = host
  requireFeature(deps, app)
  const run = effectiveRun(deps.db, appId.id)
  // An app or an agent opens its tools to every caller once it runs, on the server it names. A
  // tool in neither is its author's to try: there is nothing to turn on, nobody else can run it,
  // and it names no server, so it runs on whichever one its writer asks.
  if (standalone) await requireSpaceWriter(deps.client, appId, caller, STANDALONE_ONLY_WRITERS)
  else {
    if (!run) throw new AppRunError(409, NOT_RUNNING)
    await requireRunsHere(deps, appId, app)
  }

  const startedAt = Date.now()
  const callId = crypto.randomUUID()
  let output: unknown
  let error: string | undefined
  try {
    const inputJson = inputJsonOf(action.input)
    const inputViolations = await schemaViolations(deps.client, tool.metadata.inputSchema, action.input)
    if (inputViolations.length) {
      // Say what the tool does take, so the caller can fix the call without looking it up.
      const expected = await expectedFields(deps.client, tool.metadata.inputSchema)
      throw new AppRunError(
        400,
        `Input does not match the tool: ${inputViolations.join('; ')}${expected ? `. It takes ${expected}.` : ''}`,
      )
    }
    const privateConfig = await privateConfigFor(deps, host, run)
    const source = await fetchToolSource(deps.ipfsServerUrl, tool.metadata.code)
    const result = await executeTool(deps, {
      appId,
      source,
      inputJson,
      publicConfig: app.metadata.publicConfig,
      privateConfig,
      callId,
      timeoutSecs: tool.metadata.timeoutSecs,
    })
    const outputViolations = await schemaViolations(deps.client, tool.metadata.outputSchema, result.output)
    if (outputViolations.length)
      throw new AppRunError(400, `The tool returned a value its output schema rejects: ${outputViolations.join('; ')}`)
    output = result.output
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  const row: ToolCallRow = {
    id: callId,
    app_id: appId.id,
    tool_id: toolId.id,
    caller,
    tool_version: tool.version ?? null,
    input_json: recordedJson(action.input),
    output_json: error === undefined ? recordedJson(output) : null,
    error: error ?? null,
    duration_ms: Date.now() - startedAt,
    created_at: startedAt,
  }
  deps.db
    .query(
      `INSERT INTO app_tool_calls (id, app_id, tool_id, caller, tool_version, input_json, output_json, error, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.app_id,
      row.tool_id,
      row.caller,
      row.tool_version,
      row.input_json,
      row.output_json,
      row.error,
      row.duration_ms,
      row.created_at,
    )
  return {...toCallInfo(row), ...(error === undefined ? {output: output ?? null} : {})}
}

/**
 * A tool as a caller needs to know it before calling: its name, the version that would run, and
 * its documentation, which is the body of the tool's document. The host is found as a call finds
 * it, so a tool a host references is described at the version the host pins.
 */
export async function describeTool(
  deps: AppRunDeps,
  action: {appId?: string; toolId: string; preferHost?: string},
): Promise<{toolId: string; appId: string; version: string | null; name: string; content: HMDocument['content']}> {
  const toolId = versionless(action.toolId, 'tool')
  const {appId, tool} = await resolveToolHost(deps, action.appId, toolId, action.preferHost)
  return {
    toolId: toolId.id,
    appId: appId.id,
    version: tool.version ?? null,
    name: tool.metadata.name || toolId.path?.at(-1) || toolId.id,
    content: tool.content ?? [],
  }
}

/** The most bytes of source a test run takes. */
export const MAX_TOOL_TEST_SOURCE_BYTES = 1024 * 1024

/**
 * Runs code that is not published yet, once, as the tool at `toolId` would run it: in its host's
 * sandbox, with the host's public config and the private config the server holds. It is how an
 * author tries a draft before publishing it.
 *
 * The code is whatever the caller sends, and it runs with the host's secrets, so only someone who
 * can write the host's space may ask. The host need not be running, but it must name this server.
 * A tool in no app or agent names no server: it runs on the one its writer asks.
 * Nothing is recorded, and the draft's schemas are not checked here: the caller holds them.
 */
export async function testAppTool(
  deps: AppRunDeps,
  signer: string,
  action: {appId?: string; toolId: string; source: string; publicConfig?: unknown; input: unknown},
): Promise<api.AppToolTestInfo> {
  const toolId = versionless(action.toolId, 'tool')
  if (typeof action.source !== 'string' || !action.source.trim()) throw new AppRunError(400, 'There is no code to run')
  const sourceBytes = new TextEncoder().encode(action.source)
  if (sourceBytes.byteLength > MAX_TOOL_TEST_SOURCE_BYTES)
    throw new AppRunError(
      413,
      `The code is ${sourceBytes.byteLength} bytes; a test run takes at most ${MAX_TOOL_TEST_SOURCE_BYTES}`,
    )
  const host = await resolveToolHost(deps, action.appId, toolId)
  const {appId, app, tool, standalone} = host
  requireFeature(deps, app)
  await requireSpaceWriter(
    deps.client,
    appId,
    signer,
    'Only someone who can write to the tool’s space can run its unpublished code',
  )
  if (!standalone) await requireRunsHere(deps, appId, app)

  const startedAt = Date.now()
  try {
    try {
      validateToolCode([{path: TOOL_ENTRY_FILE, content: sourceBytes}])
    } catch (cause) {
      throw new AppRunError(400, cause instanceof Error ? cause.message : String(cause))
    }
    const result = await executeTool(deps, {
      appId,
      source: action.source,
      inputJson: inputJsonOf(action.input),
      // A draft may change the public config too; only a writer gets here, so theirs is taken.
      publicConfig: action.publicConfig ?? app.metadata.publicConfig,
      privateConfig: await privateConfigFor(deps, host, effectiveRun(deps.db, appId.id)),
      callId: crypto.randomUUID(),
      timeoutSecs: tool.metadata.timeoutSecs,
    })
    return {
      output: result.output ?? null,
      durationMs: Date.now() - startedAt,
      ...(result.logs ? {logs: result.logs} : {}),
    }
  } catch (cause) {
    return {error: cause instanceof Error ? cause.message : String(cause), durationMs: Date.now() - startedAt}
  }
}

/** One recorded call by id. */
export function getAppToolCall(deps: AppRunDeps, action: {callId: string}): api.AppToolCallInfo {
  const row = deps.db.query('SELECT * FROM app_tool_calls WHERE id = ?').get(action.callId) as ToolCallRow | null
  if (!row) throw new AppRunError(404, 'No such run')
  return toCallInfo(row)
}

/** A tool's recorded calls, newest first. Anyone who can read the tool can read them. */
export function listAppToolCalls(
  deps: AppRunDeps,
  action: {toolId: string; limit?: number; before?: number},
): api.AppToolCallInfo[] {
  const toolId = versionless(action.toolId, 'tool')
  const limit = Math.max(1, Math.min(200, Math.floor(action.limit ?? 50)))
  const rows = deps.db
    .query(`SELECT * FROM app_tool_calls WHERE tool_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`)
    .all(toolId.id, action.before ?? Number.MAX_SAFE_INTEGER, limit) as ToolCallRow[]
  return rows.map(toCallInfo)
}

/** Every app running on this server, most recently started or updated first. */
export function listAppRuns(deps: AppRunDeps): api.AppRunInfo[] {
  const rows = deps.db.query('SELECT * FROM app_runs ORDER BY updated_at DESC').all() as AppRunRow[]
  return rows.map((row) => toRunInfo(row, deps))
}

/** A tool as the HTTP API describes it. */
export type RunningAppTool = {
  id: string
  name: string
  summary?: string
  inputSchema?: unknown
  outputSchema?: unknown
}

/** A running app with its tools (the app's card-embedded tool documents), or null when it does not run here. */
export async function describeRunningApp(
  deps: AppRunDeps,
  rawAppId: string,
): Promise<{run: api.AppRunInfo; name: string; summary?: string; tools: RunningAppTool[]} | null> {
  const appId = versionless(rawAppId, 'app')
  const row = effectiveRun(deps.db, appId.id)
  if (!row) return null
  const app = await loadDocument(deps.client, appId, isToolHostType, 'app')
  // The app's own tools, then the ones it references, each at the version its card says.
  const listed = [
    ...appEmbeddedChildren(appId, app.content).map((child) => ({id: child.id, version: null as string | null})),
    ...hostToolReferences(appId, app.content),
  ]
  const tools = await Promise.all(
    listed.map(async (child) => {
      const doc = await loadReferencedTool(deps, child.id, child.version).catch(() => null)
      if (!doc) return null
      return {
        id: child.id.id,
        name: doc.metadata.name ?? child.id.path?.at(-1) ?? child.id.id,
        ...(doc.metadata.summary ? {summary: doc.metadata.summary} : {}),
        ...(doc.metadata.inputSchema ? {inputSchema: doc.metadata.inputSchema} : {}),
        ...(doc.metadata.outputSchema ? {outputSchema: doc.metadata.outputSchema} : {}),
      } satisfies RunningAppTool
    }),
  )
  return {
    run: toRunInfo(row, deps),
    name: app.metadata.name ?? appId.path?.at(-1) ?? appId.id,
    ...(app.metadata.summary ? {summary: app.metadata.summary} : {}),
    tools: tools.filter((tool) => tool !== null) as RunningAppTool[],
  }
}

/**
 * A failed tool's output as its reader should see it: the last lines, with the tool's code (loaded
 * from a base64 data URL) named index.ts instead of printed as base64 in every stack frame.
 */
export function readableToolError(output: string): string {
  const lines = output
    .replace(/data:text\/typescript;base64,[A-Za-z0-9+/=_-]+/g, 'index.ts')
    // The tool's source is a file in its call's folder: name it without the folder.
    .replace(/[^\s()]*\.seed-tool-calls\/[\w-]+\/index\.ts/g, 'index.ts')
    .replace(/[A-Za-z0-9+/=_-]{120,}/g, 'index.ts')
    // Bun names the tool's default export after a slice of its base64 module URL.
    .replace(/\b[A-Za-z0-9+/=]{16,}_default\b/g, 'default')
    .split('\n')
  // Bun prints the failing source lines before the error itself: lead with what went wrong.
  const message = lines.findIndex((line) => /^(error|[A-Z]\w*Error): /.test(line.trim()))
  if (message < 0) return lines.slice(-8).join('\n')
  const frame = lines.slice(Math.max(0, message - 6), message).filter((line) => line.trim())
  return [lines[message]!.trim(), ...lines.slice(message + 1, message + 3), ...frame].join('\n').trim()
}
