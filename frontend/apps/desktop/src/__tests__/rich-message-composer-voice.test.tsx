import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/** Voice is offered on capable servers for existing sessions and drafts that can create a session. */

const platform = {voiceChat: false as boolean | undefined}
const health = {data: {voice: true as boolean | undefined}}
vi.mock('@shm/ui/agents/models', () => ({useAgentServerHealth: () => health}))
vi.mock('@shm/ui/agents/voice-settings', () => ({
  useVoiceSettings: () => ({
    data: {available: true, deepgramApiKey: 'server', cartesiaApiKey: 'server'},
    isLoading: false,
  }),
  VoiceServerSettings: () => null,
}))

vi.mock('@shm/ui/agents/platform', () => {
  const React = require('react')
  return {
    getAgentsPlatform: () => ({
      CommentEditor: () => React.createElement('div', {'data-testid': 'editor'}),
      voiceChat: platform.voiceChat,
    }),
    setAgentsPlatform: vi.fn(),
  }
})
vi.mock('@shm/ui/tooltip', () => ({Tooltip: ({children}: {children: React.ReactNode}) => children}))
vi.mock('@/trpc', () => ({client: {}}))
vi.mock('@/grpc-client', () => ({grpcClient: {}}))
// No real LiveKit room: the button only joins one on click, and this test never clicks.
vi.mock('livekit-client', () => ({
  Room: vi.fn(),
  RoomEvent: {},
  Track: {Kind: {Audio: 'audio'}},
}))

import {AgentRichMessageComposer} from '@shm/ui/agents/rich-message-composer'

let container: HTMLDivElement
let root: Root

function render(
  props: {
    sessionId?: string
    accountId?: string | null
    startSession?: () => Promise<string>
    onSessionStarted?: (id: string) => void
  } = {},
) {
  act(() => {
    root.render(
      <AgentRichMessageComposer
        isBusy={false}
        isStreaming={false}
        stopPending={false}
        serverUrl="https://agents.example"
        accountId={props.accountId === undefined ? 'account-1' : props.accountId}
        sessionId={props.sessionId}
        canInvokeTools={false}
        onToolStartSession={props.startSession}
        onToolSessionStarted={props.onSessionStarted}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    )
  })
  return container.querySelector('button[aria-pressed]') as HTMLButtonElement | null
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  health.data.voice = true
  platform.voiceChat = false
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AgentRichMessageComposer voice button', () => {
  it('hides voice on older or unconfigured servers', () => {
    platform.voiceChat = true
    health.data.voice = undefined
    expect(render({sessionId: 'session-1'})).toBeNull()
  })
  it('renders the mic button left of the editor when the platform offers voice and a session exists', () => {
    platform.voiceChat = true
    const button = render({sessionId: 'session-1'})
    expect(button).not.toBeNull()
    expect(button!.getAttribute('aria-pressed')).toBe('false')
    expect(button!.getAttribute('title')).toBe('Talk to the agent')
    const editor = container.querySelector('[data-testid="editor"]')!
    expect(button!.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('creates and opens a session from a new-chat voice click', async () => {
    platform.voiceChat = true
    const startSession = vi.fn(async () => 'voice-created-session')
    const onSessionStarted = vi.fn()
    const button = render({startSession, onSessionStarted})!
    expect(button).not.toBeNull()
    await act(async () => button.click())
    expect(startSession).toHaveBeenCalledTimes(1)
    expect(onSessionStarted).toHaveBeenCalledWith('voice-created-session')
  })

  it('does not navigate or start voice if the draft was closed while its session was being created', async () => {
    platform.voiceChat = true
    let resolve!: (id: string) => void
    const pending = new Promise<string>((yes) => {
      resolve = yes
    })
    const onSessionStarted = vi.fn()
    const button = render({startSession: () => pending, onSessionStarted})!
    act(() => button.click())
    act(() => root.render(null))
    await act(async () => resolve('abandoned-session'))
    expect(onSessionStarted).not.toHaveBeenCalled()
  })

  it('shows nothing for a draft composer with no session yet', () => {
    platform.voiceChat = true
    expect(render()).toBeNull()
  })

  it('shows nothing when the platform does not offer voice', () => {
    platform.voiceChat = undefined
    expect(render({sessionId: 'session-1'})).toBeNull()
  })

  it('shows nothing without an account to sign the room request', () => {
    platform.voiceChat = true
    expect(render({sessionId: 'session-1', accountId: null})).toBeNull()
  })
})
