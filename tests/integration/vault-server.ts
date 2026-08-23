/**
 * Vault server spawner for integration tests.
 * Runs the Bun-based vault server (vault/) against a local seed-daemon.
 *
 * Prerequisite (this test suite only): `bun` on PATH — vault/node_modules is
 * gitignored, so the spawner runs `bun install` in vault/ when it is missing.
 *
 * NODE_ENV is left unset so the server runs in dev mode: plain-http cookies
 * (`Vault-Session` instead of `__Secure-…`) and, with no SMTP flags, email
 * verification codes logged to stdout — captured here so tests can read them
 * via `waitForVerificationCode`.
 */

import {execSync, spawn, ChildProcess} from 'child_process'
import {existsSync, mkdtempSync, rmSync} from 'fs'
import * as readline from 'node:readline'
import {tmpdir} from 'os'
import path from 'path'

export type VaultServerConfig = {
  port: number
  /** seed-daemon HTTP port; the vault server's backend base URLs point at it. */
  backendHttpPort: number
  /** Directory for the SQLite db. A fresh temp dir (removed on kill) when omitted. */
  dbDir?: string
}

export type VaultServerInstance = {
  process: ChildProcess
  /** http://localhost:<port> */
  baseUrl: string
  /** http://localhost:<port>/vault — the vault origin URL devices connect to. */
  vaultUrl: string
  waitForReady: () => Promise<void>
  /**
   * Resolves the most recent 4-digit verification code the dev-mode console
   * email sender logged for `email` (scans buffered stdout, then waits).
   */
  waitForVerificationCode: (email: string, timeoutMs?: number) => Promise<string>
  kill: () => Promise<void>
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Kill any process listening on the port, so crashed runs don't wedge us. */
function killProcessOnPort(port: number): void {
  try {
    const result = execSync(`lsof -ti :${port}`, {encoding: 'utf-8'}).trim()
    for (const pid of result.split('\n').filter(Boolean)) {
      try {
        execSync(`kill -9 ${pid}`, {stdio: 'ignore'})
        console.log(`[Vault] Killed lingering process ${pid} on port ${port}`)
      } catch {
        // Already exited
      }
    }
    if (result) execSync('sleep 0.5')
  } catch {
    // No process on the port
  }
}

export async function startVaultServer(config: VaultServerConfig): Promise<VaultServerInstance> {
  const repoRoot = path.resolve(__dirname, '../..')
  const vaultDir = path.join(repoRoot, 'vault')
  const baseUrl = `http://localhost:${config.port}`
  const vaultUrl = `${baseUrl}/vault`

  // vault/node_modules is gitignored; make sure deps are installed.
  if (!existsSync(path.join(vaultDir, 'node_modules'))) {
    console.log('[Vault] node_modules missing, running `bun install` in vault/ ...')
    try {
      execSync('bun install', {cwd: vaultDir, stdio: 'inherit'})
    } catch (error) {
      throw new Error(`\`bun install\` failed in ${vaultDir} — is bun on PATH? ${error}`)
    }
  }

  killProcessOnPort(config.port)

  let ownedDbDir: string | null = null
  let dbDir = config.dbDir
  if (!dbDir) {
    ownedDbDir = mkdtempSync(path.join(tmpdir(), 'seed-integration-vault-'))
    dbDir = ownedDbDir
  }

  const backendBaseUrl = `http://localhost:${config.backendHttpPort}`
  const args = [
    'src/main.ts',
    '--server-port',
    String(config.port),
    '--rp-id',
    'localhost',
    '--rp-origin',
    baseUrl,
    '--backend-http-base-url',
    backendBaseUrl,
    '--backend-grpc-base-url',
    backendBaseUrl,
    '--db-path',
    path.join(dbDir, 'vault.sqlite'),
  ]

  // Dev mode: NODE_ENV must not be 'production' (plain-http cookies, console
  // email sender). No SMTP flags — codes go to stdout.
  const env = {...process.env}
  delete env.NODE_ENV

  console.log(`[Vault] Spawning: bun ${args.join(' ')} (cwd: ${vaultDir})`)

  const vaultProcess = spawn('bun', args, {
    cwd: vaultDir,
    stdio: 'pipe',
    detached: true,
    env,
  })

  const stdoutLines: string[] = []
  const lineListeners = new Set<(line: string) => void>()

  const stdout = readline.createInterface({input: vaultProcess.stdout!})
  stdout.on('line', (line: string) => {
    console.log(`[Vault stdout] ${line}`)
    stdoutLines.push(line)
    for (const listener of lineListeners) listener(line)
  })
  const stderr = readline.createInterface({input: vaultProcess.stderr!})
  stderr.on('line', (line: string) => console.log(`[Vault stderr] ${line}`))

  let exited = false
  vaultProcess.on('error', (err) => {
    exited = true
    console.error('[Vault] Spawn error (is bun on PATH?):', err)
  })
  vaultProcess.on('close', (code, signal) => {
    exited = true
    console.log(`[Vault] Closed with code=${code}, signal=${signal}`)
  })

  const waitForReady = async (timeoutMs = 60_000): Promise<void> => {
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      if (exited) throw new Error('Vault server exited before becoming ready')
      try {
        // Static config endpoint: no daemon call involved.
        const response = await fetch(`${baseUrl}/vault/api/config`)
        if (response.ok) {
          console.log(`[Vault] Server ready at ${baseUrl}`)
          return
        }
      } catch {
        // Not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new Error(`Vault server not ready after ${timeoutMs}ms`)
  }

  const waitForVerificationCode = (email: string, timeoutMs = 30_000): Promise<string> => {
    const pattern = new RegExp(`Verification code for ${escapeRegExp(email)}: (\\d+)`)
    // Newest first: a resent code invalidates the previous one.
    for (let i = stdoutLines.length - 1; i >= 0; i--) {
      const match = stdoutLines[i].match(pattern)
      if (match) return Promise.resolve(match[1])
    }
    return new Promise((resolve, reject) => {
      const listener = (line: string) => {
        const match = line.match(pattern)
        if (match) {
          cleanup()
          resolve(match[1])
        }
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`No verification code for ${email} after ${timeoutMs}ms`))
      }, timeoutMs)
      const cleanup = () => {
        clearTimeout(timer)
        lineListeners.delete(listener)
      }
      lineListeners.add(listener)
    })
  }

  const kill = (): Promise<void> => {
    return new Promise((resolve) => {
      console.log('[Vault] Killing server...')
      stdout.close()
      stderr.close()
      const removeDbDir = () => {
        if (ownedDbDir) rmSync(ownedDbDir, {recursive: true, force: true})
      }
      if (exited || vaultProcess.pid === undefined) {
        removeDbDir()
        resolve()
        return
      }
      vaultProcess.once('close', () => {
        removeDbDir()
        resolve()
      })
      // Kill the whole process group (bun may spawn children).
      try {
        process.kill(-vaultProcess.pid, 'SIGTERM')
      } catch {
        vaultProcess.kill('SIGTERM')
      }
      setTimeout(() => {
        if (!exited && vaultProcess.pid !== undefined) {
          try {
            process.kill(-vaultProcess.pid, 'SIGKILL')
          } catch {
            vaultProcess.kill('SIGKILL')
          }
        }
        removeDbDir()
        resolve()
      }, 5000)
    })
  }

  return {process: vaultProcess, baseUrl, vaultUrl, waitForReady, waitForVerificationCode, kill}
}
