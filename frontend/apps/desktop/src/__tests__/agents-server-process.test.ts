import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * Resolution order for the local app environment.
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

// A packaged build unless a case says otherwise: that is where the app starts its own server.
const electronApp = vi.hoisted(() => ({addListener: vi.fn(), isPackaged: true}))
vi.mock('electron', () => ({app: electronApp}))
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
// One function behind both the named and the default export, so a start is seen however it is imported.
const spawn = vi.hoisted(() => vi.fn())
vi.mock('child_process', () => ({spawn, default: {spawn}}))

import {
  getAgentsServerState,
  getLocalAppEnvironmentFeatures,
  resolveLocalAgentsServerSpawn,
  setLocalAgentsServerEnabled,
  setLocalAppEnvironmentFeatures,
  startLocalAgentsServer,
} from '../agents-server-process'
import {AGENTS_LOCAL_SERVER_SETTING_KEY, LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY} from '@shm/shared/constants'

/** The `--features` value of each time the bundled binary was started, in order. */
function spawnedFeatures(): (string | undefined)[] {
  return spawn.mock.calls.map(([, args]) => (args as string[]).find((arg) => arg.startsWith('--features='))?.slice(11))
}

const ORIGINAL_ENV = {...process.env}

beforeEach(() => {
  mockState.healthy = new Set()
  mockState.fetched = []
  mockState.binaryExists = false
  mockState.dbExists = false
  // Most cases below exercise the spawn path; the policy cases override this.
  mockState.settings = {[AGENTS_LOCAL_SERVER_SETTING_KEY]: 'on'}
  spawn.mockClear()
  electronApp.isPackaged = true
  delete process.env.SEED_NO_AGENTS_SPAWN
  delete process.env.SEED_AGENTS_SERVER_URL
  delete process.env.SEED_NO_APPS_SPAWN
  delete process.env.SEED_APPS_SERVER_URL
  delete process.env.SEED_APPS_HTTP_PORT
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

describe('local app environment resolution', () => {
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

  it('attaches to the server SEED_APPS_SERVER_URL names, the app environment spelling of the same setting', async () => {
    process.env.SEED_APPS_SERVER_URL = 'http://127.0.0.1:4001'
    mockState.healthy.add('http://127.0.0.1:4001')

    expect(await startLocalAgentsServer()).toBe('http://127.0.0.1:4001')
    expect(getAgentsServerState()).toEqual({t: 'attached', url: 'http://127.0.0.1:4001'})
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
    mockState.settings = {
      [AGENTS_LOCAL_SERVER_SETTING_KEY]: 'off',
      [LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY]: ['tools'],
    }
    mockState.binaryExists = true

    expect(await startLocalAgentsServer()).toBeNull()
    expect(getAgentsServerState()).toEqual({t: 'disabled', reason: 'setting'})
    expect(spawn).not.toHaveBeenCalled()
    // Off stays off: nothing rewrites the user's choice.
    expect(mockState.settings[AGENTS_LOCAL_SERVER_SETTING_KEY]).toBe('off')

    // The `./dev up` server is attached to regardless of the setting.
    mockState.healthy.add('http://localhost:3050')
    expect(await startLocalAgentsServer()).toBe('http://localhost:3050')
    expect(getAgentsServerState().t).toBe('attached')
  })

  it('still attaches later to a dev server that was down at startup when the setting is off', async () => {
    mockState.settings = {
      [AGENTS_LOCAL_SERVER_SETTING_KEY]: 'off',
      [LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY]: ['tools'],
    }
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

  it('runs tools only on a fresh install, and on one an earlier build had settled to off', async () => {
    // No setting and no database: the local system starts, to run tools and nothing else.
    mockState.settings = {}
    mockState.binaryExists = true
    await startLocalAgentsServer()
    expect(spawnedFeatures()).toEqual(['tools'])
    // The server is asked to start its first sandbox now, not on the first Run of a tool.
    expect(spawn.mock.calls[0]![1]).toContain('--exec-warm-up=true')
    expect(mockState.settings).toEqual({
      [AGENTS_LOCAL_SERVER_SETTING_KEY]: 'on',
      [LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY]: ['tools'],
    })
    expect(getLocalAppEnvironmentFeatures()).toEqual(['tools'])

    // Earlier builds wrote `off` on every fresh install, so that value was nobody's choice.
    spawn.mockClear()
    mockState.settings = {[AGENTS_LOCAL_SERVER_SETTING_KEY]: 'off'}
    await startLocalAgentsServer()
    expect(spawnedFeatures()).toEqual(['tools'])
    expect(mockState.settings[AGENTS_LOCAL_SERVER_SETTING_KEY]).toBe('on')
  })

  it('keeps everything for someone who ran agents here, and decides nothing while that is unknown', async () => {
    // The setting was on: they turned it on, or an upgrade found agents. They keep agents and apps.
    mockState.settings = {[AGENTS_LOCAL_SERVER_SETTING_KEY]: 'on'}
    mockState.binaryExists = true
    await startLocalAgentsServer()
    expect(spawnedFeatures()).toEqual(['tools,apps,agents'])
    expect(mockState.settings[LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY]).toEqual(['tools', 'apps', 'agents'])

    // No setting but a database from a build that always spawned: run everything once more, so the
    // renderer can look for agents in it and settle the list. Nothing is written until it has.
    spawn.mockClear()
    mockState.settings = {}
    mockState.dbExists = true
    await startLocalAgentsServer()
    expect(spawnedFeatures()).toEqual(['tools,apps,agents'])
    expect(mockState.settings).toEqual({})
    // Until then the Settings screen shows the default.
    expect(getLocalAppEnvironmentFeatures()).toEqual(['tools'])
  })

  it('starts nothing by default in a development build, which attaches to the dev server instead', async () => {
    electronApp.isPackaged = false
    mockState.settings = {}
    mockState.binaryExists = true
    expect(await startLocalAgentsServer()).toBeNull()
    expect(spawn).not.toHaveBeenCalled()
    // Nothing is settled either, so the dev server's port stays free on every later launch.
    expect(mockState.settings).toEqual({})
    expect(getAgentsServerState()).toEqual({t: 'disabled', reason: 'setting'})

    // A developer who turns the switch on gets the bundled server, with the default checks.
    await setLocalAgentsServerEnabled(true)
    expect(spawnedFeatures()).toEqual(['tools'])
    expect(resolveLocalAgentsServerSpawn('unset', ['tools'], false, false).spawn).toBe(false)
    expect(resolveLocalAgentsServerSpawn('on', ['tools'], false, false).spawn).toBe(true)
  })

  it('says why a server that died at startup died, not the last line it printed', async () => {
    mockState.settings = {
      [AGENTS_LOCAL_SERVER_SETTING_KEY]: 'on',
      [LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY]: ['tools'],
    }
    mockState.binaryExists = true
    // A binary from before `--features` existed: it prints the error, a stack and its version, and exits.
    spawn.mockImplementationOnce(() => {
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        exitCode: null as number | null,
        killed: false,
        kill: vi.fn(),
      })
      child.stderr.end('error: Unknown flag: --features\n      at parse (main.js:1:1)\n\nBun v1.3.3 (Linux x64)\n')
      child.stderr.on('end', () => {
        child.exitCode = 1
      })
      return child
    })
    expect(await startLocalAgentsServer()).toBeNull()
    expect(getAgentsServerState()).toEqual({
      t: 'error',
      message: 'App environment exited during startup: Unknown flag: --features',
    })
  })

  it('runs what the user checked, and restarts to apply a change', async () => {
    mockState.settings = {
      [AGENTS_LOCAL_SERVER_SETTING_KEY]: 'on',
      [LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY]: ['tools', 'agents'],
    }
    mockState.binaryExists = true
    await startLocalAgentsServer()
    expect(spawnedFeatures()).toEqual(['tools,agents'])

    await setLocalAppEnvironmentFeatures(['apps', 'tools'])
    expect(mockState.settings[LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY]).toEqual(['tools', 'apps'])
    expect(spawnedFeatures()).toEqual(['tools,agents', 'tools,apps'])

    // With nothing checked there is nothing to run: the server is not started.
    await setLocalAppEnvironmentFeatures([])
    expect(spawnedFeatures()).toHaveLength(2)
    expect(getAgentsServerState()).toEqual({t: 'disabled', reason: 'setting'})
    // Turning the switch on again from there means the default, not an empty server.
    await setLocalAgentsServerEnabled(true)
    expect(mockState.settings[LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY]).toEqual(['tools'])
    expect(spawnedFeatures().at(-1)).toBe('tools')
  })

  it('stores a change of features without starting anything while the server is off or only attached', async () => {
    mockState.settings = {
      [AGENTS_LOCAL_SERVER_SETTING_KEY]: 'off',
      [LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY]: ['tools'],
    }
    mockState.binaryExists = true
    expect(await setLocalAppEnvironmentFeatures(['tools', 'apps'])).toBeNull()
    expect(mockState.settings[LOCAL_APP_ENVIRONMENT_FEATURES_SETTING_KEY]).toEqual(['tools', 'apps'])
    expect(spawn).not.toHaveBeenCalled()

    // The dev server runs what its own flags say: it is neither restarted nor replaced.
    mockState.settings[AGENTS_LOCAL_SERVER_SETTING_KEY] = 'on'
    mockState.healthy.add('http://localhost:3050')
    expect(await startLocalAgentsServer()).toBe('http://localhost:3050')
    expect(await setLocalAppEnvironmentFeatures(['agents'])).toBe('http://localhost:3050')
    expect(getAgentsServerState().t).toBe('attached')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('turning the server off persists the choice and ignores a dev server it only attached to', async () => {
    mockState.healthy.add('http://localhost:3050')
    expect(await startLocalAgentsServer()).toBe('http://localhost:3050')

    expect(await setLocalAgentsServerEnabled(false)).toBe('http://localhost:3050')
    expect(mockState.settings[AGENTS_LOCAL_SERVER_SETTING_KEY]).toBe('off')
    expect(getAgentsServerState().t).toBe('attached')
  })

  it('spawn policy: on unless turned off, running what is checked, tools only by default', () => {
    const all = ['tools', 'apps', 'agents'] as const
    // Decided: the switch and the checks say it all.
    expect(resolveLocalAgentsServerSpawn('on', ['tools'], false)).toEqual({spawn: true, features: ['tools']})
    expect(resolveLocalAgentsServerSpawn('unset', ['tools', 'apps'], true)).toEqual({
      spawn: true,
      features: ['tools', 'apps'],
    })
    expect(resolveLocalAgentsServerSpawn('off', all, true)).toEqual({spawn: false, features: all})
    expect(resolveLocalAgentsServerSpawn('on', [], true)).toEqual({spawn: false, features: []})
    // Not decided yet: what the earlier setting says about this user.
    expect(resolveLocalAgentsServerSpawn('on', null, false)).toEqual({
      spawn: true,
      features: all,
      settle: {features: all},
    })
    expect(resolveLocalAgentsServerSpawn('unset', null, true)).toEqual({spawn: true, features: all})
    const fresh = {spawn: true, features: ['tools'], settle: {policy: 'on', features: ['tools']}}
    expect(resolveLocalAgentsServerSpawn('unset', null, false)).toEqual(fresh)
    expect(resolveLocalAgentsServerSpawn('off', null, true)).toEqual(fresh)
  })

  it('ignores a non-agents process squatting on the port', async () => {
    // A 200 that is not an agents health payload must not be mistaken for one.
    vi.stubGlobal('fetch', async () => ({ok: true, json: async () => ({hello: 'world'})}) as Response)

    expect(await startLocalAgentsServer()).toBeNull()
    expect(getAgentsServerState().t).toBe('error')
  })
})
