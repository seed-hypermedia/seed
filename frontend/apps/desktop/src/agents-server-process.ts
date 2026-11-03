import {AGENTS_LOCAL_SERVER_SETTING_KEY, API_HTTP_URL, DAEMON_HTTP_URL} from '@shm/shared/constants'
import {ChildProcess, spawn} from 'child_process'
import {app} from 'electron'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as readline from 'node:readline'
import path from 'path'
import {userDataPath} from './app-paths'
import {getStoredSetting, writeStoredSetting} from './app-settings'
import {getAgentsServerBinaryPath, getAgentsServerWorkingDirectory} from './agents-server-path'
import * as log from './logger'
import {forceKillChildProcess} from './win32-process'

/**
 * Lifecycle for the local agents server, which runs the same artifact as the hosted deployment.
 *
 * The rule is **dev attaches, packaged spawns**: `./dev up` already runs `cd agents && bun run dev`
 * with hot reload, so spawning a second server there would fight it for the port and silently
 * shadow the developer's edits. Rather than make that a flag people forget to set, startup probes
 * the default port first and attaches to whatever healthy agents server answers.
 */

/**
 * Mirrors the agents server's own port default (agents/src/config.ts). Dev redefines it via
 * SEED_AGENTS_HTTP_PORT in .env.vars — like the daemon ports — so a release build's spawned
 * server and the dev hot-reload server never share a port. Read at call time, not module load,
 * so tests control it per-case.
 */
function defaultAgentsPort(): number {
  return Number(process.env.SEED_AGENTS_HTTP_PORT) || 3050
}
/** Ports scanned when the default is occupied by something that is not a healthy agents server. */
const MAX_PORT_PROBES = 20
const HEALTH_TIMEOUT_MS = 1_500
const SPAWN_READY_TIMEOUT_MS = 30_000

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

/**
 * Whether a packaged build should spawn its bundled server.
 *
 * The local agent system is off unless the user turned it on, with one exception: a build that
 * always spawned the server (before this setting existed) may have left agents behind. When the
 * setting is unset and that database exists, the server runs one more time so the app can look
 * for agents in it and settle the setting (see `useLocalAgentsServerMigration` in the renderer).
 * A fresh install has no database and starts off without spawning anything.
 */
export function resolveLocalAgentsServerSpawn(
  policy: LocalAgentsServerPolicy,
  dataExists: boolean,
): {spawn: boolean; settle?: 'off'} {
  if (policy === 'on') return {spawn: true}
  if (policy === 'off') return {spawn: false}
  return dataExists ? {spawn: true} : {spawn: false, settle: 'off'}
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
        log.info('Attached to agents server after retry', {url})
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

/** Current local agents server state. */
export function getAgentsServerState(): AgentsServerState {
  return state
}

/** Resolved base URL of the local agents server, or null when it is not running. */
export function getLocalAgentsServerUrl(): string | null {
  return state.t === 'attached' || state.t === 'spawned' ? state.url : null
}

/** Returns true when a healthy agents server answers at `url`. */
async function isAgentsServerHealthy(url: string): Promise<boolean> {
  try {
    // A canonical base (`…/hm/api/agents`) serves `/health`; an origin serves the legacy path.
    const healthUrl = url.endsWith('/hm/api/agents') ? `${url}/health` : `${url}/agents/api/health`
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
  throw new Error(`No free port for the agents server in ${startPort}..${startPort + MAX_PORT_PROBES - 1}`)
}

/**
 * Starts or attaches to the local agents server and returns its base URL.
 *
 * Resolution order:
 * 1. `SEED_NO_AGENTS_SPAWN` — skip entirely (the desktop then only talks to configured remote servers).
 * 2. `SEED_AGENTS_SERVER_URL` — attach to an explicitly configured server, failing loudly if unhealthy.
 * 3. A healthy agents server already on the default port — attach (this is the `./dev up` path).
 * 4. Otherwise spawn the bundled binary on the first free port, if the user's setting allows it
 *    (see {@link resolveLocalAgentsServerSpawn}); `force` skips that check for an explicit turn-on.
 */
export async function startLocalAgentsServer(options?: {force?: boolean}): Promise<string | null> {
  // A fresh startup supersedes any attach-retry loop left over from a previous attempt.
  if (attachRetryTimer) {
    clearInterval(attachRetryTimer)
    attachRetryTimer = undefined
  }
  if (process.env.SEED_NO_AGENTS_SPAWN) {
    log.debug('Local agents server disabled by SEED_NO_AGENTS_SPAWN')
    state = {t: 'disabled', reason: 'env'}
    return null
  }

  const configuredUrl = process.env.SEED_AGENTS_SERVER_URL?.replace(/\/+$/, '')
  if (configuredUrl) {
    if (await isAgentsServerHealthy(configuredUrl)) {
      log.info('Attached to configured agents server', {url: configuredUrl})
      state = {t: 'attached', url: configuredUrl}
      return configuredUrl
    }
    const message = `SEED_AGENTS_SERVER_URL is set to ${configuredUrl} but no healthy agents server answered there`
    log.error(message)
    state = {t: 'error', message}
    beginAttachRetry(configuredUrl)
    return null
  }

  const defaultUrl = `http://localhost:${defaultAgentsPort()}`
  if (await isAgentsServerHealthy(defaultUrl)) {
    // Almost always the `./dev up` mprocs pane. Attaching keeps its hot reload authoritative.
    log.info('Attached to already-running agents server', {url: defaultUrl})
    state = {t: 'attached', url: defaultUrl}
    return defaultUrl
  }

  if (!options?.force) {
    const policy = readLocalAgentsServerPolicy()
    const decision = resolveLocalAgentsServerSpawn(policy, fs.existsSync(localAgentsDbPath()))
    if (!decision.spawn) {
      if (decision.settle) writeStoredSetting(AGENTS_LOCAL_SERVER_SETTING_KEY, decision.settle)
      log.info('Local agents server not started', {policy})
      state = {t: 'disabled', reason: 'setting'}
      // Not spawning is not the same as not listening: a dev server that was mid-restart during
      // the probe (dev user data has no agents database, so the policy lands here) still gets
      // attached the moment it answers.
      beginAttachRetry(defaultUrl)
      return null
    }
  }

  try {
    const url = await spawnAgentsServer()
    state = {t: 'spawned', url}
    return url
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error('Failed to start local agents server', {error: message})
    state = {t: 'error', message}
    // The usual dev cause: the mprocs server was mid-restart during the probe and there is no
    // staged binary to spawn. Keep probing the default URL and attach when it returns.
    beginAttachRetry(defaultUrl)
    return null
  }
}

/** Spawns the bundled agents binary and resolves once it reports healthy. */
async function spawnAgentsServer(): Promise<string> {
  const binaryPath = getAgentsServerBinaryPath()
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Agents server binary not found at ${binaryPath}`)
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
  ]

  log.info('Starting local agents server', {binaryPath, port, args})

  const child = spawn(binaryPath, args, {
    // Run from the binary's own directory, beside the files it ships with; see agents-server-path.ts.
    cwd: getAgentsServerWorkingDirectory(),
    env: {...process.env},
    stdio: 'pipe',
  })
  serverProcess = child
  expectingClose = false

  let lastStderr = ''
  const stdout = readline.createInterface({input: child.stdout})
  stdout.on('line', (line: string) => log.rawMessage(`[agents] ${line}`))
  const stderr = readline.createInterface({input: child.stderr})
  stderr.on('line', (line: string) => {
    lastStderr = line
    log.rawMessage(`[agents] ${line}`)
  })

  child.on('error', (error) => {
    log.error('Agents server spawn error', {error})
  })
  child.on('close', (code, signal) => {
    if (!expectingClose && child === serverProcess) {
      state = {t: 'error', message: `Agents server exited: ${lastStderr || `code ${code}`}`}
      log.error('Agents server closed', {code, signal, lastStderr})
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
      throw new Error(`Agents server exited during startup: ${lastStderr || `code ${child.exitCode}`}`)
    }
    if (await isAgentsServerHealthy(url)) {
      log.info('Local agents server ready', {url})
      return url
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Agents server did not become healthy within ${SPAWN_READY_TIMEOUT_MS}ms`)
}

/**
 * Turns the bundled server on or off for good: persists the choice, then starts or stops it now.
 * A server the app merely attached to (the dev one) is not ours to stop and stays as it is.
 */
export async function setLocalAgentsServerEnabled(enabled: boolean): Promise<string | null> {
  writeStoredSetting(AGENTS_LOCAL_SERVER_SETTING_KEY, enabled ? 'on' : 'off')
  if (enabled) {
    if (state.t === 'attached' || state.t === 'spawned') return state.url
    return startLocalAgentsServer({force: true})
  }
  if (state.t === 'attached') return state.url
  stopLocalAgentsServer()
  state = {t: 'disabled', reason: 'setting'}
  return null
}

let quitHookInstalled = false

/** Stops a spawned agents server. Attached servers are left alone — we do not own them. */
export function stopLocalAgentsServer(): void {
  const child = serverProcess
  if (!child || child.killed) return
  expectingClose = true
  if (process.platform === 'win32') {
    forceKillChildProcess(child)
  } else {
    child.kill()
  }
  serverProcess = null
}
