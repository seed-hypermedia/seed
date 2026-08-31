import {useAssistantPanel} from '@/assistant-panel-state'
import {useLocalKeyPair} from '@/auth'
import {registerWebAgentsPlatform} from '@/web-agents-platform'
import {AssistantPanel} from '@shm/ui/agents/assistant-panel'

// Register the web platform adapter before any agents UI renders. This module only loads from the
// panel's client-lazy chunk (and the /hm/agents pages register the same adapter — the call is
// idempotent), so the registration never runs during SSR of other pages.
registerWebAgentsPlatform()

/** Client-only body of the assistant panel. */
export default function WebAssistantPanelContent({
  showClose = false,
}: {
  /** Render a close button in the panel header (the side panel has no other way to dismiss it). */
  showClose?: boolean
}) {
  const panel = useAssistantPanel()
  const onClose = showClose ? panel.close : undefined
  const keyPair = useLocalKeyPair()

  // The host only mounts this for a signed-in reader; this guard just covers any future caller.
  if (!keyPair) return null
  return (
    <AssistantPanel
      initialSessionId={panel.sessionId}
      initialAgentId={panel.agentId}
      newChatRequest={panel.newChatRequest}
      onSessionChange={panel.setSessionId}
      onAgentChange={panel.setAgentId}
      onClose={onClose}
    />
  )
}
