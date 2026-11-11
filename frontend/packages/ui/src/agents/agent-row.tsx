import type {AgentActivity} from '@seed-hypermedia/apps-protocol'
import {agentRowActivity, useAgentActivityReadState} from './activity'
import {useNavigate} from './navigation'
import {SizableText} from '@shm/ui/text'

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
  /** The agent's latest-activity rollup, for its activity label beside the name. */
  activity?: AgentActivity
}) {
  const navigate = useNavigate()
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
        {row ? <span className="text-muted-foreground text-xs">{row.short}</span> : null}
        {status.toLowerCase().includes('error') || status.toLowerCase().includes('failed') ? (
          <span className="text-destructive text-xs">{status}</span>
        ) : null}
        {accessRole && accessRole !== 'owner' ? (
          <span className="bg-muted text-muted-foreground flex-none rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
            {accessRole}
          </span>
        ) : null}
      </div>
    </div>
  )
}
