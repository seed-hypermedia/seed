import {useSelectedAccountId} from './account'
import {describeAgentServer, useAgentLists, useAgentServerUrls, useLocalAgentServerUrl} from './models'
import {useNavigate} from './navigation'
import {getAgentStatusIndicator} from './agent-row'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {SizableText} from '@shm/ui/text'
import {Bot, Check, ChevronDown, LayoutList, Pencil} from 'lucide-react'
import {useMemo} from 'react'

/**
 * The page title of the Agents pages, doubling as the agent switcher: opening it lists every agent
 * across the configured servers, and picking one lands on that agent's home (its sessions). The
 * current agent, when there is one, is marked rather than hidden so the list reads the same from
 * every page.
 */
export function AgentTitleMenu({
  title,
  current,
  onRename,
}: {
  title: string
  /** The agent whose page this is; absent on the all-agents home page. */
  current?: {serverUrl: string; agentId: string}
  /** Offered as the first row when the viewer can rename the current agent. */
  onRename?: () => void
}) {
  const navigate = useNavigate()
  const accountUid = useSelectedAccountId()
  const serverUrls = useAgentServerUrls().data || []
  const localServerUrl = useLocalAgentServerUrl()
  const agentQueries = useAgentLists(serverUrls, accountUid)
  const agents = useMemo(
    () =>
      serverUrls.flatMap((serverUrl, index) =>
        (agentQueries[index]?.data || []).map((agent) => ({
          serverUrl,
          id: agent.id,
          name: agent.definition.name,
          status: agent.status,
        })),
      ),
    [agentQueries, serverUrls],
  )
  const isLoading = agentQueries.some((query) => query.isFetching && !query.data)
  // Server names only disambiguate when there is more than one server to tell apart.
  const showServer = serverUrls.length > 1

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${title}: switch agent`}
          className="hover:bg-muted/60 -mx-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-left"
        >
          <SizableText size="2xl" weight="bold" className="min-w-0 truncate">
            {title}
          </SizableText>
          <ChevronDown className="text-muted-foreground size-4 flex-none" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] min-w-64 overflow-y-auto">
        {onRename ? (
          <>
            <DropdownMenuItem onClick={onRename}>
              <Pencil />
              Rename agent…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel className="text-muted-foreground text-xs font-medium">Agents</DropdownMenuLabel>
        {agents.map((agent) => {
          const isCurrent = !!current && current.serverUrl === agent.serverUrl && current.agentId === agent.id
          const indicator = getAgentStatusIndicator(agent.status)
          return (
            <DropdownMenuItem
              key={`${agent.serverUrl}:${agent.id}`}
              onClick={() => navigate({key: 'agent', agentId: agent.id, serverUrl: agent.serverUrl})}
              aria-current={isCurrent ? 'page' : undefined}
            >
              <span className="relative flex size-4 flex-none items-center justify-center">
                <Bot />
                <span
                  aria-label={indicator.label}
                  className={`absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full ${indicator.className}`}
                />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{agent.name || 'Agent'}</span>
                {showServer ? (
                  <span className="text-muted-foreground truncate text-xs">
                    {describeAgentServer(agent.serverUrl, localServerUrl.data)}
                  </span>
                ) : null}
              </span>
              {isCurrent ? <Check className="ml-auto" /> : null}
            </DropdownMenuItem>
          )
        })}
        {!agents.length ? (
          <DropdownMenuItem disabled>{isLoading ? 'Loading agents…' : 'No agents yet.'}</DropdownMenuItem>
        ) : null}
        {current ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate({key: 'agents'})}>
              <LayoutList />
              All agents
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
