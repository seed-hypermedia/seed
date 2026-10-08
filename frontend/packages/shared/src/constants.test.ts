import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('SEED_HOST_URL', '')
  vi.stubEnv('VITE_SEED_HOST_URL', '')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('hosting service configuration', () => {
  it('uses the web runtime origin ahead of build-time settings', async () => {
    vi.stubGlobal('window', {ENV: {SEED_HOST_URL: 'https://hosting.example'}})
    vi.stubEnv('VITE_SEED_HOST_URL', 'http://localhost:5555')
    expect((await import('./constants')).SEED_HOST_URL).toBe('https://hosting.example')
  })

  it('supports a server runtime origin for staging', async () => {
    vi.stubEnv('SEED_HOST_URL', 'https://staging-host.example')
    expect((await import('./constants')).SEED_HOST_URL).toBe('https://staging-host.example')
  })

  it('preserves the desktop configured service', async () => {
    vi.stubEnv('VITE_SEED_HOST_URL', 'https://desktop-host.example')
    expect((await import('./constants')).SEED_HOST_URL).toBe('https://desktop-host.example')
  })

  it('defaults to local hosting in development', async () => {
    expect((await import('./constants')).SEED_HOST_URL).toBe('http://localhost:5555')
  })
})
