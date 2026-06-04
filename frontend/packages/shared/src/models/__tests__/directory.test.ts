import {describe, expect, it, vi} from 'vitest'
import {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import {SortAttribute} from '../../client/.generated/documents/v3alpha/documents_pb'
import {BIG_INT} from '../../constants'
import {hmId} from '../../utils/entity-id-url'

vi.mock('../entity', () => ({
  prepareHMDocumentInfo: vi.fn((doc) => doc),
}))

import {createQueryResolver} from '../directory'

function makeEntry(
  overrides: Partial<{
    id: ReturnType<typeof hmId>
    path: string[]
    name: string
    createTime: string
    updateTime: string
    latestChangeTime: string
    latestCommentTime: string
    authors: string[]
    displayPublishTime: string
  }>,
): HMDocumentInfo {
  const path = overrides.path ?? ['projects', 'a']
  return {
    type: 'document',
    id: overrides.id ?? hmId('alice', {path}),
    path,
    authors: overrides.authors ?? [],
    createTime: overrides.createTime ?? '2024-01-01T00:00:00Z',
    updateTime: overrides.updateTime ?? '2024-01-01T00:00:00Z',
    sortTime: new Date(overrides.updateTime ?? '2024-01-01T00:00:00Z'),
    genesis: '',
    version: '',
    breadcrumbs: [],
    activitySummary: {
      latestChangeTime: overrides.latestChangeTime ?? overrides.updateTime ?? '2024-01-01T00:00:00Z',
      latestCommentTime: overrides.latestCommentTime,
      latestCommentId: '',
      commentCount: 0,
      isUnread: false,
    },
    generationInfo: {genesis: '', generation: 0n},
    metadata: {
      name: overrides.name ?? path[path.length - 1] ?? 'Untitled',
      displayPublishTime: overrides.displayPublishTime,
    },
    visibility: 'PUBLIC',
  } as unknown as HMDocumentInfo
}

describe('createQueryResolver', () => {
  it('uses listDirectory for children queries, maps supported sort options, and filters the parent document', async () => {
    const parent = makeEntry({id: hmId('alice', {path: ['projects']}), path: ['projects'], name: 'Projects'})
    const childOlder = makeEntry({
      id: hmId('alice', {path: ['projects', 'older']}),
      path: ['projects', 'older'],
      name: 'Older',
      latestChangeTime: '2024-01-01T00:00:00Z',
    })
    const childNewer = makeEntry({
      id: hmId('alice', {path: ['projects', 'newer']}),
      path: ['projects', 'newer'],
      name: 'Newer',
      latestChangeTime: '2024-03-01T00:00:00Z',
    })

    const listDirectory = vi.fn().mockResolvedValue({documents: [parent, childOlder, childNewer]})
    const resolver = createQueryResolver({documents: {listDirectory}} as any)

    const result = await resolver({
      includes: [{space: 'alice', path: '/projects', mode: 'Children'}],
      sort: [{term: 'ActivityTime', reverse: false}],
    })

    expect(listDirectory).toHaveBeenCalledWith({
      account: 'alice',
      directoryPath: '/projects',
      recursive: false,
      pageSize: BIG_INT,
      sortOptions: {
        attribute: SortAttribute.ACTIVITY_TIME,
        descending: true,
      },
    })
    expect(result?.results.map((doc) => doc.metadata.name)).toEqual(['Newer', 'Older'])
  })

  it('filters results by author before sorting', async () => {
    const parent = makeEntry({id: hmId('alice', {path: ['projects']}), path: ['projects'], name: 'Projects'})
    const authoredByAlice = makeEntry({
      id: hmId('alice', {path: ['projects', 'alice']}),
      path: ['projects', 'alice'],
      name: 'Alice',
      authors: ['alice-author', 'co-author'],
      updateTime: '2024-01-01T00:00:00Z',
    })
    const authoredByBob = makeEntry({
      id: hmId('alice', {path: ['projects', 'bob']}),
      path: ['projects', 'bob'],
      name: 'Bob',
      authors: ['bob-author'],
      updateTime: '2024-03-01T00:00:00Z',
    })

    const listDirectory = vi.fn().mockResolvedValue({documents: [parent, authoredByBob, authoredByAlice]})
    const resolver = createQueryResolver({documents: {listDirectory}} as any)

    const result = await resolver({
      includes: [{space: 'alice', path: '/projects', mode: 'AllDescendants'}],
      sort: [{term: 'UpdateTime', reverse: false}],
      filters: [{type: 'Author', uid: 'alice-author'}],
    })

    expect(result?.results.map((doc) => doc.metadata.name)).toEqual(['Alice'])
  })

  it('combines author OR filters with publish date range filters', async () => {
    const inRangeAlice = makeEntry({
      id: hmId('alice', {path: ['projects', 'in-range-alice']}),
      path: ['projects', 'in-range-alice'],
      name: 'In Range Alice',
      authors: ['alice-author'],
      displayPublishTime: '2024-02-15',
    })
    const inRangeBob = makeEntry({
      id: hmId('alice', {path: ['projects', 'in-range-bob']}),
      path: ['projects', 'in-range-bob'],
      name: 'In Range Bob',
      authors: ['bob-author'],
      displayPublishTime: '2024-02-20',
    })
    const outOfRangeAlice = makeEntry({
      id: hmId('alice', {path: ['projects', 'out-of-range-alice']}),
      path: ['projects', 'out-of-range-alice'],
      name: 'Out Of Range Alice',
      authors: ['alice-author'],
      displayPublishTime: '2023-12-31',
    })
    const wrongAuthor = makeEntry({
      id: hmId('alice', {path: ['projects', 'wrong-author']}),
      path: ['projects', 'wrong-author'],
      name: 'Wrong Author',
      authors: ['carol-author'],
      displayPublishTime: '2024-02-15',
    })

    const listDirectory = vi.fn().mockResolvedValue({
      documents: [wrongAuthor, outOfRangeAlice, inRangeBob, inRangeAlice],
    })
    const resolver = createQueryResolver({documents: {listDirectory}} as any)

    const result = await resolver({
      includes: [{space: 'alice', path: '/projects', mode: 'AllDescendants'}],
      sort: [{term: 'Title', reverse: false}],
      filters: [
        {type: 'Author', uid: 'alice-author'},
        {type: 'Author', uid: 'bob-author'},
        {type: 'PublishDate', from: '2024-01-01', to: '2024-12-31'},
      ],
    })

    expect(result?.results.map((doc) => doc.metadata.name)).toEqual(['In Range Alice', 'In Range Bob'])
  })

  it('still uses listDirectory for unsupported server sorts and applies client-side sorting', async () => {
    const parent = makeEntry({id: hmId('alice', {path: ['projects']}), path: ['projects'], name: 'Projects'})
    const older = makeEntry({
      id: hmId('alice', {path: ['projects', 'older']}),
      path: ['projects', 'older'],
      name: 'Older',
      updateTime: '2024-01-01T00:00:00Z',
    })
    const newer = makeEntry({
      id: hmId('alice', {path: ['projects', 'newer']}),
      path: ['projects', 'newer'],
      name: 'Newer',
      updateTime: '2024-03-01T00:00:00Z',
    })

    const listDirectory = vi.fn().mockResolvedValue({documents: [parent, older, newer]})
    const resolver = createQueryResolver({documents: {listDirectory}} as any)

    const result = await resolver({
      includes: [{space: 'alice', path: '/projects', mode: 'AllDescendants'}],
      sort: [{term: 'UpdateTime', reverse: false}],
    })

    expect(listDirectory).toHaveBeenCalledWith({
      account: 'alice',
      directoryPath: '/projects',
      recursive: true,
      pageSize: BIG_INT,
    })
    expect(result?.results.map((doc) => doc.metadata.name)).toEqual(['Newer', 'Older'])
  })
})
