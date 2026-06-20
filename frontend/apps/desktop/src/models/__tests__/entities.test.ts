import {beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {enqueueDeletedDocumentParentCardCleanup, pushDeletedEntitiesBestEffort} from '../entities'

vi.mock('@/grpc-client', () => ({
  grpcClient: {},
}))

const cleanupEnqueueMock = vi.hoisted(() => vi.fn(async () => ({enqueued: true})))

vi.mock('@/trpc', () => ({
  client: {
    documentCardCleanup: {
      enqueue: {
        mutate: cleanupEnqueueMock,
      },
    },
  },
}))

vi.mock('../documents', () => ({
  usePushResource: () => vi.fn(),
}))

describe('pushDeletedEntitiesBestEffort', () => {
  it('resolves when peer propagation fails after a local delete', async () => {
    const firstId = hmId('alice', {path: ['first']})
    const secondId = hmId('alice', {path: ['second']})
    const pushError = new Error('gateway unavailable')
    const push = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    push.mockResolvedValueOnce(true)
    push.mockRejectedValueOnce(pushError)

    try {
      await expect(pushDeletedEntitiesBestEffort(push, [firstId, secondId])).resolves.toBeUndefined()

      expect(push).toHaveBeenCalledTimes(2)
      expect(push).toHaveBeenNthCalledWith(1, firstId)
      expect(push).toHaveBeenNthCalledWith(2, secondId)
      expect(consoleError).toHaveBeenCalledWith('Failed to push deleted entity update', secondId.id, pushError)
    } finally {
      consoleError.mockRestore()
    }
  })
})

describe('enqueueDeletedDocumentParentCardCleanup', () => {
  beforeEach(() => {
    cleanupEnqueueMock.mockClear()
  })

  it('enqueues cleanup only for the selected deleted document after tombstones publish', async () => {
    const selectedId = hmId('alice', {path: ['parent', 'child']})
    const descendantId = hmId('alice', {path: ['parent', 'child', 'grandchild']})

    await enqueueDeletedDocumentParentCardCleanup({
      ids: [selectedId, descendantId],
      signingAccountUid: 'alice',
      capabilityId: 'cap-1',
    })

    expect(cleanupEnqueueMock).toHaveBeenCalledTimes(1)
    expect(cleanupEnqueueMock).toHaveBeenCalledWith({
      deletedDocumentId: selectedId.id,
      signingAccountUid: 'alice',
      capabilityId: 'cap-1',
    })
  })

  it('does not enqueue cleanup when there is no selected deleted document', async () => {
    await enqueueDeletedDocumentParentCardCleanup({ids: [], signingAccountUid: 'alice'})

    expect(cleanupEnqueueMock).not.toHaveBeenCalled()
  })
})
