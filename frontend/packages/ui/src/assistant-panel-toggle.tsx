import {hmId} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {MessageCircle} from 'lucide-react'
import {createContext, useContext} from 'react'
import {parseSpaceAgentIds} from './agents/space-agents'
import {Button} from './button'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/** Open state and toggle of the agents assistant panel, offered to the site header by its host. */
export type AssistantPanelToggle = {
  isOpen: boolean
  toggle: () => void
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
 * Site-header toggle for the agents panel, shown beside the search button. Renders nothing unless
 * a host offers the toggle and the space names an agents server for its readers.
 */
export function AssistantPanelHeaderButton({siteUid}: {siteUid: string}) {
  const toggle = useAssistantPanelToggle()
  const siteAgents = useSiteAgents(siteUid)
  if (!toggle || !siteAgents.serverUrl) return null
  return (
    <Tooltip content={toggle.isOpen ? 'Close Agents' : 'Open Agents'}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Agents"
        aria-pressed={toggle.isOpen}
        className={cn('h-8 rounded-full border-1 border-transparent p-0', toggle.isOpen && 'dark:bg-muted bg-black/5')}
        onClick={toggle.toggle}
      >
        <MessageCircle className="size-4" />
      </Button>
    </Tooltip>
  )
}
