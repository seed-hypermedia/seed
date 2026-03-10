import {describe, expect, test} from 'bun:test'
import {getProfileAvatarImageSrc} from './profile'

describe('getProfileAvatarImageSrc', () => {
  test('rewrites ipfs urls to the configured backend base url', () => {
    expect(getProfileAvatarImageSrc('http://localhost:58001', 'ipfs://bafkreiabc')).toBe(
      'http://localhost:58001/ipfs/bafkreiabc',
    )
  })

  test('leaves non-ipfs urls unchanged', () => {
    expect(getProfileAvatarImageSrc('http://localhost:58001', 'https://example.com/avatar.png')).toBe(
      'https://example.com/avatar.png',
    )
  })

  test('uses same-origin ipfs paths when backend base url is empty', () => {
    expect(getProfileAvatarImageSrc('', 'ipfs://bafkreiabc')).toBe('/ipfs/bafkreiabc')
  })
})
