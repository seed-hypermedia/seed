import {renderToStaticMarkup} from 'react-dom/server'
import {beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The signed-out gate on /hm/agents.
 *
 * Agent servers only accept signed envelopes, and on web the local device key is the signing
 * account, so the page must never render the agents UI before the identity has loaded — a
 * pre-load `null` key pair means "still loading", not "logged out", and showing a sign-in prompt
 * to an already-signed-in visitor is the bug this guards.
 */

const mockState = vi.hoisted(() => ({
  keyPairLoaded: false,
  keyPair: null as {id: string} | null,
}))

vi.mock('@/auth', () => ({
  useLocalKeyPairLoaded: () => mockState.keyPairLoaded,
  useLocalKeyPair: () => mockState.keyPair,
  useCreateAccount: () => ({
    createAccount: vi.fn(),
    content: null,
    canCreateAccount: !mockState.keyPair,
    userKeyPair: mockState.keyPair,
  }),
}))

// Registering the platform reaches for the editor and localStorage; the gate is what is under test.
vi.mock('@/web-agents-platform', () => ({registerWebAgentsPlatform: vi.fn()}))

vi.mock('@shm/shared/utils/navigation', () => ({useNavRoute: () => ({key: 'agents'})}))
vi.mock('@shm/ui/agents/list', () => ({default: () => <div>AGENTS LIST</div>}))
vi.mock('@shm/ui/agents/detail', () => ({default: () => <div>AGENT DETAIL</div>}))
vi.mock('@shm/ui/agents/server', () => ({default: () => <div>AGENT SERVER</div>}))
vi.mock('@shm/ui/agents/session', () => ({default: () => <div>AGENT SESSION</div>}))

import WebAgentsContent from '../agents-page-content'

beforeEach(() => {
  mockState.keyPairLoaded = false
  mockState.keyPair = null
})

describe('web agents page content', () => {
  it('shows neither the agents UI nor a sign-in prompt while the identity is still loading', () => {
    const markup = renderToStaticMarkup(<WebAgentsContent />)
    expect(markup).not.toContain('AGENTS LIST')
    expect(markup).not.toContain('Sign in')
  })

  it('offers a signed-out visitor a sign-in button instead of the agents UI', () => {
    mockState.keyPairLoaded = true
    const markup = renderToStaticMarkup(<WebAgentsContent />)
    expect(markup).toContain('Sign in')
    expect(markup).toContain('<button')
    expect(markup).not.toContain('AGENTS LIST')
  })

  it('renders the agents UI once an identity is present', () => {
    mockState.keyPairLoaded = true
    mockState.keyPair = {id: 'z6MkDevice'}
    const markup = renderToStaticMarkup(<WebAgentsContent />)
    expect(markup).toContain('AGENTS LIST')
    expect(markup).not.toContain('Sign in')
  })
})
