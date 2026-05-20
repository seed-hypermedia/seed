import {describe, expect, it, vi} from 'vitest'
import {resolveHypermediaUrl} from './hm-resolver'

describe('resolveHypermediaUrl', () => {
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

    fetchMock.mockRestore()
  })
})
