import {describe, expect, it} from 'vitest'
import type {PlainMessage} from '@bufbuild/protobuf'
import type {Event} from '@shm/shared'
import {isNotificationEventTooOld} from './email-notifier'

function toTimestamp(ms: number) {
  return {
    seconds: BigInt(Math.floor(ms / 1000)),
  }
}

function createBlobEvent({
  eventTimeMs,
  observeTimeMs,
}: {
  eventTimeMs: number
  observeTimeMs: number
}): PlainMessage<Event> {
  return {
    data: {
      case: 'newBlob',
      value: {
        cid: 'cid-test',
        blobType: 'Comment',
        author: 'z6Mks-test-account',
        resource: 'hm://z6Mks-test-account/comment',
        extraAttrs: '',
        blobId: 1n,
        isPinned: false,
      },
    },
    account: 'z6Mks-test-account',
    eventTime: toTimestamp(eventTimeMs) as PlainMessage<Event>['eventTime'],
    observeTime: toTimestamp(observeTimeMs) as PlainMessage<Event>['observeTime'],
  }
}

describe('isNotificationEventTooOld', () => {
  it('accepts events seen within the last hour', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)
    const event = createBlobEvent({
      eventTimeMs: now - 2 * 60 * 60 * 1000,
      observeTimeMs: now - 30 * 60 * 1000,
    })

    expect(isNotificationEventTooOld(event, now)).toBe(false)
  })

  it('rejects events whose newest timestamp is older than one hour', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)
    const event = createBlobEvent({
      eventTimeMs: now - 90 * 60 * 1000,
      observeTimeMs: now - 61 * 60 * 1000,
    })

    expect(isNotificationEventTooOld(event, now)).toBe(true)
  })
})
