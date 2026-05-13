import {describe, expect, it} from 'vitest'
import type {PlainMessage} from '@bufbuild/protobuf'
import {Code, ConnectError} from '@connectrpc/connect'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import type {Event} from '@shm/shared'
import {
  getEventId,
  isNotificationEventTooOld,
  isTransientGrpcUnavailableError,
  matchesCursorEvent,
  resolveContentReferenceNames,
} from './email-notifier'

const TEST_CID_1 = 'bafkreigh2akiscaildcuj3pww4f2ptib34dm5x3dpljubjkbzfgutz5jum'
const TEST_CID_2 = 'bafy2bzacedexveqjcytw4trm6a4lxgxyssrg3ubxyro6rp5o4lo545qcl3imw'
const TEST_ACCOUNT = 'z6Mks-test-account'

function toTimestamp(ms: number) {
  return {
    seconds: BigInt(Math.floor(ms / 1000)),
  }
}

function createBlobEvent(input: {
  eventTimeMs: number
  observeTimeMs: number
  cid?: string | undefined
}): PlainMessage<Event> {
  const {eventTimeMs, observeTimeMs} = input
  const cid = 'cid' in input ? input.cid : TEST_CID_1
  const value: any = {
    blobType: 'Comment',
    author: TEST_ACCOUNT,
    resource: `hm://${TEST_ACCOUNT}/comment`,
    extraAttrs: '',
    blobId: 1n,
    isPinned: false,
  }
  if (cid !== undefined) value.cid = cid

  return {
    data: {
      case: 'newBlob',
      value,
    },
    account: TEST_ACCOUNT,
    eventTime: toTimestamp(eventTimeMs) as PlainMessage<Event>['eventTime'],
    observeTime: toTimestamp(observeTimeMs) as PlainMessage<Event>['observeTime'],
  }
}

function createMentionEvent(
  input: {
    sourceCid?: string | undefined
    target?: string | undefined
    mentionType?: string | undefined
  } = {},
): PlainMessage<Event> {
  const sourceCid = 'sourceCid' in input ? input.sourceCid : TEST_CID_1
  const target = 'target' in input ? input.target : `hm://${TEST_ACCOUNT}`
  const mentionType = 'mentionType' in input ? input.mentionType : ''
  const sourceBlob: any = {
    author: TEST_ACCOUNT,
    createTime: toTimestamp(Date.UTC(2026, 0, 1, 12, 0, 0)),
  }
  if (sourceCid !== undefined) sourceBlob.cid = sourceCid
  const value: any = {
    source: `hm://${TEST_ACCOUNT}`,
    sourceType: 'doc/Embed',
    sourceContext: 'block-1',
    sourceBlob,
    isExactVersion: false,
    sourceDocument: '',
    targetVersion: '',
    targetFragment: '',
  }
  if (target !== undefined) value.target = target
  if (mentionType !== undefined) value.mentionType = mentionType

  return {
    data: {
      case: 'newMention',
      value,
    },
    account: TEST_ACCOUNT,
    eventTime: toTimestamp(Date.UTC(2026, 0, 1, 12, 0, 0)) as PlainMessage<Event>['eventTime'],
    observeTime: toTimestamp(Date.UTC(2026, 0, 1, 12, 0, 0)) as PlainMessage<Event>['observeTime'],
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

describe('getEventId', () => {
  it('returns blob cursor IDs only when the blob CID is valid', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)

    expect(
      getEventId(
        createBlobEvent({
          eventTimeMs: now,
          observeTimeMs: now,
          cid: TEST_CID_1,
        }),
      ),
    ).toBe(`blob-${TEST_CID_1}`)
    expect(
      getEventId(
        createBlobEvent({
          eventTimeMs: now,
          observeTimeMs: now,
          cid: undefined,
        }),
      ),
    ).toBeUndefined()
    expect(
      getEventId(
        createBlobEvent({
          eventTimeMs: now,
          observeTimeMs: now,
          cid: 'undefined',
        }),
      ),
    ).toBeUndefined()
  })

  it('returns mention cursor IDs only when source CID and target are present', () => {
    expect(getEventId(createMentionEvent({sourceCid: TEST_CID_1, target: `hm://${TEST_ACCOUNT}`}))).toBe(
      `mention-${TEST_CID_1}--hm://${TEST_ACCOUNT}`,
    )
    expect(getEventId(createMentionEvent({sourceCid: undefined}))).toBeUndefined()
    expect(getEventId(createMentionEvent({target: undefined}))).toBeUndefined()
  })
})

describe('matchesCursorEvent', () => {
  it('does not match events against malformed stored cursors', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0)
    const event = createBlobEvent({
      eventTimeMs: now,
      observeTimeMs: now,
      cid: TEST_CID_1,
    })

    expect(matchesCursorEvent(event, getEventId(event), 'blob-undefined')).toBe(false)
    expect(matchesCursorEvent(event, getEventId(event), `blob-${TEST_CID_1}`)).toBe(true)
  })

  it('does not collapse distinct mention targets from the same source blob', () => {
    const firstMention = createMentionEvent({
      sourceCid: TEST_CID_2,
      target: `hm://${TEST_ACCOUNT}/first-doc`,
    })
    const secondMention = createMentionEvent({
      sourceCid: TEST_CID_2,
      target: `hm://${TEST_ACCOUNT}/second-doc`,
    })

    expect(matchesCursorEvent(firstMention, getEventId(firstMention), getEventId(secondMention)!)).toBe(false)
  })
})

describe('isTransientGrpcUnavailableError', () => {
  it('matches Connect unavailable errors and their logged message form', () => {
    expect(isTransientGrpcUnavailableError(new ConnectError('', Code.Unavailable))).toBe(true)
    expect(isTransientGrpcUnavailableError({code: 'unavailable'})).toBe(true)
    expect(isTransientGrpcUnavailableError(new Error('[unavailable]'))).toBe(true)
    expect(isTransientGrpcUnavailableError(new Error('[internal] failed'))).toBe(false)
  })
})

describe('resolveContentReferenceNames', () => {
  it('resolves document and profile inline embeds for email rendering', async () => {
    const content: HMBlockNode[] = [
      {
        block: {
          id: 'block-1',
          type: 'Paragraph',
          text: '\uFFFC and \uFFFC linked',
          annotations: [
            {
              type: 'Embed',
              link: 'hm://doc-owner/projects/roadmap',
              starts: [0],
              ends: [1],
            },
            {
              type: 'Embed',
              link: 'hm://alice/:profile',
              starts: [6],
              ends: [7],
            },
            {
              type: 'Link',
              link: 'hm://doc-owner/linked-doc',
              starts: [8],
              ends: [14],
            },
          ],
        } as any,
        children: [],
      },
    ]

    const resolvedIds: string[] = []
    const resolvedNames = await resolveContentReferenceNames(content, async (id) => {
      resolvedIds.push(id.id)
      if (id.uid === 'alice' && id.path?.[0] === ':profile') return 'Alice'
      if (id.uid === 'doc-owner' && id.path?.join('/') === 'projects/roadmap') return 'Roadmap'
      return null
    })

    expect(resolvedIds).toEqual(['hm://doc-owner/projects/roadmap', 'hm://alice/:profile'])
    expect(resolvedNames).toEqual({
      'hm://doc-owner/projects/roadmap': 'Roadmap',
      'hm://alice/:profile': 'Alice',
    })
  })

  it('keeps resolving other inline embeds when one reference lookup fails', async () => {
    const content: HMBlockNode[] = [
      {
        block: {
          id: 'block-1',
          type: 'Paragraph',
          text: '\uFFFC and \uFFFC',
          annotations: [
            {
              type: 'Embed',
              link: 'hm://doc-owner/projects/missing',
              starts: [0],
              ends: [1],
            },
            {
              type: 'Embed',
              link: 'hm://doc-owner/projects/roadmap',
              starts: [6],
              ends: [7],
            },
          ],
        } as any,
        children: [],
      },
    ]

    const resolvedNames = await resolveContentReferenceNames(content, async (id) => {
      if (id.path?.at(-1) === 'missing') throw new Error('metadata unavailable')
      return 'Roadmap'
    })

    expect(resolvedNames).toEqual({
      'hm://doc-owner/projects/roadmap': 'Roadmap',
    })
  })
})
