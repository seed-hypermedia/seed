import {describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {pushDeletedEntitiesBestEffort} from '../entities'

vi.mock('@/grpc-client', () => ({
  grpcClient: {},
}))

vi.mock('@/trpc', () => ({
  client: {},
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
