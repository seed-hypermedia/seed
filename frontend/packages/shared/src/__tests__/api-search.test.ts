import {describe, expect, it, vi} from 'vitest'
import {Search} from '../api-search'

const account = 'z6Mkq9emq1yUBq4KSeiSH5yzgNBJSnidPVqFnTpzjCdLxB3R'

describe('Search.getData', () => {
  it('forwards search tuning fields to SearchResources', async () => {
    const searchResources = vi.fn().mockResolvedValue({resources: []})
    const grpcClient = {
      resources: {
        searchResources,
      },
    } as any

    await Search.getData(
      grpcClient,
      {
        query: 'honda',
        includeBody: true,
        contextSize: 43,
        searchType: 0,
        pageSize: 20,
        iriFilter: `hm://${account}*`,
        contentTypeFilter: [0],
      },
      (() => Promise.resolve(null)) as any,
    )

    expect(searchResources).toHaveBeenCalledWith({
      query: 'honda',
      includeBody: true,
      contextSize: 43,
      accountUid: undefined,
      loggedAccountUid: undefined,
      searchType: 0,
      pageSize: 20,
      iriFilter: `hm://${account}*`,
      contentTypeFilter: [0],
    })
  })

  it('maps comment hits to their containing document and keeps the comment id for focus', async () => {
    const grpcClient = {
      resources: {
        searchResources: vi.fn().mockResolvedValue({
          resources: [
            {
              id: `hm://${account}/z6GXZLPYtXaHn4`,
              docId: `hm://${account}/tests-moved`,
              content: 'helloPear',
              type: 'comment',
              icon: '',
              parentNames: ['Julio'],
            },
          ],
        }),
      },
    } as any

    const result = await Search.getData(
      grpcClient,
      {
        query: 'hellopear',
        includeBody: true,
      },
      (() => Promise.resolve(null)) as any,
    )

    expect(result.entities).toHaveLength(1)
    expect(result.entities[0]).toMatchObject({
      id: {
        id: `hm://${account}/tests-moved`,
        uid: account,
        path: ['tests-moved'],
      },
      commentId: `${account}/z6GXZLPYtXaHn4`,
      title: 'helloPear',
      type: 'comment',
    })
  })
})
