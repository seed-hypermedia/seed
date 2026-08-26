import {afterEach, describe, expect, it, vi} from 'vitest'

// provider-oauth pulls in the agents models/query stack; only the availability rule is under test.
vi.mock('../agents/models', () => ({
  useCancelProviderOAuth: vi.fn(),
  useProviderOAuthStatus: vi.fn(),
  useStartProviderOAuth: vi.fn(),
  useSubmitProviderOAuthCode: vi.fn(),
}))
vi.mock('../agents/navigation', () => ({useOpenUrl: vi.fn()}))
vi.mock('@shm/shared/models/query-client', () => ({invalidateQueries: vi.fn()}))

import {isSubscriptionSignInAvailable} from '../agents/provider-oauth'
import {setAgentsPlatform, type AgentsPlatform} from '../agents/platform'

const catcher = {start: vi.fn(), captured: vi.fn(), stop: vi.fn()}

function registerPlatform(overrides: Partial<AgentsPlatform>) {
  setAgentsPlatform({
    defaultServerUrl: () => null,
    getSigner: vi.fn(),
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    useAccountUid: () => null,
    useNavigate: () => vi.fn(),
    useOpenUrl: () => vi.fn(),
    CommentEditor: () => null,
    ...overrides,
  })
}

/**
 * Subscription sign-in ("Sign in with ChatGPT") ends in a redirect to localhost:1455 that only the
 * desktop main process can catch. The hosted agent servers enable the flow for desktop clients, so
 * a browser must not offer it merely because the server reports `subscriptionAuth`.
 */
describe('isSubscriptionSignInAvailable', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('is offered on desktop when the server opts in', () => {
    registerPlatform({oauthRedirectCatcher: catcher})
    expect(isSubscriptionSignInAvailable('openai', {subscriptionAuth: true})).toBe(true)
  })

  it('is never offered on a platform without a redirect catcher (web), even if the server opts in', () => {
    registerPlatform({})
    expect(isSubscriptionSignInAvailable('openai', {subscriptionAuth: true})).toBe(false)
  })

  it('is not offered when the server has not opted in', () => {
    registerPlatform({oauthRedirectCatcher: catcher})
    expect(isSubscriptionSignInAvailable('openai', {subscriptionAuth: false})).toBe(false)
    expect(isSubscriptionSignInAvailable('openai', {})).toBe(false)
    expect(isSubscriptionSignInAvailable('openai', undefined)).toBe(false)
  })

  it('is not offered for providers without a subscription flow', () => {
    registerPlatform({oauthRedirectCatcher: catcher})
    expect(isSubscriptionSignInAvailable('anthropic', {subscriptionAuth: true})).toBe(false)
  })
})
