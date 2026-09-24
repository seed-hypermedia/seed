import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

/**
 * The mic button is desktop-only and needs a session to join: the composer shows it only when the
 * platform opts in with `voiceChat`, a sessionId (and account) is known, and the session's server
 * reports voice available with both speech keys resolved. Drafts, platforms without a speech
 * pipeline, and a desktop whose keys are not entered yet get no button at all, not a disabled one.
 */

const platform = {voiceChat: false as boolean | undefined}
type Source = 'account' | 'server' | 'none'
const voiceSettings = {
  data: undefined as {available: boolean; deepgramApiKey: Source; cartesiaApiKey: Source} | undefined,
}
const READY = {available: true, deepgramApiKey: 'account' as Source, cartesiaApiKey: 'server' as Source}

vi.mock('@shm/ui/agents/voice-settings', () => ({useVoiceSettings: () => ({data: voiceSettings.data})}))

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
import {takeVoiceAutoStart} from '@shm/ui/agents/voice'

let container: HTMLDivElement
let root: Root

function render(
  props: {
    sessionId?: string
    accountId?: string | null
    onToolStartSession?: () => Promise<string>
    onToolSessionStarted?: (sessionId: string) => void
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
        onToolStartSession={props.onToolStartSession}
        onToolSessionStarted={props.onToolSessionStarted}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    )
  })
  return container.querySelector('button[aria-pressed]') as HTMLButtonElement | null
}

beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  platform.voiceChat = false
  voiceSettings.data = READY
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AgentRichMessageComposer voice button', () => {
  it('renders the mic button left of the editor when the platform offers voice and a session exists', () => {
    platform.voiceChat = true
    const button = render({sessionId: 'session-1'})
    expect(button).not.toBeNull()
    expect(button!.getAttribute('aria-pressed')).toBe('false')
    expect(button!.getAttribute('title')).toBe('Talk to the agent')
    const editor = container.querySelector('[data-testid="editor"]')!
    expect(button!.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows nothing for a draft composer that cannot create its session', () => {
    platform.voiceChat = true
    expect(render()).toBeNull()
  })

  it('on a draft, the mic creates the session like a first send, then opens it set to start voice', async () => {
    platform.voiceChat = true
    const onToolStartSession = vi.fn(async () => 'session-new')
    const onToolSessionStarted = vi.fn()
    const button = render({onToolStartSession, onToolSessionStarted})
    expect(button).not.toBeNull()
    expect(button!.getAttribute('title')).toBe('Talk to the agent')
    await act(async () => {
      button!.click()
    })
    expect(onToolStartSession).toHaveBeenCalledTimes(1)
    expect(onToolSessionStarted).toHaveBeenCalledWith('session-new')
    // The opened session's hook finds the request and starts the room; nobody else may take it.
    expect(takeVoiceAutoStart('https://other.example', 'session-new')).toBe(false)
    expect(takeVoiceAutoStart('https://agents.example', 'session-new')).toBe(true)
    expect(takeVoiceAutoStart('https://agents.example', 'session-new')).toBe(false)
  })

  it('on a draft, a failed session creation shows the reason on the mic instead of opening anything', async () => {
    platform.voiceChat = true
    const onToolSessionStarted = vi.fn()
    const button = render({
      onToolStartSession: async () => {
        throw new Error('No provider')
      },
      onToolSessionStarted,
    })
    await act(async () => {
      button!.click()
    })
    expect(onToolSessionStarted).not.toHaveBeenCalled()
    expect(container.querySelector('button[aria-pressed]')!.getAttribute('title')).toBe('No provider')
  })

  it('shows nothing when the platform does not offer voice', () => {
    platform.voiceChat = undefined
    expect(render({sessionId: 'session-1'})).toBeNull()
  })

  it('shows nothing without an account to sign the room request', () => {
    platform.voiceChat = true
    expect(render({sessionId: 'session-1', accountId: null})).toBeNull()
  })

  it('shows nothing until both speech keys are configured', () => {
    platform.voiceChat = true
    voiceSettings.data = {...READY, deepgramApiKey: 'none'}
    expect(render({sessionId: 'session-1'})).toBeNull()
    voiceSettings.data = {...READY, cartesiaApiKey: 'none'}
    expect(render({sessionId: 'session-1'})).toBeNull()
    voiceSettings.data = {available: true, deepgramApiKey: 'server', cartesiaApiKey: 'server'}
    expect(render({sessionId: 'session-1'})).not.toBeNull()
  })

  it('shows nothing when the server has no voice pipeline, or has not answered yet', () => {
    platform.voiceChat = true
    voiceSettings.data = {...READY, available: false}
    expect(render({sessionId: 'session-1'})).toBeNull()
    voiceSettings.data = undefined
    expect(render({sessionId: 'session-1'})).toBeNull()
  })
})
