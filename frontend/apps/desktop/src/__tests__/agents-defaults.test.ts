import {afterEach, describe, expect, test, vi} from 'vitest'

describe('agents defaults', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  test('the convert relay always points at the hosted server, whatever NODE_ENV says', async () => {
    // In dev the default agent server is the local one, which has no Datalab key: relaying there
    // would be a loop to a 503. The relay target is the hosted server unless explicitly overridden.
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('SEED_AGENTS_CONVERT_RELAY_URL', '')
    const dev = await import('@/agents-defaults')
    expect(dev.getDefaultConvertRelayUrl()).toBe('https://agentic.seed.hyper.media')
    expect(dev.getDefaultAgentServerUrl()).not.toBe(dev.getDefaultConvertRelayUrl())

    vi.stubEnv('SEED_AGENTS_CONVERT_RELAY_URL', 'https://staging.example')
    vi.resetModules()
    const overridden = await import('@/agents-defaults')
    expect(overridden.getDefaultConvertRelayUrl()).toBe('https://staging.example')
  })
})
