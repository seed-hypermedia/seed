/**
 * Script to run the daemon and register a key with a deterministic BIP39 mnemonic.
 * This will output the account ID for the given mnemonic.
 */

import {createGrpcWebTransport} from '@connectrpc/connect-node'
import {createPromiseClient} from '@connectrpc/connect'
import DaemonModule from '../frontend/packages/shared/src/client/.generated/daemon/v1alpha/daemon_connect'
import * as bip39 from 'bip39'
import * as path from 'path'
import {spawnDaemon, DaemonConfig} from './integration/daemon'
import {fileURLToPath} from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const {Daemon} = DaemonModule

// Deterministic mnemonic for testing - DO NOT CHANGE
// This mnemonic generates the expected account ID used in tests
const TEST_MNEMONIC = "parrot midnight lion defense ski senior trouble slice chase spot history awkward"
const EXPECTED_ACCOUNT_ID = "z6Mkm3c7LJn7vJ7XZQZHKNufnG6v9mCsVwLoG6v8ngY7aXq8"

async function main() {
  console.log('=== Register Key Script ===')
  console.log(`Using mnemonic: ${TEST_MNEMONIC}`)
  console.log('')

  // Set up daemon with test ports
  const daemonConfig: DaemonConfig = {
    httpPort: 59101,
    grpcPort: 59102,
    p2pPort: 59103,
    dataDir: path.join(__dirname, '../test-fixtures/register-key-test'),
  }

  console.log('Starting daemon...')
  const daemon = await spawnDaemon(daemonConfig)

  try {
    await daemon.waitForReady()
    console.log('Daemon ready!')

    // Create gRPC client
    const transport = createGrpcWebTransport({
      baseUrl: `http://localhost:${daemonConfig.httpPort}`,
      httpVersion: '1.1',
    })
    const daemonClient = createPromiseClient(Daemon, transport)

    // Register the key
    console.log('\nRegistering key with mnemonic...')
    const mnemonicWords = TEST_MNEMONIC.split(' ')

    const result = await daemonClient.registerKey({
      mnemonic: mnemonicWords,
      passphrase: '',
      name: `test-key-${Date.now()}`,
    })

    console.log('\n=== SUCCESS ===')
    console.log('Account ID:', result.accountId)
    console.log('Public Key:', result.publicKey)
    console.log('Key Name:', result.name)

    // Verify deterministic account ID
    if (result.accountId === EXPECTED_ACCOUNT_ID) {
      console.log('\n✅ Account ID matches expected value!')
    } else {
      console.error('\n❌ Account ID does NOT match expected value!')
      console.error(`Expected: ${EXPECTED_ACCOUNT_ID}`)
      console.error(`Got: ${result.accountId}`)
      throw new Error('Account ID mismatch')
    }

  } catch (error) {
    console.error('Error registering key:', error)
    throw error
  } finally {
    console.log('\nCleaning up...')
    await daemon.kill()
  }
}

main().catch((error) => {
  console.error('Script failed:', error)
  process.exit(1)
})
