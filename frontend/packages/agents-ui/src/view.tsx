import {AssistantPanel} from '@shm/ui/agents/assistant-panel'
import AgentDetailRoutePage from '@shm/ui/agents/detail'
import AgentsListPage from '@shm/ui/agents/list'
import AgentRunRoutePage from '@shm/ui/agents/run'
import AgentServerPage from '@shm/ui/agents/server'
import AgentSessionRoutePage from '@shm/ui/agents/session'
import {cn} from '@shm/ui/utils'
import {useSeedAgentsRoute} from './provider'

/**
 * The full agents UI at the current route: the agents list, a server, an agent with its tabs
 * (sessions, triggers, memory, tools, system prompt, collaborators, settings), a session, or a run.
 * It fills its container; give the container a height.
 */
export function SeedAgentsView({className}: {className?: string}) {
  const route = useSeedAgentsRoute()
  return <div className={cn('seed-agents flex h-full min-h-0 flex-1 flex-col', className)}>{page(route.key)}</div>
}

function page(key: ReturnType<typeof useSeedAgentsRoute>['key']) {
  switch (key) {
    case 'agent-server':
      return <AgentServerPage />
    case 'agent':
      return <AgentDetailRoutePage />
    case 'agent-session':
      return <AgentSessionRoutePage />
    case 'agent-run':
      return <AgentRunRoutePage />
    case 'agents':
      return <AgentsListPage />
  }
}

export type SeedAgentsAssistantProps = {
  /** The open chat to restore, exactly as `onSessionChange` last reported it (an opaque ref). */
  initialSessionId?: string | null
  /** The agent filter to restore, exactly as `onAgentChange` last reported it (an opaque ref). */
  initialAgentId?: string | null
  /** Bump to start a new chat from outside the panel. */
  newChatRequest?: number
  /** Reports the open chat as an opaque ref, or null while the list shows, for the host to persist. */
  onSessionChange?: (sessionRef: string | null) => void
  /** Reports the agent filter as an opaque ref, or null for all agents, for the host to persist. */
  onAgentChange?: (agentRef: string | null) => void
  /** Shows a close button that calls this. */
  onClose?: () => void
  className?: string
}

/**
 * The compact chat panel Seed's apps show beside documents: pick an agent, chat, switch between
 * recent sessions. Sessions it opens stay inside the panel.
 */
export function SeedAgentsAssistant({className, ...props}: SeedAgentsAssistantProps) {
  return (
    <div className={cn('seed-agents flex h-full min-h-0 flex-col', className)}>
      <AssistantPanel {...props} />
    </div>
  )
}
