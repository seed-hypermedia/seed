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
    expect(queryBlockSortedItems({entries: [], sort: [{key: 'updated', reverse: true}]})).toEqual([])
  })

  it('returns unchanged when sort array has != 1 element', () => {
    expect(queryBlockSortedItems({entries: [docA], sort: []})).toEqual([docA])
  })

  it('sorts by updated descending (newest first)', () => {
    const result = queryBlockSortedItems({entries: [docA, docB, docC], sort: [{key: 'updated', reverse: true}]})
    expect(result.map((d) => d.metadata.name)).toEqual(['B', 'C', 'A'])
  })

  it('sorts by updated ascending (oldest first)', () => {
    const result = queryBlockSortedItems({entries: [docA, docB, docC], sort: [{key: 'updated', reverse: false}]})
    expect(result.map((d) => d.metadata.name)).toEqual(['A', 'C', 'B'])
  })

  it('sorts by created descending (newest first)', () => {
    const result = queryBlockSortedItems({entries: [docA, docB, docC], sort: [{key: 'created', reverse: true}]})
    expect(result.map((d) => d.metadata.name)).toEqual(['C', 'B', 'A'])
  })

  it('sorts by title alphabetically', () => {
    const result = queryBlockSortedItems({entries: [docC, docA, docB], sort: [{key: 'title', reverse: false}]})
    expect(result.map((d) => d.metadata.name)).toEqual(['A', 'B', 'C'])
  })

  it('sorts by title descending', () => {
    const result = queryBlockSortedItems({entries: [docC, docA, docB], sort: [{key: 'title', reverse: true}]})
    expect(result.map((d) => d.metadata.name)).toEqual(['C', 'B', 'A'])
  })
})

describe('queryBlockSortedItems — ActivityTime', () => {
  it('sorts by latest activity descending (comment time wins over change time)', () => {
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
      sort: [{key: 'activity', reverse: true}],
    })
    // oldEditRecentComment has comment at June, recentEditNoComment at May, veryOld at Jan 2023
    expect(result.map((d) => d.metadata.name)).toEqual(['OldEditRecentComment', 'RecentEditNoComment', 'VeryOld'])
  })

  it('sorts by latest activity ascending (oldest activity first)', () => {
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
      sort: [{key: 'activity', reverse: false}],
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
      sort: [{key: 'activity', reverse: true}],
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
      sort: [{key: 'activity', reverse: true}],
    })
    // commentWins has Aug activity, changeWins has Jul
    expect(result.map((d) => d.metadata.name)).toEqual(['CommentWins', 'ChangeWins'])
  })
})
