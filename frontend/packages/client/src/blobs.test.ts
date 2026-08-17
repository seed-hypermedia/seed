import {base58btc} from 'multiformats/bases/base58'
import {describe, expect, test} from 'vitest'
import * as blobs from './blobs'

// Web Crypto Ed25519 is experimental in Node.js. Skip WebCrypto-specific tests if unavailable.
const hasWebCryptoEd25519 = await (async () => {
  try {
    await crypto.subtle.generateKey('Ed25519' as unknown as AlgorithmIdentifier, false, ['sign', 'verify'])
    return true
  } catch {
    return false
  }
})()

const cryptoTest = hasWebCryptoEd25519 ? test : test.skip

describe('NobleKeyPair', () => {
  test('generates valid Ed25519 key pair', () => {
    const kp = blobs.generateNobleKeyPair()
    expect(kp.publicKey.length).toBe(32)
    expect(kp.seed.length).toBe(32)
    // Principal = 2 bytes multicodec prefix + 32 bytes public key.
    expect(kp.principal.length).toBe(34)
    expect(kp.principal[0]).toBe(0xed)
    expect(kp.principal[1]).toBe(0x01)
  })

  test('nobleKeyPairFromSeed restores same principal', () => {
    const seed = crypto.getRandomValues(new Uint8Array(32))
    const kp1 = blobs.nobleKeyPairFromSeed(seed)
    const kp2 = blobs.nobleKeyPairFromSeed(seed)
    expect(blobs.principalEqual(kp1.principal, kp2.principal)).toBe(true)
    expect(kp1.publicKey).toEqual(kp2.publicKey)
  })

  test('signs and verifies correctly', async () => {
    const kp = blobs.generateNobleKeyPair()
    const eb = await blobs.createProfile(kp, {name: 'Noble Test'}, Date.now())
    expect(blobs.verify(eb.decoded)).toBe(true)
  })
})

describe('WebCryptoKeyPair', () => {
  cryptoTest('generates valid unexportable key pair', async () => {
    const kp = await blobs.generateWebCryptoKeyPair()
    expect(kp.publicKey.length).toBe(32)
    expect(kp.principal.length).toBe(34)
    expect(kp.keyPair.privateKey).toBeDefined()
    // Verify the private key is not exportable.
    expect(kp.keyPair.privateKey.extractable).toBe(false)
  })

  cryptoTest('signs and verifies correctly', async () => {
    const kp = await blobs.generateWebCryptoKeyPair()
    const eb = await blobs.createProfile(kp, {name: 'WebCrypto Test'}, Date.now())
    expect(blobs.verify(eb.decoded)).toBe(true)
  })

  cryptoTest('cross-verifies with NobleKeyPair', async () => {
    // Sign with WebCrypto, verify with noble (which is what verify() uses).
    const kp = await blobs.generateWebCryptoKeyPair()
    const eb = await blobs.createCapability(kp, blobs.generateNobleKeyPair().principal, 'AGENT', Date.now())
    expect(blobs.verify(eb.decoded)).toBe(true)
  })
})

describe('principal encoding', () => {
  test('string round-trip preserves identity', () => {
    const kp = blobs.generateNobleKeyPair()
    const str = blobs.principalToString(kp.principal)
    // Base58btc multibase strings start with 'z'.
    expect(str.startsWith('z')).toBe(true)
    const decoded = blobs.principalFromString(str)
    expect(blobs.principalEqual(kp.principal, decoded)).toBe(true)
  })

  test('different keys produce different strings', () => {
    const a = blobs.generateNobleKeyPair()
    const b = blobs.generateNobleKeyPair()
    expect(blobs.principalToString(a.principal)).not.toBe(blobs.principalToString(b.principal))
  })

  test('principalEqual detects different keys', () => {
    const a = blobs.generateNobleKeyPair()
    const b = blobs.generateNobleKeyPair()
    expect(blobs.principalEqual(a.principal, b.principal)).toBe(false)
  })

  test('rejects principal with invalid multicodec prefix', () => {
    const invalid = new Uint8Array([0x00, 0x01, ...new Uint8Array(32)])
    const encoded = base58btc.encode(invalid)
    expect(() => blobs.principalFromString(encoded)).toThrow('Invalid principal multicodec')
  })

  test('rejects principal with invalid length', () => {
    const tooShort = new Uint8Array([0xed, 0x01, ...new Uint8Array(16)])
    const encoded = base58btc.encode(tooShort)
    expect(() => blobs.principalFromString(encoded)).toThrow('Invalid principal length')
  })
})

describe('profile blob', () => {
  test('create, sign, and verify round-trip', async () => {
    const kp = blobs.generateNobleKeyPair()
    const ts = Date.now() as blobs.Timestamp
    const eb = await blobs.createProfile(kp, {name: 'Alice'}, ts)

    expect(eb.decoded.type).toBe('Profile')
    expect(eb.decoded.name).toBe('Alice')
    expect(eb.decoded.ts).toBe(ts)
    expect(eb.data.length).toBeGreaterThan(0)
    expect(eb.cid).toBeDefined()
    expect(blobs.verify(eb.decoded)).toBe(true)
  })

  test('profile with all fields', async () => {
    const account = blobs.generateNobleKeyPair()
    const agent = blobs.generateNobleKeyPair()
    const ts = Date.now() as blobs.Timestamp
    const eb = await blobs.createProfile(
      agent,
      {
        name: 'Alice',
        avatar: 'ipfs://QmTest',
        description: 'A test profile.',
        account: account.principal,
      },
      ts,
    )

    expect(eb.decoded.name).toBe('Alice')
    expect(eb.decoded.avatar).toBe('ipfs://QmTest')
    expect(eb.decoded.description).toBe('A test profile.')
    expect(eb.decoded.account).toEqual(account.principal)
    expect(blobs.verify(eb.decoded)).toBe(true)
  })

  test('account equal to signer is omitted', async () => {
    const kp = blobs.generateNobleKeyPair()
    const ts = Date.now() as blobs.Timestamp
    const eb = await blobs.createProfile(kp, {name: 'Self', account: kp.principal}, ts)

    expect(eb.decoded.account).toBeUndefined()
    expect(blobs.verify(eb.decoded)).toBe(true)
  })

  test('alias profile has no name or description', async () => {
    const kp = blobs.generateNobleKeyPair()
    const alias = blobs.generateNobleKeyPair()
    const ts = Date.now() as blobs.Timestamp
    const eb = await blobs.createProfileAlias(kp, alias.principal, ts)

    expect(eb.decoded.type).toBe('Profile')
    expect(eb.decoded.alias).toEqual(alias.principal)
    expect(eb.decoded.name).toBeUndefined()
    expect(eb.decoded.description).toBeUndefined()
    expect(blobs.verify(eb.decoded)).toBe(true)
  })

  test('deterministic encoding produces same CID', async () => {
    const kp = blobs.nobleKeyPairFromSeed(new Uint8Array(32).fill(42))
    const ts = 1700000000000 as blobs.Timestamp
    const eb1 = await blobs.createProfile(kp, {name: 'Test'}, ts)
    const eb2 = await blobs.createProfile(kp, {name: 'Test'}, ts)

    expect(eb1.cid.toString()).toBe(eb2.cid.toString())
    expect(eb1.data).toEqual(eb2.data)
  })
})

describe('capability blob', () => {
  test('create, sign, and verify', async () => {
    const issuer = blobs.generateNobleKeyPair()
    const delegate = blobs.generateNobleKeyPair()
    const ts = Date.now() as blobs.Timestamp
    const eb = await blobs.createCapability(issuer, delegate.principal, 'WRITER', ts)

    expect(eb.decoded.type).toBe('Capability')
    expect(eb.decoded.delegate).toEqual(delegate.principal)
    expect(eb.decoded.role).toBe('WRITER')
    expect(blobs.verify(eb.decoded)).toBe(true)
  })

  test('capability with label and path', async () => {
    const issuer = blobs.generateNobleKeyPair()
    const delegate = blobs.generateNobleKeyPair()
    const ts = Date.now() as blobs.Timestamp
    const eb = await blobs.createCapability(issuer, delegate.principal, 'AGENT', ts, {
      path: '/docs',
      label: 'My Device',
    })

    expect(eb.decoded.path).toBe('/docs')
    expect(eb.decoded.label).toBe('My Device')
    expect(blobs.verify(eb.decoded)).toBe(true)
  })
})

describe('verification', () => {
  test('tampered name fails verification', async () => {
    const kp = blobs.generateNobleKeyPair()
    const ts = Date.now() as blobs.Timestamp
    const eb = await blobs.createProfile(kp, {name: 'Alice'}, ts)

    const tampered: blobs.Profile = {...eb.decoded, name: 'Bob'}
    expect(blobs.verify(tampered)).toBe(false)
  })

  test('tampered timestamp fails verification', async () => {
    const kp = blobs.generateNobleKeyPair()
    const ts = Date.now() as blobs.Timestamp
    const eb = await blobs.createProfile(kp, {name: 'Alice'}, ts)

    const tampered: blobs.Profile = {
      ...eb.decoded,
      ts: (ts + 1) as blobs.Timestamp,
    }
    expect(blobs.verify(tampered)).toBe(false)
  })

  test('wrong signer fails verification', async () => {
    const kp = blobs.generateNobleKeyPair()
    const other = blobs.generateNobleKeyPair()
    const ts = Date.now() as blobs.Timestamp
    const eb = await blobs.createProfile(kp, {name: 'Alice'}, ts)

    const tampered: blobs.Profile = {...eb.decoded, signer: other.principal}
    expect(blobs.verify(tampered)).toBe(false)
  })
})

describe('decodeBlob', () => {
  test('decodes and verifies CID', async () => {
    const kp = blobs.generateNobleKeyPair()
    const eb = await blobs.createProfile(kp, {name: 'CID Test'}, Date.now())

    const re = blobs.decodeBlob<blobs.Profile>(eb.data, eb.cid)
    expect(re.decoded.name).toBe('CID Test')
    expect(re.cid.toString()).toBe(eb.cid.toString())
  })

  test('throws on CID mismatch', async () => {
    const kp = blobs.generateNobleKeyPair()
    const eb1 = await blobs.createProfile(kp, {name: 'One'}, Date.now())
    const eb2 = await blobs.createProfile(kp, {name: 'Two'}, Date.now())

    // Use data from eb1 but CID from eb2 — should fail.
    expect(() => blobs.decodeBlob<blobs.Profile>(eb1.data, eb2.cid)).toThrow('CID mismatch')
  })
})

// Legacy alias tests.
describe('legacy aliases', () => {
  test('generateKeyPair returns NobleKeyPair', async () => {
    const kp = await blobs.generateKeyPair()
    expect(kp).toBeInstanceOf(blobs.NobleKeyPair)
  })

  test('keyPairFromPrivateKey returns NobleKeyPair', async () => {
    const seed = crypto.getRandomValues(new Uint8Array(32))
    const kp = await blobs.keyPairFromPrivateKey(seed)
    expect(kp).toBeInstanceOf(blobs.NobleKeyPair)
  })
})
