import React from 'react'
import {act} from 'react-dom/test-utils'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const fake = vi.hoisted(() => ({request: vi.fn(), rooms: [] as any[]}))
vi.mock('@shm/ui/agents/client', () => ({sendAgentAction: fake.request, AgentServerError: class extends Error {}}))
vi.mock('livekit-client', () => ({
  Room: class {
    listeners = new Map<string, Function>()
    remoteParticipants = new Map()
    canPlaybackAudio = true
    localParticipant = {
      identity: 'me',
      isMicrophoneEnabled: false,
      setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
        this.localParticipant.isMicrophoneEnabled = enabled
      }),
    }
    connect = vi.fn(async () => {})
    disconnect = vi.fn(async () => {
      this.localParticipant.isMicrophoneEnabled = false
    })
    startAudio = vi.fn(async () => {})
    constructor() {
      fake.rooms.push(this)
    }
    on(event: string, fn: Function) {
      this.listeners.set(event, fn)
      return this
    }
    removeAllListeners() {
      this.listeners.clear()
    }
    emit(event: string, ...args: unknown[]) {
      this.listeners.get(event)?.(...args)
    }
  },
  RoomEvent: Object.fromEntries(
    [
      'TrackSubscribed',
      'TrackUnsubscribed',
      'ParticipantAttributesChanged',
      'ParticipantConnected',
      'ParticipantDisconnected',
      'ActiveSpeakersChanged',
      'TranscriptionReceived',
      'AudioPlaybackStatusChanged',
      'Reconnecting',
      'Reconnected',
      'Disconnected',
    ].map((x) => [x, x]),
  ),
  Track: {Kind: {Audio: 'audio'}},
}))
import {requestVoiceAutoStart, useVoiceSession, type VoiceSession} from '@shm/ui/agents/voice'

let voice: VoiceSession
let root: Root
let container: HTMLDivElement
const props = {serverUrl: 'https://agents.example', accountUid: 'alice', sessionId: 'session'}
function Probe(p: typeof props) {
  voice = useVoiceSession(p)
  return null
}
function render(p = props) {
  act(() => root.render(<Probe {...p} />))
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return {promise, resolve, reject}
}
const token = {_: 'CreateVoiceSessionResponse', url: 'wss://voice.example', token: 'token'}
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  fake.rooms.length = 0
  fake.request.mockReset().mockResolvedValue(token)
  Object.defineProperty(navigator, 'mediaDevices', {configurable: true, value: {getUserMedia: vi.fn()}})
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  render()
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('shared desktop/web voice lifecycle', () => {
  it('starts, mutes without hanging up, unmutes, and releases the microphone on stop', async () => {
    await act(() => voice.start())
    const room = fake.rooms[0]
    expect(fake.request).toHaveBeenCalledWith({
      serverUrl: props.serverUrl,
      accountUid: props.accountUid,
      action: {_: 'CreateVoiceSession', sessionId: 'session'},
    })
    expect(voice.status).toBe('on')
    expect(room.localParticipant.isMicrophoneEnabled).toBe(true)
    await act(() => voice.toggleMute())
    expect(voice.muted).toBe(true)
    expect(room.disconnect).not.toHaveBeenCalled()
    await act(() => voice.toggleMute())
    expect(voice.muted).toBe(false)
    act(() => voice.stop())
    expect(room.disconnect).toHaveBeenCalledWith(true)
    expect(voice.status).toBe('off')
  })
  it('cancels while the token is pending without connecting or opening the microphone', async () => {
    const pending = deferred<typeof token>()
    fake.request.mockReturnValueOnce(pending.promise)
    let start!: Promise<void>
    act(() => {
      start = voice.start()
    })
    act(() => voice.stop())
    await act(async () => {
      pending.resolve(token)
      await start
    })
    expect(fake.rooms[0].connect).not.toHaveBeenCalled()
    expect(fake.rooms[0].localParticipant.setMicrophoneEnabled).not.toHaveBeenCalled()
    expect(voice.status).toBe('off')
  })
  it('a late failure from a canceled call does not remove audio from a new call', async () => {
    const pending = deferred<void>()
    let first!: Promise<void>
    act(() => {
      first = voice.start()
    })
    fake.rooms[0].connect.mockReturnValueOnce(pending.promise)
    await act(async () => {
      await Promise.resolve()
    })
    act(() => voice.stop())
    await act(() => voice.start())
    const audio = document.createElement('audio')
    vi.spyOn(audio, 'pause').mockImplementation(() => {})
    act(() => fake.rooms[1].emit('TrackSubscribed', {kind: 'audio', attach: () => audio}))
    await act(async () => {
      pending.reject(new Error('old call failed'))
      await first
    })
    expect(voice.status).toBe('on')
    expect(audio.isConnected).toBe(true)
    act(() => voice.stop())
    expect(audio.isConnected).toBe(false)
  })
  it.each(['accountUid', 'serverUrl', 'sessionId'] as const)('leaves when %s changes', async (key) => {
    await act(() => voice.start())
    render({...props, [key]: 'different'})
    expect(fake.rooms[0].disconnect).toHaveBeenCalled()
    expect(voice.status).toBe('off')
  })
  it('allows browser-blocked audio to be enabled with a new gesture', async () => {
    await act(() => voice.start())
    const room = fake.rooms[0]
    act(() => {
      room.canPlaybackAudio = false
      room.emit('AudioPlaybackStatusChanged')
    })
    expect(voice.playbackBlocked).toBe(true)
    room.startAudio.mockImplementation(async () => {
      room.canPlaybackAudio = true
    })
    await act(() => voice.enableAudio())
    expect(voice.playbackBlocked).toBe(false)
  })
  it('reports reconnecting, resumes, and makes a lost worker retryable', async () => {
    await act(() => voice.start())
    const room = fake.rooms[0]
    act(() => room.emit('Reconnecting'))
    expect(voice.status).toBe('reconnecting')
    act(() => room.emit('Reconnected'))
    expect(voice.status).toBe('on')
    act(() => room.emit('ParticipantDisconnected', {attributes: {'lk.agent.state': 'listening'}}))
    expect(voice.status).toBe('error')
    expect(room.disconnect).toHaveBeenCalled()
    await act(() => voice.start())
    expect(voice.status).toBe('on')
  })
  it('gives actionable feedback when microphone permission is denied', async () => {
    let start!: Promise<void>
    act(() => {
      start = voice.start()
    })
    fake.rooms[0].localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
      new DOMException('denied', 'NotAllowedError'),
    )
    await act(() => start)
    expect(voice.error).toContain('Allow microphone access')
    expect(voice.status).toBe('error')
    expect(fake.rooms[0].disconnect).toHaveBeenCalled()
  })
  it('ends a call if the worker never becomes ready', async () => {
    vi.useFakeTimers()
    await act(() => voice.start())
    act(() => vi.advanceTimersByTime(30_000))
    expect(voice.status).toBe('error')
    expect(voice.error).toContain('did not become ready')
    expect(fake.rooms[0].disconnect).toHaveBeenCalled()
  })
  it('keeps a ready worker connected beyond the startup deadline', async () => {
    vi.useFakeTimers()
    await act(() => voice.start())
    act(() =>
      fake.rooms[0].emit('ParticipantConnected', {identity: 'agent', attributes: {'lk.agent.state': 'listening'}}),
    )
    act(() => vi.advanceTimersByTime(30_000))
    expect(voice.status).toBe('on')
    expect(voice.agentState).toBe('listening')
  })
  it('carries a new-chat click only to the matching account, server and session, including StrictMode', async () => {
    requestVoiceAutoStart(props.serverUrl, props.accountUid, 'new-session')
    await act(async () =>
      root.render(
        <React.StrictMode>
          <Probe {...props} sessionId="new-session" accountUid="someone-else" />
        </React.StrictMode>,
      ),
    )
    expect(fake.request).not.toHaveBeenCalled()
    await act(async () =>
      root.render(
        <React.StrictMode>
          <Probe {...props} sessionId="new-session" />
        </React.StrictMode>,
      ),
    )
    expect(fake.request).toHaveBeenCalledTimes(1)
    expect(voice.status).toBe('on')
  })
  it('shows partial captions only for the local speaker', async () => {
    await act(() => voice.start())
    const room = fake.rooms[0]
    act(() => room.emit('TranscriptionReceived', [{text: 'hello', final: false}], {identity: 'me'}))
    expect(voice.interimTranscript).toBe('hello')
    act(() => room.emit('TranscriptionReceived', [{text: 'reply', final: false}], {identity: 'agent'}))
    expect(voice.interimTranscript).toBe('hello')
    act(() => room.emit('TranscriptionReceived', [{text: 'hello', final: true}], {identity: 'me'}))
    expect(voice.interimTranscript).toBeUndefined()
  })
})
