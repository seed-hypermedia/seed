import {useAssistantPanel} from '@/assistant-panel-state'
import {useCreateAccount, useLocalKeyPair, useLocalKeyPairLoaded} from '@/auth'
import {registerWebAgentsPlatform} from '@/web-agents-platform'
import {AssistantPanel} from '@shm/ui/agents/assistant-panel'
import {Button} from '@shm/ui/button'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {X} from 'lucide-react'

// Register the web platform adapter before any agents UI renders. This module only loads from the
// panel's client-lazy chunk (and the /hm/agents pages register the same adapter — the call is
// idempotent), so the registration never runs during SSR of other pages.
registerWebAgentsPlatform()

/** Client-only body of the assistant panel: sign-in gate plus the shared panel. */
export default function WebAssistantPanelContent({
  showClose = false,
}: {
  /** Render a close button in the panel header (the side panel has no other way to dismiss it). */
  showClose?: boolean
}) {
  const panel = useAssistantPanel()
  const onClose = showClose ? panel.close : undefined
  const keyPairLoaded = useLocalKeyPairLoaded()
  const keyPair = useLocalKeyPair()

  if (!keyPairLoaded) {
    return (
      <div className="flex flex-1 items-center justify-center py-12">
        <Spinner />
      </div>
    )
  }
  if (!keyPair) return <SignedOutPanel onClose={onClose} />
  return (
    <AssistantPanel
      initialSessionId={panel.sessionId}
      newChatRequest={panel.newChatRequest}
      onSessionChange={panel.setSessionId}
      onClose={onClose}
    />
  )
}

function SignedOutPanel({onClose}: {onClose?: () => void}) {
  const {content, createAccount} = useCreateAccount({})
  return (
    <div className="flex h-full flex-col">
      <div className="border-border flex h-10 items-center justify-between gap-1 border-b px-2 py-2">
        <SizableText size="sm" className="font-medium">
          Agents
        </SizableText>
        {onClose ? (
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1"
            title="Close agents panel"
            aria-label="Close agents panel"
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
        <SizableText size="sm" color="muted">
          Sign in to chat with your agents. Your local web identity signs every agent action.
        </SizableText>
        <Button size="sm" onClick={() => createAccount({source: 'login'})}>
          Sign in
        </Button>
      </div>
      {content}
    </div>
  )
}
