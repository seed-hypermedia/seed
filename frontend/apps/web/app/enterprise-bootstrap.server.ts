// Pieces of the enterprise bootstrap that are pure enough to unit test on
// their own: the operator's bearer check, the key derivation that turns the
// daemon's mnemonic into the seed the `.hmkey.json` export carries, and the
// first home document of the organization's space.

import type {DocumentOperation} from '@seed-hypermedia/client'
import {createHash, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual} from 'crypto'

/** Daemon keystore label of the organization's root key. */
export const OWNER_KEY_NAME = 'enterprise-owner'

/**
 * Compares `Authorization: Bearer <secret>` against the secret in constant
 * time. Both sides are hashed first so a length mismatch leaks nothing either.
 */
export function bearerMatches(authorization: string | null, secret: string): boolean {
  if (!authorization || !authorization.startsWith('Bearer ')) return false
  const presented = createHash('sha256').update(authorization.slice('Bearer '.length)).digest()
  const expected = createHash('sha256').update(secret).digest()
  return timingSafeEqual(presented, expected)
}

// The daemon derives its keys as backend/core/mnemonic.go does, and the CLI's
// utils/key-derivation.ts mirrors it: BIP-39 seed, then SLIP-10 ed25519 along
// m/44'/104109'/0' (104109 = 'h' 'm'). The web app has neither bip39 nor slip10
// as dependencies, and both steps are a few lines over Node's own crypto.
const DERIVATION_PATH = [44, 104109, 0]
const HARDENED_OFFSET = 0x80000000

function slip10MasterKey(seed: Uint8Array): {key: Buffer; chainCode: Buffer} {
  const digest = createHmac('sha512', 'ed25519 seed').update(seed).digest()
  return {key: digest.subarray(0, 32), chainCode: digest.subarray(32)}
}

function slip10DeriveHardened(parent: {key: Buffer; chainCode: Buffer}, index: number) {
  const data = Buffer.alloc(1 + 32 + 4)
  data[0] = 0
  parent.key.copy(data, 1)
  data.writeUInt32BE((index + HARDENED_OFFSET) >>> 0, 33)
  const digest = createHmac('sha512', parent.chainCode).update(data).digest()
  return {key: digest.subarray(0, 32), chainCode: digest.subarray(32)}
}

/**
 * The 32-byte ed25519 seed the daemon registers for a BIP-39 mnemonic. This is
 * what `seed-cli key export` and the vault write into `.hmkey.json`, so the
 * file this produces imports anywhere a key file does.
 */
export function seedFromMnemonic(mnemonic: string[] | string, passphrase = ''): Uint8Array {
  const words = (Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic).normalize('NFKD')
  const salt = `mnemonic${passphrase}`.normalize('NFKD')
  const bip39Seed = pbkdf2Sync(words, salt, 2048, 64, 'sha512')
  let node = slip10MasterKey(bip39Seed)
  for (const index of DERIVATION_PATH) node = slip10DeriveHardened(node, index)
  return new Uint8Array(node.key)
}

const BLOCK_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

function newBlockId(): string {
  const bytes = randomBytes(8)
  let id = ''
  for (const byte of bytes) id += BLOCK_ID_ALPHABET[byte % BLOCK_ID_ALPHABET.length]
  return id
}

export function welcomeText(name: string): string {
  return `Welcome to ${name}. This is the organization's space: everyone invited here can read it, and the owner of the space decides who writes.`
}

/**
 * The first content change of the space's home document: its name, the public
 * address it is published at, and one paragraph so the page is not empty.
 */
export function homeDocumentOps(input: {name: string; siteUrl: string}): DocumentOperation[] {
  const blockId = newBlockId()
  return [
    {
      type: 'SetAttributes',
      attrs: [
        {key: ['name'], value: input.name},
        {key: ['siteUrl'], value: input.siteUrl},
      ],
    },
    {
      type: 'ReplaceBlock',
      block: {type: 'Paragraph', id: blockId, text: welcomeText(input.name), annotations: []},
    },
    {type: 'MoveBlocks', parent: '', blocks: [blockId]},
  ]
}
