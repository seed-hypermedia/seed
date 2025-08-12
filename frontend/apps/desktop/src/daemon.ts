import {
  DAEMON_GRPC_PORT,
  DAEMON_HTTP_PORT,
  IS_PROD_DESKTOP,
  IS_PROD_DEV,
  P2P_PORT,
  VERSION,
} from '@shm/shared/constants'
import {spawn} from 'child_process'
import {app} from 'electron'
import * as readline from 'node:readline'
import path from 'path'
import {grpcClient, markGRPCReady} from './app-grpc'
import {userDataPath} from './app-paths'
import {getDaemonBinaryPath} from './daemon-path'
import * as log from './logger'

let goDaemonExecutablePath = getDaemonBinaryPath()

const lndhubFlags =
  IS_PROD_DESKTOP && !IS_PROD_DEV
    ? '-lndhub.mainnet=true'
    : '-lndhub.mainnet=false'

const daemonArguments = [
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
  `SENTRY_DSN=${__SENTRY_DSN__}`,
]

type ReadyState = {t: 'ready'}
type ErrorState = {t: 'error'; message: string}
type StartupState = {t: 'startup'}

export type GoDaemonState = ReadyState | ErrorState | StartupState

let goDaemonState: GoDaemonState = {t: 'startup'}

export function getDaemonState() {
  return goDaemonState
}
const daemonStateHandlers = new Set<(state: GoDaemonState) => void>()
export function subscribeDaemonState(
  handler: (state: GoDaemonState) => void,
): () => void {
  daemonStateHandlers.add(handler)
  return () => {
    daemonStateHandlers.delete(handler)
  }
}

export function updateGoDaemonState(state: GoDaemonState) {
  goDaemonState = state
  daemonStateHandlers.forEach((handler) => handler(state))
}

export async function startMainDaemon(): Promise<{
  httpPort: string | undefined
  grpcPort: string | undefined
  p2pPort: string | undefined
}> {
  if (process.env.SEED_NO_DAEMON_SPAWN) {
    log.debug('Go daemon spawn skipped')
    updateGoDaemonState({t: 'ready'})
    return {
      httpPort: process.env.VITE_DESKTOP_HTTP_PORT,
      grpcPort: process.env.VITE_DESKTOP_GRPC_PORT,
      p2pPort: process.env.VITE_DESKTOP_P2P_PORT,
    }
  }

  const daemonProcess = spawn(goDaemonExecutablePath, daemonArguments, {
    // daemon env
    cwd: path.join(process.cwd(), '../../..'),
    // @ts-expect-error
    env: {
      ...process.env,
      SENTRY_RELEASE: VERSION,
    },
    stdio: 'pipe',
  })

  let lastStderr = ''
  // @ts-expect-error
  const stderr = readline.createInterface({input: daemonProcess.stderr})
  let expectingDaemonClose = false
  await new Promise<void>((resolve, reject) => {
    stderr.on('line', (line: string) => {
      lastStderr = line
      if (line.includes('DaemonStarted')) {
        updateGoDaemonState({t: 'ready'})
      }
      // log.rawMessage(line)
    })
    // @ts-expect-error
    const stdout = readline.createInterface({input: daemonProcess.stdout})
    stdout.on('line', (line: string) => {
      // log.rawMessage(line)
    })
    // @ts-expect-error
    daemonProcess.on('error', (err) => {
      log.error('Go daemon spawn error', {error: err})
      reject(err)
    })
    // @ts-expect-error
    daemonProcess.on('close', (code, signal) => {
      if (!expectingDaemonClose) {
        updateGoDaemonState({
          t: 'error',
          message: 'Service Error: !!!' + lastStderr,
        })
        log.error('Go daemon closed', {code: code, signal: signal})
      }
    })
    // @ts-expect-error
    daemonProcess.on('spawn', () => {
      log.debug('Go daemon spawned')
      resolve()
    })
  })

  app.addListener('will-quit', () => {
    log.debug('App will quit')
    expectingDaemonClose = true
    // @ts-expect-error
    daemonProcess.kill()
  })

  await tryUntilSuccess(
    async () => {
      log.debug('Waiting for daemon to boot...')
      const info = await grpcClient.daemon.getInfo({})
      log.info('Daemon is ready: ' + JSON.stringify(info.toJson()))
    },
    'waiting for daemon gRPC to be ready',
    200, // try every 200ms
    30_000, // timeout after 10s
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
