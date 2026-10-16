// @vitest-environment node
import {createHash, generateKeyPairSync, sign} from 'node:crypto'
import {mkdtemp, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {describe, expect, it, vi} from 'vitest'
import {canonicalManifest, verifyUpdateAsset, verifyUpdateManifest} from '../update-manifest'

// Private test keys exist only in memory and never enter the repository or release secrets.
const {privateKey, publicKey} = generateKeyPairSync('ed25519')
const publicPem = publicKey.export({type: 'spki', format: 'pem'}).toString()
const asset = {download_url: 'https://example.com/Seed.exe', sha256: 'a'.repeat(64)}
const unsigned = {name: '2026.10.1', tag_name: '2026.10.1', release_notes: '', assets: {win32: {x64: asset}}}

function signed(value: Record<string, unknown> = unsigned) {
  return {...value, signature: sign(null, Buffer.from(canonicalManifest(value)), privateKey).toString('base64')}
}

describe('update manifest verification', () => {
  it('accepts empty artifact slots emitted by legacy release generators', () => {
    const manifest = {...unsigned, assets: {...unsigned.assets, macos: {x64: {}}, linux: {app_image: {}}}}
    expect(verifyUpdateManifest(manifest, publicPem, vi.fn()).assets.macos?.x64).toBeUndefined()
  })
  it('accepts valid Ed25519 signatures independent of property order', () => {
    const manifest = signed()
    expect(verifyUpdateManifest({...manifest, assets: unsigned.assets}, publicPem, vi.fn()).name).toBe(unsigned.name)
    expect(canonicalManifest({z: [3, {b: 2, a: 1}], a: 'é', signature: 'ignored'})).toBe(
      '{"a":"é","z":[3,{"a":1,"b":2}]}',
    )
  })

  it('rejects altered signatures, payloads, unknown fields and wrong keys', () => {
    const manifest = signed()
    const warn = vi.fn()
    expect(() =>
      verifyUpdateManifest({...manifest, signature: Buffer.alloc(64).toString('base64')}, publicPem, warn),
    ).toThrow('signature')
    expect(() => verifyUpdateManifest({...manifest, minimumChromium: '999'}, publicPem, warn)).toThrow('signature')
    expect(() => verifyUpdateManifest({...manifest, futureField: true}, publicPem, warn)).toThrow('signature')
    const wrongKey = generateKeyPairSync('ed25519').publicKey.export({type: 'spki', format: 'pem'}).toString()
    expect(() => verifyUpdateManifest(manifest, wrongKey, warn)).toThrow('signature')
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns for legacy manifests and the explicit unconfigured production key', () => {
    const warn = vi.fn()
    verifyUpdateManifest(unsigned, publicPem, warn)
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('Unsigned'))
    verifyUpdateManifest(signed(), '', warn)
    expect(warn).toHaveBeenLastCalledWith(expect.stringContaining('not configured'))
    expect(() => verifyUpdateManifest(unsigned, publicPem, warn, true)).toThrow('required')
    expect(() => verifyUpdateManifest(signed(), '', warn, true)).toThrow('not configured')
  })

  it('requires distinct hashes for the DMG and the installable macOS ZIP when signed', () => {
    const manifest = {...unsigned, assets: {macos: {arm64: {...asset, zip_url: 'https://example.com/Seed.zip'}}}}
    expect(() => verifyUpdateManifest(signed(manifest), publicPem, vi.fn())).toThrow('missing')
    manifest.assets.macos.arm64 = {...manifest.assets.macos.arm64, ...{zip_sha256: 'b'.repeat(64)}}
    expect(verifyUpdateManifest(signed(manifest), publicPem, vi.fn()).assets.macos?.arm64?.zip_sha256).toBe(
      'b'.repeat(64),
    )
  })

  it('does not interpret malformed signatures or hashes as legacy omissions', () => {
    expect(() => verifyUpdateManifest({...unsigned, signature: ''}, publicPem, vi.fn())).toThrow()
    expect(() =>
      verifyUpdateManifest({...unsigned, assets: {win32: {x64: {...asset, sha256: 'bad'}}}}, publicPem, vi.fn()),
    ).toThrow()
  })
})

it('hashes the actual downloaded bytes and rejects a corrupt installer before installation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'seed-update-hash-'))
  const file = join(directory, 'installer.zip')
  try {
    await writeFile(file, 'installer bytes')
    const digest = createHash('sha256').update('installer bytes').digest('hex')
    await expect(verifyUpdateAsset(file, digest)).resolves.toBeUndefined()
    await writeFile(file, 'corrupt bytes')
    await expect(verifyUpdateAsset(file, digest)).rejects.toThrow('SHA-256 mismatch')
    await expect(verifyUpdateAsset(file, undefined)).resolves.toBeUndefined()
  } finally {
    await rm(directory, {recursive: true, force: true})
  }
})
