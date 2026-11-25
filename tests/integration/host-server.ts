/**
 * Seed hosting service spawner for integration tests.
 * The hosting service lives in a separate private repository, expected to be
 * checked out next to this one (../SeedHost) or pointed at with SEED_HOST_DIR.
 * It runs through its `scripts/dev-local.ts`, which brings its own embedded
 * Postgres and needs no external services.
 */

import {execSync, spawn, ChildProcess} from 'child_process'
import {existsSync, mkdtempSync, rmSync} from 'fs'
import * as readline from 'node:readline'
import {tmpdir} from 'os'
import path from 'path'

export type HostServerConfig = {
  port: number
  postgresPort: number
  /** Vault origins whose email prevalidation the hosting service accepts. */
  trustedPrevalidators: string[]
  /** Web server that runs as the gateway (see gatewayAdminSecret of the test env), where sites are created. */
  gateway: {baseUrl: string; adminSecret: string}
}

export type HostServerInstance = {
  process: ChildProcess
  /** http://localhost:<port> */
  baseUrl: string
  waitForReady: () => Promise<void>
  /** Resolves the newest login code emailed to `email` (the local runner prints emails to stdout). */
  waitForLoginCode: (email: string, timeoutMs?: number) => Promise<string>
  kill: () => Promise<void>
}

/** Returns the hosting service checkout, or null when it is not available on this machine. */
export function findHostDir(): string | null {
  const hostDir = process.env.SEED_HOST_DIR || path.resolve(__dirname, '../../../SeedHost')
  return existsSync(path.join(hostDir, 'scripts/dev-local.ts')) ? hostDir : null
}

function killProcessOnPort(port: number): void {
  try {
    const result = execSync(`lsof -ti :${port}`, {encoding: 'utf-8'}).trim()
    for (const pid of result.split('\n').filter(Boolean)) {
      try {
        execSync(`kill -9 ${pid}`, {stdio: 'ignore'})
        console.log(`[Host] Killed lingering process ${pid} on port ${port}`)
      } catch {
        // Already exited
      }
    }
    if (result) execSync('sleep 0.5')
  } catch {
    // No process on the port
  }
}

export async function startHostServer(config: HostServerConfig): Promise<HostServerInstance> {
  const hostDir = findHostDir()
  if (!hostDir) throw new Error('Seed hosting service checkout not found. Set SEED_HOST_DIR.')
  const baseUrl = `http://localhost:${config.port}`

  killProcessOnPort(config.port)
  killProcessOnPort(config.postgresPort)

  const postgresDir = mkdtempSync(path.join(tmpdir(), 'seed-integration-host-pg-'))
  // initdb refuses a directory that already exists with the wrong permissions.
  rmSync(postgresDir, {recursive: true, force: true})

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(config.port),
    LOCAL_PG_PORT: String(config.postgresPort),
    LOCAL_PG_DIR: postgresDir,
    // Set explicitly, so a developer's .env in the hosting service checkout cannot leak into the test.
    DATABASE_URL: '',
    SITE_URL: baseUrl,
    TRUSTED_PREVALIDATORS: config.trustedPrevalidators.join(','),
    HM_HOST: 'localhost',
    HM_HOST_URL: config.gateway.baseUrl,
    HM_HOST_SECRET: config.gateway.adminSecret,
    // Vitest sets NODE_ENV=test; the hosting service only serves in development without a client build.
    NODE_ENV: 'development',
  }

  console.log(`[Host] Spawning: npx tsx scripts/dev-local.ts (cwd: ${hostDir})`)
  const hostProcess = spawn('npx', ['tsx', 'scripts/dev-local.ts'], {
    cwd: hostDir,
    stdio: 'pipe',
    detached: true,
    env,
  })

  const stdoutLines: string[] = []
  const lineListeners = new Set<() => void>()
  const stdout = readline.createInterface({input: hostProcess.stdout!})
  stdout.on('line', (line: string) => {
    console.log(`[Host stdout] ${line}`)
    stdoutLines.push(line)
    for (const listener of lineListeners) listener()
  })
  const stderr = readline.createInterface({input: hostProcess.stderr!})
  stderr.on('line', (line: string) => console.log(`[Host stderr] ${line}`))

  let exited = false
  hostProcess.on('error', (err) => {
    exited = true
    console.error('[Host] Spawn error:', err)
  })
  hostProcess.on('close', (code, signal) => {
    exited = true
    console.log(`[Host] Closed with code=${code}, signal=${signal}`)
  })

  const waitForReady = async (timeoutMs = 120_000): Promise<void> => {
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      if (exited) throw new Error('Hosting service exited before becoming ready')
      try {
        const response = await fetch(`${baseUrl}/api/info`)
        if (response.ok) {
          console.log(`[Host] Server ready at ${baseUrl}`)
          return
        }
      } catch {
        // Not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(`Hosting service not ready after ${timeoutMs}ms`)
  }

  // The console email is "Email to <email>: <subject>" followed by the text body, with the code on its own line.
  const findLoginCode = (email: string): string | null => {
    const start = stdoutLines.findLastIndex((line) => line.startsWith(`Email to ${email}:`))
    if (start === -1) return null
    return stdoutLines.slice(start + 1).find((line) => /^\d{4}$/.test(line)) ?? null
  }

  const waitForLoginCode = (email: string, timeoutMs = 30_000): Promise<string> => {
    return new Promise((resolve, reject) => {
      const check = () => {
        const code = findLoginCode(email)
        if (code) {
          cleanup()
          resolve(code)
        }
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`No login code for ${email} after ${timeoutMs}ms`))
      }, timeoutMs)
      const cleanup = () => {
        clearTimeout(timer)
        lineListeners.delete(check)
      }
      lineListeners.add(check)
      check()
    })
  }

  const kill = (): Promise<void> => {
    return new Promise((resolve) => {
      console.log('[Host] Killing server...')
      stdout.close()
      stderr.close()
      const finish = () => {
        // Postgres is a child of the server, make sure it does not outlive it.
        killProcessOnPort(config.postgresPort)
        rmSync(postgresDir, {recursive: true, force: true})
        resolve()
      }
      if (exited || hostProcess.pid === undefined) {
        finish()
        return
      }
      const forceKill = setTimeout(() => {
        try {
          process.kill(-hostProcess.pid!, 'SIGKILL')
        } catch {
          hostProcess.kill('SIGKILL')
        }
        finish()
      }, 10_000)
      hostProcess.once('close', () => {
        clearTimeout(forceKill)
        finish()
      })
      try {
        process.kill(-hostProcess.pid, 'SIGTERM')
      } catch {
        hostProcess.kill('SIGTERM')
      }
    })
  }

  return {process: hostProcess, baseUrl, waitForReady, waitForLoginCode, kill}
}
