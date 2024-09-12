import {
  DAEMON_GRPC_PORT,
  DAEMON_HTTP_PORT,
  IS_PROD_DESKTOP,
  P2P_PORT,
  VERSION,
} from '@shm/shared'
import {spawn} from 'child_process'
import {app} from 'electron'
import path from 'path'
import {userDataPath} from './app-paths'
import {getDaemonBinaryPath} from './daemon-path'
import * as log from './logger'
import * as readline from 'node:readline'

let goDaemonExecutablePath = getDaemonBinaryPath()

let lndhubFlags = userDataPath.includes('Seed.local')
  ? '-lndhub.mainnet=false'
  : IS_PROD_DESKTOP
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

export function startMainDaemon() {
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
    env: {
      ...process.env,
      SENTRY_RELEASE: VERSION,
    },
    stdio: 'pipe',
  })

  let lastStderr = ''
  const stderr = readline.createInterface({input: daemonProcess.stderr})
  stderr.on('line', (line: string) => {
    lastStderr = line
    if (line.includes('DaemonStarted')) {
      updateGoDaemonState({t: 'ready'})
    }

    log.rawMessage(line)
  })

  const stdout = readline.createInterface({input: daemonProcess.stdout})
  stdout.on('line', (line: string) => {
    console.log('Daemon Stdout:', line)
  })

  let expectingDaemonClose = false

  daemonProcess.on('error', (err) => {
    log.error('Go daemon spawn error', {error: err})
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
  })

  app.addListener('will-quit', () => {
    log.debug('App will quit')
    expectingDaemonClose = true
    daemonProcess.kill()
  })

  const mainDaemon = {
    httpPort: process.env.VITE_DESKTOP_HTTP_PORT,
    grpcPort: process.env.VITE_DESKTOP_GRPC_PORT,
    p2pPort: process.env.VITE_DESKTOP_P2P_PORT,
  }
  return mainDaemon
}
