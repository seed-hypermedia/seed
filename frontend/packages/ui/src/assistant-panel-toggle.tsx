import {hmId} from '@shm/shared'
import {SEED_AGENT_SERVER_URL} from '@shm/shared/constants'
import {useResource} from '@shm/shared/models/entity'
import {MessageCircle} from 'lucide-react'
import {createContext, useContext} from 'react'
import {AgentActivityDot, type AgentActivityIndicator} from './agents/activity-dot'
import {parseSpaceAgentIds} from './agents/space-agents'
import {Button} from './button'
import {SmallListItem} from './list-item'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/** Open state and toggle of the agents assistant panel, offered to the site header by its host. */
export type AssistantPanelToggle = {
  isOpen: boolean
  toggle: () => void
  /** Recent activity to show on the entry points, when the host tracks it. */
  activity?: AgentActivityIndicator | null
}

/**
 * Provided by whoever hosts the assistant panel beside the page (on web, the assistant host above
 * the Remix outlet). Absent — the default — where there is no panel to toggle or nobody signed in
 * to use it, and the header shows no button. Desktop has its own toggle in the window title bar.
 */
export const AssistantPanelToggleContext = createContext<AssistantPanelToggle | null>(null)

export function useAssistantPanelToggle(): AssistantPanelToggle | null {
  return useContext(AssistantPanelToggleContext)
}

/**
 * The agents server this space names for its readers, if any.
 *
 * Read straight from the home document rather than through `useSiteAdvertisedAgentServerUrl`: that
 * lives in the agents models, and importing them here would pull the whole agents chunk — editor
 * included — into the initial bundle, which the assistant panel and the /hm/agents pages go out of
 * their way to avoid.
 */
export function useSiteAgents(siteUid: string): {serverUrl: string | null; publishesAgents: boolean} {
  const home = useResource(hmId(siteUid))
  const metadata = home.data?.type === 'document' ? home.data.document?.metadata : undefined
  const raw = metadata?.agentServerUrl
  return {
    serverUrl: typeof raw === 'string' && raw ? raw : null,
    publishesAgents: parseSpaceAgentIds(metadata?.spaceAgents).length > 0,
  }
}

/**
 * Whether a reader of this space has an agents server to talk to: the one the space names in its
 * home document, or the deployment's own default server (`SEED_AGENT_SERVER_URL`). With a default
 * server the panel is always on offer, showing the reader's own agents there even on a space that
 * publishes none.
 */
export function useHasAgentServer(siteUid: string): boolean {
  const siteAgents = useSiteAgents(siteUid)
  return !!siteAgents.serverUrl || !!SEED_AGENT_SERVER_URL
}

/**
 * Site-header toggle for the agents panel, shown beside the search button. Renders nothing unless
 * a host offers the toggle and there is an agents server for the reader to talk to.
 */
export function AssistantPanelHeaderButton({siteUid}: {siteUid: string}) {
  const toggle = useAssistantPanelToggle()
  const hasAgentServer = useHasAgentServer(siteUid)
  if (!toggle || !hasAgentServer) return null
  return (
    <Tooltip content={toggle.activity?.label ?? (toggle.isOpen ? 'Close Agents' : 'Open Agents')}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Agents"
        aria-pressed={toggle.isOpen}
        className={cn(
          'relative h-8 rounded-full border-1 border-transparent p-0',
          toggle.isOpen && 'dark:bg-muted bg-black/5',
        )}
        onClick={toggle.toggle}
      >
        <MessageCircle className="size-4" />
        <AgentActivityDot indicator={toggle.activity} />
      </Button>
    </Tooltip>
  )
}

/**
 * The same toggle as a row in the site header's mobile menu, where there is no room for the
 * button. `onClick` runs after the toggle so the menu can close over the panel it just opened.
 */
export function AssistantPanelMenuItem({siteUid, onClick}: {siteUid: string; onClick?: () => void}) {
  const toggle = useAssistantPanelToggle()
  const hasAgentServer = useHasAgentServer(siteUid)
  if (!toggle || !hasAgentServer) return null
  return (
    <SmallListItem
      bold
      active={toggle.isOpen}
      title={toggle.isOpen ? 'Close Agents' : 'Agents'}
      icon={
        <span className="relative inline-flex">
          <MessageCircle className="size-4" />
          <AgentActivityDot indicator={toggle.activity} className="-top-1 -right-1" />
        </span>
      }
      onClick={() => {
        toggle.toggle()
        onClick?.()
      }}
    />
  )
}
