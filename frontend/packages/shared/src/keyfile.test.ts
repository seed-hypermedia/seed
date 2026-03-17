import {describe, expect, test} from 'vitest'
import * as keyfile from './keyfile'

function makeKey(fill = 7): Uint8Array {
  return new Uint8Array(32).fill(fill)
}

describe('keyfile', () => {
  test('plaintext payload roundtrip preserves raw key bytes', async () => {
    const payload = await keyfile.create({
      publicKey: 'z6MkgPlaintext',
      key: makeKey(),
      createTime: '2026-03-17T00:00:00.000Z',
    })
    const parsed = keyfile.parse(keyfile.stringify(payload))
    expect(parsed).toEqual(payload)
    await expect(keyfile.decrypt(parsed)).resolves.toEqual(makeKey())
  })

  test('encrypted payload roundtrip preserves raw key bytes', async () => {
    const payload = await keyfile.create({
      publicKey: 'z6MkgEncrypted',
      key: makeKey(),
      password: 'secret-password',
      profile: {name: 'Alice', description: 'Profile description'},
      createTime: '2026-03-17T00:00:00.000Z',
    })

    const parsed = keyfile.parse(keyfile.stringify(payload))
    expect(parsed.encryption).toEqual({
      kdf: 'argon2id',
      argon2: {
        memoryCost: expect.any(Number),
        timeCost: expect.any(Number),
        parallelism: expect.any(Number),
        saltB64: expect.any(String),
      },
      cipher: 'xchacha20poly1305',
    })
    await expect(keyfile.decrypt(parsed, 'secret-password')).resolves.toEqual(makeKey())
  })

  test('encrypted payload requires a password', async () => {
    const payload = await keyfile.create({
      publicKey: 'z6MkgEncrypted',
      key: makeKey(),
      password: 'secret-password',
    })

    await expect(keyfile.decrypt(payload)).rejects.toThrow('password is required')
  })

  test('encrypted payload fails with the wrong password', async () => {
    const payload = await keyfile.create({
      publicKey: 'z6MkgEncrypted',
      key: makeKey(),
      password: 'secret-password',
    })

    await expect(keyfile.decrypt(payload, 'wrong-password')).rejects.toThrow()
  })

  test('decrypt rejects malformed encryption metadata', async () => {
    await expect(
      keyfile.decrypt(
        {
          createTime: '2026-03-17T00:00:00.000Z',
          publicKey: 'z6MkgBroken',
          keyB64: 'AA',
          encryption: {
            kdf: 'argon2id',
            argon2: {
              memoryCost: 65536,
              timeCost: 3,
              parallelism: 4,
              saltB64: '',
            },
            cipher: 'xchacha20poly1305',
          },
        },
        'secret-password',
      ),
    ).rejects.toThrow('saltB64 is required')
  })

  test('stringify preserves field names and base64url encoding', async () => {
    const json = keyfile.stringify(
      await keyfile.create({
        publicKey: 'z6MkgPlaintext',
        key: makeKey(251),
        createTime: '2026-03-17T00:00:00.000Z',
      }),
    )

    expect(json).toContain('"createTime"')
    expect(json).toContain('"publicKey"')
    expect(json).toContain('"keyB64"')
    expect(json).not.toContain('+')
    expect(json).not.toContain('/')
    expect(json).not.toContain('=')
  })
})
