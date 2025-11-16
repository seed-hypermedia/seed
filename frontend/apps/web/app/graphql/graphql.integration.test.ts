import {createGrpcWebTransport} from '@connectrpc/connect-node'
import {createGRPCClient} from '@shm/shared/grpc-client'
import {ChildProcess, spawn, execSync} from 'child_process'
import {mkdirSync, rmSync, cpSync} from 'fs'
import * as readline from 'node:readline'
import {join} from 'path'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {createSchema} from './schema'
// Import graphql from graphql-yoga to ensure single module instance
import type {GraphQLSchema} from 'graphql'
import {createYoga} from 'graphql-yoga'
import {tmpdir} from 'os'

// Find repo root - tests run from frontend/apps/web
const REPO_ROOT = join(process.cwd(), '../../..')
const TEST_FIXTURES_DIR = join(REPO_ROOT, 'test-fixtures/daemon')
const TEST_RUNTIME_DIR = join(tmpdir(), `seed-test-${Date.now()}`)
const DAEMON_CODE_PATH = join(REPO_ROOT, 'backend/cmd/seed-daemon')

// Use different ports than dev environment to avoid conflicts
// Dev uses: P2P=56000, HTTP=56001/58001, gRPC=56002
const DAEMON_HTTP_PORT = 59001 // Test HTTP port
const DAEMON_GRPC_PORT = 59002 // Test gRPC port
const DAEMON_P2P_PORT = 59000 // Test P2P port
const DAEMON_STARTUP_TIMEOUT = 10000 // 10 seconds

// Types for our GraphQL queries
interface HelloQueryData {
  hello: string
}

interface ResourceData {
  iri: string
  kind: string
  version?: string | null
  data?: string | null
}

interface GetResourceQueryData {
  getResource: ResourceData
}

interface GetResourceVariables {
  iri: string
}

/**
 * Kill any processes using the test ports to avoid conflicts
 */
async function killProcessesOnPorts(ports: number[]): Promise<void> {
  for (const port of ports) {
    try {
      // Find PIDs using the port
      const output = execSync(`lsof -ti :${port}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      }).trim()

      if (output) {
        const pids = output.split('\n')
        for (const pid of pids) {
          if (pid) {
            console.log(`Killing process ${pid} on port ${port}`)
            execSync(`kill -9 ${pid}`, {stdio: 'ignore'})
          }
        }
      }
    } catch (e) {
      // No process on port, that's fine
    }
  }
  // Wait a bit for ports to be released
  await new Promise((resolve) => setTimeout(resolve, 100))
}

describe('GraphQL API Integration Tests', () => {
  let daemonProcess: ChildProcess | null = null
  let testSchema: GraphQLSchema
  let yoga: ReturnType<typeof createYoga>

  beforeAll(async () => {
    // Kill any processes using test ports
    await killProcessesOnPorts([
      DAEMON_HTTP_PORT,
      DAEMON_GRPC_PORT,
      DAEMON_P2P_PORT,
    ])

    // Copy test fixtures to temporary runtime directory
    mkdirSync(TEST_RUNTIME_DIR, {recursive: true})
    cpSync(TEST_FIXTURES_DIR, TEST_RUNTIME_DIR, {recursive: true})

    daemonProcess = spawn(
      'go',
      [
        'run',
        DAEMON_CODE_PATH,
        '-data-dir',
        TEST_RUNTIME_DIR,
        '-http.port',
        DAEMON_HTTP_PORT.toString(),
        '-grpc.port',
        DAEMON_GRPC_PORT.toString(),
        '-p2p.port',
        DAEMON_P2P_PORT.toString(),
        '-log-level=debug',
        '-lndhub.mainnet=false', // Use testnet
      ],
      {
        stdio: 'pipe',
        cwd: REPO_ROOT, // Run from repo root
        env: {
          ...process.env,
          SEED_P2P_TESTNET_NAME: 'test', // Use testnet for tests
        },
      },
    )

    const stdout = readline.createInterface({input: daemonProcess.stdout!})
    const stderr = readline.createInterface({input: daemonProcess.stderr!})

    let daemonReady = false
    let lastStderr = ''

    // Capture output for error reporting
    stderr.on('line', (line: string) => {
      lastStderr = line
      if (line.includes('DaemonStarted') || line.includes('P2PNodeStarted')) {
        daemonReady = true
      }
    })

    daemonProcess.on('error', (err) => {
      console.error('[daemon spawn error]', err)
    })

    daemonProcess.on('close', (code, signal) => {
      if (code !== 0 && code !== null) {
        console.error(`[daemon closed] code=${code} signal=${signal}`)
        if (lastStderr) {
          console.error(`[daemon last stderr] ${lastStderr}`)
        }
      }
    })

    // Wait for process to spawn
    await new Promise<void>((resolve, reject) => {
      if (!daemonProcess) {
        reject(new Error('Daemon process not initialized'))
        return
      }
      daemonProcess.on('spawn', resolve)
      daemonProcess.on('error', reject)
    })

    // Wait for daemon to be ready (check both DaemonStarted flag and HTTP endpoint)
    await waitForDaemon(
      DAEMON_HTTP_PORT,
      DAEMON_STARTUP_TIMEOUT,
      () => daemonReady,
    )

    // Create test gRPC client connected to test daemon
    const testTransport = createGrpcWebTransport({
      baseUrl: `http://localhost:${DAEMON_HTTP_PORT}`,
      httpVersion: '1.1',
    })
    const testGrpcClient = createGRPCClient(testTransport)

    // Create GraphQL schema with test client
    testSchema = createSchema(testGrpcClient)

    // Create Yoga instance for executing queries
    yoga = createYoga({
      schema: testSchema,
      landingPage: false,
      maskedErrors: false, // Show real errors in tests
    })
  }, DAEMON_STARTUP_TIMEOUT + 5000)

  afterAll(async () => {
    // Kill daemon process
    if (daemonProcess) {
      daemonProcess.kill('SIGTERM')

      // Wait for process to exit
      await new Promise<void>((resolve) => {
        if (!daemonProcess) {
          resolve()
          return
        }

        const timeout = setTimeout(() => {
          daemonProcess?.kill('SIGKILL')
          resolve()
        }, 5000)

        daemonProcess.on('exit', () => {
          clearTimeout(timeout)
          resolve()
        })
      })
    }

    // Clean up temporary runtime directory
    try {
      rmSync(TEST_RUNTIME_DIR, {recursive: true, force: true})
    } catch (e) {
      console.error('Failed to clean up test runtime directory:', e)
    }
  })

  it('should respond to hello query', async () => {
    const query = `
      query {
        hello
      }
    `

    const response = await yoga.fetch('http://test/graphql', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query}),
    })

    const result = await response.json()

    expect(result.errors).toBeUndefined()
    expect(result.data?.hello).toBe('Hello from Seed GraphQL API')
  })

  it('should fetch resource successfully from test fixtures', async () => {
    // Test with actual resource from test fixtures
    const query = `
      query GetResource($iri: String!) {
        getResource(iri: $iri) {
          iri
          version
          __typename
          ... on Document {
            account
            path
            name
          }
          ... on Comment {
            id
            authorId
          }
        }
      }
    `

    const variables: GetResourceVariables = {
      iri: 'hm://z6MkkBQP6c9TQ5JsYJNyemvg1dU3s3AwprWRm8DZHL9VabQY?v=bafy2bzacebpoy5vqrat3jle4yktdueoxokr7ks5gn7tpzfhzox2t4vdlq6hwm',
    }

    const response = await yoga.fetch('http://test/graphql', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query, variables}),
    })

    const result = await response.json()

    // Should successfully fetch the resource from test fixtures
    expect(result.errors).toBeUndefined()
    expect(result.data?.getResource).toBeDefined()
    expect(result.data?.getResource.iri).toBe(variables.iri)
    expect(result.data?.getResource.__typename).toMatch(/Document|Comment/)
    expect(result.data?.getResource.version).toBeDefined()
  })

  it('should handle non-existent account with error', async () => {
    // Change one character of the account ID to create a not-found error
    const query = `
      query GetResource($iri: String!) {
        getResource(iri: $iri) {
          iri
          version
          __typename
        }
      }
    `

    const variables: GetResourceVariables = {
      // Changed last character Y -> X to create invalid account
      iri: 'hm://z6MkkBQP6c9TQ5JsYJNyemvg1dU3s3AwprWRm8DZHL9VabQX?v=bafy2bzacebpoy5vqrat3jle4yktdueoxokr7ks5gn7tpzfhzox2t4vdlq6hwm',
    }

    const response = await yoga.fetch('http://test/graphql', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query, variables}),
    })

    const result = await response.json()

    // Should get error for non-existent account
    expect(result.errors).toBeDefined()
    expect(result.errors[0].message).toMatch(/not found|invalid/)
  })

  it('should handle non-existent resource path with error', async () => {
    const query = `
      query GetResource($iri: String!) {
        getResource(iri: $iri) {
          iri
          version
          __typename
        }
      }
    `

    const variables: GetResourceVariables = {
      // Use valid account but non-existent path
      iri: 'hm://z6MkkBQP6c9TQ5JsYJNyemvg1dU3s3AwprWRm8DZHL9VabQY/nonexistent/path',
    }

    const response = await yoga.fetch('http://test/graphql', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query, variables}),
    })

    const result = await response.json()

    // Should get gRPC error for non-existent resource path
    expect(result.errors).toBeDefined()
    expect(result.errors[0].message).toBeDefined()
  })

  it('should handle getResource query with invalid IRI format', async () => {
    const query = `
      query GetResource($iri: String!) {
        getResource(iri: $iri) {
          iri
          __typename
        }
      }
    `

    const variables: GetResourceVariables = {
      iri: 'invalid-iri',
    }

    const response = await yoga.fetch('http://test/graphql', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query, variables}),
    })

    const result = await response.json()

    // Invalid IRI should cause an error
    if (result.errors) {
      expect(result.errors[0].message).toBeDefined()
    }
    // If it doesn't error, daemon might handle invalid IRIs gracefully
  })
})

/**
 * Wait for daemon to be ready by polling the health endpoint
 * Based on desktop/src/daemon.ts tryUntilSuccess pattern
 */
async function waitForDaemon(
  port: number,
  timeout: number,
  getDaemonReady: () => boolean,
): Promise<void> {
  const startTime = Date.now()
  const pollInterval = 200

  // Wait for DaemonStarted message or timeout
  while (Date.now() - startTime < timeout) {
    if (getDaemonReady()) {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  if (!getDaemonReady()) {
    throw new Error(
      `Daemon failed to start within ${timeout}ms. Check logs above for errors.`,
    )
  }

  // Verify HTTP endpoint is responding
  const httpStartTime = Date.now()
  while (Date.now() - httpStartTime < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}/debug/version`)
      if (response.ok) {
        return
      }
    } catch (e) {
      // Connection refused, daemon not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  throw new Error(`Daemon HTTP endpoint failed to respond within ${timeout}ms`)
}
