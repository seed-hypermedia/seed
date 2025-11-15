/**
 * Integration Tests for GraphQL Client
 *
 * Tests the GraphQL client against the real GraphQL server by spawning a daemon.
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {spawn, type ChildProcess} from 'child_process'
import {mkdirSync, rmSync} from 'fs'
import {join} from 'path'
import * as readline from 'node:readline'
import {createGraphQLClient} from '../client'
import {HELLO_QUERY} from '../queries'

// Test configuration
const REPO_ROOT = join(process.cwd(), '../../..')
const TEST_DB_DIR = join(REPO_ROOT, 'test-db', 'graphql-client')
const DAEMON_CODE_PATH = join(REPO_ROOT, 'backend/cmd/seed-daemon')
const DAEMON_HTTP_PORT = 59101
const DAEMON_GRPC_PORT = 59102
const DAEMON_P2P_PORT = 59100
const DAEMON_STARTUP_TIMEOUT = 15000

/**
 * Wait for HTTP endpoint to be ready
 */
async function waitForHTTPEndpoint(
  port: number,
  timeout: number,
): Promise<void> {
  const startTime = Date.now()

  console.log(`Waiting for HTTP endpoint on port ${port}...`)

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(
        `http://localhost:${port}/api/v1/daemon/info`,
      )
      if (response.ok) {
        console.log('✓ HTTP endpoint ready')
        return
      }
    } catch (e) {
      // Not ready yet, continue waiting
    }

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error(`HTTP endpoint not ready within ${timeout}ms`)
}

describe('GraphQL Client Integration Tests', () => {
  let daemonProcess: ChildProcess | null = null
  let client: ReturnType<typeof createGraphQLClient>

  beforeAll(async () => {
    // Clean and create test database directory
    console.log('Test DB dir:', TEST_DB_DIR)
    try {
      rmSync(TEST_DB_DIR, {recursive: true, force: true})
    } catch (e) {
      // Ignore if doesn't exist
    }
    mkdirSync(TEST_DB_DIR, {recursive: true})

    // Spawn daemon process with correct flags
    console.log('Starting daemon from', DAEMON_CODE_PATH)
    daemonProcess = spawn(
      'go',
      [
        'run',
        DAEMON_CODE_PATH,
        '-data-dir',
        TEST_DB_DIR,
        '-http.port',
        DAEMON_HTTP_PORT.toString(),
        '-grpc.port',
        DAEMON_GRPC_PORT.toString(),
        '-p2p.port',
        DAEMON_P2P_PORT.toString(),
        '-log-level=error', // Reduce noise
        '-lndhub.mainnet=false',
      ],
      {
        env: {
          ...process.env,
          SEED_P2P_TESTNET_NAME: 'test',
        },
      },
    )

    let lastOutput = ''

    // Capture stderr for debugging
    if (daemonProcess.stderr) {
      const rl = readline.createInterface({
        input: daemonProcess.stderr,
        crlfDelay: Infinity,
      })

      rl.on('line', (line) => {
        lastOutput = line
        if (line.includes('DaemonStarted')) {
          console.log('✓ Daemon started')
        }
      })
    }

    // Handle daemon errors
    daemonProcess.on('error', (error) => {
      console.error('Daemon error:', error)
    })

    daemonProcess.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`Daemon exited with code ${code}`)
        if (lastOutput) {
          console.error('Last output:', lastOutput)
        }
      }
    })

    // Wait for daemon to be ready
    await waitForHTTPEndpoint(DAEMON_HTTP_PORT, DAEMON_STARTUP_TIMEOUT)

    // Wait a bit more for GraphQL endpoint
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Create GraphQL client
    client = createGraphQLClient({
      url: `http://localhost:${DAEMON_HTTP_PORT}/hm/api/graphql`,
    })
  }, 30000) // 30 second timeout for beforeAll

  afterAll(async () => {
    // Clean up daemon
    if (daemonProcess) {
      console.log('Stopping daemon...')
      daemonProcess.kill('SIGTERM')

      await new Promise<void>((resolve) => {
        if (!daemonProcess) {
          resolve()
          return
        }
        daemonProcess.on('exit', () => {
          console.log('✓ Daemon stopped')
          resolve()
        })
        // Force kill after 5 seconds
        setTimeout(() => {
          if (daemonProcess && !daemonProcess.killed) {
            daemonProcess.kill('SIGKILL')
            resolve()
          }
        }, 5000)
      })
    }

    // Clean up test database
    try {
      rmSync(TEST_DB_DIR, {recursive: true, force: true})
    } catch (e) {
      console.error('Failed to clean up test database:', e)
    }
  })

  it('should connect to GraphQL server and execute hello query', async () => {
    const result = await client.query(HELLO_QUERY, {}).toPromise()

    expect(result.error).toBeUndefined()
    expect(result.data?.hello).toBe('Hello from Seed GraphQL API')
  })

  it('should handle cache-first request policy', async () => {
    // First query - network only
    const result1 = await client
      .query(HELLO_QUERY, {}, {requestPolicy: 'network-only'})
      .toPromise()

    expect(result1.error).toBeUndefined()
    expect(result1.data?.hello).toBe('Hello from Seed GraphQL API')

    // Second query - cache first (should use cached result)
    const result2 = await client
      .query(HELLO_QUERY, {}, {requestPolicy: 'cache-first'})
      .toPromise()

    expect(result2.error).toBeUndefined()
    expect(result2.data).toEqual(result1.data)
  })
})
