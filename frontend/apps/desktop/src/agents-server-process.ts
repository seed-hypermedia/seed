import {APP_ENVIRONMENT_FEATURES, type AppEnvironmentFeature} from '@seed-hypermedia/apps-protocol'
import {
  AGENTS_LOCAL_SERVER_SETTING_KEY,
  API_HTTP_URL,
  DAEMON_HTTP_URL,
  LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY,
} from '@shm/shared/constants'
import {ChildProcess, spawn} from 'child_process'
import {app} from 'electron'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as readline from 'node:readline'
import path from 'path'
import {userDataPath} from './app-paths'
import {getStoredSetting, writeStoredSetting} from './app-settings-store'
import {getAgentsServerBinaryPath, getAgentsServerWorkingDirectory} from './agents-server-path'
import * as log from './logger'
import {forceKillChildProcess} from './win32-process'

/**
 * Lifecycle for the local app environment, which runs the same artifact as the hosted deployment.
 *
 * The rule is **dev attaches, packaged spawns**: `./dev up` already runs `cd apps && bun run dev`
 * with hot reload, so spawning a second server there would fight it for the port and silently
 * shadow the developer's edits. Rather than make that a flag people forget to set, startup probes
 * the default port first and attaches to whatever healthy app environment answers.
 */

/**
 * Mirrors the app environment's own port default (apps/src/config.ts). Dev redefines it via
 * SEED_APPS_HTTP_PORT in .env.vars — like the daemon ports — so a release build's spawned
 * server and the dev hot-reload server never share a port. Read at call time, not module load,
 * so tests control it per-case.
 */
function defaultAgentsPort(): number {
  return Number(process.env.SEED_APPS_HTTP_PORT ?? process.env.SEED_AGENTS_HTTP_PORT) || 3050
}
/** Ports scanned when the default is occupied by something that is not a healthy app environment. */
const MAX_PORT_PROBES = 20
const HEALTH_TIMEOUT_MS = 1_500
const SPAWN_READY_TIMEOUT_MS = 30_000
/** How long a stop waits for the child to exit before giving up on the close event. */
const STOP_TIMEOUT_MS = 5_000

export type AgentsServerState =
  | {t: 'disabled'; reason?: 'env' | 'setting'}
  | {t: 'attached'; url: string}
  | {t: 'spawned'; url: string}
  | {t: 'error'; message: string}

let state: AgentsServerState = {t: 'disabled'}
let attachRetryTimer: ReturnType<typeof setInterval> | undefined

/** The user's choice about the bundled server; `unset` on a build that never asked. */
export type LocalAgentsServerPolicy = 'on' | 'off' | 'unset'

export function readLocalAgentsServerPolicy(): LocalAgentsServerPolicy {
  const value = getStoredSetting(AGENTS_LOCAL_SERVER_SETTING_KEY)
  return value === 'on' || value === 'off' ? value : 'unset'
}

/** Where the spawned server keeps its database; its presence means an earlier build ran one. */
export function localAgentsDbPath(): string {
  return path.join(userDataPath, 'agents', 'agents.sqlite')
}

/** What the bundled server runs when the user has chosen nothing: tools, and neither apps nor agents. */
export const DEFAULT_LOCAL_FEATURES: readonly AppEnvironmentFeature[] = ['tools']

/** The features the user checked for the bundled server, or null on a build that has not decided. */
export function readLocalAppEnvironmentFeatures(): AppEnvironmentFeature[] | null {
  const value = getStoredSetting(LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY)
  if (!Array.isArray(value)) return null
  return APP_ENVIRONMENT_FEATURES.filter((feature) => value.includes(feature))
}

/**
 * Whether a packaged build should spawn its bundled server, and what that server runs.
 *
 * The local app environment is on unless the user turned it off, and it runs what they checked:
 * tools on their own, apps, agents. Out of the box that is tools only. Apps and agents keep
 * sessions, memory and triggers that grow and work in the background, so they are opt-in.
 *
 * `features` is null on the first launch of a build that has this list. The earlier setting then
 * says what to do:
 *
 * - It was `on`: this user runs agents here (they turned it on, or an upgrade found agents). They
 *   keep everything.
 * - It was never set and a local database exists: a build that always ran the server may have left
 *   agents behind. The server runs with everything once more, and the app looks for agents and
 *   settles the list (see `useLocalAgentsServerMigration` in the renderer). Nothing is persisted.
 * - Otherwise (`off`, which every fresh install was given, or nothing at all): tools only, and on.
 *
 * With nothing checked there is nothing to run, so the server is not started.
 *
 * `packaged` is false in a development build. There the rule is that the app attaches to the
 * server `./dev up` runs, and a server started by default would take that server's port. So a
 * development build starts one only for a developer who turned the switch on, and settles nothing.
 */
export function resolveLocalAgentsServerSpawn(
  policy: LocalAgentsServerPolicy,
  features: readonly AppEnvironmentFeature[] | null,
  dataExists: boolean,
  packaged = true,
): {
  spawn: boolean
  features: AppEnvironmentFeature[]
  settle?: {policy?: 'on'; features: AppEnvironmentFeature[]}
} {
  if (features) {
    const on = packaged ? policy !== 'off' : policy === 'on'
    return {spawn: on && features.length > 0, features: [...features]}
  }
  if (!packaged && policy !== 'on') return {spawn: false, features: [...DEFAULT_LOCAL_FEATURES]}
  const all = [...APP_ENVIRONMENT_FEATURES]
  if (policy === 'on') return {spawn: true, features: all, settle: {features: all}}
  if (policy === 'unset' && dataExists) return {spawn: true, features: all}
  const tools = [...DEFAULT_LOCAL_FEATURES]
  return {spawn: true, features: tools, settle: {policy: 'on', features: tools}}
}

/**
 * A failed startup must not blind the app forever: a dev server that was mid-restart during the
 * one startup probe (or a spawn that failed because no binary is staged) comes back seconds
 * later, and the desktop should attach the moment it does. Cheap probe, stops on success, never
 * respawns binaries — attach-only.
 */
const ATTACH_RETRY_INTERVAL_MS = 10_000

function beginAttachRetry(url: string): void {
  if (attachRetryTimer) return
  attachRetryTimer = setInterval(() => {
    void (async () => {
      if (state.t === 'attached' || state.t === 'spawned') {
        clearInterval(attachRetryTimer)
        attachRetryTimer = undefined
        return
      }
      if (await isAgentsServerHealthy(url)) {
        log.info('Attached to app environment after retry', {url})
        state = {t: 'attached', url}
        clearInterval(attachRetryTimer)
        attachRetryTimer = undefined
      }
    })()
  }, ATTACH_RETRY_INTERVAL_MS)
  attachRetryTimer.unref?.()
}
let serverProcess: ChildProcess | null = null
let expectingClose = false

/** Current local app environment state. */
export function getAgentsServerState(): AgentsServerState {
  return state
}

/** Resolved base URL of the local app environment, or null when it is not running. */
export function getLocalAgentsServerUrl(): string | null {
  return state.t === 'attached' || state.t === 'spawned' ? state.url : null
}

/** Returns true when a healthy app environment answers at `url`. */
async function isAgentsServerHealthy(url: string): Promise<boolean> {
  try {
    // A canonical base (`…/hm/api/apps` or `…/hm/api/agents`) serves `/health`; an origin serves the legacy path.
    const healthUrl =
      url.endsWith('/hm/api/apps') || url.endsWith('/hm/api/agents') ? `${url}/health` : `${url}/agents/api/health`
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    })
    if (!response.ok) return false
    const body = (await response.json()) as {status?: unknown}
    return body?.status === 'ok'
  } catch {
    return false
  }
}

/** Returns true when nothing is listening on the port. */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.once('listening', () => probe.close(() => resolve(true)))
    probe.listen(port, '127.0.0.1')
  })
}

/** Finds a free port at or after `startPort` for a server we are about to spawn. */
async function findFreePort(startPort: number): Promise<number> {
  for (let offset = 0; offset < MAX_PORT_PROBES; offset += 1) {
    const port = startPort + offset
    if (await isPortFree(port)) return port
  }
  throw new Error(`No free port for the app environment in ${startPort}..${startPort + MAX_PORT_PROBES - 1}`)
}

/**
 * Starts or attaches to the local app environment and returns its base URL.
 *
 * Resolution order:
 * 1. `SEED_NO_APPS_SPAWN` (or the older `SEED_NO_AGENTS_SPAWN`) — skip entirely (the desktop then only talks to configured remote servers).
 * 2. `SEED_APPS_SERVER_URL` (or `SEED_AGENTS_SERVER_URL`) — attach to an explicitly configured server, failing loudly if unhealthy.
 * 3. A healthy app environment already on the default port — attach (this is the `./dev up` path).
 * 4. Otherwise spawn the bundled binary on the first free port, unless the user turned it off, to
 *    run what they checked (see {@link resolveLocalAgentsServerSpawn}).
 */
export async function startLocalAgentsServer(): Promise<string | null> {
  // A fresh startup supersedes any attach-retry loop left over from a previous attempt.
  if (attachRetryTimer) {
    clearInterval(attachRetryTimer)
    attachRetryTimer = undefined
  }
  if (process.env.SEED_NO_APPS_SPAWN ?? process.env.SEED_NO_AGENTS_SPAWN) {
    log.debug('Local app environment disabled by SEED_NO_APPS_SPAWN')
    state = {t: 'disabled', reason: 'env'}
    return null
  }

  const configuredUrl = (process.env.SEED_APPS_SERVER_URL ?? process.env.SEED_AGENTS_SERVER_URL)?.replace(/\/+$/, '')
  if (configuredUrl) {
    if (await isAgentsServerHealthy(configuredUrl)) {
      log.info('Attached to configured app environment', {url: configuredUrl})
      state = {t: 'attached', url: configuredUrl}
      return configuredUrl
    }
    const message = `SEED_APPS_SERVER_URL is set to ${configuredUrl} but no healthy app environment answered there`
    log.error(message)
    state = {t: 'error', message}
    beginAttachRetry(configuredUrl)
    return null
  }

  const defaultUrl = `http://localhost:${defaultAgentsPort()}`
  if (await isAgentsServerHealthy(defaultUrl)) {
    // Almost always the `./dev up` mprocs pane. Attaching keeps its hot reload authoritative.
    log.info('Attached to already-running app environment', {url: defaultUrl})
    state = {t: 'attached', url: defaultUrl}
    return defaultUrl
  }

  const policy = readLocalAgentsServerPolicy()
  const decision = resolveLocalAgentsServerSpawn(
    policy,
    readLocalAppEnvironmentFeatures(),
    fs.existsSync(localAgentsDbPath()),
    app.isPackaged,
  )
  if (decision.settle) {
    if (decision.settle.policy) writeStoredSetting(AGENTS_LOCAL_SERVER_SETTING_KEY, decision.settle.policy)
    writeStoredSetting(LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY, decision.settle.features)
  }
  if (!decision.spawn) {
    log.info('Local app environment not started', {policy, features: decision.features})
    state = {t: 'disabled', reason: 'setting'}
    // Not spawning is not the same as not listening: a dev server that was mid-restart during
    // the probe still gets attached the moment it answers.
    beginAttachRetry(defaultUrl)
    return null
  }

  try {
    const url = await spawnAgentsServer(decision.features)
    state = {t: 'spawned', url}
    return url
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('Failed to start local app environment', {error: message})
    state = {t: 'error', message}
    // The usual dev cause: the mprocs server was mid-restart during the probe and there is no
    // staged binary to spawn. Keep probing the default URL and attach when it returns.
    beginAttachRetry(defaultUrl)
    return null
  }
}

/** Spawns the bundled agents binary to run `features`, and resolves once it reports healthy. */
async function spawnAgentsServer(features: readonly AppEnvironmentFeature[]): Promise<string> {
  const binaryPath = getAgentsServerBinaryPath()
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`App environment binary not found at ${binaryPath}`)
  }

  const port = await findFreePort(defaultAgentsPort())
  const dataDir = path.join(userDataPath, 'agents')
  fs.mkdirSync(dataDir, {recursive: true})

  const args = [
    `--server-hostname=127.0.0.1`,
    `--server-port=${port}`,
    `--db-path=${localAgentsDbPath()}`,
    `--data-dir=${dataDir}`,
    // The desktop bridge serves the typed `/api/*` transport; direct `/ipfs/*` gateway reads live
    // on the daemon. Hosted servers normally expose both surfaces on one origin, but local desktop
    // topology deliberately splits them.
    `--hm-server-url=${API_HTTP_URL}`,
    `--ipfs-server-url=${DAEMON_HTTP_URL}`,
    // Subscription sign-in is a server opt-in; the desktop enables it for the server
    // it owns because it can catch the OAuth redirect on localhost:1455 itself.
    `--subscription-auth=true`,
    // The server itself refuses what is not listed, so an unchecked feature is off for every
    // client that reaches this port, not just hidden in this app.
    `--features=${features.join(',')}`,
    // The first sandbox on a machine takes most of a minute to start. Start it now, in the
    // background, so that is not what the first Run of a tool waits for.
    `--exec-warm-up=true`,
  ]

  log.info('Starting local app environment', {binaryPath, port, args})

  const child = spawn(binaryPath, args, {
    // Run from the binary's own directory, beside the files it ships with; see agents-server-path.ts.
    cwd: getAgentsServerWorkingDirectory(),
    env: {...process.env},
    stdio: 'pipe',
  })
  serverProcess = child
  expectingClose = false

  // Why the server stopped, for the Settings screen. A server that dies on an error prints
  // `error: <what went wrong>`, then a stack and the runtime's version line: the error is the
  // reason, and the last line alone ("Bun v1.3.3 (Linux x64)") says nothing.
  let lastStderr = ''
  let lastError = ''
  const exitReason = (code: number | null) => lastError || lastStderr || `code ${code}`
  const stdout = readline.createInterface({input: child.stdout})
  stdout.on('line', (line: string) => log.rawMessage(`[agents] ${line}`))
  const stderr = readline.createInterface({input: child.stderr})
  stderr.on('line', (line: string) => {
    if (line.trim()) lastStderr = line
    if (line.startsWith('error: ')) lastError = line.slice('error: '.length)
    log.rawMessage(`[agents] ${line}`)
  })

  child.on('error', (error) => {
    log.error('App environment spawn error', {error})
  })
  child.on('close', (code, signal) => {
    if (!expectingClose && child === serverProcess) {
      state = {t: 'error', message: `App environment exited: ${exitReason(code)}`}
      log.error('App environment closed', {code, signal, lastStderr, lastError})
    }
  })

  if (!quitHookInstalled) {
    quitHookInstalled = true
    app.addListener('will-quit', () => stopLocalAgentsServer())
  }

  const url = `http://localhost:${port}`
  const deadline = Date.now() + SPAWN_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`App environment exited during startup: ${exitReason(child.exitCode)}`)
    }
    if (await isAgentsServerHealthy(url)) {
      log.info('Local app environment ready', {url})
      return url
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`App environment did not become healthy within ${SPAWN_READY_TIMEOUT_MS}ms`)
}

/**
 * Turns the bundled server on or off for good: persists the choice, then starts or stops it now.
 * A server the app merely attached to (the dev one) is not ours to stop and stays as it is.
 */
export async function setLocalAgentsServerEnabled(enabled: boolean): Promise<string | null> {
  writeStoredSetting(AGENTS_LOCAL_SERVER_SETTING_KEY, enabled ? 'on' : 'off')
  if (enabled) {
    // On with nothing checked would run nothing: turning it on then means the default again.
    if (!readLocalAppEnvironmentFeatures()?.length)
      writeStoredSetting(LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY, [...DEFAULT_LOCAL_FEATURES])
    if (state.t === 'attached' || state.t === 'spawned') return state.url
    return startLocalAgentsServer()
  }
  if (state.t === 'attached') return state.url
  // Wait for the exit: an immediate re-enable probes the default port first and would otherwise
  // attach to the server that is still shutting down, then be left on a dead URL.
  await stopLocalAgentsServer()
  state = {t: 'disabled', reason: 'setting'}
  return null
}

/**
 * Sets what the bundled server runs (tools on their own, apps, agents), persistently, and restarts
 * it so the change holds now: the server reads the list once, when it starts. Unchecking the last
 * one stops it. A server the app merely attached to (the dev one) runs what its own flags say and
 * is left alone.
 */
export async function setLocalAppEnvironmentFeatures(
  features: readonly AppEnvironmentFeature[],
): Promise<string | null> {
  const next = APP_ENVIRONMENT_FEATURES.filter((feature) => features.includes(feature))
  writeStoredSetting(LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY, next)
  if (state.t === 'attached') return state.url
  // Only a server that runs is restarted: a change made while it is off waits for the switch.
  if (state.t !== 'spawned' && state.t !== 'error') return null
  await stopLocalAgentsServer()
  state = {t: 'disabled', reason: 'setting'}
  return startLocalAgentsServer()
}

/**
 * What the Settings screen shows as checked: the stored list, or the default before one is stored.
 */
export function getLocalAppEnvironmentFeatures(): AppEnvironmentFeature[] {
  return readLocalAppEnvironmentFeatures() ?? [...DEFAULT_LOCAL_FEATURES]
}

let quitHookInstalled = false

/**
 * Stops a spawned app environment; resolves once it has exited (or after a short timeout). Attached
 * servers are left alone — we do not own them.
 */
export function stopLocalAgentsServer(): Promise<void> {
  const child = serverProcess
  if (!child || child.killed) return Promise.resolve()
  expectingClose = true
  const closed = new Promise<void>((resolve) => {
    if (child.exitCode !== null) return resolve()
    const timer = setTimeout(resolve, STOP_TIMEOUT_MS)
    child.once('close', () => {
      clearTimeout(timer)
      resolve()
    })
  })
  if (process.platform === 'win32') {
    forceKillChildProcess(child)
  } else {
    child.kill()
  }
  serverProcess = null
  return closed
}
