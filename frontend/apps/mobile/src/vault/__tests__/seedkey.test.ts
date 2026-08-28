/**
 * Desktop `.seedkey` format unit tests: byte-exact round-trip, principal
 * mismatch rejection, and the explicit password-protected-export rejection.
 */

import {b64url, randomBytes} from '../crypto'
import {buildSeedKeyExport, ENCRYPTED_SEEDKEY_ERROR, parseSeedKeyImport} from '../seedkey'
import {accountIdFromSeed} from '../state-codec'

describe('buildSeedKeyExport', () => {
  test('produces the desktop createExportedKeyFile shape', () => {
    const seed = randomBytes(32)
    const json = buildSeedKeyExport({seed, createTime: 1_700_000_000_000})
    // Desktop appends a trailing newline after MarshalIndent.
    expect(json.endsWith('\n')).toBe(true)

    const payload = JSON.parse(json)
    expect(Object.keys(payload).sort()).toEqual(['createTime', 'keyB64', 'publicKey'])
    expect(payload.createTime).toBe(new Date(1_700_000_000_000).toISOString())
    expect(payload.publicKey).toBe(accountIdFromSeed(seed))
    // keyB64 is Go base64.RawURLEncoding: base64url alphabet, no padding.
    expect(payload.keyB64).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(Array.from(b64url.decode(payload.keyB64))).toEqual(Array.from(seed))
  })

  test('rejects a non-32-byte seed', () => {
    expect(() => buildSeedKeyExport({seed: randomBytes(31)})).toThrow('Invalid seed length')
  })
})

describe('parseSeedKeyImport', () => {
  test('round-trips an exported payload', () => {
    const seed = randomBytes(32)
    const parsed = parseSeedKeyImport(buildSeedKeyExport({seed}))
    expect(Array.from(parsed.seed)).toEqual(Array.from(seed))
    expect(parsed.publicKey).toBe(accountIdFromSeed(seed))
  })

  test('derives the principal when publicKey is absent', () => {
    const seed = randomBytes(32)
    const parsed = parseSeedKeyImport(JSON.stringify({keyB64: b64url.encode(seed)}))
    expect(parsed.publicKey).toBe(accountIdFromSeed(seed))
  })

  test('rejects a publicKey that does not match the seed', () => {
    const seed = randomBytes(32)
    const otherPrincipal = accountIdFromSeed(randomBytes(32))
    const json = JSON.stringify({
      createTime: new Date().toISOString(),
      publicKey: otherPrincipal,
      keyB64: b64url.encode(seed),
    })
    expect(() => parseSeedKeyImport(json)).toThrow('publicKey does not match')
  })

  test('rejects password-protected exports with a clear error', () => {
    const seed = randomBytes(32)
    const json = JSON.stringify({
      createTime: new Date().toISOString(),
      publicKey: accountIdFromSeed(seed),
      keyB64: b64url.encode(seed),
      encryption: {
        kdf: 'argon2id',
        cipher: 'xchacha20poly1305',
        argon2: {memoryCost: 65536, timeCost: 3, parallelism: 4, saltB64: b64url.encode(randomBytes(16))},
      },
    })
    expect(() => parseSeedKeyImport(json)).toThrow(ENCRYPTED_SEEDKEY_ERROR)
    expect(ENCRYPTED_SEEDKEY_ERROR).toMatch(/not supported yet/)
  })

  test('rejects malformed payloads', () => {
    expect(() => parseSeedKeyImport('not json at all')).toThrow('not valid JSON')
    expect(() => parseSeedKeyImport('[1,2,3]')).toThrow('expected a JSON object')
    expect(() => parseSeedKeyImport('{}')).toThrow('missing keyB64')
    expect(() => parseSeedKeyImport(JSON.stringify({keyB64: '!!not-base64url!!'}))).toThrow('not valid base64url')
    expect(() => parseSeedKeyImport(JSON.stringify({keyB64: b64url.encode(randomBytes(16))}))).toThrow(
      'expected a 32-byte key',
    )
  })
})
