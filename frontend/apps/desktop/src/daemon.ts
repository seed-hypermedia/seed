import {State} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'
import {DAEMON_GRPC_PORT, DAEMON_HTTP_PORT, P2P_PORT, VERSION} from '@shm/shared/constants'
import {ChildProcess, spawn} from 'child_process'
import {app} from 'electron'
import * as readline from 'node:readline'
import path from 'path'
import {grpcClient, markGRPCReady} from './app-grpc'
import {userDataPath} from './app-paths'
import {getDaemonBinaryPath} from './daemon-path'
import * as log from './logger'
import {forceKillChildProcess} from './win32-process'

const quietNodeLogs = log.isQuietNodeLogsEnabled()

let goDaemonExecutablePath = getDaemonBinaryPath()

declare const __SEED_P2P_TESTNET_NAME__: string

/** Testnet name used by the "testnet" network option (matches the ./dev up-testnet stack). */
export const DEFAULT_TESTNET_NAME = 'dev'

export type DaemonNetworkConfig = {
  mode: 'mainnet' | 'testnet' | 'custom'
  customName?: string
}

/** Maps the user-facing network config to the -p2p.testnet-name flag value ('' means mainnet). */
export function resolveTestnetName(network: DaemonNetworkConfig): string {
  if (network.mode === 'testnet') return DEFAULT_TESTNET_NAME
  if (network.mode === 'custom') return network.customName?.trim() || ''
  return ''
}

// Current daemon configuration, so a restart triggered by one setting keeps the others.
let currentEmbeddingEnabled = false
let currentTestnetName = __SEED_P2P_TESTNET_NAME__ || ''

// Embedding-specific flags
const embeddingFlags = [
  '-llm.embedding.enabled',
  '-llm.backend.sleep-between-batches=0s',
  '-llm.backend.batch-size=100',
  '-llm.embedding.index-pass-size=100',
]

// Build daemon arguments based on the current settings
function buildDaemonArguments(embeddingEnabled: boolean, testnetName: string): string[] {
  const args = [
    `-http.port=${String(DAEMON_HTTP_PORT)}`,
    `-grpc.port=${String(DAEMON_GRPC_PORT)}`,
    `-p2p.port=${String(P2P_PORT)}`,

    testnetName ? '-lndhub.mainnet=false' : '-lndhub.mainnet=true',

    ...(testnetName ? ['-p2p.testnet-name', testnetName] : []),

    // Daemon data is always at {userDataPath}/daemon.
    // In fixture mode, userDataPath is set via SEED_FIXTURE_DATA_DIR.
    `-data-dir=${userDataPath}/daemon`,
  ]

  // Use file-based keystore in fixture mode.
  if (process.env.SEED_FIXTURE_DATA_DIR) {
    args.push(`-keystore-dir=${userDataPath}/daemon/keys`)
  }

  if (embeddingEnabled) {
    args.push(...embeddingFlags)
  }

  return args
}

// Store daemon process reference for restart capability
let currentDaemonProcess: ChildProcess | null = null
let expectingDaemonClose = false

type ReadyState = {t: 'ready'}
type ErrorState = {t: 'error'; message: string}
type StartupState = {t: 'startup'}
type MigratingState = {t: 'migrating'; completed: number; total: number}

export type GoDaemonState = ReadyState | ErrorState | StartupState | MigratingState

let goDaemonState: GoDaemonState = {t: 'startup'}

export function getDaemonState() {
  return goDaemonState
}
const daemonStateHandlers = new Set<(state: GoDaemonState) => void>()
export function subscribeDaemonState(handler: (state: GoDaemonState) => void): () => void {
  daemonStateHandlers.add(handler)
  return () => {
    daemonStateHandlers.delete(handler)
  }
}

export function updateGoDaemonState(state: GoDaemonState) {
  goDaemonState = state
  daemonStateHandlers.forEach((handler) => handler(state))
}

/** Spawns the daemon process, wires up log/close handling, and resolves once the process has spawned. */
async function spawnDaemonProcess(args: string[]): Promise<void> {
  log.info('Starting daemon with arguments:', {args})

  const daemonProcess = spawn(goDaemonExecutablePath, args, {
    // daemon env
    cwd: path.join(process.cwd(), '../../..'),
    env: {
      ...process.env,
      SENTRY_RELEASE: VERSION,
      SENTRY_DSN: __SENTRY_DSN__,
    },
    stdio: 'pipe',
  })

  // Store reference for restart capability
  currentDaemonProcess = daemonProcess

  let lastStderr = ''
  const stderr = readline.createInterface({input: daemonProcess.stderr})
  await new Promise<void>((resolve, reject) => {
    stderr.on('line', (line: string) => {
      lastStderr = line
      if (line.includes('DaemonStarted')) {
        updateGoDaemonState({t: 'ready'})
      }
      if (!quietNodeLogs) log.rawMessage(line)
    })
    const stdout = readline.createInterface({input: daemonProcess.stdout})
    stdout.on('line', (line: string) => {
      if (!quietNodeLogs) log.rawMessage(line)
    })
    daemonProcess.on('error', (err) => {
      log.error('Go daemon spawn error', {error: err})
      reject(err)
    })
    daemonProcess.on('close', (code, signal) => {
      // Only report an error if this process is still the current one — a
      // stale process closing late after a restart should not flip the state.
      if (!expectingDaemonClose && daemonProcess === currentDaemonProcess) {
        updateGoDaemonState({
          t: 'error',
          message: 'Service Error: !!!' + lastStderr,
        })
        log.error('Go daemon closed', {code: code, signal: signal})
      }
    })
    daemonProcess.on('spawn', () => {
      log.debug('Go daemon spawned')
      resolve()
    })
  })
}

/** Polls the daemon gRPC and HTTP endpoints until it is fully ready. */
async function waitForDaemonReady(label: string): Promise<void> {
  await tryUntilSuccess(
    async () => {
      log.debug('Waiting for daemon to boot...')
      const info = await grpcClient.daemon.getInfo({})
      if (info.state !== State.ACTIVE) {
        if (info.state === State.MIGRATING && info.tasks.length === 1) {
          const completed = Number(info.tasks[0].completed)
          const total = Number(info.tasks[0].total)
          log.info(`Daemon migrating: ${completed}/${total}`)
          // Broadcast migration progress to loading window
          updateGoDaemonState({
            t: 'migrating',
            completed,
            total,
          })
        }
        throw new Error(`Daemon not ready yet: ${info.state}`)
      }
      log.info('Daemon is ready: ' + JSON.stringify(info.toJson()))
      // Daemon is ACTIVE - update state so loading window can close
      updateGoDaemonState({t: 'ready'})
    },
    `waiting for ${label} gRPC to be ready`,
    200, // try every 200ms
    10 * 60 * 1_000, // timeout after 10 minutes
  )

  // Also check HTTP endpoint is responding
  await tryUntilSuccess(
    async () => {
      log.debug('Checking HTTP endpoint health...')
      const response = await fetch(`http://localhost:${DAEMON_HTTP_PORT}/debug/version`)
      if (!response.ok) {
        throw new Error(`HTTP endpoint not ready: ${response.status}`)
      }
      const version = await response.text()
      log.info('HTTP endpoint is ready, version: ' + version)
    },
    `waiting for ${label} HTTP to be ready`,
    200, // try every 200ms
    30_000, // timeout after 30s
  )
}

/** Kills the current daemon process (if any) and waits for it to close, with a 5s timeout. */
async function killCurrentDaemon(): Promise<void> {
  if (!currentDaemonProcess) return
  expectingDaemonClose = true

  if (process.platform === 'win32') {
    forceKillChildProcess(currentDaemonProcess)
  } else {
    currentDaemonProcess.kill()
  }

  // Wait for the process to actually close
  await new Promise<void>((resolve) => {
    if (!currentDaemonProcess) {
      resolve()
      return
    }
    const proc = currentDaemonProcess
    const onClose = () => {
      proc.removeListener('close', onClose)
      resolve()
    }
    proc.on('close', onClose)
    // Timeout after 5 seconds
    setTimeout(() => {
      proc.removeListener('close', onClose)
      resolve()
    }, 5000)
  })

  currentDaemonProcess = null
}

export async function startMainDaemon(
  embeddingEnabled: boolean = false,
  network?: DaemonNetworkConfig,
): Promise<{
  httpPort: string | undefined
  grpcPort: string | undefined
  p2pPort: string | undefined
}> {
  if (process.env.SEED_NO_DAEMON_SPAWN) {
    log.debug('Go daemon spawn skipped')
    updateGoDaemonState({t: 'ready'})
    markGRPCReady()
    return {
      httpPort: process.env.VITE_DESKTOP_HTTP_PORT,
      grpcPort: process.env.VITE_DESKTOP_GRPC_PORT,
      p2pPort: process.env.VITE_DESKTOP_P2P_PORT,
    }
  }

  currentEmbeddingEnabled = embeddingEnabled
  if (network) {
    currentTestnetName = resolveTestnetName(network)
  }

  const args = buildDaemonArguments(currentEmbeddingEnabled, currentTestnetName)
  await spawnDaemonProcess(args)

  app.addListener('will-quit', () => {
    log.debug('App will quit')
    expectingDaemonClose = true
    const daemon = currentDaemonProcess
    if (!daemon || daemon.killed) return
    if (process.platform === 'win32') {
      forceKillChildProcess(daemon)
    } else {
      daemon.kill()
    }
  })

  await waitForDaemonReady('daemon')
  markGRPCReady()

  const mainDaemon = {
    httpPort: process.env.VITE_DESKTOP_HTTP_PORT,
    grpcPort: process.env.VITE_DESKTOP_GRPC_PORT,
    p2pPort: process.env.VITE_DESKTOP_P2P_PORT,
  }
  return mainDaemon
}

async function tryUntilSuccess(
  fn: () => Promise<void>,
  attemptName: string,
  retryDelayMs: number = 1_000,
  maxRetryMs: number = 10_000,
) {
  const startTime = Date.now()
  let didResolve = false
  let didTimeout = false
  while (!didResolve && !didTimeout) {
    try {
      await fn()
      didResolve = true
    } catch (error) {}
    if (!didResolve) {
      if (Date.now() - startTime > maxRetryMs) {
        didTimeout = true
      }
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
  }
  if (didTimeout) {
    throw new Error('Timed out: ' + attemptName)
  }
}

/**
 * Restarts the daemon with updated configuration. Only the provided settings
 * change; the rest keep their current values.
 * This will kill the current daemon process and start a new one with updated flags.
 */
export async function restartDaemon(changes: {
  embeddingEnabled?: boolean
  network?: DaemonNetworkConfig
}): Promise<void> {
  if (process.env.SEED_NO_DAEMON_SPAWN) {
    log.debug('Daemon restart skipped (SEED_NO_DAEMON_SPAWN)')
    return
  }

  if (changes.embeddingEnabled !== undefined) {
    currentEmbeddingEnabled = changes.embeddingEnabled
  }
  if (changes.network) {
    currentTestnetName = resolveTestnetName(changes.network)
  }

  log.info('Restarting daemon with changes:', {
    changes,
    embeddingEnabled: currentEmbeddingEnabled,
    testnetName: currentTestnetName,
  })
  updateGoDaemonState({t: 'startup'})

  // Kill the current daemon process
  await killCurrentDaemon()

  // Reset the close expectation flag
  expectingDaemonClose = false

  // Start new daemon with updated configuration
  const args = buildDaemonArguments(currentEmbeddingEnabled, currentTestnetName)
  await spawnDaemonProcess(args)

  // Wait for daemon to be ready
  await waitForDaemonReady('restarted daemon')

  log.info('Daemon restart complete', {
    embeddingEnabled: currentEmbeddingEnabled,
    testnetName: currentTestnetName,
  })
}

/**
 * Shuts down the daemon process, ensuring it's properly terminated before an update.
 * On Windows this uses taskkill /F /T to force-kill the entire process tree.
 * Returns after the process has closed or a timeout is reached.
 */
export async function shutdownDaemonForUpdate(): Promise<void> {
  if (!currentDaemonProcess || currentDaemonProcess.killed) {
    log.info('[DAEMON] No running daemon to shut down for update')
    return
  }

  log.info('[DAEMON] Shutting down daemon for update')
  await killCurrentDaemon()
  log.info('[DAEMON] Daemon process closed after update shutdown')
}
