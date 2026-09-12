import {NotificationPayloadSchema} from '../../../packages/shared/src/models/notification-payload'
import {describe, expect, it} from 'vitest'

const basePayload = {
  feedEventId: 'mention-event-1',
  eventAtMs: 1_000,
  reason: 'mention',
  eventType: 'citation',
  author: {uid: 'author', name: 'Alice', icon: null},
  target: {uid: 'source', path: ['doc'], name: 'Source Doc'},
  commentId: null,
  sourceId: null,
  citationType: 'd',
}

describe('notification sourceContext compatibility review', () => {
  it('accepts old payloads and preserves a new optional sourceContext', () => {
    expect(NotificationPayloadSchema.parse(basePayload).sourceContext).toBeUndefined()
    expect(NotificationPayloadSchema.parse({...basePayload, sourceContext: 'block-1'}).sourceContext).toBe('block-1')
  })
})
