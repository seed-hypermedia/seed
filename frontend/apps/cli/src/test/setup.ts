/**
 * Test setup infrastructure for Seed CLI
 * Manages daemon and web server lifecycle for integration tests
 */

import {spawn, execSync, type ChildProcess} from 'child_process'
import {mkdtempSync, rmSync, existsSync, cpSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'

/**
 * Find repo root by looking for backend directory
 */
function findRepoRoot(): string {
  let repoRoot = process.cwd()
  while (!existsSync(join(repoRoot, 'backend')) && repoRoot !== '/') {
    repoRoot = join(repoRoot, '..')
  }
  if (!existsSync(join(repoRoot, 'backend'))) {
    throw new Error('Could not find repo root')
  }
  return repoRoot
}

/**
 * Find an executable in PATH
 */
function findExecutable(name: string): string {
  try {
    const result = execSync(`which ${name}`, {encoding: 'utf8'}).trim()
    if (result) return result
  } catch {
    // which failed
  }
  // Default to just the name and hope PATH works
  return name
}

export type TestContext = {
  testnetName: string
  daemonUrl: string
  dataDir: string
  daemon: ChildProcess | null
  cleanup: () => Promise<void>
}

export type FullTestContext = TestContext & {
  webServerUrl: string
  webServer: ChildProcess | null
}

export type TestConfig = {
  httpPort?: number
  grpcPort?: number
  p2pPort?: number
}

/**
 * Get a random port in a safe range
 */
function getRandomPort(): number {
  return 50000 + Math.floor(Math.random() * 10000)
}

/**
 * Generate unique testnet name with timestamp
 */
export function generateTestnetName(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `cli-test-${timestamp}-${random}`
}

/**
 * Wait for daemon to be ready by polling the debug endpoint
 */
async function waitForDaemon(url: string, timeoutMs = 90000): Promise<void> {
  const start = Date.now()
  // Use debug endpoint which is always available on daemon
  const healthUrl = `${url}/debug/version`
  let lastError: Error | null = null

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(healthUrl)
      if (res.ok) {
        return
      }
      lastError = new Error(`HTTP ${res.status}`)
    } catch (e) {
      lastError = e as Error
      // Daemon not ready yet
    }
    await sleep(1000)
  }

  throw new Error(`Daemon failed to start within ${timeoutMs}ms. Last error: ${lastError?.message}`)
}

/**
 * Start a daemon instance for testing
 */
export async function startDaemon(config: TestConfig = {}): Promise<TestContext> {
  const testnetName = generateTestnetName()
  // Use random ports to avoid conflicts between test runs
  const basePort = getRandomPort()
  const httpPort = config.httpPort || basePort
  const grpcPort = config.grpcPort || basePort + 1
  const p2pPort = config.p2pPort || basePort + 2

  const dataDir = mkdtempSync(join(tmpdir(), 'seed-cli-test-'))

  console.log(`[test] Starting daemon with testnet: ${testnetName}`)
  console.log(`[test] Data dir: ${dataDir}`)
  console.log(`[test] Ports: http=${httpPort}, grpc=${grpcPort}, p2p=${p2pPort}`)

  const repoRoot = findRepoRoot()
  const daemonPath = join(repoRoot, 'backend/cmd/seed-daemon')

  // Find go binary
  const goBinary = findExecutable('go')
  console.log(`[test] Go binary: ${goBinary}`)

  // Use shell to spawn go since direct spawn can have PATH issues
  const daemon = spawn(
    '/bin/sh',
    [
      '-c',
      `cd "${daemonPath}" && "${goBinary}" run . -data-dir="${dataDir}" -http.port=${httpPort} -grpc.port=${grpcPort} -p2p.port=${p2pPort} -log-level=warn`,
    ],
    {
      env: {
        ...process.env,
        SEED_P2P_TESTNET_NAME: testnetName,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  const daemonUrl = `http://localhost:${httpPort}`

  // Log daemon output
  daemon.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      console.log(`[daemon:stdout] ${line}`)
    }
  })

  daemon.stderr?.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      console.log(`[daemon:stderr] ${line}`)
    }
  })

  daemon.on('exit', (code, signal) => {
    console.log(`[daemon] Process exited with code ${code}, signal ${signal}`)
  })

  daemon.on('error', (err) => {
    console.log(`[daemon] Process error: ${err.message}`)
  })

  // Wait for daemon to be ready
  try {
    await waitForDaemon(daemonUrl)
    console.log(`[test] Daemon ready at ${daemonUrl}`)
  } catch (error) {
    daemon.kill()
    rmSync(dataDir, {recursive: true, force: true})
    throw error
  }

  const cleanup = async () => {
    console.log('[test] Cleaning up...')
    if (daemon && !daemon.killed) {
      daemon.kill('SIGTERM')
      await sleep(1000)
      if (!daemon.killed) {
        daemon.kill('SIGKILL')
      }
    }
    if (existsSync(dataDir)) {
      rmSync(dataDir, {recursive: true, force: true})
    }
    console.log('[test] Cleanup complete')
  }

  return {
    testnetName,
    daemonUrl,
    dataDir,
    daemon,
    cleanup,
  }
}

/**
 * Start daemon with test fixture data
 * Copies fixture to temp dir to avoid modifying original
 */
export async function startDaemonWithFixture(config: TestConfig = {}): Promise<TestContext> {
  const testnetName = 'fixture'
  const basePort = getRandomPort()
  const httpPort = config.httpPort || basePort
  const grpcPort = config.grpcPort || basePort + 1
  const p2pPort = config.p2pPort || basePort + 2

  const repoRoot = findRepoRoot()
  const fixtureSource = join(repoRoot, 'test-fixtures/desktop/daemon')

  if (!existsSync(fixtureSource)) {
    throw new Error(`Fixture not found: ${fixtureSource}`)
  }

  // Copy fixture to temp directory
  const dataDir = mkdtempSync(join(tmpdir(), 'seed-cli-fixture-'))
  cpSync(fixtureSource, dataDir, {recursive: true})

  console.log(`[test] Starting daemon with fixture data`)
  console.log(`[test] Data dir: ${dataDir}`)
  console.log(`[test] Ports: http=${httpPort}, grpc=${grpcPort}, p2p=${p2pPort}`)

  const daemonPath = join(repoRoot, 'backend/cmd/seed-daemon')
  const keystoreDir = join(dataDir, 'keys')

  const goBinary = findExecutable('go')
  console.log(`[test] Go binary: ${goBinary}`)

  const daemon = spawn(
    '/bin/sh',
    [
      '-c',
      `cd "${daemonPath}" && "${goBinary}" run . -data-dir="${dataDir}" -keystore-dir="${keystoreDir}" -http.port=${httpPort} -grpc.port=${grpcPort} -p2p.port=${p2pPort} -log-level=warn`,
    ],
    {
      env: {
        ...process.env,
        SEED_P2P_TESTNET_NAME: testnetName,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  const daemonUrl = `http://localhost:${httpPort}`

  daemon.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      console.log(`[daemon:stdout] ${line}`)
    }
  })

  daemon.stderr?.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      console.log(`[daemon:stderr] ${line}`)
    }
  })

  daemon.on('exit', (code, signal) => {
    console.log(`[daemon] Process exited with code ${code}, signal ${signal}`)
  })

  daemon.on('error', (err) => {
    console.log(`[daemon] Process error: ${err.message}`)
  })

  try {
    await waitForDaemon(daemonUrl)
    console.log(`[test] Daemon ready at ${daemonUrl}`)
  } catch (error) {
    daemon.kill()
    rmSync(dataDir, {recursive: true, force: true})
    throw error
  }

  const cleanup = async () => {
    console.log('[test] Cleaning up fixture test...')
    if (daemon && !daemon.killed) {
      daemon.kill('SIGTERM')
      await sleep(1000)
      if (!daemon.killed) {
        daemon.kill('SIGKILL')
      }
    }
    if (existsSync(dataDir)) {
      rmSync(dataDir, {recursive: true, force: true})
    }
    console.log('[test] Cleanup complete')
  }

  return {
    testnetName,
    daemonUrl,
    dataDir,
    daemon,
    cleanup,
  }
}

/**
 * Run CLI command and capture output
 */
export async function runCli(
  args: string[],
  options: {server?: string; env?: Record<string, string>} = {}
): Promise<{stdout: string; stderr: string; exitCode: number}> {
  return new Promise((resolve) => {
    // Find CLI directory
    let cliDir = process.cwd()
    if (!existsSync(join(cliDir, 'src/index.ts'))) {
      // Try to find it relative to this file
      cliDir = join(__dirname, '../..')
    }
    const cliPath = join(cliDir, 'src/index.ts')
    const serverArgs = options.server ? ['--server', options.server] : []

    const proc = spawn('bun', ['run', cliPath, ...serverArgs, ...args], {
      cwd: cliDir,
      env: {...process.env, ...options.env},
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      resolve({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code || 0,
      })
    })
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Wait for web server to be ready by polling the root
 */
async function waitForWebServer(url: string, timeoutMs = 60000): Promise<void> {
  const start = Date.now()
  let lastError: Error | null = null

  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 404) {
        // Server is responding
        return
      }
      lastError = new Error(`HTTP ${res.status}`)
    } catch (e) {
      lastError = e as Error
    }
    await sleep(1000)
  }

  throw new Error(`Web server failed to start within ${timeoutMs}ms. Last error: ${lastError?.message}`)
}

/**
 * Start daemon with fixture data AND web server for full integration testing
 */
export async function startFullIntegrationWithFixture(config: TestConfig = {}): Promise<FullTestContext> {
  const testnetName = 'fixture'
  const basePort = getRandomPort()
  const httpPort = config.httpPort || basePort
  const grpcPort = config.grpcPort || basePort + 1
  const p2pPort = config.p2pPort || basePort + 2
  const webServerPort = basePort + 3

  const repoRoot = findRepoRoot()
  const fixtureSource = join(repoRoot, 'test-fixtures/desktop/daemon')

  if (!existsSync(fixtureSource)) {
    throw new Error(`Fixture not found: ${fixtureSource}`)
  }

  // Copy fixture to temp directory
  const dataDir = mkdtempSync(join(tmpdir(), 'seed-cli-fixture-'))
  cpSync(fixtureSource, dataDir, {recursive: true})

  console.log(`[test] Starting full integration with fixture data`)
  console.log(`[test] Data dir: ${dataDir}`)
  console.log(`[test] Ports: http=${httpPort}, grpc=${grpcPort}, p2p=${p2pPort}, web=${webServerPort}`)

  const daemonPath = join(repoRoot, 'backend/cmd/seed-daemon')
  const keystoreDir = join(dataDir, 'keys')

  const goBinary = findExecutable('go')
  console.log(`[test] Go binary: ${goBinary}`)

  // Start daemon
  const daemon = spawn(
    '/bin/sh',
    [
      '-c',
      `cd "${daemonPath}" && "${goBinary}" run . -data-dir="${dataDir}" -keystore-dir="${keystoreDir}" -http.port=${httpPort} -grpc.port=${grpcPort} -p2p.port=${p2pPort} -log-level=warn`,
    ],
    {
      env: {
        ...process.env,
        SEED_P2P_TESTNET_NAME: testnetName,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  const daemonUrl = `http://localhost:${httpPort}`

  daemon.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      console.log(`[daemon:stdout] ${line}`)
    }
  })

  daemon.stderr?.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      console.log(`[daemon:stderr] ${line}`)
    }
  })

  daemon.on('exit', (code, signal) => {
    console.log(`[daemon] Process exited with code ${code}, signal ${signal}`)
  })

  daemon.on('error', (err) => {
    console.log(`[daemon] Process error: ${err.message}`)
  })

  try {
    await waitForDaemon(daemonUrl)
    console.log(`[test] Daemon ready at ${daemonUrl}`)
  } catch (error) {
    daemon.kill()
    rmSync(dataDir, {recursive: true, force: true})
    throw error
  }

  // Start web server
  const webPath = join(repoRoot, 'frontend/apps/web')
  const webServerUrl = `http://localhost:${webServerPort}`

  console.log(`[test] Starting web server at ${webServerUrl}`)

  // Create config.json in web app directory for testing (if it doesn't exist)
  const webConfigPath = join(webPath, 'config.json')
  const hadConfig = existsSync(webConfigPath)
  if (!hadConfig) {
    writeFileSync(webConfigPath, JSON.stringify({}))
    console.log(`[test] Created temporary config.json at ${webConfigPath}`)
  }

  // Find pnpm in mise installs or use npx as fallback
  let pnpmBinary = findExecutable('pnpm')
  if (!pnpmBinary || pnpmBinary === 'pnpm') {
    // Check mise installs
    const misePnpm = join(process.env.HOME || '', '.local/share/mise/installs/pnpm/9.15.0/pnpm')
    if (existsSync(misePnpm)) {
      pnpmBinary = misePnpm
    }
  }
  console.log(`[test] pnpm binary: ${pnpmBinary}`)

  const webServer = spawn(
    '/bin/sh',
    [
      '-c',
      `cd "${webPath}" && "${pnpmBinary}" remix vite:dev --port ${webServerPort}`,
    ],
    {
      env: {
        ...process.env,
        DAEMON_HTTP_URL: `http://localhost:${httpPort}`,
        DAEMON_HTTP_PORT: String(httpPort),
        DAEMON_FILE_URL: `http://localhost:${httpPort}/ipfs`,
        NODE_ENV: 'development',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  )

  webServer.stdout?.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      console.log(`[web:stdout] ${line}`)
    }
  })

  webServer.stderr?.on('data', (data) => {
    const lines = data.toString().split('\n').filter(Boolean)
    for (const line of lines) {
      console.log(`[web:stderr] ${line}`)
    }
  })

  webServer.on('exit', (code, signal) => {
    console.log(`[web] Process exited with code ${code}, signal ${signal}`)
  })

  webServer.on('error', (err) => {
    console.log(`[web] Process error: ${err.message}`)
  })

  try {
    await waitForWebServer(webServerUrl)
    console.log(`[test] Web server ready at ${webServerUrl}`)
  } catch (error) {
    daemon.kill()
    webServer.kill()
    rmSync(dataDir, {recursive: true, force: true})
    throw error
  }

  const cleanup = async () => {
    console.log('[test] Cleaning up full integration test...')
    if (webServer && !webServer.killed) {
      webServer.kill('SIGTERM')
      await sleep(500)
      if (!webServer.killed) {
        webServer.kill('SIGKILL')
      }
    }
    if (daemon && !daemon.killed) {
      daemon.kill('SIGTERM')
      await sleep(1000)
      if (!daemon.killed) {
        daemon.kill('SIGKILL')
      }
    }
    if (existsSync(dataDir)) {
      rmSync(dataDir, {recursive: true, force: true})
    }
    // Remove config.json if we created it
    if (!hadConfig && existsSync(webConfigPath)) {
      rmSync(webConfigPath)
      console.log(`[test] Removed temporary config.json`)
    }
    console.log('[test] Cleanup complete')
  }

  return {
    testnetName,
    daemonUrl,
    dataDir,
    daemon,
    webServerUrl,
    webServer,
    cleanup,
  }
}
