import {useNavigate} from '@/utils/useNavigate'
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
}: {
  agentId: string
  name: string
  status: string
  serverUrl: string
}) {
  const navigate = useNavigate()
  const statusIndicator = getAgentStatusIndicator(status)
  return (
    <div
      className="border-border hover:bg-muted/60 flex cursor-pointer items-center justify-between gap-4 rounded-lg border p-3 transition-colors"
      onClick={() => navigate({key: 'agent', agentId, serverUrl})}
    >
      <SizableText weight="bold" className="min-w-0 truncate">
        {name}
      </SizableText>
      <Tooltip content={statusIndicator.label} asChild>
        <span className={`size-2.5 shrink-0 rounded-full ${statusIndicator.className}`} />
      </Tooltip>
    </div>
  )
}
