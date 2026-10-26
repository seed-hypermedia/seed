import {Button} from '@shm/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {cn} from '@shm/ui/utils'
import {AudioLines, Loader2, Mic, MicOff, PhoneOff, Settings2, Volume2} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {useAgentServerHealth} from './models'
import {requestVoiceAutoStart, useVoiceSession} from './voice'
import {useVoiceSettings, VoiceServerSettings} from './voice-settings'

type VoiceControlProps = {
  serverUrl: string
  accountUid: string
  sessionId?: string
  startSession?: () => Promise<string>
  onSessionStarted?: (sessionId: string) => void
  className?: string
}

/** Shared desktop/web call controls, with server-specific setup and recoverable audio feedback. */
export function VoiceButton(props: VoiceControlProps) {
  const health = useAgentServerHealth(props.serverUrl)
  // Do not send unsupported signed actions to older or unconfigured servers.
  if (!health.data?.voice || (!props.sessionId && !(props.startSession && props.onSessionStarted))) return null
  return <VoiceControls key={`${props.serverUrl}:${props.accountUid}:${props.sessionId ?? 'draft'}`} {...props} />
}

function VoiceControls({
  serverUrl,
  accountUid,
  sessionId,
  startSession,
  onSessionStarted,
  className,
}: VoiceControlProps) {
  const voice = useVoiceSession({serverUrl, accountUid, sessionId: sessionId ?? ''})
  const [creating, setCreating] = useState(false)
  const [creationError, setCreationError] = useState<string>()
  const draftAttempt = useRef(0)
  const creationPending = useRef(false)
  useEffect(
    () => () => {
      draftAttempt.current += 1
    },
    [],
  )
  const begin = async () => {
    if (sessionId) {
      await voice.start()
      return
    }
    if (!startSession || !onSessionStarted || creationPending.current) return
    const attempt = ++draftAttempt.current
    creationPending.current = true
    setCreating(true)
    setCreationError(undefined)
    try {
      const created = await startSession()
      if (draftAttempt.current !== attempt) return
      requestVoiceAutoStart(serverUrl, accountUid, created)
      onSessionStarted(created)
    } catch (error) {
      if (draftAttempt.current === attempt)
        setCreationError(error instanceof Error ? error.message : 'Could not start the conversation.')
    } finally {
      if (draftAttempt.current === attempt) {
        creationPending.current = false
        setCreating(false)
      }
    }
  }
  const stop = () => {
    draftAttempt.current += 1
    creationPending.current = false
    setCreating(false)
    voice.stop()
  }
  const settings = useVoiceSettings(serverUrl, accountUid)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const active = creating || voice.status === 'on' || voice.status === 'connecting' || voice.status === 'reconnecting'
  const ready =
    settings.data?.available && settings.data.deepgramApiKey !== 'none' && settings.data.cartesiaApiKey !== 'none'
  const busy = creating || voice.status === 'connecting' || voice.status === 'reconnecting'
  const label = creating
    ? 'Starting conversation…'
    : voice.status === 'connecting'
      ? 'Connecting…'
      : voice.status === 'reconnecting'
        ? 'Reconnecting…'
        : voice.agentState === 'speaking'
          ? 'Speaking'
          : voice.agentState === 'thinking'
            ? 'Thinking…'
            : voice.muted
              ? 'Microphone muted'
              : voice.agentState === 'listening'
                ? voice.userSpeaking
                  ? 'Hearing you'
                  : 'Listening'
                : 'Starting voice…'
  const Icon = busy ? Loader2 : voice.agentState === 'speaking' ? AudioLines : voice.muted ? MicOff : Mic
  return (
    <div className={cn('px-3 pt-2', className)}>
      <div className={cn('flex flex-wrap items-center gap-2 rounded-lg', active && 'bg-muted ring-border p-2 ring-1')}>
        {active ? (
          <>
            <div className="flex min-w-24 flex-1 items-center gap-2 text-sm" role="status">
              <Icon
                aria-hidden
                className={cn(
                  'text-primary size-4 shrink-0',
                  busy && 'motion-safe:animate-spin',
                  voice.userSpeaking && !voice.muted && 'motion-safe:animate-pulse',
                )}
              />
              <span>{label}</span>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1">
              {voice.playbackBlocked ? (
                <Button type="button" size="sm" variant="outline" onClick={() => void voice.enableAudio()}>
                  <Volume2 className="size-4" /> Enable sound
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="max-sm:size-10"
                disabled={voice.status !== 'on'}
                aria-label={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
                aria-pressed={voice.muted}
                title={voice.muted ? 'Unmute microphone' : 'Mute microphone'}
                onClick={() => void voice.toggleMute()}
              >
                {voice.muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="max-sm:size-10"
                onClick={stop}
                aria-label={voice.status === 'connecting' ? 'Cancel voice connection' : 'End voice call'}
                title="End voice call"
              >
                <PhoneOff className="text-destructive size-4" />
              </Button>
            </div>
          </>
        ) : (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={settings.isLoading}
              onClick={() => (ready ? void begin() : setSettingsOpen(true))}
              title={ready ? 'Talk to the agent' : 'Set up voice'}
              aria-label={ready ? 'Talk to the agent' : 'Set up voice'}
              aria-pressed={false}
              data-voice-status={voice.status}
            >
              <AudioLines className="size-4" /> {voice.status === 'error' ? 'Try voice again' : 'Voice'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSettingsOpen(true)}
              aria-label="Voice settings"
              title="Voice settings"
            >
              <Settings2 className="size-3.5" />
            </Button>
          </>
        )}
      </div>
      {voice.error || creationError ? (
        <p role="alert" className="text-destructive mt-2 text-xs">
          {voice.error || creationError}
        </p>
      ) : null}
      {voice.interimTranscript ? (
        <p className="text-muted-foreground mt-2 line-clamp-2 text-sm">{voice.interimTranscript}</p>
      ) : null}
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent>
          <DialogTitle>Voice settings</DialogTitle>
          <DialogDescription>Talk to your agent and hear its replies in this conversation.</DialogDescription>
          <VoiceServerSettings serverUrl={serverUrl} accountUid={accountUid} />
        </DialogContent>
      </Dialog>
    </div>
  )
}
