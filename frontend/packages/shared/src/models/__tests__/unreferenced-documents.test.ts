import {describe, expect, it, vi} from 'vitest'
import {fetchAllUnreferencedDocuments} from '../unreferenced-documents'

describe('fetchAllUnreferencedDocuments', () => {
  it('consumes every page and preserves an incomplete index indicator', async () => {
    const listUnreferencedDocuments = vi
      .fn()
      .mockResolvedValueOnce({documents: [{id: {id: 'hm://site/a'}}], nextPageToken: 'next', indexIncomplete: false})
      .mockResolvedValueOnce({documents: [{id: {id: 'hm://site/b'}}], nextPageToken: '', indexIncomplete: true})

    const result = await fetchAllUnreferencedDocuments({listUnreferencedDocuments} as any, 'site')

    expect(listUnreferencedDocuments).toHaveBeenNthCalledWith(
      1,
      {siteAccount: 'site', pageSize: 100, pageToken: ''},
      {},
    )
    expect(listUnreferencedDocuments).toHaveBeenNthCalledWith(
      2,
      {siteAccount: 'site', pageSize: 100, pageToken: 'next'},
      {},
    )
    expect(result).toEqual({documents: [{id: {id: 'hm://site/a'}}, {id: {id: 'hm://site/b'}}], indexIncomplete: true})
  })
})
