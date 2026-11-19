import * as hmac from '@noble/hashes/hmac.js'
import * as pbkdf2 from '@noble/hashes/pbkdf2.js'
import * as sha2 from '@noble/hashes/sha2.js'
import * as bip39 from '@scure/bip39'
import * as english from '@scure/bip39/wordlists/english.js'

/**
 * Parse an account recovery phrase and derive its 32-byte Ed25519 seed locally.
 * Matches the daemon's BIP-39 + SLIP-10 path m/44'/104109'/0'. This is separate
 * from the vault recovery credential. The optional original passphrase is exact.
 */
export async function deriveAccountSeed(input: string, passphrase = ''): Promise<Uint8Array> {
  const phrase = input
    .trim()
    .toLowerCase()
    .split(/[\s,]+/)
    .join(' ')
  if (!bip39.validateMnemonic(phrase, english.wordlist)) {
    throw new Error('Invalid account recovery phrase. Check the words and their order.')
  }

  // go-bip39 in the desktop daemon preserves passphrase bytes, including Unicode.
  // The generic mnemonicToSeed helper normalizes them and can restore a different key.
  const seed = await pbkdf2.pbkdf2Async(sha2.sha512, phrase, `mnemonic${passphrase}`, {c: 2048, dkLen: 64})
  let node = hmac.hmac(sha2.sha512, new TextEncoder().encode('ed25519 seed'), seed)
  // SLIP-10 Ed25519 only supports hardened children; 104109 encodes "hm".
  for (const index of [44, 104109, 0]) {
    const data = new Uint8Array(37)
    data.set(node.subarray(0, 32), 1)
    new DataView(data.buffer).setUint32(33, index + 0x80000000, false)
    node = hmac.hmac(sha2.sha512, node.subarray(32), data)
  }
  return node.slice(0, 32)
}
