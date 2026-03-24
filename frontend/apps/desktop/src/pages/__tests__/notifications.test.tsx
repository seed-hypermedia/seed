import {isNotificationEventRead} from '@/models/notification-read-logic'
import type {NotificationPayload} from '@shm/shared/models/notification-payload'
import {LoadedEventWithNotifMeta} from '@shm/shared/models/activity-service'
import {classifyNotificationEvent} from '@shm/shared/models/notification-event-classifier'
import {describe, expect, it} from 'vitest'
import {
  getMaxLoadedNotificationEventAtMs,
  markNotificationReadAndNavigate,
  notificationRouteForPayload,
  notificationTitle,
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

function createMentionPayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    feedEventId: 'mention-event-1',
    eventAtMs: 1_000,
    reason: 'mention',
    eventType: 'citation',
    author: {uid: 'author', name: 'Alice', icon: null},
    target: {uid: 'source', path: ['doc'], name: 'Source Doc'},
    commentId: null,
    sourceId: null,
    citationType: 'd',
    ...overrides,
  }
}

function createReplyPayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    feedEventId: 'reply-event-1',
    eventAtMs: 2_000,
    reason: 'reply',
    eventType: 'comment',
    author: {uid: 'author-2', name: 'Bob', icon: null},
    target: {uid: 'site', path: ['post'], name: 'Post'},
    commentId: 'comment-version-cid',
    sourceId: null,
    citationType: null,
    ...overrides,
  }
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

  it('classifies discussion notifications when selected account authored the target document', () => {
    const event = createReplyEvent({
      replyParentAuthor: null,
      target: {
        id: hmId('site-owner', ['post']),
        metadata: {name: 'Post'},
      } as any,
      targetAuthorUids: ['target-account'],
      comment: {
        id: 'comment-version-cid',
        threadRoot: undefined,
      } as any,
    })
    expect(classifyNotificationEvent(event, 'target-account')).toBe('discussion')
  })

  it('suppresses citation discussion notifications to avoid duplicates', () => {
    const event = createMentionEvent({
      citationType: 'c',
      target: {
        id: hmId('site-owner', ['post']),
        metadata: {name: 'Post'},
      } as any,
      targetAuthorUids: ['target-account'],
      comment: {
        id: 'comment-version-cid',
        threadRoot: undefined,
      } as any,
    })
    expect(classifyNotificationEvent(event, 'target-account')).toBeNull()
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
    const payload = createReplyPayload()
    const route = notificationRouteForPayload(payload)
    expect(route).toEqual({
      key: 'comments',
      id: expect.objectContaining({uid: 'site', path: ['post']}),
      openComment: 'comment-version-cid',
    })
  })

  it('creates route for mention notifications', () => {
    const payload = createMentionPayload()
    const route = notificationRouteForPayload(payload)
    expect(route).toEqual({
      key: 'document',
      id: expect.objectContaining({uid: 'source', path: ['doc']}),
    })
  })

  it('marks event read before navigating', async () => {
    const callOrder: string[] = []
    const item = createReplyPayload()
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

  it('includes document name for mention notifications from comment events', () => {
    const payload = createMentionPayload({eventType: 'comment'})
    expect(notificationTitle(payload)).toBe('Alice mentioned you in Source Doc')
  })

  it('falls back to source path when mention source metadata is missing', () => {
    const payload = createMentionPayload({
      author: {uid: 'author', name: 'Alice', icon: null},
      target: {uid: 'source', path: ['fallback-doc'], name: null},
    })
    expect(notificationTitle(payload)).toBe('Alice mentioned you in fallback-doc')
  })

  it('prefers resolved author and target metadata when building notification titles', () => {
    const payload = createReplyPayload({
      author: {uid: 'author-2', name: 'Old Name', icon: null},
      target: {uid: 'site', path: ['post'], name: 'Old Post'},
    })
    expect(
      notificationTitle(payload, {
        authorName: 'Updated Name',
        targetName: 'Updated Post',
      }),
    ).toBe('Updated Name replied to your comment in Updated Post')
  })

  it('falls back to payload metadata when resolved notification metadata is unavailable', () => {
    const payload = createReplyPayload({
      author: {uid: 'author-2', name: 'Stored Name', icon: null},
      target: {uid: 'site', path: ['post'], name: 'Stored Post'},
    })
    expect(
      notificationTitle(payload, {
        authorName: null,
        targetName: undefined,
      }),
    ).toBe('Stored Name replied to your comment in Stored Post')
  })

  it('computes mark-all timestamp from latest loaded event', () => {
    const notifications = [createMentionPayload({eventAtMs: 10}), createReplyPayload({eventAtMs: 20})]
    expect(getMaxLoadedNotificationEventAtMs(notifications, 1)).toBe(20)
    expect(getMaxLoadedNotificationEventAtMs([], 99)).toBe(99)
  })

  it('creates route for ref (site-doc-update) notifications', () => {
    const payload: NotificationPayload = {
      feedEventId: 'ref-event-1',
      eventAtMs: 3_000,
      reason: 'site-doc-update',
      eventType: 'ref',
      author: {uid: 'author', name: 'Alice', icon: null},
      target: {uid: 'site-owner', path: ['updated-page'], name: 'Updated Page'},
      commentId: null,
      sourceId: null,
      citationType: null,
    }
    const route = notificationRouteForPayload(payload)
    expect(route).toEqual({
      key: 'document',
      id: expect.objectContaining({uid: 'site-owner', path: ['updated-page']}),
    })
  })

  it('returns null for ref notifications without target uid', () => {
    const payload: NotificationPayload = {
      feedEventId: 'ref-event-2',
      eventAtMs: 3_000,
      reason: 'site-doc-update',
      eventType: 'ref',
      author: {uid: 'author', name: 'Alice', icon: null},
      target: {uid: '', path: null, name: null},
      commentId: null,
      sourceId: null,
      citationType: null,
    }
    expect(notificationRouteForPayload(payload)).toBeNull()
  })

  it('creates correct route for citation with source path', () => {
    // Simulates the corrected payload where target contains the source (citing) doc info
    const payload = createMentionPayload({
      target: {uid: 'citing-account', path: ['their', 'document'], name: 'Their Doc'},
    })
    const route = notificationRouteForPayload(payload)
    expect(route).toEqual({
      key: 'document',
      id: expect.objectContaining({uid: 'citing-account', path: ['their', 'document']}),
    })
  })

  it('navigates to source document path for citation mention, not home document', () => {
    // Regression: citation mentions previously lost the source path, navigating to
    // the home document of the citing account instead of the specific sub-document.
    const payload: NotificationPayload = {
      feedEventId: 'regression-1',
      eventAtMs: 1_000,
      reason: 'mention',
      eventType: 'citation',
      author: {uid: 'author', name: 'Alice', icon: null},
      // target must contain source (citing) doc info per server convention
      target: {uid: 'other-account', path: ['deep', 'nested', 'page'], name: 'Nested Page'},
      commentId: null,
      sourceId: null,
      citationType: 'd',
    }
    const route = notificationRouteForPayload(payload)
    expect(route).toEqual({
      key: 'document',
      id: expect.objectContaining({
        uid: 'other-account',
        path: ['deep', 'nested', 'page'],
      }),
    })
    // Must NOT navigate to the home document (path: null)
    expect((route as any).id.path).not.toBeNull()
  })

  it('navigates to comment on source document for comment citation', () => {
    const payload: NotificationPayload = {
      feedEventId: 'regression-2',
      eventAtMs: 1_000,
      reason: 'mention',
      eventType: 'citation',
      author: {uid: 'author', name: 'Alice', icon: null},
      target: {uid: 'site-owner', path: ['blog-post'], name: 'Blog Post'},
      commentId: 'comment-abc',
      sourceId: null,
      citationType: 'c',
    }
    const route = notificationRouteForPayload(payload)
    expect(route).toEqual({
      key: 'comments',
      id: expect.objectContaining({uid: 'site-owner', path: ['blog-post']}),
      openComment: 'comment-abc',
    })
  })

  it('does not navigate when route is null for unknown event types', () => {
    const payload: NotificationPayload = {
      feedEventId: 'unknown-1',
      eventAtMs: 1_000,
      reason: 'mention',
      eventType: 'unknown',
      author: {uid: 'author', name: 'Alice', icon: null},
      target: {uid: 'account', path: null, name: null},
      commentId: null,
      sourceId: null,
      citationType: null,
    }
    expect(notificationRouteForPayload(payload)).toBeNull()
  })

  it('does not navigate when comment notification has empty target uid', () => {
    const payload: NotificationPayload = {
      feedEventId: 'empty-uid-1',
      eventAtMs: 1_000,
      reason: 'reply',
      eventType: 'comment',
      author: {uid: 'author', name: 'Alice', icon: null},
      target: {uid: '', path: null, name: null},
      commentId: 'comment-1',
      sourceId: null,
      citationType: null,
    }
    expect(notificationRouteForPayload(payload)).toBeNull()
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
