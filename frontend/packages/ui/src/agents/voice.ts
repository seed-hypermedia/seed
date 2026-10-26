import {Room, RoomEvent, Track, type Participant, type TranscriptionSegment} from 'livekit-client'
import {useCallback, useEffect, useRef, useState} from 'react'
import {AgentServerError, sendAgentAction} from './client'

/** Connection state of the current voice call. */
export type VoiceStatus = 'off' | 'connecting' | 'reconnecting' | 'on' | 'error'
/** The worker's published speech state. */
export type VoiceAgentState = 'initializing' | 'listening' | 'thinking' | 'speaking' | 'idle'
/** Call controls and feedback shared by Seed desktop and web. */
export type VoiceSession = {
  status: VoiceStatus
  agentState: VoiceAgentState
  userSpeaking: boolean
  muted: boolean
  playbackBlocked: boolean
  interimTranscript?: string
  error?: string
  start: () => Promise<void>
  stop: () => void
  toggle: () => void
  toggleMute: () => Promise<void>
  enableAudio: () => Promise<void>
}

const AGENT_STATE_ATTRIBUTE = 'lk.agent.state'
const AGENT_STATES: ReadonlySet<string> = new Set(['initializing', 'listening', 'thinking', 'speaking', 'idle'])

let pendingVoiceStart: {serverUrl: string; accountUid: string; sessionId: string; expiresAt: number} | undefined

/** Carries an explicit Voice click from a new conversation to its newly mounted session. */
export function requestVoiceAutoStart(serverUrl: string, accountUid: string, sessionId: string): void {
  pendingVoiceStart = {serverUrl, accountUid, sessionId, expiresAt: Date.now() + 30_000}
}

function describeVoiceError(err: unknown): string {
  if (err instanceof AgentServerError) {
    if (err.status === 501) return 'Voice is not set up on this agent server.'
    return err.message
  }
  const name = typeof err === 'object' && err ? (err as {name?: unknown}).name : undefined
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError')
    return 'Allow microphone access in your browser or system settings, then try again.'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'Connect a microphone, then try again.'
  if (name === 'NotReadableError') return 'The microphone could not be opened. Check whether another app is using it.'
  return err instanceof Error && err.message ? err.message : 'Could not start voice. Please try again.'
}

/** Owns a call's microphone, playback and room; releases them on stop, navigation or account/server change. */
export function useVoiceSession({
  serverUrl,
  accountUid,
  sessionId,
}: {
  serverUrl: string
  accountUid: string
  sessionId: string
}): VoiceSession {
  const [status, setStatus] = useState<VoiceStatus>('off')
  const [agentState, setAgentState] = useState<VoiceAgentState>('initializing')
  const [userSpeaking, setUserSpeaking] = useState(false)
  const [muted, setMuted] = useState(false)
  const [playbackBlocked, setPlaybackBlocked] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState<string>()
  const [error, setError] = useState<string>()
  const roomRef = useRef<Room | null>(null)
  const attemptRef = useRef(0)
  const statusRef = useRef<VoiceStatus>('off')
  const releaseRef = useRef<(() => void) | null>(null)
  const mutePending = useRef(false)

  const resetLiveState = useCallback(() => {
    setAgentState('initializing')
    setUserSpeaking(false)
    setInterimTranscript(undefined)
    setMuted(false)
    setPlaybackBlocked(false)
    mutePending.current = false
  }, [])

  const stop = useCallback(() => {
    attemptRef.current += 1
    releaseRef.current?.()
    releaseRef.current = null
    roomRef.current = null
    statusRef.current = 'off'
    setStatus('off')
    setError(undefined)
    resetLiveState()
  }, [resetLiveState])

  const start = useCallback(async () => {
    if (statusRef.current !== 'off' && statusRef.current !== 'error') return
    const attempt = ++attemptRef.current
    const superseded = () => attemptRef.current !== attempt
    setError(undefined)
    statusRef.current = 'connecting'
    setStatus('connecting')
    resetLiveState()

    // Each attempt owns its own elements: a late failed connection must never clean up a newer call.
    const audioElements = new Set<HTMLMediaElement>()
    let room: Room | undefined
    let workerReady = false
    let workerDeadline: ReturnType<typeof setTimeout> | undefined
    const release = () => {
      if (workerDeadline) clearTimeout(workerDeadline)
      room?.removeAllListeners()
      for (const el of Array.from(audioElements)) {
        el.pause()
        el.srcObject = null
        el.remove()
      }
      audioElements.clear()
      if (room) void room.disconnect(true).catch(() => {})
    }
    releaseRef.current = release
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access requires HTTPS or localhost and a supported browser.')
      }
      room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {echoCancellation: true, noiseSuppression: true, autoGainControl: true},
      })
      const current = room
      roomRef.current = current
      const isLocal = (participant?: Participant) => participant?.identity === current.localParticipant.identity
      current.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio || superseded()) return
        const el = track.attach()
        el.style.display = 'none'
        document.body.appendChild(el)
        audioElements.add(el)
      })
      current.on(RoomEvent.TrackUnsubscribed, (track) => {
        for (const el of track.detach()) {
          audioElements.delete(el)
          el.remove()
        }
      })
      const readAgentState = (participant: Participant) => {
        if (isLocal(participant)) return
        const next = participant.attributes?.[AGENT_STATE_ATTRIBUTE]
        if (next && AGENT_STATES.has(next)) {
          setAgentState(next as VoiceAgentState)
          if (next !== 'initializing') {
            workerReady = true
            if (workerDeadline) clearTimeout(workerDeadline)
          }
        }
      }
      current.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => readAgentState(participant))
      current.on(RoomEvent.ParticipantConnected, readAgentState)
      current.on(RoomEvent.ParticipantDisconnected, (participant) => {
        if (!participant.attributes?.[AGENT_STATE_ATTRIBUTE]) return
        stop()
        setError('The voice agent disconnected. Try starting a new call.')
        statusRef.current = 'error'
        setStatus('error')
      })
      current.on(RoomEvent.ActiveSpeakersChanged, (speakers) => setUserSpeaking(speakers.some(isLocal)))
      current.on(RoomEvent.TranscriptionReceived, (segments: TranscriptionSegment[], participant) => {
        if (!isLocal(participant)) return
        for (const seg of segments) setInterimTranscript(seg.final ? undefined : seg.text)
      })
      current.on(RoomEvent.AudioPlaybackStatusChanged, () => setPlaybackBlocked(!current.canPlaybackAudio))
      current.on(RoomEvent.Reconnecting, () => {
        statusRef.current = 'reconnecting'
        setStatus('reconnecting')
      })
      current.on(RoomEvent.Reconnected, () => {
        statusRef.current = 'on'
        setStatus('on')
      })
      current.on(RoomEvent.Disconnected, () => {
        if (superseded()) return
        stop()
        setError('Voice disconnected. Check your connection and try again.')
        statusRef.current = 'error'
        setStatus('error')
      })
      // Run within the click gesture. If the browser still blocks playback, offer an explicit retry button.
      void current.startAudio().catch(() => {
        if (!superseded()) setPlaybackBlocked(true)
      })
      const response = await sendAgentAction({serverUrl, accountUid, action: {_: 'CreateVoiceSession', sessionId}})
      if (superseded()) return
      if (response._ !== 'CreateVoiceSessionResponse') throw new Error('Unexpected response from the agent server')
      if (window.location.protocol === 'https:' && new URL(response.url).protocol !== 'wss:') {
        throw new Error('This server needs a secure voice connection (WSS). Contact the server administrator.')
      }
      await current.connect(response.url, response.token)
      if (superseded()) {
        release()
        return
      }
      current.remoteParticipants.forEach(readAgentState)
      // Dispatch acceptance does not guarantee an available worker. Bound startup explicitly.
      if (!workerReady)
        workerDeadline = setTimeout(() => {
          if (superseded()) return
          stop()
          setError('The voice agent did not become ready. Please try again.')
          statusRef.current = 'error'
          setStatus('error')
        }, 30_000)
      await current.localParticipant.setMicrophoneEnabled(true)
      if (superseded()) {
        release()
        return
      }
      setPlaybackBlocked(!current.canPlaybackAudio)
      statusRef.current = 'on'
      setStatus('on')
    } catch (err) {
      release()
      if (superseded()) return
      releaseRef.current = null
      roomRef.current = null
      resetLiveState()
      setError(describeVoiceError(err))
      statusRef.current = 'error'
      setStatus('error')
    }
  }, [serverUrl, accountUid, sessionId, resetLiveState, stop])

  const toggle = useCallback(() => {
    if (statusRef.current === 'off' || statusRef.current === 'error') void start()
    else stop()
  }, [start, stop])

  const toggleMute = useCallback(async () => {
    const room = roomRef.current
    if (!room || statusRef.current !== 'on' || mutePending.current) return
    mutePending.current = true
    try {
      const enabled = !room.localParticipant.isMicrophoneEnabled
      await room.localParticipant.setMicrophoneEnabled(enabled)
      if (roomRef.current !== room) return
      setMuted(!enabled)
      if (!enabled) {
        setUserSpeaking(false)
        setInterimTranscript(undefined)
      }
      setError(undefined)
    } catch (err) {
      if (roomRef.current === room) setError(describeVoiceError(err))
    } finally {
      if (roomRef.current === room) mutePending.current = false
    }
  }, [])

  const enableAudio = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    try {
      await room.startAudio()
      if (roomRef.current === room) setPlaybackBlocked(!room.canPlaybackAudio)
    } catch {
      if (roomRef.current === room) setPlaybackBlocked(true)
    }
  }, [])

  useEffect(() => stop, [serverUrl, accountUid, sessionId, stop])
  useEffect(() => {
    let disposed = false
    // Consume after effect setup so React StrictMode's rehearsal cannot swallow the user's click.
    queueMicrotask(() => {
      if (disposed || !pendingVoiceStart) return
      const pending = pendingVoiceStart
      if (pending.expiresAt < Date.now()) {
        pendingVoiceStart = undefined
        return
      }
      if (pending.serverUrl !== serverUrl || pending.accountUid !== accountUid || pending.sessionId !== sessionId)
        return
      pendingVoiceStart = undefined
      void start()
    })
    return () => {
      disposed = true
    }
  }, [serverUrl, accountUid, sessionId, start])
  return {
    status,
    agentState,
    userSpeaking,
    muted,
    playbackBlocked,
    interimTranscript,
    error,
    start,
    stop,
    toggle,
    toggleMute,
    enableAudio,
  }
}
