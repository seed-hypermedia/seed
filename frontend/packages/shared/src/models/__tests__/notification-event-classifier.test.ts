import {describe, expect, it} from 'vitest'
import {hmId} from '../../utils/entity-id-url'
import {
  classifyCommentNotificationForAccount,
  classifyNotificationEvent,
  extractMentionedAccountUidsFromComment,
  getMentionedAccountUid,
  getCitationMentionKind,
} from '../notification-event-classifier'

function makeCommentWithMention(link: string) {
  return {
    id: 'comment-id',
    version: 'comment-version',
    author: 'bob',
    targetAccount: 'alice',
    targetVersion: 'target-version',
    content: [
      {
        block: {
          type: 'Paragraph' as const,
          id: 'block-1',
          text: '@alice',
          annotations: [{type: 'Embed' as const, link, starts: [0], ends: [6]}],
          attributes: {},
        },
        children: [],
      },
    ],
    createTime: '2024-01-01T00:00:00Z',
    updateTime: '2024-01-01T00:00:00Z',
    visibility: 'PUBLIC' as const,
  }
}

describe('classifyCommentNotificationForAccount', () => {
  it('classifies top-level comments on owned documents as discussion', () => {
    const reason = classifyCommentNotificationForAccount({
      subscriptionAccountUid: 'alice',
      commentAuthorUid: 'bob',
      targetAccountUid: 'alice',
      targetAuthorUids: ['alice'],
      isTopLevelComment: true,
      parentCommentAuthorUid: null,
      mentionedAccountUids: new Set(),
    })
    expect(reason).toBe('discussion')
  })

  it('classifies top-level comments on collaborated documents as discussion', () => {
    const reason = classifyCommentNotificationForAccount({
      subscriptionAccountUid: 'alice',
      commentAuthorUid: 'bob',
      targetAccountUid: 'site-owner',
      targetAuthorUids: ['site-owner', 'alice'],
      isTopLevelComment: true,
      parentCommentAuthorUid: null,
      mentionedAccountUids: new Set(),
    })
    expect(reason).toBe('discussion')
  })

  it('does not classify replies on collaborated documents as discussion', () => {
    const reason = classifyCommentNotificationForAccount({
      subscriptionAccountUid: 'alice',
      commentAuthorUid: 'bob',
      targetAccountUid: 'site-owner',
      targetAuthorUids: ['site-owner', 'alice'],
      isTopLevelComment: false,
      parentCommentAuthorUid: null,
      mentionedAccountUids: new Set(),
    })
    expect(reason).toBeNull()
  })
})

describe('comment reason priority', () => {
  const baseline = {
    subscriptionAccountUid: 'alice',
    commentAuthorUid: 'bob',
    targetAccountUid: 'alice',
    targetAuthorUids: ['alice'],
    isTopLevelComment: true,
    parentCommentAuthorUid: null,
    mentionedAccountUids: new Set(['alice']),
  }

  it('prefers body mention over discussion for both owner and collaborator', () => {
    expect(classifyCommentNotificationForAccount(baseline)).toBe('mention')
    expect(
      classifyCommentNotificationForAccount({
        ...baseline,
        targetAccountUid: 'site',
        targetAuthorUids: ['site', 'alice'],
      }),
    ).toBe('mention')
    expect(
      classifyNotificationEvent(
        {
          type: 'comment',
          comment: makeCommentWithMention('hm://alice/:profile'),
          author: {id: {uid: 'bob'}},
          target: {id: {uid: 'alice'}},
          targetAuthorUids: ['alice'],
        } as any,
        'alice',
      ),
    ).toBe('mention')
  })

  it('preserves reply over mention and self-author suppression', () => {
    expect(
      classifyCommentNotificationForAccount({
        ...baseline,
        isTopLevelComment: false,
        parentCommentAuthorUid: 'alice',
      }),
    ).toBe('reply')
    expect(classifyCommentNotificationForAccount({...baseline, commentAuthorUid: 'alice'})).toBeNull()
  })
})

describe('getMentionedAccountUid', () => {
  it('returns the uid for direct account mentions', () => {
    expect(getMentionedAccountUid('hm://alice')).toBe('alice')
  })

  it('returns the uid for profile mentions', () => {
    expect(getMentionedAccountUid('hm://alice/:profile')).toBe('alice')
  })

  it('returns the profile account uid for site profile mentions', () => {
    expect(getMentionedAccountUid('hm://site-owner/:profile/alice')).toBe('alice')
  })

  it('ignores document references', () => {
    expect(getMentionedAccountUid('hm://alice/notes')).toBeNull()
  })
})

describe('extractMentionedAccountUidsFromComment', () => {
  it('collects direct account mentions from comment annotations', () => {
    expect(extractMentionedAccountUidsFromComment(makeCommentWithMention('hm://alice'))).toEqual(new Set(['alice']))
  })

  it('collects profile mentions from comment annotations', () => {
    expect(extractMentionedAccountUidsFromComment(makeCommentWithMention('hm://alice/:profile'))).toEqual(
      new Set(['alice']),
    )
  })
})

it('does not notify an account for an explicit home document mention', () => {
  const comment = makeCommentWithMention('hm://alice?v=published&l')
  Object.assign(comment.content[0]!.block.annotations[0]!, {attributes: {mentionKind: 'document'}})
  expect(extractMentionedAccountUidsFromComment(comment)).toEqual(new Set())
})

it('does not classify explicit home document citations as account mentions', () => {
  expect(
    classifyNotificationEvent(
      {type: 'citation', citationType: 'd', mentionKind: 'document', target: {id: {uid: 'alice', path: []}}} as any,
      'alice',
    ),
  ).toBeNull()
  expect(
    classifyNotificationEvent(
      {type: 'citation', citationType: 'd', target: {id: {uid: 'alice', path: []}}} as any,
      'alice',
    ),
  ).toBe('mention')
})

it('derives citation identity from matching source blocks and preserves mixed legacy references', () => {
  const comment = makeCommentWithMention('hm://alice?v=captured&l')
  Object.assign(comment.content[0]!.block.annotations[0]!, {attributes: {mentionKind: 'document'}})
  expect(getCitationMentionKind(comment.content, hmId('alice'), 'block-1')).toBe('document')
  expect(getCitationMentionKind(comment.content, hmId('alice'), 'other-block')).toBeUndefined()
  expect(getCitationMentionKind(comment.content, hmId('bob'))).toBeUndefined()
  comment.content.push({
    ...makeCommentWithMention('hm://alice').content[0]!,
    block: {...makeCommentWithMention('hm://alice').content[0]!.block, id: 'legacy'},
  })
  expect(getCitationMentionKind(comment.content, hmId('alice'))).toBeUndefined()
  expect(getCitationMentionKind(comment.content, hmId('alice'), 'block-1')).toBe('document')
})
