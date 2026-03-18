import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const appInvalidateQueriesMock = vi.fn()
const fetchMock = vi.fn()

vi.mock('../app-invalidation', () => ({
  appInvalidateQueries: appInvalidateQueriesMock,
}))

vi.mock('../app-paths', () => ({
  userDataPath: '/tmp/seed-test-data',
  initPaths: vi.fn(),
}))

function jsonResponse(body: any, status: number = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'Content-Type': 'application/json'},
  })
}

async function loadCaller() {
  const mod = await import('../app-ai-config')
  return mod.aiConfigApi.createCaller({})
}

describe('app ai config', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps ChatGPT Pro login pending while transient OpenAI polling requests are retried', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          user_code: 'ABCD-EFGH',
          device_auth_id: 'device-auth-id',
          interval: 1,
        }),
      )
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(new Response('', {status: 403}))

    const caller = await loadCaller()
    const start = await caller.startOpenaiLogin({
      draft: {
        label: 'OpenAI',
        model: 'gpt-5',
      },
    })

    await Promise.resolve()
    await Promise.resolve()

    const statusBeforeRetry = await caller.getOpenaiLoginStatus(start.sessionId)
    expect(statusBeforeRetry.status).toBe('pending')
    expect(statusBeforeRetry.message).toBeUndefined()

    await vi.advanceTimersByTimeAsync(3000)

    const statusAfterRetry = await caller.getOpenaiLoginStatus(start.sessionId)
    expect(statusAfterRetry.status).toBe('pending')
    expect(statusAfterRetry.message).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
