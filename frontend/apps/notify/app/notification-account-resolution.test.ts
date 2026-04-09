import {describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared'
import {resolveNotificationAccount} from './notification-account-resolution'

describe('resolveNotificationAccount', () => {
  it('returns the aliased account uid when account loading follows a profile redirect', async () => {
    const loadAccount = vi.fn(async () => ({
      type: 'account' as const,
      id: hmId('real-account'),
      metadata: {
        name: 'Real Account',
      },
    }))

    await expect(resolveNotificationAccount(loadAccount, 'session-key')).resolves.toEqual({
      uid: 'real-account',
      metadata: {
        name: 'Real Account',
      },
    })
  })

  it('falls back to the original uid when account loading does not resolve an account', async () => {
    const loadAccount = vi.fn(async () => ({
      type: 'account-not-found' as const,
      uid: 'session-key',
    }))

    await expect(resolveNotificationAccount(loadAccount, 'session-key')).resolves.toEqual({
      uid: 'session-key',
      metadata: null,
    })
  })
})
