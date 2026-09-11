import {describe, expect, it} from 'vitest'
import {mentionCandidateSubtitle, rankMentionCandidates} from './mention-ranking'
import {hmId} from '../utils/entity-id-url'
import type {HMMentionCandidate} from '@seed-hypermedia/client/hm-types'
const now = Date.UTC(2026, 8, 11)
function account(uid: string, title: string, extra: Partial<HMMentionCandidate> = {}): HMMentionCandidate {
  return {
    id: hmId(uid),
    type: 'account',
    title,
    icon: '',
    parentNames: [],
    searchQuery: '',
    sameSite: false,
    issuedContact: false,
    ...extra,
  }
}
describe('mention ranking', () => {
  it('keeps exact matches ahead of contextual prefix matches', () => {
    const exact = account('a', 'Alex')
    const boosted = account('b', 'Alexander', {sameSite: true, issuedContact: true, activityTime: now})
    expect(rankMentionCandidates([boosted, exact], 'Alex', [], now).map((c) => c.id.uid)).toEqual(['a', 'b'])
  })
  it('allows recent visits and activity to outweigh contacts and site membership', () => {
    const old = account('old', 'Old', {sameSite: true, issuedContact: true})
    const recent = account('recent', 'Recent', {activityTime: now})
    expect(
      rankMentionCandidates(
        [old, recent],
        '',
        [{id: hmId('recent', {path: [':profile']}), time: now, name: 'Recent'}],
        now,
      )[0]?.id.uid,
    ).toBe('recent')
  })
  it('matches both public names and petnames and excludes unrelated seeds', () => {
    expect(
      rankMentionCandidates(
        [account('a', 'Buddy', {publicName: 'Alice'}), account('b', 'Bob', {issuedContact: true})],
        'Alice',
        [],
        now,
      ).map((c) => c.id.uid),
    ).toEqual(['a'])
  })
  it('deduplicates versions and does not boost a home document from a profile visit', () => {
    const doc = {...account('a', 'Home'), type: 'document' as const, id: hmId('a', {version: 'v1', latest: true})}
    const results = rankMentionCandidates(
      [doc, {...doc, id: hmId('a', {version: 'v2', latest: true})}],
      '',
      [{id: hmId('a', {path: [':profile']}), time: now, name: 'A'}],
      now,
    )
    expect(results).toHaveLength(1)
    expect(results[0]?.hint).toBe('Home document')
  })
  it('labels issued contacts without assuming a profile-follow subscription', () => {
    expect(rankMentionCandidates([account('site', 'Site', {issuedContact: true})], '', [], now)[0]?.hint).toBe(
      'Contact',
    )
  })
})

describe('mention context and subtitles', () => {
  it('shows factual activity and a site role instead of an account ID', () => {
    const [candidate] = rankMentionCandidates(
      [
        account('a', 'Alice', {
          activityTime: now - 120_000,
          activityType: 'publication',
          accountRole: 'site-editor',
        }),
      ],
      '',
      [],
      now,
    )
    expect(candidate?.hint).toBe('Published 2m ago · Site editor')
    expect(mentionCandidateSubtitle(candidate!)).toBe('Published 2m ago · Site editor')
  })
  it('uses comment activity and contact fallback without calling followers members', () => {
    expect(
      rankMentionCandidates(
        [
          account('a', 'Alice', {
            activityTime: now - 120_000,
            activityType: 'comment',
            accountRole: 'site-follower',
          }),
        ],
        '',
        [],
        now,
      )[0]?.hint,
    ).toBe('Commented 2m ago · Site follower')
    expect(rankMentionCandidates([account('a', 'Alice', {sameSite: true})], '', [], now)[0]?.hint).toBeUndefined()
  })
  it('uses public name as fallback and a clean short ID only without useful hints', () => {
    expect(
      mentionCandidateSubtitle(account('long-account-identifier', 'Buddy', {petname: 'Buddy', publicName: 'Alice'})),
    ).toBe('Alice')
    expect(mentionCandidateSubtitle(account('long-account-identifier', 'Alice'))).toBe('long-acc…tifier')
  })
  it('boosts direct reply authors ahead of thread participants but keeps exact text first', () => {
    const context = {participants: [{uid: 'b'}, {uid: 'c'}], replyAuthorUid: 'c'}
    expect(
      rankMentionCandidates(
        [account('a', 'Alex'), account('b', 'Alexander'), account('c', 'Alexander')],
        '',
        [],
        now,
        context,
      ).map((c) => c.id.uid),
    ).toEqual(['c', 'b', 'a'])
    expect(
      rankMentionCandidates(
        [account('a', 'Alex'), account('b', 'Alexander'), account('c', 'Alexander')],
        'Alex',
        [],
        now,
        context,
      ).map((c) => c.id.uid),
    ).toEqual(['a', 'c', 'b'])
  })
  it('does not boost documents and describes known thread activity', () => {
    const context = {
      participants: [
        {uid: 'b', latestCommentTime: now - 120_000},
        {uid: 'a', isThreadAuthor: true},
      ],
    }
    expect(rankMentionCandidates([account('b', 'Bob')], '', [], now, context)[0]?.hint).toBe(
      'Replied 2m ago · In this thread',
    )
    expect(rankMentionCandidates([account('a', 'Alice')], '', [], now, context)[0]?.hint).toBe('Thread author')
    const docs = [account('a', 'A'), account('b', 'B')].map((c) => ({...c, type: 'document' as const}))
    expect(rankMentionCandidates(docs, '', [], now, {...context, replyAuthorUid: 'b'}).map((c) => c.id.uid)).toEqual([
      'a',
      'b',
    ])
  })
})

it('describes thread-author comment activity without implying it was a reply', () => {
  const thread = {participants: [{uid: 'author', isThreadAuthor: true, latestCommentTime: now - 120_000}]}
  expect(rankMentionCandidates([account('author', 'Author')], '', [], now, thread)[0]?.hint).toBe(
    'Commented 2m ago · Thread author',
  )
})

it('preserves reply identity through account aliases regardless of candidate arrival order', () => {
  const oldBea = 'z6MkgHKiUr9ijJTTgNfrt6uCn85q1wMzu1fVyP5KXLyKjwgE'
  const currentBea = 'z6MkkGNjfnikRkxK9EaxMPYy3HYxNGkRyXTWxxRtynB2kyeb'
  const canonical = account(currentBea, 'Bea')
  const alias = account(currentBea, 'Bea', {sourceAccountUid: oldBea})
  const other = account('unrelated', 'Bea', {activityTime: now, sameSite: true, issuedContact: true})
  for (const candidates of [
    [canonical, other, alias],
    [alias, other, canonical],
  ]) {
    const result = rankMentionCandidates(candidates, 'be', [], now, {
      replyAuthorUid: oldBea,
      participants: [{uid: oldBea, isThreadAuthor: true, latestCommentTime: now - 120_000}],
    })
    expect(result.map((c) => c.id.uid)).toEqual([currentBea, 'unrelated'])
    expect(result[0]?.hint).toBe('Commented 2m ago · Replying to')
    expect(result[1]?.hint).not.toContain('Replying to')
  }
})

it('excludes the selected reply account and its aliases, but not another account with the same name', () => {
  const candidates = [
    account('self', 'Demo'),
    account('self', 'Demo', {sourceAccountUid: 'old-self'}),
    account('other', 'Demo'),
  ]
  for (const selectedAccountUid of ['self', 'old-self']) {
    expect(
      rankMentionCandidates(candidates, '', [], now, {
        selectedAccountUid,
        replyAuthorUid: 'old-self',
        participants: [{uid: 'old-self'}, {uid: 'other'}],
      }).map((c) => c.id.uid),
    ).toEqual(['other'])
  }
  expect(rankMentionCandidates(candidates, '', [], now).map((c) => c.id.uid)).toEqual(['other', 'self'])
})

it('does not exclude documents owned by the selected reply account', () => {
  const document = {...account('self', 'Home'), type: 'document' as const}
  expect(rankMentionCandidates([document], '', [], now, {selectedAccountUid: 'self'})).toHaveLength(1)
})
