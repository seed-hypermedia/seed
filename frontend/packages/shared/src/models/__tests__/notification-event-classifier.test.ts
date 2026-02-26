import {describe, expect, it} from 'vitest'
import {classifyCommentNotificationForAccount} from '../notification-event-classifier'

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
