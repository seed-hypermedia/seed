import {hmId} from '@shm/shared'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const enqueue = vi.hoisted(() => vi.fn(async () => ({enqueued: true})))
vi.mock('@/trpc', () => ({client: {documentCardCleanup: {enqueue: {mutate: enqueue}}}}))
import {
  autoLinkParentAfterPublish,
  appendDocumentCardToParent,
  updateParentCardsAfterDocumentRelocation,
} from '../auto-link-parent'

describe('durable parent reference maintenance', () => {
  beforeEach(() => enqueue.mockClear())
  const childId = hmId('alice', {path: ['parent', 'child']})
  it('queues first publication without touching the parent draft in the caller', async () => {
    const result = await autoLinkParentAfterPublish({
      childId,
      childDraftId: 'local-child',
      signingAccountUid: 'alice',
      isPrivate: false,
    })
    expect(result.kind).toBe('queued')
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'add',
        parentDocumentId: hmId('alice', {path: ['parent']}).id,
        targetDocumentId: childId.id,
        childDraftId: 'local-child',
      }),
    )
  })
  it('skips private children even when a temporary parent card exists', async () => {
    await autoLinkParentAfterPublish({
      childId,
      childDraftId: 'local-child',
      signingAccountUid: 'alice',
      isPrivate: true,
    })
    expect(enqueue).not.toHaveBeenCalled()
  })
  it('skips home documents', async () => {
    await autoLinkParentAfterPublish({childId: hmId('alice'), signingAccountUid: 'alice', isPrivate: false})
    expect(enqueue).not.toHaveBeenCalled()
  })
  it('delegates move destination suppression to the same add job', async () => {
    await appendDocumentCardToParent({childId, signingAccountUid: 'alice'})
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({operation: 'add', targetDocumentId: childId.id}))
  })
  it('queues only the explicitly selected source card and the destination', async () => {
    const from = hmId('alice', {path: ['old', 'child']})
    await updateParentCardsAfterDocumentRelocation({
      from,
      to: childId,
      signingAccountUid: 'alice',
      origin: {parentDocumentId: hmId('alice', {path: ['arbitrary-container']}), embedBlockId: 'clicked-card'},
    })
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'remove',
        sourceDocumentId: from.id,
        parentDocumentId: hmId('alice', {path: ['arbitrary-container']}).id,
        targetBlockId: 'clicked-card',
      }),
    )
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({operation: 'add', targetDocumentId: childId.id}))
  })
  it('surfaces intake errors so callers can distinguish maintenance failure from child success', async () => {
    enqueue.mockRejectedValueOnce(new Error('storage unavailable'))
    await expect(autoLinkParentAfterPublish({childId, signingAccountUid: 'alice', isPrivate: false})).rejects.toThrow(
      'storage unavailable',
    )
  })
})
