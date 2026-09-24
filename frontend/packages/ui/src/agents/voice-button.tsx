import {Button} from '@shm/ui/button'
import {cn} from '@shm/ui/utils'
import {Loader2, Mic, MicOff} from 'lucide-react'
import {useState} from 'react'
import {requestVoiceAutoStart, useVoiceSession} from './voice'

/**
 * The mic button in an agent-session composer: one click joins the session's voice room, the
 * next leaves it. Its colour follows the worker's state so the user can see whether they are
 * being heard (accent), waited on (amber), or answered (blue); a failed start turns it red with
 * the reason as its tooltip.
 */
export function VoiceButton({
  serverUrl,
  accountUid,
  sessionId,
  className,
  showStatus = false,
}: {
  serverUrl: string
  accountUid: string
  sessionId: string
  className?: string
  /** Also write the state out next to the button, with what the mic is hearing while you talk. */
  showStatus?: boolean
}) {
  const voice = useVoiceSession({serverUrl, accountUid, sessionId})
  const {status, agentState, userSpeaking, interimTranscript, error} = voice

  let title: string
  let stateClassName: string | undefined
  let Icon: typeof Mic = Mic
  if (status === 'connecting') {
    title = 'Connecting…'
    Icon = Loader2
  } else if (status === 'error') {
    title = error ?? 'Could not start voice'
    Icon = MicOff
    stateClassName = 'text-destructive'
  } else if (status === 'on') {
    if (agentState === 'thinking') {
      title = 'Thinking…'
      stateClassName = 'bg-amber-500/15 text-amber-700 hover:text-amber-700 dark:text-amber-300 animate-pulse'
    } else if (agentState === 'speaking') {
      title = 'Speaking…'
      stateClassName = 'bg-blue-500/15 text-blue-700 hover:text-blue-700 dark:text-blue-300 animate-pulse'
    } else if (agentState === 'listening') {
      title = 'Listening…'
      stateClassName = cn(
        'bg-accent text-accent-foreground ring-2 ring-primary/40 hover:bg-accent/80',
        userSpeaking && 'animate-pulse',
      )
    } else {
      title = 'Stop voice'
      stateClassName = 'bg-accent text-accent-foreground hover:bg-accent/80'
    }
  } else {
    title = 'Talk to the agent'
    stateClassName = 'text-muted-foreground'
  }

  // What the label says while the room is up: the state, and while you talk, that you are heard —
  // with the words as they are recognised, so "is it hearing me?" has an answer on screen.
  let statusText: string | null = null
  if (status === 'connecting') statusText = 'Connecting…'
  else if (status === 'error') statusText = error ?? 'Could not start voice'
  else if (status === 'on') {
    if (agentState === 'thinking') statusText = 'Thinking…'
    else if (agentState === 'speaking') statusText = 'Speaking…'
    else if (userSpeaking || interimTranscript)
      statusText = interimTranscript ? `“${interimTranscript}”` : 'Hearing you…'
    else if (agentState === 'listening') statusText = 'Listening…'
    else statusText = 'Joining…'
  }

  const button = (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn('max-sm:size-10', stateClassName, className)}
      onClick={voice.toggle}
      title={title}
      aria-label={status === 'on' ? 'Stop voice' : 'Talk to the agent'}
      aria-pressed={status === 'on' || status === 'connecting'}
      data-voice-status={status}
      data-voice-agent-state={status === 'on' ? agentState : undefined}
    >
      <Icon className={cn('size-3.5', status === 'connecting' && 'animate-spin')} />
    </Button>
  )
  if (!showStatus || !statusText) return button
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {button}
      <span
        role="status"
        aria-live="polite"
        className={cn(
          'max-w-56 truncate text-xs',
          status === 'error' ? 'text-destructive' : 'text-muted-foreground',
          status === 'on' && (userSpeaking || interimTranscript) && 'text-foreground',
        )}
        title={statusText}
      >
        {statusText}
      </span>
    </div>
  )
}

/**
 * The mic of a draft composer, where no session exists yet. A click creates the session the same
 * way the first typed message would, marks it for an immediate voice start, and opens it; the
 * session view's own mic then joins the room. The button reads as the same control as the live one.
 */
export function DraftVoiceButton({
  serverUrl,
  startSession,
  onSessionStarted,
  className,
}: {
  serverUrl: string
  /** Creates the session and resolves its id. */
  startSession: () => Promise<string>
  /** Opens the created session. */
  onSessionStarted: (sessionId: string) => void
  className?: string
}) {
  const [state, setState] = useState<{status: 'off' | 'connecting' | 'error'; error?: string}>({status: 'off'})
  const begin = async () => {
    if (state.status === 'connecting') return
    setState({status: 'connecting'})
    try {
      const sessionId = await startSession()
      requestVoiceAutoStart(serverUrl, sessionId)
      onSessionStarted(sessionId)
    } catch (err) {
      setState({status: 'error', error: err instanceof Error ? err.message : 'Could not start the session'})
    }
  }
  const Icon = state.status === 'connecting' ? Loader2 : state.status === 'error' ? MicOff : Mic
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className={cn(
        'max-sm:size-10',
        state.status === 'error' ? 'text-destructive' : 'text-muted-foreground',
        className,
      )}
      onClick={() => void begin()}
      title={state.status === 'connecting' ? 'Starting…' : state.error ?? 'Talk to the agent'}
      aria-label="Talk to the agent"
      aria-pressed={state.status === 'connecting'}
      data-voice-status={state.status}
    >
      <Icon className={cn('size-3.5', state.status === 'connecting' && 'animate-spin')} />
    </Button>
  )
}
