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
import {appEmbeddedChildren, HM_TOOL_TYPE, isToolHostType, TOOL_ENTRY_FILE} from '@seed-hypermedia/client/apps'
import {resolveCapability} from '@seed-hypermedia/client/capability'
import type {createSeedClient} from '@seed-hypermedia/client'
import {unpackHmId, packHmId, type HMDocument, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {structFields, validate as validateSchema} from '@seed-hypermedia/client/schema-engine'
import {loadSchemaRef} from '@seed-hypermedia/client/schema-resolve'
import type * as api from '@/api'
import {
  APP_PRIVATE_CONFIG_ENV,
  APP_TOOL_SEED_TOKEN_ENV,
  APP_TOOL_SEED_URL_ENV,
  buildAppToolProgram,
  parseLambdaResult,
  type CodeExecutor,
} from '@/code-exec'
import * as hostConfig from '@/host-config'

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
  /** Whether `accountId` holds the signing key of `keyAccount` on this server (its own server accounts). */
  holdsSigningKey: (accountId: string, keyAccount: string) => boolean
  /**
   * Seed access for tools (`ctx.seed`): where a tool sends its requests and the host port its
   * sandbox may reach for that. Without it, tools have no Seed access.
   */
  toolSeed?: {url: string; hostPort?: number}
  /**
   * Publishes a document signed by a key this server holds (the host's attached key), with the
   * same checks as an agent's write: the key's account must be able to write there.
   */
  publishAs?: (
    keyAccount: string,
    document: ToolSeedDocument & {id: UnpackedHypermediaId},
  ) => Promise<{version: string}>
  /**
   * An agent's built-in `signing` private config field, kept in its definition: `get` answers null
   * for a host that is not an agent here; `set` is the owner's change (see {@link api.HostConfigInfo}).
   */
  agentSigning?: {
    get(hostId: string): AgentSigning | null
    set(signer: string, hostId: string, signing: unknown): void
  }
}

/** The accounts an agent publishes as, and which one is its default. */
export type AgentSigning = {keys: {account: string; label?: string}[]; primary?: string}

/** What a tool publishes with `ctx.seed.publish(id, document)`. */
export type ToolSeedDocument = {
  name?: string
  metadata?: Record<string, unknown>
  /** The body as markdown; replaces the old body. */
  content?: string
}

/** The schema type of a private config field that names a signing key the server holds. */
export const SIGNING_KEY_TYPE = 'hm://hyper.media/signing-key'

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
  writes_json?: string | null
}

/** A tool call's Seed access: alive only while the call runs, found by the call's token. */
type ToolSeedSession = {
  callId: string
  host: UnpackedHypermediaId
  toolMetadata: Record<string, unknown>
  caller: string
  /** Signing-key field -> the account it names, from the host's private config. */
  signingKeys: Record<string, string>
  /** The key used when a publish names none and there are several (an agent's primary). */
  defaultKey?: string
  writes: api.AppToolWrite[]
}

const toolSeedSessions = new Map<string, ToolSeedSession>()

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
  if (!matches) throw new AppRunError(400, `${id.id} is not ${what === 'app' ? 'an app or an agent' : 'a tool'}`)
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

async function requireSpaceWriter(client: SeedClient, appId: UnpackedHypermediaId, signer: string) {
  if (appId.uid === signer) return
  const path = appId.path?.length ? `/${appId.path.join('/')}` : ''
  const capability = await resolveCapability(client, appId.uid, signer, path).catch(() => undefined)
  if (!capability)
    throw new AppRunError(403, 'Only someone who can write to the app’s space can run it, stop it or change its config')
}

function toRunInfo(row: AppRunRow, deps: AppRunDeps): api.AppRunInfo {
  return {
    appId: row.app_id,
    spaceUid: row.space_uid,
    startedBy: row.started_by,
    privateConfigKeys: hostConfig.hostConfigState(deps.db, deps, row.app_id).privateConfigKeys,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * How an app or agent runs here. An app runs once someone runs it (an `app_runs` row); an agent
 * mounted on this server is always running, so its tools run with no Run step. Private config is
 * kept apart from runs (host-config.ts), so an agent has it without being run.
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
 */
export async function runApp(
  deps: AppRunDeps,
  signer: string,
  action: {appId: string; privateConfig?: Record<string, unknown>},
): Promise<api.AppRunInfo> {
  const appId = versionless(action.appId, 'app')
  const app = await loadHostHere(deps, appId)
  await requireSpaceWriter(deps.client, appId, signer)
  if (action.privateConfig !== undefined) await savePrivateConfig(deps, signer, appId, app, action.privateConfig)
  const existing = getRunRow(deps.db, appId.id)
  const now = Date.now()
  deps.db
    .query(
      `INSERT INTO app_runs (app_id, space_uid, started_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (app_id) DO UPDATE SET started_by = excluded.started_by, updated_at = excluded.updated_at`,
    )
    .run(appId.id, appId.uid, signer, existing?.created_at ?? now, now)
  return toRunInfo(getRunRow(deps.db, appId.id)!, deps)
}

/** The host document, after checking it is an app or agent that runs on this server. */
async function loadHostHere(deps: AppRunDeps, hostId: UnpackedHypermediaId) {
  let host = await loadDocument(deps.client, hostId, isToolHostType, 'app')
  try {
    await requireRunsHere(deps, hostId, host)
  } catch (error) {
    // A client names this server on the app and runs it straight away, so this node can still
    // hold the version from before: look for a newer one once, then let the answer stand.
    if (!(error instanceof AppRunError) || !(await discoverDocument(deps.client, hostId, STALE_APP_WAIT_MS)))
      throw error
    host = await loadDocument(deps.client, hostId, isToolHostType, 'app')
    await requireRunsHere(deps, hostId, host)
  }
  return host
}

/** Merges `changes` into the host's private config, checks it against the host's schema, and stores it. */
async function savePrivateConfig(
  deps: AppRunDeps,
  signer: string,
  hostId: UnpackedHypermediaId,
  host: {metadata: {privateConfigSchema?: unknown}},
  changes: Record<string, unknown>,
) {
  const stored = hostConfig.readPrivateConfig(deps.db, deps, hostId.id)
  const merged = hostConfig.mergePrivateConfig(stored, changes)
  const violations = await schemaViolations(deps.client, host.metadata.privateConfigSchema, merged)
  if (violations.length) throw new AppRunError(400, `Private config does not match: ${violations.join('; ')}`)
  // A signing key is attached only by someone who holds it here: a writer of the host cannot lend
  // the host a key that belongs to someone else. Detaching (null) and keeping a key are allowed.
  for (const field of await signingKeyFields(deps.client, host.metadata.privateConfigSchema)) {
    const value = changes[field]
    if (value === undefined || value === null || value === stored[field]) continue
    if (typeof value !== 'string' || !deps.holdsSigningKey(signer, value))
      throw new AppRunError(
        403,
        `${field} must be a signing key your account holds on this server: create or import it under Server accounts, then choose it here.`,
      )
  }
  hostConfig.writePrivateConfig(deps.db, deps, {hostId: hostId.id, spaceUid: hostId.uid}, merged, signer)
}

/** The private config fields whose type is a signing key. */
async function signingKeyFields(client: SeedClient, ref: unknown): Promise<string[]> {
  if (typeof ref !== 'string' || !ref) return []
  const loaded = await loadSchemaRef(client, ref).catch(() => null)
  return structFields(loaded?.schema)
    .filter((field) => (field.schema as {type?: unknown}).type === SIGNING_KEY_TYPE)
    .map((field) => field.name)
}

/**
 * A host's config on this server: which private config fields are set (never their values), and
 * the account each signing-key field names (public: it is who the host publishes as).
 */
export async function getHostConfig(deps: AppRunDeps, action: {hostId: string}): Promise<api.HostConfigInfo> {
  const hostId = versionless(action.hostId, 'host')
  const state = hostConfig.hostConfigState(deps.db, deps, hostId.id)
  const agentSigning = deps.agentSigning?.get(hostId.id)
  const info: api.HostConfigInfo = {
    hostId: hostId.id,
    ...state,
    ...(agentSigning?.keys.length
      ? {privateConfigKeys: [...state.privateConfigKeys, 'signing'].sort(), agentSigning}
      : {}),
  }
  if (!state.privateConfigKeys.length) return info
  const host = await loadDocument(deps.client, hostId, isToolHostType, 'app').catch(() => null)
  const fields = host ? await signingKeyFields(deps.client, host.metadata.privateConfigSchema) : []
  const values = fields.length ? hostConfig.readPrivateConfig(deps.db, deps, hostId.id) : {}
  const signingKeys = Object.fromEntries(
    fields.filter((field) => typeof values[field] === 'string').map((field) => [field, values[field] as string]),
  )
  return Object.keys(signingKeys).length ? {...info, signingKeys} : info
}

/**
 * Changes a host's private config: a value replaces that field, a null removes it, and fields not
 * named keep their values. The host (an app or an agent) must run on this server, and the signer
 * must be able to write its space. An app does not need to be running.
 */
export async function setHostPrivateConfig(
  deps: AppRunDeps,
  signer: string,
  action: {hostId: string; privateConfig: Record<string, unknown>},
): Promise<api.HostConfigInfo> {
  const hostId = versionless(action.hostId, 'host')
  if (!action.privateConfig || typeof action.privateConfig !== 'object' || Array.isArray(action.privateConfig))
    throw new AppRunError(400, 'privateConfig is an object of field values (null removes a field)')
  const host = await loadHostHere(deps, hostId)
  await requireSpaceWriter(deps.client, hostId, signer)
  // An agent's keys are its built-in `signing` field, kept with the agent; the rest is its
  // schema-described private config, kept here.
  const {signing, ...changes} = action.privateConfig
  if (signing !== undefined) {
    if (!deps.agentSigning?.get(hostId.id))
      throw new AppRunError(
        400,
        'Only an agent has the built-in signing field. An app names its keys with signing-key fields in its privateConfigSchema.',
      )
    deps.agentSigning.set(signer, hostId.id, signing)
  }
  if (Object.keys(changes).length) await savePrivateConfig(deps, signer, hostId, host, changes)
  return getHostConfig(deps, {hostId: hostId.id})
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
    await loadDocument(deps.client, appId, isToolHostType, 'app')
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
  hostConfig.deletePrivateConfig(deps.db, appId.id)
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
    ...(row.writes_json ? {writes: JSON.parse(row.writes_json) as api.AppToolWrite[]} : {}),
    createdAt: row.created_at,
  }
}

/**
 * Serves one `ctx.seed` request from a running tool. Reads return public documents. A publish is
 * signed with one of the host's attached keys, after checking that the caller may make the host
 * publish (a writer of the host, which its triggers are, unless the tool allows viewers) and, in the
 * write itself, that the key's account can write there. Every publish is recorded on the call.
 */
export async function toolSeedRequest(deps: AppRunDeps, token: string, body: unknown): Promise<unknown> {
  const session = toolSeedSessions.get(token)
  if (!session) throw new AppRunError(401, 'This tool call is over, or the token is not one this server gave out')
  if (!body || typeof body !== 'object') throw new AppRunError(400, 'A ctx.seed request is a JSON object')
  const request = body as {op?: unknown; id?: unknown; document?: unknown; as?: unknown}
  const id = typeof request.id === 'string' ? unpackHmId(request.id) : null
  if (!id) throw new AppRunError(400, `ctx.seed.${String(request.op)} needs an hm:// address`)
  const target = {...id, version: null, latest: true, blockRef: null, blockRange: null}
  switch (request.op) {
    case 'resource': {
      const resource = await deps.client.request('Resource', target)
      if (resource.type !== 'document') throw new AppRunError(404, `No document at ${id.id}`)
      if (resource.document.visibility === 'PRIVATE')
        throw new AppRunError(403, `${id.id} is private: tools read only public documents`)
      return {
        url: id.id,
        version: resource.document.version,
        metadata: resource.document.metadata,
        content: resource.document.content,
      }
    }
    case 'directory': {
      const result = await deps.client.request('Query', {
        includes: [{space: id.uid, path: id.path?.length ? `/${id.path.join('/')}` : '', mode: 'Children'}],
      })
      return (result?.results ?? [])
        .filter((info) => (info as {visibility?: unknown}).visibility !== 'PRIVATE')
        .map((info) => ({
          url: info.id.id,
          id: {id: info.id.id, uid: info.id.uid, path: info.id.path},
          metadata: info.metadata,
          updateTime: info.updateTime,
        }))
    }
    case 'publish': {
      if (!deps.publishAs) throw new AppRunError(503, 'This app environment cannot publish for tools')
      const keyAccount = chooseSigningKey(session, request.as)
      if (
        session.toolMetadata.callableBy !== 'viewers' &&
        !(await isSpaceWriter(deps.client, session.host, session.caller))
      )
        throw new AppRunError(
          403,
          'This tool publishes as the app, so only writers of the app (and its triggers) may call it. A tool whose document says callableBy: "viewers" may be called by anyone, and must check its input.',
        )
      const document = (request.document ?? {}) as ToolSeedDocument
      if (typeof document !== 'object' || Array.isArray(document))
        throw new AppRunError(400, 'ctx.seed.publish(id, {name?, metadata?, content?})')
      const {version} = await deps.publishAs(keyAccount, {...document, id: target})
      session.writes.push({id: id.id, version, as: keyAccount, at: Date.now()})
      return {url: id.id, version}
    }
    default:
      throw new AppRunError(400, `ctx.seed has no ${String(request.op)}: use resource, directory or publish`)
  }
}

/** The account to publish as: the one named by `as` (a key field or its account), or the only key. */
function chooseSigningKey(session: ToolSeedSession, as: unknown): string {
  const keys = session.signingKeys
  const accounts = Object.values(keys)
  if (typeof as === 'string' && as) {
    const account = keys[as] ?? (accounts.includes(as) ? as : undefined)
    if (!account) throw new AppRunError(403, `${as} is not a signing key of this app`)
    return account
  }
  if (accounts.length === 1) return accounts[0]!
  if (session.defaultKey && accounts.includes(session.defaultKey)) return session.defaultKey
  if (!accounts.length)
    throw new AppRunError(
      409,
      "This app has no signing key: add a signing-key field to its private config schema and attach a key in the app's Settings",
    )
  throw new AppRunError(
    400,
    `This app has several signing keys (${Object.keys(keys).join(', ')}): pass {as: ctx.privateConfig.<field>}`,
  )
}

async function fetchToolSource(ipfsServerUrl: string, code: unknown): Promise<string> {
  if (typeof code !== 'string' || !code.startsWith('ipfs://')) throw new AppRunError(400, 'This tool has no code')
  const cid = code.slice('ipfs://'.length).split(/[/?#]/, 1)[0]
  const response = await fetch(`${ipfsServerUrl.replace(/\/$/, '')}/ipfs/${cid}/${TOOL_ENTRY_FILE}`)
  if (!response.ok) throw new AppRunError(502, `Could not load the tool's ${TOOL_ENTRY_FILE} (HTTP ${response.status})`)
  return response.text()
}

/**
 * Calls a tool of a running app: its latest code, with the app's public config and private config
 * as `ctx`. Anyone may call. The call is recorded whether it succeeds or fails.
 */
export async function callAppTool(
  deps: AppRunDeps,
  caller: string,
  action: {appId: string; toolId: string; input: unknown},
): Promise<api.AppToolCallInfo> {
  const appId = versionless(action.appId, 'app')
  const toolId = versionless(action.toolId, 'tool')
  const run = effectiveRun(deps.db, appId.id)
  if (!run) throw new AppRunError(409, 'This app is not running here. Run it from the app’s Settings first.')
  const app = await loadDocument(deps.client, appId, isToolHostType, 'app')
  await requireRunsHere(deps, appId, app)
  if (!appEmbeddedChildren(appId, app.content).some((child) => child.id.id === toolId.id))
    throw new AppRunError(404, `${toolId.id} is not a tool of this app`)
  const tool = await loadDocument(deps.client, toolId, HM_TOOL_TYPE, 'tool')

  const startedAt = Date.now()
  const callId = crypto.randomUUID()
  let output: unknown
  let error: string | undefined
  let keyFields: string[] = []
  // The call's Seed access: a token only this call holds, forgotten when it ends.
  const seedToken = deps.toolSeed ? crypto.randomBytes(32).toString('base64url') : null
  const session: ToolSeedSession = {
    callId,
    host: appId,
    toolMetadata: tool.metadata as Record<string, unknown>,
    caller,
    signingKeys: {},
    writes: [],
  }
  try {
    const inputViolations = await schemaViolations(deps.client, tool.metadata.inputSchema, action.input)
    if (inputViolations.length) {
      // Say what the tool does take, so the caller can fix the call without looking it up.
      const expected = await expectedFields(deps.client, tool.metadata.inputSchema)
      throw new AppRunError(
        400,
        `Input does not match the tool: ${inputViolations.join('; ')}${expected ? `. It takes ${expected}.` : ''}`,
      )
    }
    const privateConfig = hostConfig.readPrivateConfig(deps.db, deps, appId.id)
    keyFields = await signingKeyFields(deps.client, app.metadata.privateConfigSchema)
    const privateViolations = await schemaViolations(deps.client, app.metadata.privateConfigSchema, privateConfig)
    if (privateViolations.length)
      throw new AppRunError(
        409,
        `The app’s private config is incomplete: ${privateViolations.join('; ')}. Set it in the app’s Settings.`,
      )
    if (!deps.codeExec.runtimes.includes('ts')) throw new AppRunError(503, 'This server cannot run TypeScript tools')
    for (const field of keyFields)
      if (typeof privateConfig[field] === 'string') session.signingKeys[field] = privateConfig[field] as string
    // A tool under an agent publishes as the agent's keys, its primary unless it names another.
    const agentSigning = deps.agentSigning?.get(appId.id)
    for (const key of agentSigning?.keys ?? []) session.signingKeys[key.account] = key.account
    if (agentSigning?.primary) session.defaultKey = agentSigning.primary
    if (seedToken) toolSeedSessions.set(seedToken, session)
    const source = await fetchToolSource(deps.ipfsServerUrl, tool.metadata.code)
    const stateDir = path.join(
      deps.dataDir,
      'app-runs',
      crypto.createHash('sha256').update(appId.id).digest('hex').slice(0, 24),
    )
    fs.mkdirSync(stateDir, {recursive: true})
    const execution = await deps.codeExec.execute({
      principal: {accountId: appId.uid, agentId: `app:${appId.id}`, sessionId: callId},
      stateDir,
      runtime: 'ts',
      code: buildAppToolProgram(source, action.input, {app: appId.id, publicConfig: app.metadata.publicConfig ?? {}}),
      env: {
        [APP_PRIVATE_CONFIG_ENV]: JSON.stringify(privateConfig),
        ...(seedToken && deps.toolSeed
          ? {[APP_TOOL_SEED_URL_ENV]: deps.toolSeed.url, [APP_TOOL_SEED_TOKEN_ENV]: seedToken}
          : {}),
      },
      ...(seedToken && deps.toolSeed?.hostPort ? {hostPort: deps.toolSeed.hostPort} : {}),
    })
    const parsed = parseLambdaResult(execution.stdout)
    if (!execution.success) {
      const detail = readableToolError(execution.stderr.trim() || parsed.logs || '')
      throw new AppRunError(400, `The tool failed (exit ${execution.exitCode})${detail ? `:\n${detail}` : ''}`)
    }
    if (!parsed.hasResult) throw new AppRunError(400, 'The tool finished without returning a value')
    const outputViolations = await schemaViolations(deps.client, tool.metadata.outputSchema, parsed.result)
    if (outputViolations.length)
      throw new AppRunError(400, `The tool returned a value its output schema rejects: ${outputViolations.join('; ')}`)
    output = parsed.result
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  } finally {
    if (seedToken) toolSeedSessions.delete(seedToken)
  }
  const row: ToolCallRow = {
    id: callId,
    app_id: appId.id,
    tool_id: toolId.id,
    caller,
    tool_version: tool.version ?? null,
    input_json: JSON.stringify(action.input ?? null),
    output_json: error === undefined ? JSON.stringify(output ?? null) : null,
    error: error ?? null,
    duration_ms: Date.now() - startedAt,
    created_at: startedAt,
    writes_json: session.writes.length ? JSON.stringify(session.writes) : null,
  }
  deps.db
    .query(
      `INSERT INTO app_tool_calls (id, app_id, tool_id, caller, tool_version, input_json, output_json, error, duration_ms, created_at, writes_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      row.writes_json ?? null,
    )
  return toCallInfo(row)
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
  const tools = await Promise.all(
    appEmbeddedChildren(appId, app.content).map(async (child) => {
      const doc = await loadDocument(deps.client, child.id, HM_TOOL_TYPE, 'tool').catch(() => null)
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
