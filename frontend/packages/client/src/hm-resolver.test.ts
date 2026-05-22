import {afterEach, describe, expect, it, vi} from 'vitest'
import {resolveHypermediaUrl} from './hm-resolver'

describe('resolveHypermediaUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves custom-domain profile URLs from the domain resolver without fetching', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const result = await resolveHypermediaUrl(
      'https://dream-machines-2.hyper.media/:profile/z6MkfopTfn1vwUZiPsFK82w8BTuV4ewV6zZKaU4sTtnuU5bt',
      {
        domainResolver: async () => 'z6MksiteUid',
      },
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result?.id).toBe('hm://z6MkfopTfn1vwUZiPsFK82w8BTuV4ewV6zZKaU4sTtnuU5bt/:profile')
    expect(result?.hmId.uid).toBe('z6MkfopTfn1vwUZiPsFK82w8BTuV4ewV6zZKaU4sTtnuU5bt')
    expect(result?.hmId.path).toEqual([':profile'])
  })

  it('falls back to the domain resolver when the OPTIONS fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
    const domainResolver = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('z6MksiteUid')

    const result = await resolveHypermediaUrl('https://site.example/projects/seed?v=cid123#blk1[5:15]', {
      domainResolver,
    })

    expect(domainResolver).toHaveBeenCalledTimes(2)
    expect(result?.id).toBe('hm://z6MksiteUid/projects/seed')
    expect(result?.hmId.uid).toBe('z6MksiteUid')
    expect(result?.hmId.path).toEqual(['projects', 'seed'])
    expect(result?.hmId.version).toBe('cid123')
    expect(result?.hmId.blockRef).toBe('blk1')
    expect(result?.hmId.blockRange).toEqual({start: 5, end: 15})
    expect(result?.hmId.hostname).toBe('https://site.example')
  })
})
