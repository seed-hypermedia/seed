import {getUpdateStatusLabel, useUpdateStatus} from '@/components/auto-updater'
import {useConnectionSummary} from '@/models/contacts'
import {useDaemonInfo} from '@/models/daemon'
import {getAggregatedDiscoveryStream, getDiscoveryStream, getSubscriptionKeysStream} from '@/models/entities'
import {DiscoveryState} from '@seed-hypermedia/client/hm-types'
import {Task, TaskName} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'
import {COMMIT_HASH, VERSION} from '@shm/shared/constants'
import {useResource} from '@shm/shared/models/entity'
import {useRouteLink} from '@shm/shared/routing'
import {useStream} from '@shm/shared/use-stream'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {Progress} from '@shm/ui/components/progress'
import {FooterWrapper} from '@shm/ui/footer'
import {HoverCard, HoverCardContent, HoverCardTrigger} from '@shm/ui/hover-card'
import {Cable} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {Binoculars, Bot, MessageCirclePlus} from 'lucide-react'
import {ReactNode} from 'react'
import {OnlineIndicator} from './indicator'
import {useNetworkDialog} from './network-dialog'

/** Renders the desktop app footer and status actions. */
export default function Footer({
  children,
  assistantOpen,
  onNewAssistantChat,
  onToggleAssistant,
}: {
  children?: ReactNode
  assistantOpen?: boolean
  onNewAssistantChat?: () => void
  onToggleAssistant?: () => void
}) {
  const updateStatus = useUpdateStatus()
  return (
    <FooterWrapper className="flex-none">
      <FooterNetworkingButton />
      <div className="flex items-center gap-4 px-1">
        <SizableText
          size="xs"
          className="text-muted-foreground cursor-default opacity-50 select-none"
          style={{fontSize: 10}}
        >
          {`Seed ${VERSION} (${COMMIT_HASH.slice(0, 8)})`}
        </SizableText>
        {updateStatus && updateStatus?.type != 'idle' && (
          <SizableText size="xs" color="muted" className="cursor-default select-none" style={{fontSize: 10}}>
            {getUpdateStatusLabel(updateStatus)}
          </SizableText>
        )}
      </div>

      <div className="flex flex-1 items-center justify-end gap-1">
        <DaemonTasksIndicator />
        <SubscriptionsPanel />
        {children}
        {onToggleAssistant && (
          <Tooltip content={assistantOpen ? 'Close assistant panel' : 'Open assistant panel'}>
            <Button
              size="xs"
              variant={'ghost'}
              className={cn('px-2', assistantOpen && 'text-brand hover:text-brand-hover')}
              onClick={onToggleAssistant}
              aria-label="Toggle assistant"
            >
              <Bot className="size-3" />
            </Button>
          </Tooltip>
        )}
        {onNewAssistantChat && (
          <Tooltip content="New assistant chat">
            <Button
              size="xs"
              variant={'ghost'}
              className="px-2"
              onClick={onNewAssistantChat}
              aria-label="New assistant chat"
            >
              <MessageCirclePlus className="size-3" />
            </Button>
          </Tooltip>
        )}
      </div>
    </FooterWrapper>
  )
}

/** Renders a footer action button with optional active styling. */
export function FooterButton({
  active,
  label,
  icon,
  onPress,
}: {
  active?: boolean
  label: string
  icon?: ReactNode
  onPress: () => void
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'default' : 'ghost'}
      className={cn('px-2', active && 'bg-link hover:bg-link-hover')}
      onClick={onPress}
    >
      {icon}
      {label}
    </Button>
  )
}

function FooterNetworkingButton() {
  const route = useNavRoute()
  const networkDialog = useNetworkDialog()
  const summary = useConnectionSummary()
  return (
    <div className="flex items-center gap-2">
      <Button
        size="xs"
        className={cn('px-2', route.key == 'contacts' && 'text-primary')}
        onClick={() => networkDialog.open(true)}
      >
        <OnlineIndicator online={summary.online} />
        <Cable className="size-3" />
        <SizableText size="xs">{summary.connectedCount}</SizableText>
      </Button>
      {networkDialog.content}
    </div>
  )
}

/** Single subscription item showing the resolved name and its sync state. */
function SubscriptionItem({subscriptionKey}: {subscriptionKey: string}) {
  // Extract the entity ID (strip /* and :profile suffixes) for discovery state lookup
  const entityId = subscriptionKey.replace(/\/\*$/, '').replace(/:profile$/, '')
  const id = unpackHmId(entityId)
  const resource = useResource(id, {subscribed: false})
  const discoveryState = useStream(getDiscoveryStream(entityId))

  const isProfile = subscriptionKey.endsWith(':profile')
  const isRecursive = subscriptionKey.includes('/*')
  const isAccount = id && !id.path?.length

  const linkProps = useRouteLink(id ? (isProfile ? {key: 'profile', id} : {key: 'document', id}) : null)

  // Resolve display name from resource metadata
  const name = resource.data?.type === 'document' ? resource.data.document.metadata.name : null
  const fallbackName = id
    ? isAccount
      ? `${id.uid.slice(0, 8)}…`
      : `${id.uid.slice(0, 6)}/${id.path?.join('/')}`
    : entityId

  const suffix = isProfile ? ' (profile)' : isRecursive ? ' /*' : ''
  const syncLabel = getSyncLabel(discoveryState)

  return (
    <div className="flex items-center gap-2 text-xs">
      {discoveryState?.isDiscovering ? (
        <Spinner size="small" className="size-3 shrink-0" />
      ) : (
        <span
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            discoveryState?.isTombstone
              ? 'bg-destructive'
              : discoveryState?.isNotFound
              ? 'bg-muted-foreground'
              : 'bg-green-500',
          )}
        />
      )}
      <a {...linkProps} className="text-foreground hover:text-foreground min-w-0 flex-1 truncate hover:underline">
        {name || fallbackName}
        {suffix && <span className="text-muted-foreground/70">{suffix}</span>}
      </a>
      <span className="text-muted-foreground/70 shrink-0 text-[10px]">{syncLabel}</span>
    </div>
  )
}

function getSyncLabel(state: DiscoveryState | null | undefined): string {
  if (!state) return 'watching'
  if (state.isTombstone) return 'deleted'
  if (state.isNotFound) return 'not found'
  if (state.isDiscovering) {
    if (state.progress && state.progress.blobsDiscovered > 0) {
      return `${state.progress.blobsDownloaded}/${state.progress.blobsDiscovered}`
    }
    return 'syncing'
  }
  return 'synced'
}

/** Footer panel showing all active subscriptions for this window. */
function SubscriptionsPanel() {
  const subscriptionKeys = useStream(getSubscriptionKeysStream()) ?? []
  const aggregated = useStream(getAggregatedDiscoveryStream())
  const count = subscriptionKeys.length
  const isAnySyncing = (aggregated?.activeCount ?? 0) > 0

  if (count === 0) return null

  return (
    <Popover>
      <Tooltip content={`Subscribed to ${count} ${count === 1 ? 'entity' : 'entities'}`}>
        <PopoverTrigger asChild>
          <Button size="xs" variant="ghost" className="px-2">
            {isAnySyncing ? (
              <Spinner size="small" className="size-3" />
            ) : (
              <Binoculars className="text-muted-foreground size-3" />
            )}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent side="top" align="end" className="w-96">
        <div className="flex flex-col gap-2">
          <SizableText size="sm" className="font-medium">
            Watching {count} Resources
          </SizableText>
          <div className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
            {subscriptionKeys.map((key) => (
              <SubscriptionItem key={key} subscriptionKey={key} />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Get human-readable label for a task name
 */
function getTaskLabel(taskName: TaskName): string {
  switch (taskName) {
    case TaskName.REINDEXING:
      return 'Reindexing Database'
    case TaskName.EMBEDDING:
      return 'Generating Embeddings'
    case TaskName.LOADING_MODEL:
      return 'Loading AI Model'
    default:
      return 'Background Task'
  }
}

/**
 * Calculate progress percentage for a task
 */
function getTaskProgress(task: Task): number {
  const total = Number(task.total)
  const completed = Number(task.completed)
  if (total <= 0) return 0
  return Math.round((completed / total) * 100)
}

/**
 * Single task item in the hover card
 */
function DaemonTaskItem({task}: {task: Task}) {
  const progress = getTaskProgress(task)
  const label = getTaskLabel(task.taskName)
  const total = Number(task.total)
  const completed = Number(task.completed)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <SizableText size="xs" className="font-medium">
          {label}
        </SizableText>
        <SizableText size="xs" className="text-muted-foreground">
          {progress}%
        </SizableText>
      </div>
      <Progress value={progress} className="h-1.5" />
      {total > 0 && (
        <SizableText size="xs" className="text-muted-foreground">
          {completed.toLocaleString()} / {total.toLocaleString()}
          {task.description && ` - ${task.description}`}
        </SizableText>
      )}
    </div>
  )
}

/**
 * Footer indicator showing background daemon tasks with progress
 */
function DaemonTasksIndicator() {
  const {data: info} = useDaemonInfo()

  // Get active tasks
  const tasks = info?.tasks ?? []

  // Don't render anything if no tasks
  if (tasks.length === 0) return null

  // Build summary text
  const taskCount = tasks.length
  const summaryText = taskCount === 1 ? getTaskLabel(tasks[0].taskName) : `${taskCount} tasks running`

  // Calculate average progress across all tasks for the inline indicator
  const avgProgress =
    tasks.length > 0
      ? Math.round(tasks.reduce((sum: number, task: Task) => sum + getTaskProgress(task), 0) / tasks.length)
      : 0

  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <div className="flex cursor-default items-center gap-2 px-2">
          <Spinner size="small" className="size-3" />
          <SizableText size="xs" className="text-muted-foreground select-none" style={{fontSize: 10}}>
            {summaryText}
          </SizableText>
          {tasks.length === 1 && (
            <SizableText size="xs" className="text-muted-foreground select-none" style={{fontSize: 10}}>
              ({avgProgress}%)
            </SizableText>
          )}
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-80">
        <div className="flex flex-col gap-3">
          <SizableText size="sm" className="font-medium">
            Background Tasks
          </SizableText>
          <div className="flex flex-col gap-3">
            {tasks.map((task: Task, index: number) => (
              <DaemonTaskItem key={`${task.taskName}-${index}`} task={task} />
            ))}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
