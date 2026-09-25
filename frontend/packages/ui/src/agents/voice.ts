import {Room, RoomEvent, Track, type Participant, type TranscriptionSegment} from 'livekit-client'
import {useCallback, useEffect, useRef, useState} from 'react'
import {AgentServerError, sendAgentAction} from './client'

/**
 * Voice chat with an agent session.
 *
 * The browser joins a LiveKit room the agent server mints for the session; the server's voice
 * worker listens in that room, transcribes what the user says, appends it to the session as a
 * user message, and speaks the agent's reply back through an audio track. This hook owns the
 * room: joining, publishing the mic, playing the agent's audio, and mirroring the worker's state
 * (`lk.agent.state`) so a button can show listening / thinking / speaking.
 */

/** Whether the room is up. `error` keeps the last failure's message until the next start. */
export type VoiceStatus = 'off' | 'connecting' | 'on' | 'error'

/** The worker's published pipeline state; `initializing` until it says otherwise. */
export type VoiceAgentState = 'initializing' | 'listening' | 'thinking' | 'speaking' | 'idle'

export type VoiceSession = {
  status: VoiceStatus
  agentState: VoiceAgentState
  /** True while LiveKit counts the local participant among the active speakers. */
  userSpeaking: boolean
  /** The in-progress transcription of what the user is saying; cleared once a segment is final. */
  interimTranscript?: string
  /** Readable reason for `status === 'error'`. */
  error?: string
  start: () => Promise<void>
  stop: () => void
  toggle: () => void
}

const AGENT_STATE_ATTRIBUTE = 'lk.agent.state'
const AGENT_STATES: ReadonlySet<string> = new Set(['initializing', 'listening', 'thinking', 'speaking', 'idle'])

function toAgentState(value: string | undefined): VoiceAgentState | null {
  return value && AGENT_STATES.has(value) ? (value as VoiceAgentState) : null
}

/** Turns the failures a start can hit into the one line the button shows. */
function describeVoiceError(err: unknown): string {
  if (err instanceof AgentServerError) {
    if (err.status === 501) return 'Voice is not set up on this agent server'
    return err.message
  }
  // getUserMedia failures arrive as DOMExceptions named after the cause.
  const name = typeof err === 'object' && err ? (err as {name?: unknown}).name : undefined
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'Microphone access was denied'
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'No microphone was found'
  if (name === 'NotReadableError') return 'The microphone is in use by another app'
  if (err instanceof Error && err.message) return err.message
  return 'Could not start voice'
}

/**
 * A voice start requested before its session existed. The draft composer's mic creates the session
 * and opens it, which unmounts the draft; the opened session's hook finds the request here and
 * starts the room, so one click on a new chat still ends in a live conversation.
 */
let pendingVoiceAutoStart: {serverUrl: string; sessionId: string} | null = null

/** Asks the next `useVoiceSession` mounted for this session to start immediately. */
export function requestVoiceAutoStart(serverUrl: string, sessionId: string): void {
  pendingVoiceAutoStart = {serverUrl, sessionId}
}

/** Consumes a pending request for this session, if any. */
export function takeVoiceAutoStart(serverUrl: string, sessionId: string): boolean {
  if (pendingVoiceAutoStart?.serverUrl !== serverUrl || pendingVoiceAutoStart.sessionId !== sessionId) return false
  pendingVoiceAutoStart = null
  return true
}

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
  const [interimTranscript, setInterimTranscript] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()

  const roomRef = useRef<Room | null>(null)
  const audioElementsRef = useRef<HTMLMediaElement[]>([])
  /** Bumped by every start and stop, so a start still awaiting the token or the connection
   * notices it was superseded and tears its room down instead of publishing a stale one. */
  const attemptRef = useRef(0)
  const statusRef = useRef<VoiceStatus>('off')
  statusRef.current = status

  const resetLiveState = useCallback(() => {
    setAgentState('initializing')
    setUserSpeaking(false)
    setInterimTranscript(undefined)
  }, [])

  const removeAudioElements = useCallback(() => {
    for (const el of audioElementsRef.current) el.remove()
    audioElementsRef.current = []
  }, [])

  /** Stable: reads everything through refs so effects and the button can hold onto it. */
  const stop = useCallback(() => {
    attemptRef.current += 1
    const room = roomRef.current
    roomRef.current = null
    removeAudioElements()
    resetLiveState()
    if (room) {
      room.removeAllListeners()
      void room.localParticipant.setMicrophoneEnabled(false).catch(() => {})
      void room.disconnect().catch(() => {})
    }
    setStatus('off')
    setError(undefined)
  }, [removeAudioElements, resetLiveState])

  const start = useCallback(async () => {
    if (statusRef.current === 'connecting' || statusRef.current === 'on') return
    const attempt = ++attemptRef.current
    const superseded = () => attemptRef.current !== attempt
    setError(undefined)
    setStatus('connecting')
    statusRef.current = 'connecting'
    resetLiveState()

    let room: Room | null = null
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access is not available here')
      }
      const response = await sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'CreateVoiceSession', sessionId},
      })
      if (response._ !== 'CreateVoiceSessionResponse') {
        throw new Error('Unexpected response from the agent server')
      }
      if (superseded()) return

      room = new Room({adaptiveStream: true, dynacast: true})
      const current = room
      const isLocal = (participant?: Participant) =>
        !!participant && participant.identity === current.localParticipant.identity

      // The agent's audio plays through hidden elements on the body, so the composer that hosts
      // the button never has to lay them out.
      current.on(RoomEvent.TrackSubscribed, (track) => {
        if (track.kind !== Track.Kind.Audio) return
        const el = track.attach()
        el.style.display = 'none'
        document.body.appendChild(el)
        audioElementsRef.current.push(el)
      })
      current.on(RoomEvent.TrackUnsubscribed, (track) => {
        for (const el of track.detach()) {
          audioElementsRef.current = audioElementsRef.current.filter((a) => a !== el)
          el.remove()
        }
      })
      // The worker publishes its pipeline state as a participant attribute; it may already be
      // in the room (read below) or join after us.
      const readAgentState = (participant: Participant) => {
        if (isLocal(participant)) return
        const next = toAgentState(participant.attributes?.[AGENT_STATE_ATTRIBUTE])
        if (next) setAgentState(next)
      }
      current.on(RoomEvent.ParticipantAttributesChanged, (_changed, participant) => readAgentState(participant))
      current.on(RoomEvent.ParticipantConnected, (participant) => readAgentState(participant))
      current.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setUserSpeaking(speakers.some((s) => isLocal(s)))
      })
      current.on(RoomEvent.TranscriptionReceived, (segments: TranscriptionSegment[], participant) => {
        if (!isLocal(participant)) return
        for (const seg of segments) {
          if (seg.final) setInterimTranscript(undefined)
          else if (seg.text?.trim()) setInterimTranscript(seg.text)
        }
      })
      // No auto-reconnect: a dropped room turns the button off and the user clicks again.
      current.on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== current) return
        roomRef.current = null
        attemptRef.current += 1
        current.removeAllListeners()
        removeAudioElements()
        resetLiveState()
        setStatus('off')
      })

      await current.connect(response.url, response.token)
      if (superseded()) {
        current.removeAllListeners()
        await current.disconnect()
        return
      }
      current.remoteParticipants.forEach((participant) => readAgentState(participant))
      await current.localParticipant.setMicrophoneEnabled(true)
      if (superseded()) {
        current.removeAllListeners()
        await current.disconnect()
        return
      }
      // Browsers may hold playback until a gesture; the click that started us counts, so this
      // is a no-op there and best-effort elsewhere.
      void current.startAudio().catch(() => {})
      roomRef.current = current
      setStatus('on')
      statusRef.current = 'on'
    } catch (err) {
      if (room) {
        room.removeAllListeners()
        void room.disconnect().catch(() => {})
      }
      removeAudioElements()
      if (superseded()) return
      resetLiveState()
      setError(describeVoiceError(err))
      setStatus('error')
      statusRef.current = 'error'
    }
  }, [serverUrl, accountUid, sessionId, removeAudioElements, resetLiveState])

  const toggle = useCallback(() => {
    if (statusRef.current === 'off' || statusRef.current === 'error') void start()
    else stop()
  }, [start, stop])

  // A room belongs to one session: leave it when the composer moves to another or goes away.
  useEffect(() => stop, [sessionId, stop])

  // A new chat's mic asked for voice before the session existed; honour it now that it does.
  useEffect(() => {
    if (takeVoiceAutoStart(serverUrl, sessionId)) void start()
  }, [serverUrl, sessionId, start])

  return {status, agentState, userSpeaking, interimTranscript, error, start, stop, toggle}
}
