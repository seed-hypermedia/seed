import {Button} from '@shm/ui/button'
import {cn} from '@shm/ui/utils'
import {Loader2, Mic, MicOff} from 'lucide-react'
import {useVoiceSession} from './voice'

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
}: {
  serverUrl: string
  accountUid: string
  sessionId: string
  className?: string
}) {
  const voice = useVoiceSession({serverUrl, accountUid, sessionId})
  const {status, agentState, userSpeaking, error} = voice

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

  return (
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
}
