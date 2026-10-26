import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const {setSubscriptionMock} = vi.hoisted(() => ({
  setSubscriptionMock: vi.fn(),
}))

const {sendNotificationWelcomeEmailMock} = vi.hoisted(() => ({
  sendNotificationWelcomeEmailMock: vi.fn(),
}))

const {requestAPIMock} = vi.hoisted(() => ({
  requestAPIMock: vi.fn(),
}))

vi.mock('@/db', () => ({
  setSubscription: setSubscriptionMock,
  getEmail: vi.fn(() => ({
    adminToken: 'admin-token',
    isUnsubscribed: false,
  })),
}))

vi.mock('@/emails', () => ({
  sendNotificationWelcomeEmail: sendNotificationWelcomeEmailMock,
}))

vi.mock('@/notify-request', () => ({
  requestAPI: requestAPIMock,
}))

describe('public-subscribe route', () => {
  beforeEach(() => {
    vi.resetModules()
    setSubscriptionMock.mockReset()
    sendNotificationWelcomeEmailMock.mockReset()
    requestAPIMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('adds CORS headers to successful subscription responses', async () => {
    const {POST} = await import('./public-subscribe')
    requestAPIMock.mockResolvedValue({
      type: 'account',
      metadata: {name: 'Example Account'},
    })

    const response = await POST(
      new Request('http://localhost/hm/api/public-subscribe', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          action: 'subscribe',
          email: 'user@example.com',
          accountId: 'account-1',
          notifyOwnedDocChange: true,
          notifySiteDiscussions: false,
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(setSubscriptionMock).toHaveBeenCalledWith({
      id: 'account-1',
      email: 'user@example.com',
      notifyOwnedDocChange: true,
      notifySiteDiscussions: false,
    })
    expect(sendNotificationWelcomeEmailMock).toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({success: true})
  })
})
