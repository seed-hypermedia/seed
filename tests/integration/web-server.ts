/**
 * Web server manager for integration tests.
 * Builds and starts the Remix web app server.
 */

import {spawn, ChildProcess, execSync} from 'child_process'
import * as readline from 'node:readline'
import path from 'path'

export type WebServerConfig = {
  port: number
  daemonHttpPort: number
  dataDir: string // Path to web config directory (contains config.json)
}

export type WebServerInstance = {
  process: ChildProcess
  config: WebServerConfig
  kill: () => Promise<void>
  waitForReady: () => Promise<void>
  baseUrl: string
}

export async function buildWebApp(): Promise<void> {
  // tests/integration/web-server.ts -> web app is at ../../frontend/apps/web
  const webAppDir = path.resolve(__dirname, '../../frontend/apps/web')
  console.log('[Web] Building web app...')

  execSync('yarn build', {
    cwd: webAppDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
    },
  })

  console.log('[Web] Build complete')
}

export async function startWebServer(config: WebServerConfig): Promise<WebServerInstance> {
  // tests/integration/web-server.ts -> web app is at ../../frontend/apps/web
  const webAppDir = path.resolve(__dirname, '../../frontend/apps/web')
  const baseUrl = `http://localhost:${config.port}`

  console.log(`[Web] Starting server on port ${config.port}`)
  console.log(`[Web] Daemon HTTP port: ${config.daemonHttpPort}`)
  console.log(`[Web] Data dir: ${config.dataDir}`)

  const env = {
    ...process.env,
    PORT: String(config.port),
    DAEMON_HTTP_PORT: String(config.daemonHttpPort),
    DAEMON_HTTP_URL: `http://localhost:${config.daemonHttpPort}`,
    DAEMON_FILE_URL: `http://localhost:${config.daemonHttpPort}/ipfs`,
    DATA_DIR: config.dataDir,
    SEED_BASE_URL: baseUrl,
    NODE_ENV: 'production',
  }

  // Use remix-serve to run the built app
  const webProcess = spawn('yarn', ['start:prod'], {
    cwd: webAppDir,
    stdio: 'pipe',
    env,
    shell: true,
  })

  let isReady = false
  let readyResolve: (() => void) | null = null
  let readyReject: ((err: Error) => void) | null = null

  const stdout = readline.createInterface({input: webProcess.stdout!})
  stdout.on('line', (line: string) => {
    console.log(`[Web stdout] ${line}`)
    // Look for the server initialization complete message
    // The web app outputs "Server initialized and cache warmed" when ready
    if (line.includes('Server initialized')) {
      isReady = true
      readyResolve?.()
    }
    // Fallback: remix-serve outputs "http://localhost:xxxx"
    if (line.includes('[remix-serve]') && line.includes('http://localhost:')) {
      isReady = true
      readyResolve?.()
    }
  })

  const stderr = readline.createInterface({input: webProcess.stderr!})
  stderr.on('line', (line: string) => {
    console.log(`[Web stderr] ${line}`)
  })

  webProcess.on('error', (err) => {
    console.error('[Web] Spawn error:', err)
    readyReject?.(err)
  })

  webProcess.on('close', (code, signal) => {
    console.log(`[Web] Closed with code=${code}, signal=${signal}`)
    if (!isReady) {
      readyReject?.(new Error(`Web server exited before ready: code=${code}`))
    }
  })

  const waitForReady = async (): Promise<void> => {
    if (isReady) return

    // Wait for the process to output the ready message
    await new Promise<void>((resolve, reject) => {
      readyResolve = resolve
      readyReject = reject

      // Timeout after 120 seconds (server initialization can be slow)
      setTimeout(() => {
        reject(new Error('Web server startup timeout (120s)'))
      }, 120_000)
    })

    // Additional delay to ensure server is fully ready
    await new Promise((r) => setTimeout(r, 1000))
  }

  const kill = (): Promise<void> => {
    return new Promise((resolve) => {
      console.log('[Web] Killing process...')

      // Close readline interfaces to prevent "Channel closed" errors
      stdout.close()
      stderr.close()

      if (webProcess.exitCode !== null) {
        // Already exited
        resolve()
        return
      }

      webProcess.once('close', () => resolve())
      webProcess.kill()

      // Force kill after 5s if graceful shutdown fails
      setTimeout(() => {
        if (webProcess.exitCode === null) {
          webProcess.kill('SIGKILL')
        }
        resolve()
      }, 5000)
    })
  }

  return {
    process: webProcess,
    config,
    kill,
    waitForReady,
    baseUrl,
  }
}

async function waitForHttpReady(port: number, timeoutMs = 60_000): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${port}/`)
      if (response.ok || response.status === 404) {
        // 404 is fine - server is responding
        console.log(`[Web] HTTP endpoint ready on port ${port}`)
        return
      }
    } catch (e) {
      // Not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(`Web HTTP endpoint not ready after ${timeoutMs}ms`)
}
