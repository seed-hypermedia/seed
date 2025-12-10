/**
 * Test environment setup for integration tests.
 * Manages the full test stack (daemon + web server).
 */

import {execSync} from 'child_process'
import path from 'path'
import {DaemonConfig, DaemonInstance, spawnDaemon} from './daemon'
import {buildWebApp, startWebServer, WebServerConfig, WebServerInstance} from './web-server'

/**
 * Kill any process listening on the given port.
 * This ensures clean test runs even if previous tests crashed.
 */
function killProcessOnPort(port: number): void {
  try {
    // Get PIDs of processes using the port
    const result = execSync(`lsof -ti :${port}`, {encoding: 'utf-8'}).trim()
    if (result) {
      const pids = result.split('\n').filter(Boolean)
      for (const pid of pids) {
        try {
          execSync(`kill -9 ${pid}`, {stdio: 'ignore'})
          console.log(`[Cleanup] Killed process ${pid} on port ${port}`)
        } catch {
          // Process may have already exited
        }
      }
      // Give OS time to release the port
      execSync('sleep 0.5')
    }
  } catch {
    // No process on port, which is fine
  }
}

export type TestEnvConfig = {
  // Web server port
  webPort?: number
  // Daemon ports
  daemonHttpPort?: number
  daemonGrpcPort?: number
  daemonP2pPort?: number
  // Skip building (for faster iteration)
  skipBuild?: boolean
}

export type TestEnv = {
  daemon: DaemonInstance
  web: WebServerInstance
  cleanup: () => Promise<void>
}

// Default ports for integration tests (avoid common dev ports)
const DEFAULT_WEB_PORT = 3399
const DEFAULT_DAEMON_HTTP_PORT = 59001
const DEFAULT_DAEMON_GRPC_PORT = 59002
const DEFAULT_DAEMON_P2P_PORT = 59003

export async function setupTestEnv(config: TestEnvConfig = {}): Promise<TestEnv> {
  const webPort = config.webPort ?? DEFAULT_WEB_PORT
  const daemonHttpPort = config.daemonHttpPort ?? DEFAULT_DAEMON_HTTP_PORT
  const daemonGrpcPort = config.daemonGrpcPort ?? DEFAULT_DAEMON_GRPC_PORT
  const daemonP2pPort = config.daemonP2pPort ?? DEFAULT_DAEMON_P2P_PORT

  // tests/integration/test-env.ts -> repo root is ../..
  const repoRoot = path.resolve(__dirname, '../..')
  const daemonDataDir = path.join(repoRoot, 'test-fixtures/daemon')
  const webDataDir = path.join(repoRoot, 'test-fixtures/web')

  console.log('=== Setting up test environment ===')
  console.log(`Web port: ${webPort}`)
  console.log(`Daemon HTTP port: ${daemonHttpPort}`)
  console.log(`Daemon gRPC port: ${daemonGrpcPort}`)
  console.log(`Daemon P2P port: ${daemonP2pPort}`)
  console.log(`Daemon data dir: ${daemonDataDir}`)
  console.log(`Web data dir: ${webDataDir}`)

  // 0. Clean up any lingering processes from previous test runs
  console.log('[Cleanup] Checking for lingering processes on test ports...')
  killProcessOnPort(webPort)
  killProcessOnPort(daemonHttpPort)
  killProcessOnPort(daemonGrpcPort)
  killProcessOnPort(daemonP2pPort)

  // 1. Build web app (unless skipped)
  if (!config.skipBuild) {
    await buildWebApp()
  }

  // 2. Start daemon
  const daemonConfig: DaemonConfig = {
    httpPort: daemonHttpPort,
    grpcPort: daemonGrpcPort,
    p2pPort: daemonP2pPort,
    dataDir: daemonDataDir,
  }
  const daemon = await spawnDaemon(daemonConfig)
  await daemon.waitForReady()

  // 3. Start web server
  const webConfig: WebServerConfig = {
    port: webPort,
    daemonHttpPort,
    dataDir: webDataDir,
  }
  const web = await startWebServer(webConfig)
  await web.waitForReady()

  console.log('=== Test environment ready ===')
  console.log(`Web server: ${web.baseUrl}`)

  const cleanup = async () => {
    console.log('=== Cleaning up test environment ===')
    web.kill()
    daemon.kill()
    // Small delay to let processes close gracefully before Vitest worker shutdown
    // This helps avoid "Channel closed" errors from tinypool
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  // Handle process exit
  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)

  return {
    daemon,
    web,
    cleanup,
  }
}
