import {State} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'
import {
  DAEMON_GRPC_PORT,
  DAEMON_HTTP_PORT,
  IS_PROD_DESKTOP,
  IS_PROD_DEV,
  P2P_PORT,
  VERSION,
} from '@shm/shared/constants'
import {ChildProcess, spawn} from 'child_process'
import {app} from 'electron'
import * as readline from 'node:readline'
import path from 'path'
import {grpcClient, markGRPCReady} from './app-grpc'
import {userDataPath} from './app-paths'
import {getDaemonBinaryPath} from './daemon-path'
import * as log from './logger'

let goDaemonExecutablePath = getDaemonBinaryPath()

const lndhubFlags = IS_PROD_DESKTOP && !IS_PROD_DEV ? '-lndhub.mainnet=true' : '-lndhub.mainnet=false'

// Base daemon arguments (without embedding flags)
const baseDaemonArguments = [
  '-http.port',
  String(DAEMON_HTTP_PORT),

  '-grpc.port',
  String(DAEMON_GRPC_PORT),

  '-p2p.port',
  String(P2P_PORT),

  '-log-level=debug',

  '-data-dir',
  `${userDataPath}/daemon`,

  '-syncing.smart=true',

  '-syncing.no-sync-back=true',

  lndhubFlags,
]

// Embedding-specific flags
const embeddingFlags = [
  '-llm.embedding.enabled',
  '-llm.backend.sleep-between-batches',
  '0s',
  '-llm.backend.batch-size',
  '100',
  '-llm.embedding.index-pass-size',
  '100',
]

// Build daemon arguments based on embedding setting
function buildDaemonArguments(embeddingEnabled: boolean): string[] {
  if (embeddingEnabled) {
    return [...baseDaemonArguments, ...embeddingFlags]
  }
  return [...baseDaemonArguments]
}

// For backwards compatibility during initial startup
const daemonArguments = baseDaemonArguments

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

export async function startMainDaemon(embeddingEnabled: boolean = false): Promise<{
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
  const daemonEnv = {
    ...process.env,
    SENTRY_RELEASE: VERSION,
    SENTRY_DSN: __SENTRY_DSN__,
  }

  const args = buildDaemonArguments(embeddingEnabled)
  log.info('Starting daemon with arguments:', {args, embeddingEnabled})

  const daemonProcess = spawn(goDaemonExecutablePath, args, {
    // daemon env
    cwd: path.join(process.cwd(), '../../..'),
    env: daemonEnv,
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
      log.rawMessage(line)
    })
    const stdout = readline.createInterface({input: daemonProcess.stdout})
    stdout.on('line', (line: string) => {
      log.rawMessage(line)
    })
    daemonProcess.on('error', (err) => {
      log.error('Go daemon spawn error', {error: err})
      reject(err)
    })
    daemonProcess.on('close', (code, signal) => {
      if (!expectingDaemonClose) {
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

  app.addListener('will-quit', () => {
    log.debug('App will quit')
    expectingDaemonClose = true
    daemonProcess.kill()
  })

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
    'waiting for daemon gRPC to be ready',
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
    'waiting for daemon HTTP to be ready',
    200, // try every 200ms
    30_000, // timeout after 30s
  )
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
 * Restarts the daemon with new embedding configuration.
 * This will kill the current daemon process and start a new one with updated flags.
 */
export async function restartDaemonWithEmbedding(embeddingEnabled: boolean): Promise<void> {
  if (process.env.SEED_NO_DAEMON_SPAWN) {
    log.debug('Daemon restart skipped (SEED_NO_DAEMON_SPAWN)')
    return
  }

  log.info('Restarting daemon with embedding:', {embeddingEnabled})
  updateGoDaemonState({t: 'startup'})

  // Kill the current daemon process
  if (currentDaemonProcess) {
    expectingDaemonClose = true
    currentDaemonProcess.kill()

    // Wait for the process to actually close
    await new Promise<void>((resolve) => {
      if (!currentDaemonProcess) {
        resolve()
        return
      }
      const onClose = () => {
        currentDaemonProcess?.removeListener('close', onClose)
        resolve()
      }
      currentDaemonProcess.on('close', onClose)
      // Timeout after 5 seconds
      setTimeout(() => {
        currentDaemonProcess?.removeListener('close', onClose)
        resolve()
      }, 5000)
    })

    currentDaemonProcess = null
  }

  // Reset the close expectation flag
  expectingDaemonClose = false

  // Start new daemon with updated configuration
  const daemonEnv = {
    ...process.env,
    SENTRY_RELEASE: VERSION,
    SENTRY_DSN: __SENTRY_DSN__,
  }

  const args = buildDaemonArguments(embeddingEnabled)
  log.info('Restarting daemon with arguments:', {args, embeddingEnabled})

  const daemonProcess = spawn(goDaemonExecutablePath, args, {
    cwd: path.join(process.cwd(), '../../..'),
    env: daemonEnv,
    stdio: 'pipe',
  })

  currentDaemonProcess = daemonProcess

  let lastStderr = ''
  const stderr = readline.createInterface({input: daemonProcess.stderr})
  await new Promise<void>((resolve, reject) => {
    stderr.on('line', (line: string) => {
      lastStderr = line
      if (line.includes('DaemonStarted')) {
        updateGoDaemonState({t: 'ready'})
      }
      log.rawMessage(line)
    })
    const stdout = readline.createInterface({input: daemonProcess.stdout})
    stdout.on('line', (line: string) => {
      log.rawMessage(line)
    })
    daemonProcess.on('error', (err) => {
      log.error('Go daemon restart spawn error', {error: err})
      reject(err)
    })
    daemonProcess.on('close', (code, signal) => {
      if (!expectingDaemonClose) {
        updateGoDaemonState({
          t: 'error',
          message: 'Service Error: !!!' + lastStderr,
        })
        log.error('Go daemon closed after restart', {code, signal})
      }
    })
    daemonProcess.on('spawn', () => {
      log.debug('Go daemon respawned')
      resolve()
    })
  })

  // Wait for daemon to be ready
  await tryUntilSuccess(
    async () => {
      log.debug('Waiting for restarted daemon to boot...')
      const info = await grpcClient.daemon.getInfo({})
      if (info.state !== State.ACTIVE) {
        if (info.state === State.MIGRATING && info.tasks.length === 1) {
          const completed = Number(info.tasks[0].completed)
          const total = Number(info.tasks[0].total)
          log.info(`Daemon migrating after restart: ${completed}/${total}`)
          updateGoDaemonState({
            t: 'migrating',
            completed,
            total,
          })
        }
        throw new Error(`Daemon not ready yet: ${info.state}`)
      }
      log.info('Restarted daemon is ready')
      updateGoDaemonState({t: 'ready'})
    },
    'waiting for restarted daemon gRPC to be ready',
    200,
    10 * 60 * 1_000,
  )

  // Also check HTTP endpoint
  await tryUntilSuccess(
    async () => {
      log.debug('Checking HTTP endpoint health after restart...')
      const response = await fetch(`http://localhost:${DAEMON_HTTP_PORT}/debug/version`)
      if (!response.ok) {
        throw new Error(`HTTP endpoint not ready: ${response.status}`)
      }
      log.info('HTTP endpoint is ready after restart')
    },
    'waiting for restarted daemon HTTP to be ready',
    200,
    30_000,
  )

  log.info('Daemon restart complete', {embeddingEnabled})
}
