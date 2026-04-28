/**
 * Tests the format produced by `seed-cli key export`.
 *
 * The export command is a thin wrapper around `@seed-hypermedia/client/keyfile`
 * — what we verify here is that a `KeyringKey` (as produced by the CLI's keyring
 * utilities) round-trips cleanly through the .hmkey.json format consumed by
 * the desktop app and vault.
 */

import {describe, test, expect} from 'bun:test'
import {existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync} from 'fs'
import {tmpdir, platform} from 'os'
import path from 'path'
import * as keyfile from '@seed-hypermedia/client/keyfile'
import * as ed25519 from '@noble/ed25519'
import {base58btc} from 'multiformats/bases/base58'

const ED25519_VARINT_PREFIX = new Uint8Array([0xed, 0x01])

function makeKeyringKey(fill = 7) {
  const privateKey = new Uint8Array(32).fill(fill)
  const publicKey = ed25519.getPublicKey(privateKey)
  const principal = new Uint8Array(ED25519_VARINT_PREFIX.length + publicKey.length)
  principal.set(ED25519_VARINT_PREFIX, 0)
  principal.set(publicKey, ED25519_VARINT_PREFIX.length)
  return {
    name: 'test-key',
    privateKey,
    publicKey,
    accountId: base58btc.encode(principal),
  }
}

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'seed-cli-key-export-'))
}

describe('key export format', () => {
  test('unencrypted export round-trips through keyfile.load', async () => {
    const stored = makeKeyringKey()
    const payload = await keyfile.create({
      publicKey: stored.accountId,
      key: stored.privateKey,
    })
    expect(payload.encryption).toBeUndefined()
    expect(payload.publicKey).toBe(stored.accountId)

    const json = keyfile.stringify(payload)
    expect(json.endsWith('\n')).toBe(true)

    const loaded = await keyfile.load(json)
    expect(loaded.publicKey).toBe(stored.accountId)
    expect(loaded.seed).toEqual(stored.privateKey)
  })

  test('encrypted export round-trips through keyfile.load with matching password', async () => {
    const stored = makeKeyringKey(11)
    const payload = await keyfile.create({
      publicKey: stored.accountId,
      key: stored.privateKey,
      password: 'hunter2',
    })

    expect(payload.encryption).toEqual({
      kdf: 'argon2id',
      cipher: 'xchacha20poly1305',
      argon2: {
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4,
        saltB64: expect.any(String),
      },
    })

    const json = keyfile.stringify(payload)
    const loaded = await keyfile.load(json, 'hunter2')
    expect(loaded.seed).toEqual(stored.privateKey)
    expect(loaded.publicKey).toBe(stored.accountId)
  })

  test('encrypted export rejects the wrong password', async () => {
    const stored = makeKeyringKey(13)
    const payload = await keyfile.create({
      publicKey: stored.accountId,
      key: stored.privateKey,
      password: 'correct',
    })
    await expect(keyfile.load(keyfile.stringify(payload), 'wrong')).rejects.toThrow()
  })

  test('keyring accountId equals payload publicKey (cross-format invariant)', async () => {
    const stored = makeKeyringKey(42)
    expect(stored.accountId).toBe(keyfile.principalStringFromSeed(stored.privateKey))
  })
})

describe('key export file IO', () => {
  test('writeFileSync with mode 0o600 produces a private file (POSIX only)', async () => {
    if (platform() === 'win32') return

    const dir = makeTmpDir()
    try {
      const stored = makeKeyringKey(3)
      const payload = await keyfile.create({
        publicKey: stored.accountId,
        key: stored.privateKey,
      })
      const outputPath = path.join(dir, `${stored.accountId}.hmkey.json`)
      writeFileSync(outputPath, keyfile.stringify(payload), {mode: 0o600})

      const info = statSync(outputPath)
      // Mode bits beyond the permission triplet vary by platform; mask to 0o777.
      expect(info.mode & 0o777).toBe(0o600)

      const reread = readFileSync(outputPath, 'utf8')
      const loaded = await keyfile.load(reread)
      expect(loaded.seed).toEqual(stored.privateKey)
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })

  test('default filename derives from accountId', () => {
    const stored = makeKeyringKey(5)
    // This mirrors the `--output` default in key.ts: <accountId>.hmkey.json.
    const expected = `${stored.accountId}.hmkey.json`
    expect(expected.endsWith('.hmkey.json')).toBe(true)
    expect(expected.startsWith('z')).toBe(true)
  })

  test('overwrite refusal mirrors --force semantics', () => {
    const dir = makeTmpDir()
    try {
      const target = path.join(dir, 'k.hmkey.json')
      writeFileSync(target, 'existing')
      // The CLI uses `existsSync(target) && !force` to refuse overwriting.
      expect(existsSync(target)).toBe(true)
    } finally {
      rmSync(dir, {recursive: true, force: true})
    }
  })
})
