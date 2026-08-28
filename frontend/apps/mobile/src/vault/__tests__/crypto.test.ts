import {
  b64std,
  b64url,
  decrypt,
  deriveSecretCredentialAuthKey,
  encrypt,
  randomBytes,
  sha256,
  SECRET_AUTH_KEY_INFO,
} from '../crypto'

describe('vault crypto primitives', () => {
  test('sha256 known vector', () => {
    // sha256("abc")
    const digest = sha256(new TextEncoder().encode('abc'))
    expect(b64url.encode(digest)).toBe('ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0')
  })

  test('randomBytes returns the requested length and varies', () => {
    const a = randomBytes(32)
    const b = randomBytes(32)
    expect(a).toHaveLength(32)
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  test('noble HKDF equals WebCrypto HKDF with empty salt (the server contract)', async () => {
    const secret = randomBytes(32)
    const derived = deriveSecretCredentialAuthKey(secret)

    const baseKey = await crypto.subtle.importKey('raw', secret.slice().buffer as ArrayBuffer, {name: 'HKDF'}, false, [
      'deriveBits',
    ])
    const expected = new Uint8Array(
      await crypto.subtle.deriveBits(
        {
          name: 'HKDF',
          hash: 'SHA-256',
          salt: new Uint8Array(0),
          info: new TextEncoder().encode(SECRET_AUTH_KEY_INFO),
        },
        baseKey,
        256,
      ),
    )

    expect(Array.from(derived)).toEqual(Array.from(expected))
  })

  test('deriveSecretCredentialAuthKey rejects non-32-byte secrets (Go parity)', () => {
    expect(() => deriveSecretCredentialAuthKey(randomBytes(16))).toThrow('Invalid vault secret length')
  })

  test('b64std is padded, b64url is unpadded; both decode each alphabet correctly', () => {
    const data = Uint8Array.from([251, 239, 190, 1]) // encodes with url-unsafe chars in std alphabet
    const std = b64std.encode(data)
    const url = b64url.encode(data)
    expect(std).toBe('++++AQ==')
    expect(url).toBe('----AQ')
    expect(Array.from(b64std.decode(std))).toEqual(Array.from(data))
    expect(Array.from(b64url.decode(url))).toEqual(Array.from(data))
  })

  test('XChaCha20-Poly1305 round-trip with a 64-byte DEK (key truncated to 32)', async () => {
    const dek = randomBytes(64)
    const plaintext = new TextEncoder().encode('vault state bytes')
    const sealed = await encrypt(plaintext, dek)
    // nonce (24) + ciphertext + tag (16)
    expect(sealed.length).toBe(24 + plaintext.length + 16)
    const opened = await decrypt(sealed, dek)
    expect(new TextDecoder().decode(opened)).toBe('vault state bytes')
    // Only the first 32 bytes of the key matter.
    const truncatedKey = dek.slice(0, 32)
    expect(new TextDecoder().decode(await decrypt(sealed, truncatedKey))).toBe('vault state bytes')
    await expect(decrypt(sealed, randomBytes(32))).rejects.toThrow()
  })
})
