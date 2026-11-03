import {Bot} from 'lucide-react'
import {createContext, useContext} from 'react'
import type {AgentActivityIndicator} from './agents/activity-dot'
import {Button} from './button'
import {useSiteAgentMounts} from './site-agents'
import {SmallListItem} from './list-item'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/** Open state and toggle of the agents assistant panel, offered to the site header by its host. */
export type AssistantPanelToggle = {
  isOpen: boolean
  toggle: () => void
  /** Recent activity for the entry point tooltip, when the host tracks it. */
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
 * Whether this space has agents for a reader to talk to: at least one mount document (see
 * `useSiteAgentMounts`, a document query kept out of the agents chunk so this costs the initial
 * bundle nothing). A space with no agents gets no panel entry point at all.
 */
export function useSiteHasAgents(siteUid: string): boolean {
  const mounts = useSiteAgentMounts(siteUid)
  return (mounts.data?.length ?? 0) > 0
}

/**
 * Site-header toggle for the agents panel, shown beside the search button. Renders nothing unless
 * a host offers the toggle and the space has agents.
 */
export function AssistantPanelHeaderButton({siteUid}: {siteUid: string}) {
  const toggle = useAssistantPanelToggle()
  const hasAgents = useSiteHasAgents(siteUid)
  if (!toggle || !hasAgents) return null
  return (
    <Tooltip content={toggle.activity?.label ?? (toggle.isOpen ? 'Close Agents' : 'Open Agents')}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Agents"
        aria-pressed={toggle.isOpen}
        className={cn('h-8 rounded-full border-1 border-transparent p-0', toggle.isOpen && 'dark:bg-muted bg-black/5')}
        onClick={toggle.toggle}
      >
        <Bot className="size-4" />
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
  const hasAgents = useSiteHasAgents(siteUid)
  if (!toggle || !hasAgents) return null
  return (
    <SmallListItem
      bold
      active={toggle.isOpen}
      title={toggle.isOpen ? 'Close Agents' : 'Agents'}
      icon={<Bot className="size-4" />}
      onClick={() => {
        toggle.toggle()
        onClick?.()
      }}
    />
  )
}
