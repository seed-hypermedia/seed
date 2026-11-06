import {Bot} from 'lucide-react'
import {createContext, useContext} from 'react'
import {Button} from './button'
import {SmallListItem} from './list-item'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/** Open state and toggle of the agents assistant panel, offered to the site header by its host. */
export type AssistantPanelToggle = {
  isOpen: boolean
  toggle: () => void
  /**
   * How many agents the reader owns that live in no space yet. Agents became documents and the
   * pages that listed them are gone, so the entry point is how someone with agents from before
   * learns they have something to adopt: it stays visible and carries a red dot while any remain.
   */
  orphans?: number
}

/**
 * Provided by whoever hosts the assistant panel beside the page (on web, the assistant host above
 * the Remix outlet), and only while the reader has something to do there: signed in, on a space
 * with at least one mounted agent their account can see (owner, accepted collaborator, or public
 * agent), or owning orphan agents to adopt. Absent — the default — otherwise, and the header shows
 * no button: a reader the space's agents are not shared with gets no way into an empty panel.
 * Desktop has its own toggle in the window title bar.
 */
export const AssistantPanelToggleContext = createContext<AssistantPanelToggle | null>(null)

export function useAssistantPanelToggle(): AssistantPanelToggle | null {
  return useContext(AssistantPanelToggleContext)
}

/** Tooltip and label of every agents entry point. The red dot, not the label, flags orphans. */
export const ASSISTANT_TOGGLE_LABEL = 'Agents'

/** The red dot on an agents entry point while the reader owns orphan agents. */
export function OrphanAgentsDot({orphans}: {orphans: number | undefined}) {
  if (!orphans) return null
  return (
    <span
      data-testid="agent-orphans-dot"
      aria-hidden
      className="bg-destructive pointer-events-none absolute top-0.5 right-0.5 size-2 rounded-full"
    />
  )
}

/**
 * Site-header toggle for the agents panel, shown beside the search button. Renders nothing unless
 * a host offers the toggle, which it does only while the reader has an agent here.
 */
export function AssistantPanelHeaderButton() {
  const toggle = useAssistantPanelToggle()
  if (!toggle) return null
  return (
    <Tooltip content={ASSISTANT_TOGGLE_LABEL}>
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
        <Bot className="size-4" />
        <OrphanAgentsDot orphans={toggle.orphans} />
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
      title={ASSISTANT_TOGGLE_LABEL}
      icon={
        <span className="relative flex">
          <Bot className="size-4" />
          <OrphanAgentsDot orphans={toggle.orphans} />
        </span>
      }
      onClick={() => {
        toggle.toggle()
        onClick?.()
      }}
    />
  )
}
