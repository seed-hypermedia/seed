/**
 * Web server manager for integration tests.
 * Builds and starts the Remix web app server.
 */

import {spawn, ChildProcess, execFileSync, execSync} from 'child_process'
import * as readline from 'node:readline'
import path from 'path'

export type WebServerConfig = {
  port: number
  daemonHttpPort: number
  dataDir: string // Path to web config directory (contains config.json)
  /** Announced via /hm/api/config notifyServiceHost when set. */
  notifyServiceHost?: string
  /** Secret of the gateway admin API (/hm/api/admin), which the hosting service uses to create sites. */
  serviceAdminSecret?: string
  /** The app environment the web app offers by default (SEED_AGENT_SERVER_URL), such as a test server. */
  agentServerUrl?: string
}

export type WebServerInstance = {
  process: ChildProcess
  config: WebServerConfig
  kill: () => Promise<void>
  waitForReady: () => Promise<void>
  baseUrl: string
}

function getProcessTree(pid: number): number[] {
  let children: number[] = []
  try {
    children = execFileSync('ps', ['-o', 'pid=', '--ppid', String(pid)], {encoding: 'utf-8'})
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(Number)
  } catch {}
  return [...children.flatMap(getProcessTree), pid]
}

function signalProcesses(pids: number[], signal: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, signal)
    } catch {}
  }
}

function processIsRunning(pid: number): boolean {
  try {
    const state = execFileSync('ps', ['-p', String(pid), '-o', 'stat='], {encoding: 'utf-8'}).trim()
    return state.length > 0 && !state.startsWith('Z')
  } catch {
    return false
  }
}

export async function buildWebApp(): Promise<void> {
  // tests/integration/web-server.ts -> web app is at ../../frontend/apps/web
  const webAppDir = path.resolve(__dirname, '../../frontend/apps/web')
  console.log('[Web] Building web app...')

  execSync('pnpm build', {
    cwd: webAppDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=8192`.trim(),
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
    ...(config.agentServerUrl ? {SEED_AGENT_SERVER_URL: config.agentServerUrl} : {}),
    DATA_DIR: config.dataDir,
    SEED_BASE_URL: baseUrl,
    NODE_ENV: 'production',
    ...(config.notifyServiceHost ? {NOTIFY_SERVICE_HOST: config.notifyServiceHost} : {}),
    ...(config.serviceAdminSecret ? {SERVICE_ADMIN_SECRET: config.serviceAdminSecret} : {}),
  }

  // Use remix-serve to run the built app
  const webProcess = spawn('pnpm', ['start:prod'], {
    cwd: webAppDir,
    stdio: 'pipe',
    env,
    shell: process.platform === 'win32',
    detached: process.platform !== 'win32',
  })
  const ownedProcessIds = new Set(webProcess.pid ? [webProcess.pid] : [])
  const captureProcessTree = () => {
    if (!webProcess.pid || process.platform === 'win32') return
    for (const pid of getProcessTree(webProcess.pid)) ownedProcessIds.add(pid)
  }

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
      captureProcessTree()
      readyResolve?.()
    }
    // Fallback: remix-serve outputs "http://localhost:xxxx"
    if (line.includes('[remix-serve]') && line.includes('http://localhost:')) {
      isReady = true
      captureProcessTree()
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

      const exited = new Promise<void>((done) => webProcess.once('close', () => done()))
      captureProcessTree()
      const signalOwnedProcesses = (signal: NodeJS.Signals) => {
        signalProcesses([...ownedProcessIds], signal)
        if (process.platform !== 'win32' && webProcess.pid) {
          try {
            process.kill(-webProcess.pid, signal)
          } catch {}
        }
        try {
          webProcess.kill(signal)
        } catch {}
      }
      void (async () => {
        signalOwnedProcesses('SIGTERM')
        await Promise.race([exited, new Promise((done) => setTimeout(done, 5000))])
        const stillRunning = [...ownedProcessIds].filter(processIsRunning)
        if (stillRunning.length) signalProcesses(stillRunning, 'SIGKILL')
        if (webProcess.exitCode === null && webProcess.signalCode === null) {
          try {
            webProcess.kill('SIGKILL')
          } catch {}
        }
        await Promise.race([exited, new Promise((done) => setTimeout(done, 1000))])
        resolve()
      })()
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
