/**
 * Integration test for registerKey with deterministic mnemonic
 */

import {describe, it, expect, beforeAll, afterAll} from 'vitest'
import {createGrpcWebTransport} from '@connectrpc/connect-node'
import {createPromiseClient} from '@connectrpc/connect'
import {Daemon} from '../frontend/packages/shared/src/client'
import {spawnDaemon, DaemonConfig} from './integration/daemon'
import * as path from 'path'
import {fileURLToPath} from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Deterministic mnemonic for testing - DO NOT CHANGE
// This mnemonic generates the expected account ID
const TEST_MNEMONIC = "parrot midnight lion defense ski senior trouble slice chase spot history awkward"
const EXPECTED_ACCOUNT_ID = "z6Mkm3c7LJn7vJ7XZQZHKNufnG6v9mCsVwLoG6v8ngY7aXq8"

describe('registerKey integration test', () => {
  let daemon: Awaited<ReturnType<typeof spawnDaemon>>
  let daemonClient: ReturnType<typeof createPromiseClient<typeof Daemon>>

  beforeAll(async () => {
    // Set up daemon with test ports
    const daemonConfig: DaemonConfig = {
      httpPort: 59201,
      grpcPort: 59202,
      p2pPort: 59203,
      dataDir: path.join(__dirname, '../test-fixtures/register-key-integration-test'),
    }

    console.log('Starting daemon for integration test...')
    daemon = await spawnDaemon(daemonConfig)
    await daemon.waitForReady()

    // Create gRPC client
    const transport = createGrpcWebTransport({
      baseUrl: `http://localhost:${daemonConfig.httpPort}`,
      httpVersion: '1.1',
    })
    daemonClient = createPromiseClient(Daemon, transport)
  }, 60000)

  afterAll(async () => {
    if (daemon) {
      await daemon.kill()
    }
  })

  it('should deterministically generate account ID from mnemonic', async () => {
    const mnemonicWords = TEST_MNEMONIC.split(' ')

    const result = await daemonClient.registerKey({
      mnemonic: mnemonicWords,
      passphrase: '',
      name: `test-key-${Date.now()}`,
    })

    expect(result.accountId).toBe(EXPECTED_ACCOUNT_ID)
    expect(result.publicKey).toBe(EXPECTED_ACCOUNT_ID)
    expect(result.name).toMatch(/^test-key-\d+$/)
  })
})
