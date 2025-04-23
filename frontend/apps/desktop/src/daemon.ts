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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function connectWithRetry(
  daemonProcess: ReturnType<typeof spawn>,
): Promise<void> {
  let attempt = 1
  const maxAttempts = Infinity // Keep trying forever
  const baseDelay = 1000 // Start with 1 second delay
  const maxDelay = 30000 // Max delay of 30 seconds

  // TEMPORARY: Force first 3 attempts to fail for testing
  // const TEMP_FAIL_ATTEMPTS = 0

  while (true) {
    try {
      // TEMPORARY: Simulate failure for testing
      // if (attempt <= TEMP_FAIL_ATTEMPTS) {
      //   throw new Error(
      //     `Temporary test failure for attempt ${attempt}/${TEMP_FAIL_ATTEMPTS}`,
      //   )
      // }

      await new Promise<void>((resolve, reject) => {
        let hasStartupCompleted = false
        let lastStderr = ''

        const stderr = readline.createInterface({
          input: daemonProcess.stderr!,
          terminal: false,
        })

        stderr.on('line', (line: string) => {
          lastStderr = line
          if (line.includes('DaemonStarted')) {
            updateGoDaemonState({t: 'ready'})
          }

          try {
            const daemonEvent = JSON.parse(line)
            if (daemonEvent.msg === 'P2PNodeReady' && !hasStartupCompleted) {
              hasStartupCompleted = true
              resolve()
            }
          } catch (e) {
            // If JSON parsing fails, just continue
            log.debug(`Failed to parse daemon output: ${line}`)
          }
        })

        const stdout = readline.createInterface({
          input: daemonProcess.stdout!,
          terminal: false,
        })

        stdout.on('line', (line: string) => {
          console.log('Daemon Stdout:', line)
        })

        let expectingDaemonClose = false

        daemonProcess.on('error', (err) => {
          log.error('Go daemon spawn error', {error: err, attempt})
          reject(err)
        })

        daemonProcess.on('close', (code, signal) => {
          if (!expectingDaemonClose) {
            updateGoDaemonState({
              t: 'error',
              message: `Service Error (Attempt ${attempt}): ${lastStderr}`,
            })
            log.error('Go daemon closed', {code, signal, attempt})
            reject(new Error(`Daemon closed unexpectedly: ${lastStderr}`))
          }
        })

        daemonProcess.on('spawn', () => {
          log.debug('Go daemon spawned', {attempt})
        })

        app.addListener('will-quit', () => {
          log.debug('App will quit')
          expectingDaemonClose = true
          daemonProcess.kill()
        })
      })

      // If we get here, connection was successful
      log.debug('Successfully connected to daemon', {attempt})
      return
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      log.error('Connection attempt failed', {attempt, error: errorMessage})
      updateGoDaemonState({
        t: 'error',
        message: `Connection attempt ${attempt} failed: ${errorMessage}`,
      })

      // Calculate delay with exponential backoff
      const backoffDelay = Math.min(
        baseDelay * Math.pow(1.5, attempt - 1),
        maxDelay,
      )

      log.debug('Retrying connection', {
        attempt,
        nextAttempt: attempt + 1,
        backoffDelay,
      })
      await delay(backoffDelay)
      attempt++
    }
  }
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
    cwd: path.join(process.cwd(), '../../..'),
    env: {
      ...process.env,
      SENTRY_RELEASE: VERSION,
    },
    stdio: 'pipe',
  })

  await connectWithRetry(daemonProcess)

  const mainDaemon = {
    httpPort: process.env.VITE_DESKTOP_HTTP_PORT,
    grpcPort: process.env.VITE_DESKTOP_GRPC_PORT,
    p2pPort: process.env.VITE_DESKTOP_P2P_PORT,
  }
  return mainDaemon
}
