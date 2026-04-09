import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {asResponse, createActionArgs, createLoaderArgs} from './route-test-utils'

const {setEmailUnsubscribedMock} = vi.hoisted(() => ({
  setEmailUnsubscribedMock: vi.fn(),
}))

vi.mock('@/db', () => ({
  setEmailUnsubscribed: setEmailUnsubscribedMock,
}))

describe('hm.api.unsubscribe route', () => {
  beforeEach(() => {
    vi.resetModules()
    setEmailUnsubscribedMock.mockReset()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns a CORS preflight response for OPTIONS requests', async () => {
    const {loader} = await import('./routes/hm.api.unsubscribe')
    const response = asResponse(
      await loader(
        createLoaderArgs(
          new Request('http://localhost/hm/api/unsubscribe', {
            method: 'OPTIONS',
          }),
        ),
      ),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('adds CORS headers to successful action responses', async () => {
    const {action} = await import('./routes/hm.api.unsubscribe')
    const response = asResponse(
      await action(
        createActionArgs(
          new Request('http://localhost/hm/api/unsubscribe?token=token-1', {
            method: 'POST',
          }),
        ),
      ),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(setEmailUnsubscribedMock).toHaveBeenCalledWith('token-1', true)
    await expect(response.json()).resolves.toEqual({ok: true})
  })
})
