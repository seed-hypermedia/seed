import {Bot} from 'lucide-react'
import {createContext, useContext} from 'react'
import type {AgentActivityIndicator} from './agents/activity-dot'
import {Button} from './button'
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
 * the Remix outlet), and only while the reader has an agent to talk to there: signed in, on a
 * space with at least one mounted agent their account can see (owner, accepted collaborator, or
 * public agent). Absent — the default — otherwise, and the header shows no button: a reader the
 * space's agents are not shared with gets no way into an empty panel. Desktop has its own toggle
 * in the window title bar.
 */
export const AssistantPanelToggleContext = createContext<AssistantPanelToggle | null>(null)

export function useAssistantPanelToggle(): AssistantPanelToggle | null {
  return useContext(AssistantPanelToggleContext)
}

/**
 * Site-header toggle for the agents panel, shown beside the search button. Renders nothing unless
 * a host offers the toggle, which it does only while the reader has an agent here.
 */
export function AssistantPanelHeaderButton() {
  const toggle = useAssistantPanelToggle()
  if (!toggle) return null
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
export function AssistantPanelMenuItem({onClick}: {onClick?: () => void}) {
  const toggle = useAssistantPanelToggle()
  if (!toggle) return null
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
