import {invalidateQueries} from '@shm/shared/models/query-client'
import {Bot, ChevronDown, ChevronUp} from 'lucide-react'
import {useMemo, useState} from 'react'
import {Button} from '../button'
import {SizableText} from '../text'
import {toast} from '../toast'
import {useAppDialog} from '../universal-dialog'
import type {AgentInfo} from './client'
import {describeAgentServer, useLocalAgentServerUrl} from './models'
import {MountAgentDialog, unmountedOwnedAgents} from './mount'
import {getAgentsPlatform} from './platform'

/** Rows shown before the list folds behind "Show all". */
const VISIBLE_ROWS = 4

/**
 * Sticky card at the top of the assistant panel's list for agents the account owns that are not
 * mounted in a document yet. Agents became documents: the pages that used to list them are gone,
 * so this is where somebody with agents from before finds them and gives each a home. It stays
 * until every owned agent is mounted (it can fold to one line for the session), and never shows
 * for a new account or one whose agents are all mounted.
 */
export function AgentMountReminder({
  agents,
  settled,
}: {
  /** Every agent on every server the panel knows, as the panel lists them. */
  agents: {serverUrl: string; agent: AgentInfo}[]
  /** False while the agent lists are still loading, so the card never flashes in and out. */
  settled: boolean
}) {
  const accountUid = getAgentsPlatform().useAccountUid()
  const localServerUrl = useLocalAgentServerUrl()
  const dialog = useAppDialog(MountAgentDialog)
  const [folded, setFolded] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const pending = useMemo(() => unmountedOwnedAgents(agents), [agents])
  if (!settled || !accountUid || pending.length === 0) return null
  const rows = showAll ? pending : pending.slice(0, VISIBLE_ROWS)
  const hidden = pending.length - rows.length
  const count = pending.length === 1 ? '1 agent' : `${pending.length} agents`
  return (
    <section
      aria-label="Agents to mount"
      className="border-border bg-muted/40 flex flex-none flex-col gap-2 border-b px-3 py-2"
    >
      {dialog.content}
      <div className="flex items-center gap-2">
        <Bot className="text-muted-foreground size-4 shrink-0" />
        <SizableText size="sm" weight="bold" className="min-w-0 flex-1 truncate">
          {folded ? `${count} to mount` : 'Give your agents a home'}
        </SizableText>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={folded ? 'Show agents to mount' : 'Hide agents to mount'}
          onClick={() => setFolded((value) => !value)}
        >
          {folded ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
        </Button>
      </div>
      {folded ? null : (
        <>
          <SizableText size="xs" color="muted">
            {count} you own {pending.length === 1 ? 'is' : 'are'} not mounted in a document yet. A mounted agent gets a
            page of its own, with its chats, tools and settings, that you can link to.
          </SizableText>
          <ul className="flex flex-col gap-1">
            {rows.map(({serverUrl, agent}) => (
              <li key={`${serverUrl} ${agent.id}`} className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 flex-col">
                  <SizableText size="sm" className="truncate">
                    {agent.definition.name || 'Untitled agent'}
                  </SizableText>
                  <SizableText size="xs" color="muted" className="truncate">
                    {describeAgentServer(serverUrl, localServerUrl.data)}
                  </SizableText>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    dialog.open({
                      agent,
                      serverUrl,
                      accountUid,
                      onMounted: () => {
                        toast.success(`Mounted ${agent.definition.name || 'the agent'}`)
                        invalidateQueries(['agents'])
                      },
                    })
                  }
                >
                  Mount
                </Button>
              </li>
            ))}
          </ul>
          {hidden > 0 ? (
            <Button variant="link" size="sm" className="h-auto justify-start p-0" onClick={() => setShowAll(true)}>
              Show all {pending.length}
            </Button>
          ) : null}
        </>
      )}
    </section>
  )
}
