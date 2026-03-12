import {describe, test, expect} from 'bun:test'
import {
  deriveKeyPairFromMnemonic,
  deriveAccountIdFromMnemonic,
  generateMnemonic,
  validateMnemonic,
} from './key-derivation'

// Known test vector — this mnemonic is used in the integration tests
// (cli.test.ts, cli-live.test.ts) and must produce a deterministic account ID.
const KNOWN_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const KNOWN_ACCOUNT_ID = 'z6MkqqiSjqcT9NasDUXiymyB8kpgz6h3CNQaghGAoXsaYJ2f'

describe('deriveKeyPairFromMnemonic', () => {
  test('known mnemonic produces known account ID', () => {
    const keyPair = deriveKeyPairFromMnemonic(KNOWN_MNEMONIC)
    expect(keyPair.accountId).toBe(KNOWN_ACCOUNT_ID)
  })

  test('string input and array input produce same result', () => {
    const words = KNOWN_MNEMONIC.split(' ')
    const fromString = deriveKeyPairFromMnemonic(KNOWN_MNEMONIC)
    const fromArray = deriveKeyPairFromMnemonic(words)
    expect(fromString.accountId).toBe(fromArray.accountId)
    expect(fromString.publicKey).toEqual(fromArray.publicKey)
    expect(fromString.privateKey).toEqual(fromArray.privateKey)
  })

  test('different passphrase produces different key', () => {
    const withoutPass = deriveKeyPairFromMnemonic(KNOWN_MNEMONIC)
    const withPass = deriveKeyPairFromMnemonic(KNOWN_MNEMONIC, 'my-secret')
    expect(withoutPass.accountId).not.toBe(withPass.accountId)
  })

  test('same passphrase produces same key (deterministic)', () => {
    const first = deriveKeyPairFromMnemonic(KNOWN_MNEMONIC, 'pass')
    const second = deriveKeyPairFromMnemonic(KNOWN_MNEMONIC, 'pass')
    expect(first.accountId).toBe(second.accountId)
    expect(first.privateKey).toEqual(second.privateKey)
  })

  test('returns valid Ed25519 key pair with 32-byte keys', () => {
    const keyPair = deriveKeyPairFromMnemonic(KNOWN_MNEMONIC)
    expect(keyPair.privateKey).toBeInstanceOf(Uint8Array)
    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array)
    expect(keyPair.privateKey.length).toBe(32)
    expect(keyPair.publicKey.length).toBe(32)
  })

  test('publicKeyWithPrefix has correct multicodec prefix', () => {
    const keyPair = deriveKeyPairFromMnemonic(KNOWN_MNEMONIC)
    // Ed25519 multicodec prefix: 0xed, 0x01
    expect(keyPair.publicKeyWithPrefix[0]).toBe(0xed)
    expect(keyPair.publicKeyWithPrefix[1]).toBe(0x01)
    expect(keyPair.publicKeyWithPrefix.length).toBe(34) // 2 prefix + 32 key
  })
})

describe('deriveAccountIdFromMnemonic', () => {
  test('returns z-prefixed base58btc string', () => {
    const id = deriveAccountIdFromMnemonic(KNOWN_MNEMONIC)
    expect(id.startsWith('z')).toBe(true)
    expect(id.length).toBeGreaterThan(40)
  })

  test('matches full key pair derivation', () => {
    const id = deriveAccountIdFromMnemonic(KNOWN_MNEMONIC)
    const keyPair = deriveKeyPairFromMnemonic(KNOWN_MNEMONIC)
    expect(id).toBe(keyPair.accountId)
  })

  test('accepts passphrase', () => {
    const withPass = deriveAccountIdFromMnemonic(KNOWN_MNEMONIC, 'pass123')
    expect(withPass.startsWith('z')).toBe(true)
    expect(withPass).not.toBe(deriveAccountIdFromMnemonic(KNOWN_MNEMONIC))
  })
})

describe('generateMnemonic', () => {
  test('generates 12 words by default', () => {
    const mnemonic = generateMnemonic()
    const words = mnemonic.split(' ')
    expect(words.length).toBe(12)
  })

  test('generates 12 words when explicitly requested', () => {
    const mnemonic = generateMnemonic(12)
    expect(mnemonic.split(' ').length).toBe(12)
  })

  test('generates 24 words when requested', () => {
    const mnemonic = generateMnemonic(24)
    expect(mnemonic.split(' ').length).toBe(24)
  })

  test('generates valid BIP-39 mnemonics', () => {
    const m12 = generateMnemonic(12)
    const m24 = generateMnemonic(24)
    expect(validateMnemonic(m12)).toBe(true)
    expect(validateMnemonic(m24)).toBe(true)
  })

  test('generates different mnemonics each time', () => {
    const a = generateMnemonic()
    const b = generateMnemonic()
    expect(a).not.toBe(b)
  })
})

describe('validateMnemonic', () => {
  test('valid 12-word mnemonic returns true', () => {
    expect(validateMnemonic(KNOWN_MNEMONIC)).toBe(true)
  })

  test('valid generated mnemonic returns true', () => {
    const mnemonic = generateMnemonic()
    expect(validateMnemonic(mnemonic)).toBe(true)
  })

  test('invalid mnemonic returns false', () => {
    expect(validateMnemonic('not a valid mnemonic at all')).toBe(false)
  })

  test('empty string returns false', () => {
    expect(validateMnemonic('')).toBe(false)
  })

  test('random words that are not BIP-39 return false', () => {
    expect(validateMnemonic('hello world foo bar baz qux quux corge grault garply waldo fred')).toBe(false)
  })

  test('correct words but wrong checksum return false', () => {
    // Same words as known mnemonic but shuffled — checksum will fail
    expect(
      validateMnemonic('about abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon'),
    ).toBe(false)
  })
})
