import {describe, expect, it, vi} from 'vitest'
import {Search} from '../api-search'

const account = 'z6Mkq9emq1yUBq4KSeiSH5yzgNBJSnidPVqFnTpzjCdLxB3R'

describe('Search.getData', () => {
  it('forwards search tuning fields to SearchEntities', async () => {
    const searchEntities = vi.fn().mockResolvedValue({entities: [], nextPageToken: 'next-token'})
    const grpcClient = {
      entities: {
        searchEntities,
      },
    } as any

    const result = await Search.getData(
      grpcClient,
      {
        query: 'honda',
        includeBody: true,
        contextSize: 43,
        searchType: 0,
        pageSize: 20,
        pageToken: 'page-token',
        iriFilter: `hm://${account}*`,
        contentTypeFilter: [0],
        entityKindFilter: [1],
      },
      (() => Promise.resolve(null)) as any,
    )

    expect(searchEntities).toHaveBeenCalledWith({
      query: 'honda',
      includeBody: true,
      contextSize: 43,
      accountUid: undefined,
      loggedAccountUid: undefined,
      searchType: 0,
      pageSize: 20,
      pageToken: 'page-token',
      iriFilter: `hm://${account}*`,
      contentTypeFilter: [0],
      entityKindFilter: [1],
    })

    expect(result.nextPageToken).toBe('next-token')
  })

  it('maps profile hits and home document title hits to the account without a version', async () => {
    const grpcClient = {
      entities: {
        searchEntities: vi.fn().mockResolvedValue({
          nextPageToken: '',
          entities: [
            {id: `hm://${account}`, content: 'Clerk', type: 'profile', icon: '', parentNames: []},
            {id: `hm://${account}?v=head&l`, content: 'Clerk', type: 'title', icon: '', parentNames: []},
            {id: `hm://${account}/notes?v=head&l`, content: 'Notes', type: 'title', icon: '', parentNames: ['Clerk']},
            {id: `hm://${account}?v=head&l#block`, content: 'Clerk', type: 'title', icon: '', parentNames: []},
          ],
        }),
      },
    } as any

    const result = await Search.getData(grpcClient, {query: 'clerk'}, (() => Promise.resolve(null)) as any)

    expect(result.entities.map((e) => [e.type, e.id.id, e.id.version ?? null])).toEqual([
      ['profile', `hm://${account}`, null],
      ['profile', `hm://${account}`, null],
      ['document', `hm://${account}/notes`, 'head'],
      ['document', `hm://${account}`, 'head'],
    ])
  })

  it('maps comment hits to their containing document and keeps the comment id for focus', async () => {
    const grpcClient = {
      entities: {
        searchEntities: vi.fn().mockResolvedValue({
          nextPageToken: '',
          entities: [
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
