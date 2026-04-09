import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {asResponse, createLoaderArgs} from './route-test-utils'

const {
  getEmailWithTokenMock,
  getNotificationConfigsForEmailMock,
  getSubscriptionMock,
  setEmailUnsubscribedMock,
  setSubscriptionMock,
  unsetNotificationConfigMock,
} = vi.hoisted(() => ({
  getEmailWithTokenMock: vi.fn(),
  getNotificationConfigsForEmailMock: vi.fn(),
  getSubscriptionMock: vi.fn(),
  setEmailUnsubscribedMock: vi.fn(),
  setSubscriptionMock: vi.fn(),
  unsetNotificationConfigMock: vi.fn(),
}))

vi.mock('@/db', () => ({
  getEmailWithToken: getEmailWithTokenMock,
  getNotificationConfigsForEmail: getNotificationConfigsForEmailMock,
  getSubscription: getSubscriptionMock,
  setEmailUnsubscribed: setEmailUnsubscribedMock,
  setSubscription: setSubscriptionMock,
  unsetNotificationConfig: unsetNotificationConfigMock,
}))

describe('hm.api.email-notif-token route', () => {
  beforeEach(() => {
    vi.resetModules()
    getEmailWithTokenMock.mockReset()
    getNotificationConfigsForEmailMock.mockReset()
    getSubscriptionMock.mockReset()
    setEmailUnsubscribedMock.mockReset()
    setSubscriptionMock.mockReset()
    unsetNotificationConfigMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns a CORS preflight response for OPTIONS requests', async () => {
    const {loader} = await import('./routes/hm.api.email-notif-token')
    const response = asResponse(
      await loader(
        createLoaderArgs(
          new Request('http://localhost/hm/api/email-notif-token', {
            method: 'OPTIONS',
          }),
        ),
      ),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('adds CORS headers to successful loader responses', async () => {
    const {loader} = await import('./routes/hm.api.email-notif-token')
    getEmailWithTokenMock.mockReturnValue({
      email: 'user@example.com',
      adminToken: 'admin-token',
      isUnsubscribed: false,
      subscriptions: [],
    })
    getNotificationConfigsForEmailMock.mockReturnValue([
      {
        accountId: 'account-1',
        email: 'user@example.com',
        verifiedTime: null,
      },
    ])

    const response = asResponse(
      await loader(createLoaderArgs(new Request('http://localhost/hm/api/email-notif-token?token=token-1'))),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    await expect(response.json()).resolves.toMatchObject({
      email: 'user@example.com',
      myNotifications: [
        {
          accountId: 'account-1',
          email: 'user@example.com',
        },
      ],
    })
  })
})
