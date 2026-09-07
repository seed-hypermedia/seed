import {describe, expect, it} from 'vitest'
import {isPublicIPAddress, normalizeIPHostname} from './remote-file-security'

describe('remote file address policy', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '192.168.0.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::127.0.0.1',
    '::ffff:127.0.0.1',
    '64:ff9b::7f00:1',
    '100::1',
    '100:0:0:1::1',
    '2001:db8::1',
    '2002::1',
    '3fff::1',
    '4000::1',
    '5f00::1',
    'fc00::1',
    'fe80::1',
    'ff00::1',
  ])('rejects non-global address %s', (address) => {
    expect(isPublicIPAddress(address)).toBe(false)
  })

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2001:4860:4860::8888'])(
    'allows global unicast address %s',
    (address) => {
      expect(isPublicIPAddress(address)).toBe(true)
    },
  )

  it('removes URL brackets from IPv6 literals', () => {
    expect(normalizeIPHostname('[2001:4860:4860::8888]')).toBe('2001:4860:4860::8888')
  })
})
