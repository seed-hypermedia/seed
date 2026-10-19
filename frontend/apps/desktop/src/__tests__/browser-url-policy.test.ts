// @vitest-environment node
import {beforeEach, describe, expect, it, vi} from 'vitest'
vi.mock('node:dns/promises', () => ({lookup: vi.fn()}))
import {lookup} from 'node:dns/promises'
import {assertPublicWebUrl, isPrivateHost} from '../browser-url-policy'

beforeEach(() => vi.mocked(lookup).mockReset())
describe('browser URL policy', () => {
  it.each([
    'localhost',
    'a.localhost.',
    'printer.local',
    'db.internal',
    '127.99.1.2',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.2.1',
    '169.254.1.1',
    '100.64.0.1',
    '100.127.255.255',
    '0.0.0.0',
    '[::1]',
    '[fc00::1]',
    '[fdff::1]',
    '[fe80::1]',
    '[febf::1]',
    '[::ffff:8.8.8.8]',
    '[::ffff:127.0.0.1]',
    '2130706433',
    '0177.0.0.1',
    '0x7f000001',
    '127.1',
    '0x08080808',
    '010.010.010.010',
  ])('blocks %s without DNS', async (host) => {
    expect(isPrivateHost(`http://${host}/`)).toBe(true)
    await expect(assertPublicWebUrl(`http://${host}/`)).rejects.toThrow()
    expect(lookup).not.toHaveBeenCalled()
  })
  it.each(['8.8.8.8', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '[2606:4700:4700::1111]'])(
    'accepts public literal %s',
    async (host) => {
      expect(isPrivateHost(`https://${host}/`)).toBe(false)
      await expect(assertPublicWebUrl(`https://${host}/`)).resolves.toBeUndefined()
    },
  )
  it('rejects mixed public/private DNS and resolution failures', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([
      {address: '8.8.8.8', family: 4},
      {address: '10.0.0.1', family: 4},
    ] as never)
    await expect(assertPublicWebUrl('https://example.com')).rejects.toThrow('private')
    expect(lookup).toHaveBeenCalledWith('example.com', {all: true})
    vi.mocked(lookup).mockRejectedValueOnce(new Error('ENOTFOUND'))
    await expect(assertPublicWebUrl('https://example.com')).rejects.toThrow('ENOTFOUND')
  })
  it('permits hostnames only after checking all DNS answers', async () => {
    vi.mocked(lookup).mockResolvedValueOnce([{address: '8.8.8.8', family: 4}] as never)
    await expect(assertPublicWebUrl('https://example.com')).resolves.toBeUndefined()
  })
  it.each(['file:///etc/passwd', 'hm://alice', 'invalid'])('fails closed for %s', (url) => {
    expect(isPrivateHost(url)).toBe(true)
  })
})
