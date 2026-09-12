import {describe, expect, it} from 'vitest'
import {notificationToPayload} from './notification-persistence'

describe('document mention notification anchor persistence review', () => {
  it('retains sourceContext from a document mention', () => {
    const payload = notificationToPayload(
      {
        reason: 'mention',
        source: 'document',
        authorAccountId: 'author',
        authorMeta: null,
        targetMeta: {name: 'Source Doc'},
        subjectAccountId: 'mentioned',
        subjectAccountMeta: null,
        targetId: {
          id: 'hm://source/doc',
          uid: 'source',
          path: ['doc'],
          version: null,
          blockRef: null,
          blockRange: null,
          hostname: null,
          scheme: null,
          latest: null,
        },
        url: 'https://example.test/hm/source/doc',
        sourceContext: 'block-1',
      } as any,
      'event-1',
      1_000,
    ) as any

    expect(payload.sourceContext).toBe('block-1')
  })
})
