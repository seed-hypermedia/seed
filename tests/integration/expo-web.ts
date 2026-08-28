/**
 * Expo web dev-server manager for mobile e2e tests.
 * Starts the mobile app (frontend/apps/mobile) as a react-native-web app
 * served by the Expo/Metro dev server.
 *
 * The mobile app manages its own dependencies with npm (it lives outside the
 * pnpm workspace). Run `npm install` in frontend/apps/mobile before this.
 */

import {spawn, ChildProcess} from 'child_process'
import * as readline from 'node:readline'
import path from 'path'

export type ExpoWebConfig = {
  port: number
}

export type ExpoWebInstance = {
  process: ChildProcess
  baseUrl: string
  kill: () => Promise<void>
  waitForReady: () => Promise<void>
  /** Compiles the web bundle (first compile can take ~1 minute). */
  prewarmBundle: () => Promise<void>
}

export async function startExpoWeb(config: ExpoWebConfig): Promise<ExpoWebInstance> {
  const mobileAppDir = path.resolve(__dirname, '../../frontend/apps/mobile')
  const baseUrl = `http://localhost:${config.port}`

  console.log(`[Expo] Starting web dev server on port ${config.port}`)

  const expoProcess = spawn('npx', ['expo', 'start', '--web', '--port', String(config.port)], {
    cwd: mobileAppDir,
    stdio: 'pipe',
    detached: true,
    env: {
      ...process.env,
      CI: '1',
      BROWSER: 'none',
      EXPO_NO_TELEMETRY: '1',
    },
  })

  const stdout = readline.createInterface({input: expoProcess.stdout!})
  stdout.on('line', (line: string) => console.log(`[Expo stdout] ${line}`))
  const stderr = readline.createInterface({input: expoProcess.stderr!})
  stderr.on('line', (line: string) => console.log(`[Expo stderr] ${line}`))

  let exited = false
  expoProcess.on('close', (code, signal) => {
    exited = true
    console.log(`[Expo] Closed with code=${code}, signal=${signal}`)
  })

  const waitForReady = async (timeoutMs = 120_000): Promise<void> => {
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      if (exited) throw new Error('Expo dev server exited before becoming ready')
      try {
        const response = await fetch(baseUrl)
        if (response.ok) {
          console.log(`[Expo] Dev server ready at ${baseUrl}`)
          return
        }
      } catch {
        // Not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    throw new Error(`Expo dev server not ready after ${timeoutMs}ms`)
  }

  const prewarmBundle = async (): Promise<void> => {
    console.log('[Expo] Prewarming web bundle (first compile can take a minute)...')
    const started = Date.now()
    const html = await (await fetch(baseUrl)).text()
    const match = html.match(/src="([^"]+\.bundle[^"]*)"/)
    if (!match) throw new Error('Could not find bundle URL in Expo index page')
    const response = await fetch(`${baseUrl}${match[1]}`)
    if (!response.ok) {
      throw new Error(`Bundle compile failed with status ${response.status}`)
    }
    await response.arrayBuffer()
    console.log(`[Expo] Bundle compiled in ${Math.round((Date.now() - started) / 1000)}s`)
  }

  const kill = (): Promise<void> => {
    return new Promise((resolve) => {
      console.log('[Expo] Killing dev server...')
      stdout.close()
      stderr.close()
      if (exited || expoProcess.pid === undefined) {
        resolve()
        return
      }
      expoProcess.once('close', () => resolve())
      // Kill the whole process group: expo spawns Metro as a child
      try {
        process.kill(-expoProcess.pid, 'SIGTERM')
      } catch {
        expoProcess.kill('SIGTERM')
      }
      setTimeout(() => {
        if (!exited && expoProcess.pid !== undefined) {
          try {
            process.kill(-expoProcess.pid, 'SIGKILL')
          } catch {
            expoProcess.kill('SIGKILL')
          }
        }
        resolve()
      }, 5000)
    })
  }

  return {process: expoProcess, baseUrl, kill, waitForReady, prewarmBundle}
}
