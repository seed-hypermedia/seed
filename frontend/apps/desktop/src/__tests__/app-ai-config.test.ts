import fs from 'fs/promises'
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
    return fs.rm('/tmp/seed-test-data', {recursive: true, force: true})
  })

  it('repairs stale selected and last-used provider ids during config migration', async () => {
    await fs.mkdir('/tmp/seed-test-data', {recursive: true})
    await fs.writeFile(
      '/tmp/seed-test-data/ai-config.json',
      JSON.stringify({
        selectedProviderId: 'missing-provider',
        lastUsedProviderId: 'missing-provider',
        agentProviders: [
          {
            id: 'gemini-provider',
            label: 'Gemini',
            type: 'gemini',
            model: 'gemini-2.5-flash',
            apiKey: 'AIza-test-key',
          },
        ],
      }),
      'utf-8',
    )

    const mod = await import('../app-ai-config')
    const config = await mod.readConfig()

    expect(config.selectedProviderId).toBe('gemini-provider')
    expect(config.lastUsedProviderId).toBe('gemini-provider')
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

  it('lists Gemini generation models across pages and normalizes them to base model ids', async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          models: [
            {
              name: 'models/gemini-2.5-flash-001',
              baseModelId: 'gemini-2.5-flash',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemma-3-4b-it',
              baseModelId: 'gemma-3-4b-it',
              supportedGenerationMethods: ['generateContent'],
            },
          ],
          nextPageToken: 'page-2',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          models: [
            {
              name: 'models/gemini-2.5-pro-001',
              baseModelId: 'gemini-2.5-pro',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/gemini-2.5-flash-002',
              baseModelId: 'gemini-2.5-flash',
              supportedGenerationMethods: ['generateContent'],
            },
            {
              name: 'models/embedding-001',
              baseModelId: 'embedding-001',
              supportedGenerationMethods: ['embedContent'],
            },
          ],
        }),
      )

    const caller = await loadCaller()
    const models = await caller.listGeminiModels('AIza-test-key')

    expect(models).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro'])
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(firstUrl.origin + firstUrl.pathname).toBe('https://generativelanguage.googleapis.com/v1beta/models')
    expect(firstUrl.searchParams.get('key')).toBe('AIza-test-key')
    expect(firstUrl.searchParams.get('pageSize')).toBe('1000')

    const secondUrl = new URL(String(fetchMock.mock.calls[1]?.[0]))
    expect(secondUrl.searchParams.get('pageToken')).toBe('page-2')
  })
})
