import {describe, expect, it, vi} from 'vitest'
import {resolveHypermediaUrl} from './hm-resolver'

describe('resolveHypermediaUrl', () => {
  it('uses /hm gateway paths as canonical ids when the domain store marks the domain as a gateway', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const resolved = await resolveHypermediaUrl('https://hyper.media/hm/z6Mktarget/:profile', {
      domainResolver: async () => ({registeredAccountUid: 'z6Mkgateway', isGateway: true}),
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(resolved?.id).toBe('hm://z6Mktarget/:profile')
    expect(resolved?.hmId).toMatchObject({
      uid: 'z6Mktarget',
      path: [':profile'],
      hostname: 'hyper.media',
      latest: true,
    })
  })

  it('keeps /hm paths relative to custom domains that are not gateways', async () => {
    const resolved = await resolveHypermediaUrl('https://example.com/hm/z6Mktarget/:profile', {
      domainResolver: async () => ({registeredAccountUid: 'z6Mkdomain', isGateway: false}),
    })

    expect(resolved?.id).toBe('hm://z6Mkdomain/hm/z6Mktarget/:profile')
    expect(resolved?.hmId).toMatchObject({
      uid: 'z6Mkdomain',
      path: ['hm', 'z6Mktarget', ':profile'],
      hostname: 'https://example.com',
      latest: true,
    })
  })
})
