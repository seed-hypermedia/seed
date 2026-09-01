import {createContext, useContext} from 'react'
import {useNavigate} from './navigation'

/**
 * How the surface hosting a transcript opens another agent session.
 *
 * The main window navigates; the assistant panel swaps its own selected session instead —
 * following a continuation, opening a delegate child, or stepping back to a predecessor from the
 * panel must all stay in the panel. Components that open sessions read this through
 * {@link useOpenAgentSession} and never navigate directly, so they behave correctly on both
 * surfaces without threading a callback through every layer.
 */
export const OpenAgentSessionContext = createContext<((sessionId: string, agentId?: string) => void) | null>(null)

/**
 * Opens an agent session the way the hosting surface wants: the panel's override when inside the
 * assistant panel, main-window navigation otherwise. Cmd/shift-click always spawns a full window,
 * matching every other session row in the app; a given `event` is consumed either way.
 */
export function useOpenAgentSession() {
  const override = useContext(OpenAgentSessionContext)
  const navigate = useNavigate()
  const spawn = useNavigate('spawn')
  return (target: {
    sessionId: string
    serverUrl?: string
    agentId?: string
    event?: {metaKey?: boolean; shiftKey?: boolean; preventDefault?: () => void; stopPropagation?: () => void}
  }) => {
    target.event?.preventDefault?.()
    target.event?.stopPropagation?.()
    const route = {
      key: 'agent-session' as const,
      sessionId: target.sessionId,
      ...(target.agentId ? {agentId: target.agentId} : {}),
      serverUrl: target.serverUrl,
    }
    if (target.event?.metaKey || target.event?.shiftKey) {
      if (target.serverUrl) spawn(route)
      return
    }
    if (override) return override(target.sessionId, target.agentId)
    if (target.serverUrl) navigate(route)
  }
}
