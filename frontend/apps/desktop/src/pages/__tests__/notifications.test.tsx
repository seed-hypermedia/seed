import {isNotificationEventRead} from '@/models/notification-read-logic'
import {LoadedEventWithNotifMeta} from '@shm/shared/models/activity-service'
import {describe, expect, it} from 'vitest'
import {
  classifyNotificationEvent,
  getMaxLoadedNotificationEventAtMs,
  markNotificationReadAndNavigate,
  notificationRouteForEvent,
} from '../notifications-helpers'

function hmId(uid: string, path: string[] | null = null) {
  return {
    id: `hm://${uid}${path?.length ? `/${path.join('/')}` : ''}`,
    uid,
    path,
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    scheme: null,
    latest: null,
  }
}

function createMentionEvent(overrides: Partial<LoadedEventWithNotifMeta> = {}) {
  return {
    type: 'citation',
    citationType: 'd',
    id: 'citation-id',
    feedEventId: 'mention-event-1',
    eventAtMs: 1_000,
    time: '2025-01-01T00:00:00Z',
    author: {
      id: hmId('author'),
      metadata: {name: 'Alice'},
    },
    source: {
      id: hmId('source', ['doc']),
      metadata: {name: 'Source Doc'},
    },
    target: {
      id: hmId('target-account'),
      metadata: {name: 'Target'},
    },
    targetFragment: undefined,
    comment: null,
    replyCount: 0,
    ...overrides,
  } as unknown as LoadedEventWithNotifMeta
}

function createReplyEvent(overrides: Partial<LoadedEventWithNotifMeta> = {}) {
  return {
    type: 'comment',
    id: 'comment-id',
    feedEventId: 'reply-event-1',
    eventAtMs: 2_000,
    time: '2025-01-02T00:00:00Z',
    author: {
      id: hmId('author-2'),
      metadata: {name: 'Bob'},
    },
    replyParentAuthor: {
      id: hmId('target-account'),
      metadata: {name: 'Target User'},
    },
    comment: {
      id: 'comment-version-cid',
    },
    target: {
      id: hmId('site', ['post']),
      metadata: {name: 'Post'},
    },
    replyingComment: null,
    commentId: hmId('author-2', ['comment']),
    replyCount: 1,
    ...overrides,
  } as unknown as LoadedEventWithNotifMeta
}

describe('notifications page helpers', () => {
  it('classifies mention notifications for selected account root target', () => {
    const event = createMentionEvent()
    expect(classifyNotificationEvent(event, 'target-account')).toBe('mention')
  })

  it('classifies mention notifications for selected account path targets', () => {
    const event = createMentionEvent({
      target: {
        id: hmId('target-account', ['foo', 'bar']),
        metadata: {name: 'Target Doc'},
      } as any,
    })
    expect(classifyNotificationEvent(event, 'target-account')).toBe('mention')
  })

  it('classifies reply notifications when parent author matches selected account', () => {
    const event = createReplyEvent()
    expect(classifyNotificationEvent(event, 'target-account')).toBe('reply')
  })

  it('classifies mention notifications from comment body embeds', () => {
    const event = createReplyEvent({
      replyParentAuthor: null,
      target: {
        id: hmId('some-other-account', ['post']),
        metadata: {name: 'Post'},
      } as any,
      comment: {
        id: 'comment-version-cid',
        targetAccount: 'some-other-account',
        content: [
          {
            block: {
              id: 'p1',
              type: 'Paragraph',
              text: 'ping',
              attributes: {},
              annotations: [
                {
                  type: 'Embed',
                  starts: [0],
                  ends: [1],
                  link: 'hm://target-account',
                },
              ],
            },
          },
        ],
      } as any,
    })
    expect(classifyNotificationEvent(event, 'target-account')).toBe('mention')
  })

  it('ignores self-authored comment body mentions', () => {
    const event = createReplyEvent({
      replyParentAuthor: null,
      author: {
        id: hmId('target-account'),
        metadata: {name: 'Self'},
      } as any,
      comment: {
        id: 'comment-version-cid',
        targetAccount: 'some-other-account',
        content: [
          {
            block: {
              id: 'p1',
              type: 'Paragraph',
              text: 'ping',
              attributes: {},
              annotations: [
                {
                  type: 'Embed',
                  starts: [0],
                  ends: [1],
                  link: 'hm://target-account',
                },
              ],
            },
          },
        ],
      } as any,
    })
    expect(classifyNotificationEvent(event, 'target-account')).toBeNull()
  })

  it('filters out events for other selected accounts', () => {
    const mention = createMentionEvent()
    const reply = createReplyEvent()
    expect(classifyNotificationEvent(mention, 'another-account')).toBeNull()
    expect(classifyNotificationEvent(reply, 'another-account')).toBeNull()
  })

  it('creates route for reply notifications', () => {
    const event = createReplyEvent()
    expect(notificationRouteForEvent(event)).toEqual({
      key: 'comments',
      id: hmId('site', ['post']),
      openComment: 'comment-version-cid',
    })
  })

  it('creates route for mention notifications', () => {
    const event = createMentionEvent()
    expect(notificationRouteForEvent(event)).toEqual({
      key: 'document',
      id: hmId('source', ['doc']),
    })
  })

  it('marks event read before navigating', async () => {
    const callOrder: string[] = []
    const item = {
      reason: 'reply' as const,
      event: createReplyEvent(),
    }
    await markNotificationReadAndNavigate({
      accountUid: 'target-account',
      item,
      markEventRead: async () => {
        callOrder.push('mark')
      },
      navigate: () => {
        callOrder.push('navigate')
      },
    })
    expect(callOrder).toEqual(['mark', 'navigate'])
  })

  it('computes mark-all timestamp from latest loaded event', () => {
    const notifications = [
      {reason: 'mention' as const, event: createMentionEvent({eventAtMs: 10})},
      {reason: 'reply' as const, event: createReplyEvent({eventAtMs: 20})},
    ]
    expect(getMaxLoadedNotificationEventAtMs(notifications, 1)).toBe(20)
    expect(getMaxLoadedNotificationEventAtMs([], 99)).toBe(99)
  })

  it('applies read rules with watermark and explicit read event IDs', () => {
    const readState = {
      accountId: 'target-account',
      markAllReadAtMs: 1000,
      readEvents: [{eventId: 'explicit-read', eventAtMs: 2000}],
      dirty: false,
      lastSyncAtMs: null,
      lastSyncError: null,
    }

    expect(
      isNotificationEventRead({
        readState,
        eventId: 'older-than-watermark',
        eventAtMs: 900,
      }),
    ).toBe(true)
    expect(
      isNotificationEventRead({
        readState,
        eventId: 'explicit-read',
        eventAtMs: 2000,
      }),
    ).toBe(true)
    expect(
      isNotificationEventRead({
        readState,
        eventId: 'unread',
        eventAtMs: 2500,
      }),
    ).toBe(false)
  })
})
