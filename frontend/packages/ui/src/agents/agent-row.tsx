import type {AgentActivity} from '@seed-hypermedia/agents-protocol'
import {agentRowActivity, useAgentActivityReadState} from './activity'
import {AgentActivityMark} from './activity-dot'
import {useNavigate} from './navigation'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'

export function getAgentStatusIndicator(status: string): {label: string; className: string} {
  const normalizedStatus = status.toLowerCase()
  if (normalizedStatus.includes('error') || normalizedStatus.includes('failed')) {
    return {label: status || 'Error', className: 'bg-destructive'}
  }
  if (
    normalizedStatus.includes('thinking') ||
    normalizedStatus.includes('streaming') ||
    normalizedStatus.includes('running') ||
    normalizedStatus.includes('busy')
  ) {
    return {label: status || 'Thinking', className: 'animate-pulse bg-muted-foreground/60'}
  }
  return {label: status || 'Idle', className: 'bg-green-500'}
}

export function AgentListRow({
  agentId,
  name,
  status,
  serverUrl,
  accessRole,
  activity,
}: {
  agentId: string
  name: string
  status: string
  serverUrl: string
  accessRole?: 'owner' | 'reader' | 'writer' | 'chatter'
  /** The agent's latest-activity rollup, for the unread mark beside its name. */
  activity?: AgentActivity
}) {
  const navigate = useNavigate()
  const statusIndicator = getAgentStatusIndicator(status)
  const readState = useAgentActivityReadState()
  const row = agentRowActivity(activity, serverUrl, name, readState.data)
  return (
    <div
      className="border-border hover:bg-muted/60 flex cursor-pointer items-center justify-between gap-4 rounded-lg border p-3 transition-colors"
      onClick={() => navigate({key: 'agent', agentId, serverUrl})}
    >
      <div className="flex min-w-0 items-center gap-2">
        <SizableText weight="bold" className="min-w-0 truncate">
          {name}
        </SizableText>
        {row ? (
          <Tooltip content={row.label} asChild>
            <span className="inline-flex">
              <AgentActivityMark tone={row.tone} label={row.label} />
            </span>
          </Tooltip>
        ) : null}
        {accessRole && accessRole !== 'owner' ? (
          <span className="bg-muted text-muted-foreground flex-none rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
            {accessRole}
          </span>
        ) : null}
      </div>
      <Tooltip content={statusIndicator.label} asChild>
        <span className={`size-2.5 shrink-0 rounded-full ${statusIndicator.className}`} />
      </Tooltip>
    </div>
  )
}
