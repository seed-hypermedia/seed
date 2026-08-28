/**
 * Notify-service manager for integration tests.
 * Runs the notification server (frontend/apps/notify, Remix vite dev) with a
 * temp SQLite DATA_DIR and no SMTP — emails are skipped, but configs and
 * verification tokens land in the DB, so tests verify emails by reading the
 * token straight from sqlite (exactly what the emailed link would carry).
 */

import {execFileSync} from 'child_process'
import {spawn, ChildProcess} from 'child_process'
import {mkdtempSync, rmSync} from 'fs'
import {tmpdir} from 'os'
import * as readline from 'node:readline'
import path from 'path'

export type NotifyServerConfig = {
  port: number
  /** Daemon HTTP port the notifier polls for activity (may be a dead port for config-only tests). */
  daemonHttpPort: number
}

export type NotifyServerInstance = {
  process: ChildProcess
  baseUrl: string
  dataDir: string
  kill: () => Promise<void>
  waitForReady: () => Promise<void>
  /** Read the newest email-verification token for an email from the DB. */
  readVerificationToken: (email: string) => string | null
}

export async function startNotifyServer(config: NotifyServerConfig): Promise<NotifyServerInstance> {
  const notifyAppDir = path.resolve(__dirname, '../../frontend/apps/notify')
  const dataDir = mkdtempSync(path.join(tmpdir(), 'seed-notify-test-'))
  const baseUrl = `http://localhost:${config.port}`

  console.log(`[Notify] Starting notify server on port ${config.port} (data: ${dataDir})`)

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATA_DIR: dataDir,
    DAEMON_HTTP_PORT: String(config.daemonHttpPort),
    DAEMON_HTTP_URL: `http://localhost:${config.daemonHttpPort}`,
    SEED_BASE_URL: baseUrl,
    PORT: String(config.port),
  }
  // Neutralize SMTP so tests never send real mail. Empty strings (not
  // deletes): the notify app's dotenv loads frontend/apps/notify/.env, and
  // dotenv only fills variables that are UNSET — an empty value blocks it.
  env.NOTIFY_SMTP_HOST = ''
  env.NOTIFY_SMTP_USER = ''
  env.NOTIFY_SMTP_PASSWORD = ''
  env.NOTIFY_SENDER = ''
  delete env.NODE_ENV

  const notifyProcess = spawn('npx', ['remix', 'vite:dev', '--port', String(config.port)], {
    cwd: notifyAppDir,
    stdio: 'pipe',
    detached: true,
    env,
  })

  const stdout = readline.createInterface({input: notifyProcess.stdout!})
  stdout.on('line', (line: string) => console.log(`[Notify stdout] ${line}`))
  const stderr = readline.createInterface({input: notifyProcess.stderr!})
  stderr.on('line', (line: string) => console.log(`[Notify stderr] ${line}`))

  let exited = false
  notifyProcess.on('close', (code, signal) => {
    exited = true
    console.log(`[Notify] Closed with code=${code}, signal=${signal}`)
  })

  const waitForReady = async (timeoutMs = 120_000): Promise<void> => {
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      if (exited) throw new Error('Notify server exited before becoming ready')
      try {
        // Any HTTP answer means vite is serving; the first real request
        // triggers the server build.
        const response = await fetch(baseUrl)
        if (response.status < 500) {
          console.log(`[Notify] Ready at ${baseUrl}`)
          return
        }
      } catch {
        // Not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(`Notify server not ready after ${timeoutMs}ms`)
  }

  const readVerificationToken = (email: string): string | null => {
    const dbPath = path.join(dataDir, 'web-db.sqlite')
    try {
      const out = execFileSync(
        '/usr/bin/sqlite3',
        [
          dbPath,
          `SELECT token FROM notification_email_verifications WHERE email = '${email}' ORDER BY rowid DESC LIMIT 1;`,
        ],
        {encoding: 'utf-8'},
      ).trim()
      return out || null
    } catch (error) {
      console.log(
        `[Notify] readVerificationToken failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      return null
    }
  }

  const kill = (): Promise<void> => {
    return new Promise((resolve) => {
      console.log('[Notify] Killing server...')
      stdout.close()
      stderr.close()
      const done = () => {
        rmSync(dataDir, {recursive: true, force: true})
        resolve()
      }
      if (exited || notifyProcess.pid === undefined) {
        done()
        return
      }
      notifyProcess.once('close', done)
      try {
        process.kill(-notifyProcess.pid, 'SIGTERM')
      } catch {
        notifyProcess.kill('SIGTERM')
      }
      setTimeout(() => {
        if (!exited && notifyProcess.pid !== undefined) {
          try {
            process.kill(-notifyProcess.pid, 'SIGKILL')
          } catch {
            notifyProcess.kill('SIGKILL')
          }
        }
        done()
      }, 5000)
    })
  }

  return {process: notifyProcess, baseUrl, dataDir, kill, waitForReady, readVerificationToken}
}
