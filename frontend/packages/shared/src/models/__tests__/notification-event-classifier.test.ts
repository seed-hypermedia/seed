import {describe, expect, it} from 'vitest'
import {
  classifyCommentNotificationForAccount,
  extractMentionedAccountUidsFromComment,
  getMentionedAccountUid,
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
