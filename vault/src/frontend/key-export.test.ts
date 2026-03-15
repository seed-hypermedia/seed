import {describe, expect, mock, test} from 'bun:test'
import * as keyExport from './key-export'
import type * as vault from './vault'

function makeAccount(seedFill = 7): vault.Account {
  return {
    seed: new Uint8Array(32).fill(seedFill),
    createTime: 123,
    delegations: [],
  }
}

describe('account-key-export', () => {
  test('encodes a plaintext account export payload', async () => {
    const payload = await keyExport.buildAccountKeyExport({
      publicKey: 'z6MkgPlaintext',
      account: makeAccount(),
    })

    expect(payload.createTime).toEqual(expect.any(String))
    expect(new Date(payload.createTime).toISOString()).toBe(payload.createTime)
    expect(payload.publicKey).toBe('z6MkgPlaintext')
    expect(payload.keyB64).toEqual(expect.any(String))
    expect(payload.encryption).toBeUndefined()
  })

  test('encodes an encrypted account export payload when password is provided', async () => {
    const payload = await keyExport.buildAccountKeyExport({
      publicKey: 'z6MkgEncrypted',
      account: makeAccount(),
      password: 'secret-password',
      profile: {name: 'Alice', description: 'Profile description'},
    })

    expect(payload.encryption).toEqual({
      kdf: 'argon2id',
      argon2: {
        memoryCost: expect.any(Number),
        timeCost: expect.any(Number),
        parallelism: expect.any(Number),
        saltB64: expect.any(String),
      },
      cipher: 'xchacha20poly1305',
      nonceB64: expect.any(String),
    })
    expect(payload.profile).toEqual({
      name: 'Alice',
      description: 'Profile description',
    })
  })

  test('downloads the exported key as a browser file', async () => {
    const createObjectURL = mock(() => 'blob:export')
    const revokeObjectURL = mock(() => {})
    const click = mock(() => {})
    const append = mock(() => {})
    const remove = mock(() => {})
    const anchor = {
      click,
      remove,
      style: {display: ''},
      href: '',
      download: '',
    } as unknown as HTMLAnchorElement
    const createElement = mock(() => anchor)

    const originalCreateElement = document.createElement.bind(document)
    const originalAppend = document.body.append.bind(document.body)
    const originalCreateObjectURL = URL.createObjectURL.bind(URL)
    const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL)

    document.createElement = createElement as typeof document.createElement
    document.body.append = append as typeof document.body.append
    URL.createObjectURL = createObjectURL as typeof URL.createObjectURL
    URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL

    try {
      const result = await keyExport.saveAccountKeyFile({
        publicKey: 'z6MkhDownload',
        account: makeAccount(),
      })

      expect(result).toEqual({
        fileName: 'z6MkhDownload.hmkey.json',
        method: 'download',
      })
      expect(createElement).toHaveBeenCalledWith('a')
      expect(anchor.download).toBe('z6MkhDownload.hmkey.json')
      expect(click).toHaveBeenCalled()
      expect(remove).toHaveBeenCalled()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:export')
    } finally {
      document.createElement = originalCreateElement
      document.body.append = originalAppend
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
    }
  })
})
