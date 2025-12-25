/**
 * Daemon spawner utility for integration tests.
 * Spawns a seed-daemon process with custom ports and data directory.
 */

import {spawn, ChildProcess} from 'child_process'
import * as readline from 'node:readline'
import path from 'path'
import {fileURLToPath} from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export type DaemonConfig = {
  httpPort: number
  grpcPort: number
  p2pPort: number
  dataDir: string
}

export type DaemonInstance = {
  process: ChildProcess
  config: DaemonConfig
  kill: () => Promise<void>
  waitForReady: () => Promise<void>
}

function getDaemonBinaryPath(): string {
  const platform = process.platform
  const arch = process.arch

  let triple: string
  switch (`${platform}/${arch}`) {
    case 'darwin/x64':
      triple = 'x86_64-apple-darwin'
      break
    case 'darwin/arm64':
      triple = 'aarch64-apple-darwin'
      break
    case 'win32/x64':
      triple = 'x86_64-pc-windows-msvc'
      break
    case 'linux/x64':
      triple = 'x86_64-unknown-linux-gnu'
      break
    case 'linux/arm64':
      triple = 'aarch64-unknown-linux-gnu'
      break
    default:
      throw new Error(`Unsupported platform: ${platform}/${arch}`)
  }

  // tests/integration/daemon.ts -> repo root is ../..
  const repoRoot = path.resolve(__dirname, '../..')
  return path.join(repoRoot, `plz-out/bin/backend/seed-daemon-${triple}`)
}

export async function spawnDaemon(config: DaemonConfig): Promise<DaemonInstance> {
  const binaryPath = getDaemonBinaryPath()

  const args = [
    '-http.port',
    String(config.httpPort),
    '-grpc.port',
    String(config.grpcPort),
    '-p2p.port',
    String(config.p2pPort),
    '-log-level=debug',
    '-data-dir',
    config.dataDir,
    '-syncing.smart=true',
    '-syncing.no-sync-back=true',
    '-lndhub.mainnet=false',
  ]

  console.log(`[Daemon] Spawning: ${binaryPath}`)
  console.log(`[Daemon] Args: ${args.join(' ')}`)

  const daemonProcess = spawn(binaryPath, args, {
    stdio: 'pipe',
    env: {
      ...process.env,
    },
  })

  let isReady = false
  let readyResolve: (() => void) | null = null
  let readyReject: ((err: Error) => void) | null = null

  const stderr = readline.createInterface({input: daemonProcess.stderr!})
  stderr.on('line', (line: string) => {
    console.log(`[Daemon stderr] ${line}`)
    if (line.includes('DaemonStarted')) {
      isReady = true
      readyResolve?.()
    }
  })

  const stdout = readline.createInterface({input: daemonProcess.stdout!})
  stdout.on('line', (line: string) => {
    console.log(`[Daemon stdout] ${line}`)
  })

  daemonProcess.on('error', (err) => {
    console.error('[Daemon] Spawn error:', err)
    readyReject?.(err)
  })

  daemonProcess.on('close', (code, signal) => {
    console.log(`[Daemon] Closed with code=${code}, signal=${signal}`)
    if (!isReady) {
      readyReject?.(new Error(`Daemon exited before ready: code=${code}`))
    }
  })

  const waitForReady = async (): Promise<void> => {
    if (isReady) return

    await new Promise<void>((resolve, reject) => {
      readyResolve = resolve
      readyReject = reject

      // Timeout after 60 seconds
      setTimeout(() => {
        reject(new Error('Daemon startup timeout (60s)'))
      }, 60_000)
    })

    // Also wait for HTTP endpoint to be ready
    await waitForHttpReady(config.httpPort)
  }

  const kill = (): Promise<void> => {
    return new Promise((resolve) => {
      console.log('[Daemon] Killing process...')

      // Close readline interfaces to prevent "Channel closed" errors
      stderr.close()
      stdout.close()

      if (daemonProcess.exitCode !== null) {
        // Already exited
        resolve()
        return
      }

      daemonProcess.once('close', () => resolve())
      daemonProcess.kill()

      // Force kill after 5s if graceful shutdown fails
      setTimeout(() => {
        if (daemonProcess.exitCode === null) {
          daemonProcess.kill('SIGKILL')
        }
        resolve()
      }, 5000)
    })
  }

  return {
    process: daemonProcess,
    config,
    kill,
    waitForReady,
  }
}

async function waitForHttpReady(port: number, timeoutMs = 30_000): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${port}/debug/version`)
      if (response.ok) {
        console.log(`[Daemon] HTTP endpoint ready on port ${port}`)
        return
      }
    } catch (e) {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(`HTTP endpoint not ready after ${timeoutMs}ms`)
}
