/**
 * Cross-platform OS keyring access.
 *
 * Shares the same keyring namespace and format as the Go daemon
 * (seed-daemon-<environment>). Keys are stored as a JSON map of
 * name -> base64-encoded libp2p protobuf private key bytes.
 *
 * Linux: uses `secret-tool` (libsecret / D-Bus Secret Service).
 * macOS: uses `security` (Keychain).
 */

import {execSync} from 'child_process'
import {platform} from 'os'
import {base58btc} from 'multiformats/bases/base58'
import * as ed25519 from '@noble/ed25519'

const KEYRING_ACCOUNT = 'parentCollection'

// Libp2p Ed25519 private key protobuf header:
// field 1 (key type) = 1 (Ed25519), field 2 (key data) = 64 bytes.
const LIBP2P_ED25519_HEADER = new Uint8Array([0x08, 0x01, 0x12, 0x40])

// Ed25519 multicodec prefix (varint-encoded 0xed = [0xed, 0x01]).
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01])

export type KeyringKey = {
  name: string
  privateKey: Uint8Array
  publicKey: Uint8Array
  publicKeyWithPrefix: Uint8Array
  accountId: string
}

export type KeyringKeyInfo = {
  name: string
  accountId: string
}

/**
 * Returns the keyring service name for the given environment.
 */
export function getServiceName(dev: boolean): string {
  return dev ? 'seed-daemon-dev' : 'seed-daemon-main'
}

/**
 * Reads the raw JSON string from the OS keyring.
 */
function readKeyringRaw(serviceName: string): string | null {
  const os = platform()

  try {
    if (os === 'linux') {
      const result = execSync(
        `secret-tool lookup service ${esc(serviceName)} username ${esc(
          KEYRING_ACCOUNT,
        )}`,
        {encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']},
      )
      return result.trim()
    }

    if (os === 'darwin') {
      const result = execSync(
        `security find-generic-password -s ${esc(serviceName)} -a ${esc(
          KEYRING_ACCOUNT,
        )} -w`,
        {encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']},
      )
      return result.trim()
    }

    throw new Error(
      `Unsupported platform: ${os}. Only linux and darwin are supported.`,
    )
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (
      msg.includes('not found') ||
      msg.includes('No matching') ||
      msg.includes('could not be found') ||
      msg.includes('SecKeychainSearchCopyNext') ||
      msg.includes('The specified item could not be found') ||
      msg.includes('status 1')
    ) {
      return null
    }
    throw err
  }
}

/**
 * Writes the raw JSON string to the OS keyring.
 */
function writeKeyringRaw(serviceName: string, value: string): void {
  const os = platform()

  if (os === 'linux') {
    const label = `Password for '${KEYRING_ACCOUNT}' on '${serviceName}'`
    execSync(
      `secret-tool store --label ${esc(label)} service ${esc(
        serviceName,
      )} username ${esc(KEYRING_ACCOUNT)}`,
      {input: value, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']},
    )
    return
  }

  if (os === 'darwin') {
    execSync(
      `security add-generic-password -U -s ${esc(serviceName)} -a ${esc(
        KEYRING_ACCOUNT,
      )} -w ${esc(value)}`,
      {encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe']},
    )
    return
  }

  throw new Error(
    `Unsupported platform: ${os}. Only linux and darwin are supported.`,
  )
}

/**
 * Reads the key collection from the OS keyring.
 */
function readCollection(serviceName: string): Record<string, string> {
  const raw = readKeyringRaw(serviceName)
  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch {
    throw new Error(
      'Failed to parse keyring data. The keyring entry may be corrupted.',
    )
  }
}

/**
 * Writes the key collection to the OS keyring.
 */
function writeCollection(
  serviceName: string,
  collection: Record<string, string>,
): void {
  writeKeyringRaw(serviceName, JSON.stringify(collection))
}

/**
 * Decodes a libp2p-encoded Ed25519 private key.
 * Format: 4-byte protobuf header (08 01 12 40) + 32-byte seed + 32-byte pubkey.
 */
function decodeLibp2pKey(base64Data: string): {
  privateKey: Uint8Array
  publicKey: Uint8Array
} {
  const raw = Buffer.from(base64Data, 'base64')

  if (raw.length !== 68) {
    throw new Error(
      `Unexpected key length: ${raw.length} bytes (expected 68 for Ed25519 libp2p key)`,
    )
  }

  for (let i = 0; i < LIBP2P_ED25519_HEADER.length; i++) {
    if (raw[i] !== LIBP2P_ED25519_HEADER[i]) {
      throw new Error('Invalid libp2p key header. Expected Ed25519 key type.')
    }
  }

  return {
    privateKey: new Uint8Array(raw.subarray(4, 36)),
    publicKey: new Uint8Array(raw.subarray(36, 68)),
  }
}

/**
 * Encodes an Ed25519 key pair into libp2p protobuf format.
 */
function encodeLibp2pKey(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
): string {
  const buf = new Uint8Array(68)
  buf.set(LIBP2P_ED25519_HEADER, 0)
  buf.set(privateKey, 4)
  buf.set(publicKey, 36)
  return Buffer.from(buf).toString('base64')
}

/**
 * Computes the account ID from raw public key bytes.
 */
function computeAccountId(publicKey: Uint8Array): string {
  const withPrefix = new Uint8Array(
    ED25519_MULTICODEC_PREFIX.length + publicKey.length,
  )
  withPrefix.set(ED25519_MULTICODEC_PREFIX, 0)
  withPrefix.set(publicKey, ED25519_MULTICODEC_PREFIX.length)
  return base58btc.encode(withPrefix)
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Lists all keys stored in the OS keyring.
 */
export function listKeys(dev: boolean): KeyringKeyInfo[] {
  const serviceName = getServiceName(dev)
  const collection = readCollection(serviceName)
  const keys: KeyringKeyInfo[] = []

  for (const [name, base64Data] of Object.entries(collection)) {
    try {
      const {publicKey} = decodeLibp2pKey(base64Data)
      keys.push({name, accountId: computeAccountId(publicKey)})
    } catch {
      keys.push({name, accountId: '(corrupted)'})
    }
  }

  return keys
}

/**
 * Gets a key by name or account ID from the OS keyring.
 */
export function getKey(
  nameOrAccountId: string,
  dev: boolean,
): KeyringKey | null {
  const serviceName = getServiceName(dev)
  const collection = readCollection(serviceName)

  // Direct name lookup.
  if (collection[nameOrAccountId]) {
    return decodeKeyEntry(nameOrAccountId, collection[nameOrAccountId])
  }

  // Match by account ID.
  for (const [name, base64Data] of Object.entries(collection)) {
    try {
      const {publicKey} = decodeLibp2pKey(base64Data)
      if (computeAccountId(publicKey) === nameOrAccountId) {
        return decodeKeyEntry(name, base64Data)
      }
    } catch {
      continue
    }
  }

  return null
}

/**
 * Gets the default key from the keyring.
 * Prefers "main", otherwise returns the first key.
 */
export function getDefaultKey(dev: boolean): KeyringKey | null {
  const serviceName = getServiceName(dev)
  const collection = readCollection(serviceName)
  const entries = Object.entries(collection)

  if (entries.length === 0) return null

  if (collection['main']) {
    return decodeKeyEntry('main', collection['main'])
  }

  const [name, base64Data] = entries[0]
  return decodeKeyEntry(name, base64Data)
}

/**
 * Stores a key in the OS keyring.
 */
export function storeKey(
  name: string,
  privateKey: Uint8Array,
  dev: boolean,
): KeyringKey {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(
      'Invalid key name. Use only alphanumeric characters, hyphens, and underscores.',
    )
  }

  const publicKey = ed25519.getPublicKey(privateKey)
  const serviceName = getServiceName(dev)
  const collection = readCollection(serviceName)

  if (collection[name]) {
    throw new Error(
      `Key "${name}" already exists. Remove it first with "seed-cli key remove".`,
    )
  }

  collection[name] = encodeLibp2pKey(privateKey, publicKey)
  writeCollection(serviceName, collection)

  const publicKeyWithPrefix = new Uint8Array(
    ED25519_MULTICODEC_PREFIX.length + publicKey.length,
  )
  publicKeyWithPrefix.set(ED25519_MULTICODEC_PREFIX, 0)
  publicKeyWithPrefix.set(publicKey, ED25519_MULTICODEC_PREFIX.length)

  return {
    name,
    privateKey,
    publicKey,
    publicKeyWithPrefix,
    accountId: computeAccountId(publicKey),
  }
}

/**
 * Removes a key from the OS keyring.
 */
export function removeKey(nameOrAccountId: string, dev: boolean): boolean {
  const serviceName = getServiceName(dev)
  const collection = readCollection(serviceName)

  if (collection[nameOrAccountId]) {
    delete collection[nameOrAccountId]
    writeCollection(serviceName, collection)
    return true
  }

  for (const [name, base64Data] of Object.entries(collection)) {
    try {
      const {publicKey} = decodeLibp2pKey(base64Data)
      if (computeAccountId(publicKey) === nameOrAccountId) {
        delete collection[name]
        writeCollection(serviceName, collection)
        return true
      }
    } catch {
      continue
    }
  }

  return false
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function decodeKeyEntry(name: string, base64Data: string): KeyringKey {
  const {privateKey, publicKey} = decodeLibp2pKey(base64Data)
  const publicKeyWithPrefix = new Uint8Array(
    ED25519_MULTICODEC_PREFIX.length + publicKey.length,
  )
  publicKeyWithPrefix.set(ED25519_MULTICODEC_PREFIX, 0)
  publicKeyWithPrefix.set(publicKey, ED25519_MULTICODEC_PREFIX.length)

  return {
    name,
    privateKey,
    publicKey,
    publicKeyWithPrefix,
    accountId: computeAccountId(publicKey),
  }
}

function esc(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}
