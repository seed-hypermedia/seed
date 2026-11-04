import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * Resolution order for the local agents server.
 *
 * This runs in the Electron main process, so nothing here is exercised by rendering tests — yet it
 * decides whether the app has a local server at all, and therefore whether "Local Agents" ever
 * appears in the UI. The attach path in particular is what `./dev up` relies on.
 */

const mockState = vi.hoisted(() => ({
  /** Health responses keyed by base URL; absent means the probe fails. */
  healthy: new Set<string>(),
  fetched: [] as string[],
  binaryExists: false,
  /** Whether a previous build's agents database exists in user data. */
  dbExists: false,
  /** The persisted local-server setting, as app-settings would return it. */
  settings: {} as Record<string, unknown>,
}))

vi.mock('electron', () => ({app: {addListener: vi.fn()}}))
vi.mock('@/app-paths', () => ({userDataPath: '/tmp/seed-test'}))
vi.mock('../app-paths', () => ({userDataPath: '/tmp/seed-test'}))
vi.mock('../logger', () => ({
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  rawMessage: vi.fn(),
}))
vi.mock('../win32-process', () => ({forceKillChildProcess: vi.fn()}))
const existsSync = vi.hoisted(
  () => (file: string) => (String(file).endsWith('agents.sqlite') ? mockState.dbExists : mockState.binaryExists),
)
vi.mock('node:fs', () => ({
  existsSync,
  mkdirSync: vi.fn(),
  default: {existsSync, mkdirSync: vi.fn()},
}))
vi.mock('../app-settings-store', () => ({
  getStoredSetting: (key: string) => mockState.settings[key] ?? null,
  writeStoredSetting: (key: string, value: unknown) => {
    mockState.settings[key] = value
  },
}))
vi.mock('../agents-server-path', () => ({
  getAgentsServerBinaryPath: () => '/nonexistent/seed-agents',
  getAgentsServerWorkingDirectory: () => '/nonexistent',
}))
vi.mock('child_process', () => ({spawn: vi.fn(), default: {spawn: vi.fn()}}))

import {
  getAgentsServerState,
  resolveLocalAgentsServerSpawn,
  setLocalAgentsServerEnabled,
  startLocalAgentsServer,
} from '../agents-server-process'
import {AGENTS_LOCAL_SERVER_SETTING_KEY} from '@shm/shared/constants'

const ORIGINAL_ENV = {...process.env}

beforeEach(() => {
  mockState.healthy = new Set()
  mockState.fetched = []
  mockState.binaryExists = false
  mockState.dbExists = false
  // Most cases below exercise the spawn path; the policy cases override this.
  mockState.settings = {[AGENTS_LOCAL_SERVER_SETTING_KEY]: 'on'}
  delete process.env.SEED_NO_AGENTS_SPAWN
  delete process.env.SEED_AGENTS_SERVER_URL
  // The dev shell exports this (.env.vars); tests exercise the release default unless set explicitly.
  delete process.env.SEED_AGENTS_HTTP_PORT

  vi.stubGlobal('fetch', async (url: string) => {
    mockState.fetched.push(String(url))
    const base = String(url).replace('/agents/api/health', '')
    if (!mockState.healthy.has(base)) throw new Error('connection refused')
    return {ok: true, json: async () => ({status: 'ok'})} as Response
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  process.env = {...ORIGINAL_ENV}
})

describe('local agents server resolution', () => {
  it('skips entirely when disabled by env', async () => {
    process.env.SEED_NO_AGENTS_SPAWN = '1'

    expect(await startLocalAgentsServer()).toBeNull()
    expect(getAgentsServerState()).toEqual({t: 'disabled', reason: 'env'})
    // Disabled means disabled: no probing at all.
    expect(mockState.fetched).toHaveLength(0)
  })

  it('attaches to a healthy server already on the default port', async () => {
    // This is the `./dev up` path: the mprocs pane owns the server and must stay authoritative.
    mockState.healthy.add('http://localhost:3050')

    expect(await startLocalAgentsServer()).toBe('http://localhost:3050')
    expect(getAgentsServerState()).toEqual({t: 'attached', url: 'http://localhost:3050'})
  })

  it('probes the port from SEED_AGENTS_HTTP_PORT when set, not the release default', async () => {
    // Dev redefines the port (.env.vars) so a release build's server on 3050 is never mistaken
    // for the dev one.
    process.env.SEED_AGENTS_HTTP_PORT = '3051'
    mockState.healthy.add('http://localhost:3051')

    expect(await startLocalAgentsServer()).toBe('http://localhost:3051')
    expect(getAgentsServerState()).toEqual({t: 'attached', url: 'http://localhost:3051'})
    expect(mockState.fetched.every((url) => url.includes('3051'))).toBe(true)
  })

  it('attaches to an explicitly configured server', async () => {
    process.env.SEED_AGENTS_SERVER_URL = 'http://127.0.0.1:4000/'
    mockState.healthy.add('http://127.0.0.1:4000')

    expect(await startLocalAgentsServer()).toBe('http://127.0.0.1:4000')
    expect(getAgentsServerState()).toEqual({t: 'attached', url: 'http://127.0.0.1:4000'})
  })

  it('fails loudly when the configured server is unreachable rather than silently spawning', async () => {
    process.env.SEED_AGENTS_SERVER_URL = 'http://127.0.0.1:4000'

    expect(await startLocalAgentsServer()).toBeNull()
    const state = getAgentsServerState()
    expect(state.t).toBe('error')
    expect(state.t === 'error' && state.message).toContain('127.0.0.1:4000')
    // It must not fall through to the default port or a spawn.
    expect(mockState.fetched.every((url) => url.includes('4000'))).toBe(true)
  })

  it('recovers by attaching when the server comes back after a failed startup', async () => {
    // The one startup probe misses (server mid-restart, no binary staged) — the app must not stay
    // blind forever: the attach-retry loop probes the default URL and attaches when it answers.
    vi.useFakeTimers()
    try {
      const started = await startLocalAgentsServer()
      expect(started).toBeNull()
      expect(getAgentsServerState().t).toBe('error')

      mockState.healthy.add('http://localhost:3050')
      await vi.advanceTimersByTimeAsync(11_000)
      const state = getAgentsServerState()
      expect(state.t).toBe('attached')
      expect(state.t === 'attached' && state.url).toBe('http://localhost:3050')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports an error when nothing is running and the bundled binary is missing', async () => {
    expect(await startLocalAgentsServer()).toBeNull()
    const state = getAgentsServerState()
    expect(state.t).toBe('error')
    expect(state.t === 'error' && state.message).toContain('binary not found')
  })

  it('does not spawn when the user turned the local server off, but still attaches to a dev server', async () => {
    mockState.settings = {[AGENTS_LOCAL_SERVER_SETTING_KEY]: 'off'}
    mockState.binaryExists = true

    expect(await startLocalAgentsServer()).toBeNull()
    expect(getAgentsServerState()).toEqual({t: 'disabled', reason: 'setting'})

    // The `./dev up` server is attached to regardless of the setting.
    mockState.healthy.add('http://localhost:3050')
    expect(await startLocalAgentsServer()).toBe('http://localhost:3050')
    expect(getAgentsServerState().t).toBe('attached')
  })

  it('still attaches later to a dev server that was down at startup when the setting is off', async () => {
    mockState.settings = {[AGENTS_LOCAL_SERVER_SETTING_KEY]: 'off'}
    vi.useFakeTimers()
    try {
      expect(await startLocalAgentsServer()).toBeNull()
      expect(getAgentsServerState()).toEqual({t: 'disabled', reason: 'setting'})
      mockState.healthy.add('http://localhost:3050')
      await vi.advanceTimersByTimeAsync(11_000)
      expect(getAgentsServerState()).toEqual({t: 'attached', url: 'http://localhost:3050'})
    } finally {
      vi.useRealTimers()
    }
  })

  it('settles a fresh install to off without spawning, and runs once more for an upgrade with data', async () => {
    // No setting yet and no database: nothing to look for, so the local system starts off.
    mockState.settings = {}
    mockState.binaryExists = true
    expect(await startLocalAgentsServer()).toBeNull()
    expect(getAgentsServerState()).toEqual({t: 'disabled', reason: 'setting'})
    expect(mockState.settings[AGENTS_LOCAL_SERVER_SETTING_KEY]).toBe('off')

    // No setting yet but a database from a build that always spawned: spawn, so the renderer can
    // look for agents in it and settle the setting. (The binary is missing here, so the spawn
    // fails, which is enough to show it was attempted.)
    mockState.settings = {}
    mockState.dbExists = true
    mockState.binaryExists = false
    expect(await startLocalAgentsServer()).toBeNull()
    expect(getAgentsServerState().t).toBe('error')
    expect(mockState.settings[AGENTS_LOCAL_SERVER_SETTING_KEY]).toBeUndefined()
  })

  it('turning the server off persists the choice and ignores a dev server it only attached to', async () => {
    mockState.healthy.add('http://localhost:3050')
    expect(await startLocalAgentsServer()).toBe('http://localhost:3050')

    expect(await setLocalAgentsServerEnabled(false)).toBe('http://localhost:3050')
    expect(mockState.settings[AGENTS_LOCAL_SERVER_SETTING_KEY]).toBe('off')
    expect(getAgentsServerState().t).toBe('attached')
  })

  it('spawn policy: on spawns, off never does, unset depends on leftover data', () => {
    expect(resolveLocalAgentsServerSpawn('on', false)).toEqual({spawn: true})
    expect(resolveLocalAgentsServerSpawn('off', true)).toEqual({spawn: false})
    expect(resolveLocalAgentsServerSpawn('unset', true)).toEqual({spawn: true})
    expect(resolveLocalAgentsServerSpawn('unset', false)).toEqual({spawn: false, settle: 'off'})
  })

  it('ignores a non-agents process squatting on the port', async () => {
    // A 200 that is not an agents health payload must not be mistaken for one.
    vi.stubGlobal('fetch', async () => ({ok: true, json: async () => ({hello: 'world'})}) as Response)

    expect(await startLocalAgentsServer()).toBeNull()
    expect(getAgentsServerState().t).toBe('error')
  })
})
