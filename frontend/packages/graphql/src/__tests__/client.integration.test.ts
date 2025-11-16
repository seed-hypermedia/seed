/**
 * Integration Tests for GraphQL Client
 *
 * Tests the GraphQL client against the real GraphQL server by spawning a daemon
 * and creating a test Yoga server.
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {spawn, type ChildProcess, execSync} from 'child_process'
import {mkdirSync, rmSync, cpSync} from 'fs'
import {join} from 'path'
import * as readline from 'node:readline'
import {createGraphQLClient} from '../client'
import {HELLO_QUERY, GET_RESOURCE_QUERY} from '../queries'
import {createServer, type Server} from 'http'
import {createYoga} from 'graphql-yoga'
import {tmpdir} from 'os'
import {createGrpcWebTransport} from '@connectrpc/connect-node'
import {createGRPCClient} from '@shm/shared/grpc-client'

// Test configuration
const REPO_ROOT = join(process.cwd(), '../../..')
const TEST_FIXTURES_DIR = join(REPO_ROOT, 'test-fixtures/daemon')
const TEST_RUNTIME_DIR = join(tmpdir(), `seed-graphql-client-test-${Date.now()}`)
const DAEMON_CODE_PATH = join(REPO_ROOT, 'backend/cmd/seed-daemon')
const DAEMON_HTTP_PORT = 59101
const DAEMON_GRPC_PORT = 59102
const DAEMON_P2P_PORT = 59100
const DAEMON_STARTUP_TIMEOUT = 15000
const GRAPHQL_SERVER_PORT = 59103 // Separate port for GraphQL test server

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

/**
 * Wait for HTTP endpoint to be ready
 */
async function waitForHTTPEndpoint(
  port: number,
  timeout: number,
): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeout) {
    try {
      const response = await fetch(`http://localhost:${port}/debug/version`)
      if (response.ok) {
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
  let graphqlServer: Server | null = null
  let client: ReturnType<typeof createGraphQLClient>

  beforeAll(async () => {
    // Kill any processes using test ports
    await killProcessesOnPorts([
      DAEMON_HTTP_PORT,
      DAEMON_GRPC_PORT,
      DAEMON_P2P_PORT,
      GRAPHQL_SERVER_PORT,
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
        '-lndhub.mainnet=false',
      ],
      {
        stdio: 'pipe',
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          SEED_P2P_TESTNET_NAME: 'test',
        },
      },
    )

    let lastOutput = ''

    // Capture output for error reporting
    if (daemonProcess.stderr) {
      const rl = readline.createInterface({
        input: daemonProcess.stderr,
        crlfDelay: Infinity,
      })
      rl.on('line', (line) => {
        lastOutput = line
      })
    }

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

    // Create gRPC client connected to test daemon
    const testTransport = createGrpcWebTransport({
      baseUrl: `http://localhost:${DAEMON_HTTP_PORT}`,
      httpVersion: '1.1',
    })
    const testGrpcClient = createGRPCClient(testTransport)

    // Import and create the real GraphQL schema from web app
    const {createSchema} = await import(
      '../../../../apps/web/app/graphql/schema.ts'
    )
    const testSchema = createSchema(testGrpcClient)

    // Create Yoga server with real schema
    const yoga = createYoga({
      schema: testSchema,
      landingPage: false,
      maskedErrors: false, // Show real errors in tests
    })

    // Create HTTP server for GraphQL
    graphqlServer = createServer(yoga)
    await new Promise<void>((resolve) => {
      graphqlServer!.listen(GRAPHQL_SERVER_PORT, resolve)
    })

    // Create GraphQL client pointing to test server
    client = createGraphQLClient({
      url: `http://localhost:${GRAPHQL_SERVER_PORT}/graphql`,
    })
  }, 30000) // 30 second timeout for beforeAll

  afterAll(async () => {
    // Clean up GraphQL server
    if (graphqlServer) {
      await new Promise<void>((resolve) => {
        graphqlServer!.close(resolve)
      })
    }

    // Clean up daemon
    if (daemonProcess) {
      daemonProcess.kill('SIGTERM')

      await new Promise<void>((resolve) => {
        if (!daemonProcess) {
          resolve()
          return
        }
        daemonProcess.on('exit', resolve)
        // Force kill after 5 seconds
        setTimeout(() => {
          if (daemonProcess && !daemonProcess.killed) {
            daemonProcess.kill('SIGKILL')
            resolve()
          }
        }, 5000)
      })
    }

    // Clean up temporary runtime directory
    try {
      rmSync(TEST_RUNTIME_DIR, {recursive: true, force: true})
    } catch (e) {
      console.error('Failed to clean up test runtime directory:', e)
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

  it('should fetch resource from fixtures using GraphQL client', async () => {
    // Test with basic query to verify client can fetch from real daemon
    const query = `
      query GetResource($iri: String!) {
        getResource(iri: $iri) {
          __typename
          iri
          version
          ... on Document {
            account
            path
            name
          }
        }
      }
    `

    const result = await client
      .query(
        query,
        {
          iri: 'hm://z6MkkBQP6c9TQ5JsYJNyemvg1dU3s3AwprWRm8DZHL9VabQY?v=bafy2bzacebpoy5vqrat3jle4yktdueoxokr7ks5gn7tpzfhzox2t4vdlq6hwm',
        },
        {requestPolicy: 'network-only'},
      )
      .toPromise()

    expect(result.error).toBeUndefined()
    expect(result.data?.getResource).toBeDefined()
    expect(result.data?.getResource.iri).toBe(
      'hm://z6MkkBQP6c9TQ5JsYJNyemvg1dU3s3AwprWRm8DZHL9VabQY?v=bafy2bzacebpoy5vqrat3jle4yktdueoxokr7ks5gn7tpzfhzox2t4vdlq6hwm',
    )
    expect(result.data?.getResource.__typename).toBe('Document')
    expect(result.data?.getResource.version).toBeDefined()
  })
})
