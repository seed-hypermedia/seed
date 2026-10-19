import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const {setEmailUnsubscribedMock} = vi.hoisted(() => ({
  setEmailUnsubscribedMock: vi.fn(),
}))

vi.mock('@/db', () => ({
  setEmailUnsubscribed: setEmailUnsubscribedMock,
}))

describe('unsubscribe route', () => {
  beforeEach(() => {
    vi.resetModules()
    setEmailUnsubscribedMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('adds CORS headers to successful action responses', async () => {
    const {POST} = await import('./unsubscribe')
    const response = await POST(
      new Request('http://localhost/hm/api/unsubscribe?token=token-1', {
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(setEmailUnsubscribedMock).toHaveBeenCalledWith('token-1', true)
    await expect(response.json()).resolves.toEqual({ok: true})
  })

  it('unsubscribes on GET and redirects the browser to the settings page on the same origin', async () => {
    const {GET} = await import('./unsubscribe')
    const response = await GET(new Request('http://localhost/hm/api/notify/unsubscribe?token=token%201'))

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/hm/email-notifications?token=token%201')
    expect(setEmailUnsubscribedMock).toHaveBeenCalledWith('token 1', true)
  })
})
