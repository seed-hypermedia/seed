/**
 * Running apps on this server (hypermedia/apps/apps-and-tools.md). An app document names this server
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
import {validate as validateSchema} from '@seed-hypermedia/client/schema-engine'
import {loadSchemaRef} from '@seed-hypermedia/client/schema-resolve'
import type * as api from '@/api'
import {APP_PRIVATE_CONFIG_ENV, buildAppToolProgram, parseLambdaResult, type CodeExecutor} from '@/code-exec'

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
  const resource = await client.request('Resource', id).catch(() => null)
  if (resource?.type !== 'document') throw new AppRunError(404, `No ${what} at ${id.id}`)
  const matches =
    typeof type === 'string' ? resource.document.metadata?.type === type : type(resource.document.metadata?.type)
  if (!matches) throw new AppRunError(400, `${id.id} is not ${what === 'app' ? 'an app or an agent' : 'a tool'}`)
  return resource.document as HMDocument
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
  if (!capability) throw new AppRunError(403, 'Only someone who can write to the app’s space can run or stop it')
}

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
  const app = await loadDocument(deps.client, appId, isToolHostType, 'app')
  await requireRunsHere(deps, appId, app)
  await requireSpaceWriter(deps.client, appId, signer)
  const existing = getRunRow(deps.db, appId.id)
  let privateConfig = existing ? readPrivateConfig(existing, deps) : {}
  if (action.privateConfig !== undefined) {
    // New values replace the ones held for the same fields; fields not given keep theirs, so a
    // single secret can change without sending the others again.
    const merged = {...privateConfig, ...action.privateConfig}
    const violations = await schemaViolations(deps.client, app.metadata.privateConfigSchema, merged)
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
  try {
    const inputViolations = await schemaViolations(deps.client, tool.metadata.inputSchema, action.input)
    if (inputViolations.length)
      throw new AppRunError(400, `Input does not match the tool: ${inputViolations.join('; ')}`)
    const privateViolations = await schemaViolations(
      deps.client,
      app.metadata.privateConfigSchema,
      readPrivateConfig(run, deps),
    )
    if (privateViolations.length)
      throw new AppRunError(
        409,
        `The app’s private config is incomplete: ${privateViolations.join('; ')}. Set it in the app’s Settings.`,
      )
    if (!deps.codeExec.runtimes.includes('ts')) throw new AppRunError(503, 'This server cannot run TypeScript tools')
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
      env: {[APP_PRIVATE_CONFIG_ENV]: JSON.stringify(readPrivateConfig(run, deps))},
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
  return output
    .replace(/data:text\/typescript;base64,[A-Za-z0-9+/=_-]+/g, 'index.ts')
    .replace(/[A-Za-z0-9+/=_-]{120,}/g, 'index.ts')
    .split('\n')
    .slice(-8)
    .join('\n')
}
