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

/**
 * How the hosting surface opens a run's own page — the durable record with its hierarchy, code,
 * and activity. Returns a click handler for the given run, or nothing when the surface has no way
 * in, so a row can decide whether it is a button at all.
 *
 * The main window navigates to the run page. The assistant panel has no run page to show, so
 * there a run with a transcript opens that transcript in the panel instead, and a run without one
 * (a script, a delegate that never got a session) stays inert.
 */
export function useOpenAgentRun() {
  const override = useContext(OpenAgentSessionContext)
  const navigate = useNavigate()
  return (target: {
    runId: string
    sessionId?: string
    agentId?: string
    serverUrl: string
  }): (() => void) | undefined => {
    if (override) {
      const sessionId = target.sessionId
      return sessionId ? () => override(sessionId, target.agentId) : undefined
    }
    return () =>
      navigate({
        key: 'agent-run',
        runId: target.runId,
        ...(target.agentId ? {agentId: target.agentId} : {}),
        serverUrl: target.serverUrl,
      })
  }
}
