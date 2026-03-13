import {describe, expect, it} from 'vitest'
import {queryBlockSortedItems} from '../content'
import {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'

/** Minimal HMDocumentInfo factory — only fields the sort functions inspect */
function makeEntry(
  overrides: Partial<{
    name: string
    createTime: string
    updateTime: string
    displayPublishTime: string
    latestChangeTime: string
    latestCommentTime: string
  }>,
): HMDocumentInfo {
  return {
    type: 'document',
    id: {type: 'd', uid: 'test', path: null},
    path: [],
    authors: [],
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
      name: overrides.name ?? 'Untitled',
      displayPublishTime: overrides.displayPublishTime,
    },
    visibility: 'PUBLIC',
  } as unknown as HMDocumentInfo
}

describe('queryBlockSortedItems', () => {
  const docA = makeEntry({name: 'A', updateTime: '2024-01-01T00:00:00Z', createTime: '2024-01-01T00:00:00Z'})
  const docB = makeEntry({name: 'B', updateTime: '2024-03-01T00:00:00Z', createTime: '2024-02-01T00:00:00Z'})
  const docC = makeEntry({name: 'C', updateTime: '2024-02-01T00:00:00Z', createTime: '2024-03-01T00:00:00Z'})

  it('returns empty for empty entries', () => {
    expect(queryBlockSortedItems({entries: [], sort: [{term: 'UpdateTime', reverse: false}]})).toEqual([])
  })

  it('returns empty when sort array has != 1 element', () => {
    expect(queryBlockSortedItems({entries: [docA], sort: []})).toEqual([])
  })

  it('sorts by UpdateTime descending by default', () => {
    const result = queryBlockSortedItems({entries: [docA, docB, docC], sort: [{term: 'UpdateTime', reverse: false}]})
    expect(result.map((d) => d.metadata.name)).toEqual(['B', 'C', 'A'])
  })

  it('sorts by UpdateTime ascending when reversed', () => {
    const result = queryBlockSortedItems({entries: [docA, docB, docC], sort: [{term: 'UpdateTime', reverse: true}]})
    expect(result.map((d) => d.metadata.name)).toEqual(['A', 'C', 'B'])
  })

  it('sorts by CreateTime descending by default', () => {
    const result = queryBlockSortedItems({entries: [docA, docB, docC], sort: [{term: 'CreateTime', reverse: false}]})
    expect(result.map((d) => d.metadata.name)).toEqual(['C', 'B', 'A'])
  })

  it('sorts by Title alphabetically', () => {
    const result = queryBlockSortedItems({entries: [docC, docA, docB], sort: [{term: 'Title', reverse: false}]})
    expect(result.map((d) => d.metadata.name)).toEqual(['A', 'B', 'C'])
  })

  it('sorts by Title reversed', () => {
    const result = queryBlockSortedItems({entries: [docC, docA, docB], sort: [{term: 'Title', reverse: true}]})
    expect(result.map((d) => d.metadata.name)).toEqual(['C', 'B', 'A'])
  })
})

describe('queryBlockSortedItems — ActivityTime', () => {
  it('sorts by latest activity (comment time wins over change time)', () => {
    const oldEditRecentComment = makeEntry({
      name: 'OldEditRecentComment',
      updateTime: '2024-01-01T00:00:00Z',
      latestChangeTime: '2024-01-01T00:00:00Z',
      latestCommentTime: '2024-06-01T00:00:00Z',
    })
    const recentEditNoComment = makeEntry({
      name: 'RecentEditNoComment',
      updateTime: '2024-05-01T00:00:00Z',
      latestChangeTime: '2024-05-01T00:00:00Z',
    })
    const veryOld = makeEntry({
      name: 'VeryOld',
      updateTime: '2023-01-01T00:00:00Z',
      latestChangeTime: '2023-01-01T00:00:00Z',
    })

    const result = queryBlockSortedItems({
      entries: [recentEditNoComment, veryOld, oldEditRecentComment],
      sort: [{term: 'ActivityTime', reverse: false}],
    })
    // oldEditRecentComment has comment at June, recentEditNoComment at May, veryOld at Jan 2023
    expect(result.map((d) => d.metadata.name)).toEqual(['OldEditRecentComment', 'RecentEditNoComment', 'VeryOld'])
  })

  it('sorts by latest activity reversed (oldest activity first)', () => {
    const recent = makeEntry({
      name: 'Recent',
      updateTime: '2024-06-01T00:00:00Z',
      latestChangeTime: '2024-06-01T00:00:00Z',
    })
    const old = makeEntry({
      name: 'Old',
      updateTime: '2024-01-01T00:00:00Z',
      latestChangeTime: '2024-01-01T00:00:00Z',
    })

    const result = queryBlockSortedItems({
      entries: [recent, old],
      sort: [{term: 'ActivityTime', reverse: true}],
    })
    expect(result.map((d) => d.metadata.name)).toEqual(['Old', 'Recent'])
  })

  it('falls back to updateTime when activitySummary times are missing', () => {
    const recentUpdate = makeEntry({
      name: 'RecentUpdate',
      updateTime: '2024-06-01T00:00:00Z',
    })
    const oldUpdate = makeEntry({
      name: 'OldUpdate',
      updateTime: '2024-01-01T00:00:00Z',
    })

    const result = queryBlockSortedItems({
      entries: [oldUpdate, recentUpdate],
      sort: [{term: 'ActivityTime', reverse: false}],
    })
    expect(result.map((d) => d.metadata.name)).toEqual(['RecentUpdate', 'OldUpdate'])
  })

  it('uses max(latestChangeTime, latestCommentTime) for activity', () => {
    const changeWins = makeEntry({
      name: 'ChangeWins',
      updateTime: '2024-01-01T00:00:00Z',
      latestChangeTime: '2024-07-01T00:00:00Z',
      latestCommentTime: '2024-03-01T00:00:00Z',
    })
    const commentWins = makeEntry({
      name: 'CommentWins',
      updateTime: '2024-01-01T00:00:00Z',
      latestChangeTime: '2024-02-01T00:00:00Z',
      latestCommentTime: '2024-08-01T00:00:00Z',
    })

    const result = queryBlockSortedItems({
      entries: [changeWins, commentWins],
      sort: [{term: 'ActivityTime', reverse: false}],
    })
    // commentWins has Aug activity, changeWins has Jul
    expect(result.map((d) => d.metadata.name)).toEqual(['CommentWins', 'ChangeWins'])
  })
})
