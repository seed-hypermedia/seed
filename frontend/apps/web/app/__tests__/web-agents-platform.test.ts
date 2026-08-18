import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import type {AgentsPlatform} from '@shm/ui/agents/platform'

/**
 * The web adapter for the shared Agents UI.
 *
 * The shared UI treats every local-node capability as optional and guards on absence, so what this
 * adapter *omits* is as load-bearing as what it provides: claiming a capability the browser cannot
 * honor turns a no-op into a crash deep inside the shared code.
 */

const registered = vi.hoisted(() => ({platform: null as AgentsPlatform | null}))
const mocks = vi.hoisted(() => ({
  storedKeyPair: null as CryptoKeyPair | null,
  keyPairFromStore: null as CryptoKeyPair | null,
  appContext: {origin: undefined as string | undefined},
}))

vi.mock('@shm/shared', () => ({
  routeToHref: vi.fn(),
  useUniversalAppContext: () => mocks.appContext,
}))

vi.mock('@shm/ui/agents/platform', () => ({
  setAgentsPlatform: (platform: AgentsPlatform) => {
    registered.platform = platform
  },
}))

vi.mock('@/auth', () => ({
  keyPairStore: {get: () => mocks.keyPairFromStore},
  useLocalKeyPair: () => null,
  useCreateAccount: () => ({createAccount: vi.fn(), content: null}),
}))

vi.mock('@/local-db', () => ({
  getStoredLocalKeys: async () => (mocks.storedKeyPair ? {keyPair: mocks.storedKeyPair} : null),
}))

// The rich editor drags in the whole ProseMirror stack; the adapter only passes it through.
vi.mock('@shm/editor/comment-editor', () => ({CommentEditor: () => null}))

/** Registers the adapter fresh (the module registers only once per load) and returns it. */
async function loadPlatform(): Promise<AgentsPlatform> {
  vi.resetModules()
  registered.platform = null
  const {registerWebAgentsPlatform} = await import('../web-agents-platform')
  registerWebAgentsPlatform()
  if (!registered.platform) throw new Error('the adapter registered no platform')
  return registered.platform
}

/** A minimal localStorage over a Map, so the namespacing is observable. */
function fakeWindow() {
  const store = new Map<string, string>()
  return {
    store,
    window: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => void store.delete(key),
      },
    },
  }
}

beforeEach(() => {
  mocks.storedKeyPair = null
  mocks.keyPairFromStore = null
  mocks.appContext.origin = undefined
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('web agents platform', () => {
  it('omits every capability that needs a local HM node or a loopback socket', async () => {
    const platform = await loadPlatform()

    expect(platform.subscribeToEntity).toBeUndefined()
    expect(platform.discoverEntity).toBeUndefined()
    expect(platform.connectToHmServer).toBeUndefined()
    expect(platform.getLocalServerUrl).toBeUndefined()
    expect(platform.oauthRedirectCatcher).toBeUndefined()
    // No settings window on web either — omitting this makes the agents list manage servers in a
    // dialog instead of navigating to a route that does not exist.
    expect(platform.useOpenServerSettings).toBeUndefined()
  })

  it('provides the members the shared UI cannot run without', async () => {
    const platform = await loadPlatform()

    expect(typeof platform.getSigner).toBe('function')
    expect(typeof platform.useAccountUid).toBe('function')
    expect(typeof platform.useNavigate).toBe('function')
    expect(typeof platform.useOpenUrl).toBe('function')
    expect(platform.CommentEditor).toBeTruthy()
  })

  it('points agent hm:// links at this deployment, not the default gateway', async () => {
    // Without this the shared markdown renderer falls back to DEFAULT_GATEWAY_URL, so a
    // self-hosted site would hand out hyper.media hrefs for the agent's links.
    mocks.appContext.origin = 'https://mysite.example'
    const platform = await loadPlatform()

    expect(platform.useGatewayUrl?.()).toBe('https://mysite.example')
  })

  it('leaves the gateway unset when the deployment has no origin, so the shared fallback applies', async () => {
    mocks.appContext.origin = undefined
    const platform = await loadPlatform()

    expect(platform.useGatewayUrl?.()).toBeUndefined()
  })

  it('defaults to the configured Seed agent server', async () => {
    const {SEED_AGENT_SERVER_URL} = await import('@shm/shared/constants')
    const platform = await loadPlatform()

    expect(platform.defaultServerUrl()).toBe(SEED_AGENT_SERVER_URL ?? null)
  })

  it('round-trips a setting through a namespaced localStorage key', async () => {
    const {window, store} = fakeWindow()
    vi.stubGlobal('window', window)
    const platform = await loadPlatform()

    await platform.setSetting('agent-server-url', 'https://agents.example.com')

    expect(store.get('seed.agents.setting.agent-server-url')).toBe('"https://agents.example.com"')
    await expect(platform.getSetting('agent-server-url')).resolves.toBe('https://agents.example.com')
  })

  it('stores structured values, not just strings', async () => {
    const {window} = fakeWindow()
    vi.stubGlobal('window', window)
    const platform = await loadPlatform()

    await platform.setSetting('agent-server-urls', ['https://a.example', 'https://b.example'])

    await expect(platform.getSetting('agent-server-urls')).resolves.toEqual(['https://a.example', 'https://b.example'])
  })

  it('clears the key when a setting is unset, rather than storing a null', async () => {
    const {window, store} = fakeWindow()
    vi.stubGlobal('window', window)
    const platform = await loadPlatform()

    await platform.setSetting('agent-server-url', 'https://agents.example.com')
    await platform.setSetting('agent-server-url', null)

    expect(store.has('seed.agents.setting.agent-server-url')).toBe(false)
    await expect(platform.getSetting('agent-server-url')).resolves.toBeNull()
  })

  it('reads an unset setting as null', async () => {
    const {window} = fakeWindow()
    vi.stubGlobal('window', window)
    const platform = await loadPlatform()

    await expect(platform.getSetting('never-written')).resolves.toBeNull()
  })

  it('treats a corrupted stored value as unset instead of throwing', async () => {
    const {window, store} = fakeWindow()
    store.set('seed.agents.setting.agent-server-url', '{not json')
    vi.stubGlobal('window', window)
    const platform = await loadPlatform()

    await expect(platform.getSetting('agent-server-url')).resolves.toBeNull()
  })

  it('is inert during server rendering, where there is no window', async () => {
    const platform = await loadPlatform()

    await expect(platform.getSetting('agent-server-url')).resolves.toBeNull()
    await expect(platform.setSetting('agent-server-url', 'https://agents.example.com')).resolves.toBeUndefined()
  })

  it('refuses to sign when the visitor has no local web identity', async () => {
    const platform = await loadPlatform()

    await expect(platform.getSigner('z6MkSomeAccount')).rejects.toThrow(/no local web identity/)
  })
})
