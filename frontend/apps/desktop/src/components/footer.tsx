import {getUpdateStatusLabel, useUpdateStatus} from '@/components/auto-updater'
import {useConnectionSummary} from '@/models/contacts'
import {
  getActiveDiscoveriesStream,
  getAggregatedDiscoveryStream,
} from '@/models/entities'
import {COMMIT_HASH, VERSION} from '@shm/shared/constants'
import {DiscoveryState} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {useRouteLink} from '@shm/shared/routing'
import {useStream} from '@shm/shared/use-stream'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {Progress} from '@shm/ui/components/progress'
import {FooterWrapper} from '@shm/ui/footer'
import {HoverCard, HoverCardContent, HoverCardTrigger} from '@shm/ui/hover-card'
import {Cable} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {ReactNode} from 'react'
import {OnlineIndicator} from './indicator'
import {useNetworkDialog} from './network-dialog'

export default function Footer({children}: {children?: ReactNode}) {
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
          <SizableText
            size="xs"
            color="muted"
            className="cursor-default select-none"
            style={{fontSize: 10}}
          >
            {getUpdateStatusLabel(updateStatus)}
          </SizableText>
        )}
      </div>

      <div className="flex flex-1 items-center justify-end gap-1">
        <DiscoveryIndicator />
        {children}
      </div>
    </FooterWrapper>
  )
}

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

function DiscoveryItem({discovery}: {discovery: DiscoveryState}) {
  const id = unpackHmId(discovery.entityId)
  const resource = useResource(id)
  const linkProps = useRouteLink(id ? {key: 'document', id} : null)

  const name =
    resource.data?.type === 'document'
      ? resource.data.document.metadata.name
      : null
  const isAccount = id && !id.path?.length
  const fallbackName = id
    ? isAccount
      ? `Account ${id.uid.slice(0, 8)}...`
      : `${id.uid.slice(0, 6)}/${id.path?.join('/')}`
    : discovery.entityId

  return (
    <div className="flex items-center gap-2 text-xs">
      {discovery.isTombstone ? (
        <span className="text-muted-foreground shrink-0 text-[10px]">
          Deleted
        </span>
      ) : (
        <Spinner size="small" className="size-3 shrink-0" />
      )}
      <a
        {...linkProps}
        className="text-foreground hover:text-foreground min-w-0 flex-1 truncate hover:underline"
      >
        {name || fallbackName}
      </a>
      {discovery.recursive && (
        <span className="text-muted-foreground/70 shrink-0 text-[10px]">
          recursive
        </span>
      )}
      {discovery.progress && discovery.progress.blobsDiscovered > 0 && (
        <span className="text-muted-foreground/70 shrink-0">
          {discovery.progress.blobsDownloaded}/
          {discovery.progress.blobsDiscovered}
        </span>
      )}
    </div>
  )
}

function DiscoveryIndicator() {
  const discovery = useStream(getAggregatedDiscoveryStream())
  const activeDiscoveries = useStream(getActiveDiscoveriesStream())

  const activeCount = discovery?.activeCount ?? 0
  const tombstoneCount = discovery?.tombstoneCount ?? 0

  // Don't show indicator if nothing is happening
  if (!discovery || (activeCount === 0 && tombstoneCount === 0)) return null

  const {blobsDiscovered, blobsDownloaded} = discovery
  const hasBlobs = blobsDiscovered > 0
  const progress = hasBlobs ? (blobsDownloaded / blobsDiscovered) * 100 : 0

  // Build header text based on what's happening
  const headerParts: string[] = []
  if (activeCount > 0) {
    headerParts.push(
      `Discovering ${activeCount} resource${activeCount > 1 ? 's' : ''}`,
    )
  }
  if (tombstoneCount > 0) {
    headerParts.push(
      `${tombstoneCount} deleted resource${tombstoneCount > 1 ? 's' : ''}`,
    )
  }

  const hoverContent = (
    <div className="flex flex-col gap-2">
      <SizableText size="sm" className="font-medium">
        {headerParts.join(', ')}
      </SizableText>
      {activeDiscoveries && activeDiscoveries.length > 0 && (
        <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
          {activeDiscoveries.map((d) => (
            <DiscoveryItem key={d.entityId} discovery={d} />
          ))}
        </div>
      )}
      {hasBlobs && (
        <div className="text-muted-foreground text-xs">
          {blobsDownloaded}/{blobsDiscovered} blobs downloaded
          {discovery.blobsFailed > 0 && (
            <span className="text-destructive">
              {' '}
              ({discovery.blobsFailed} failed)
            </span>
          )}
        </div>
      )}
    </div>
  )

  // Only tombstones, no active discovery - show static indicator
  if (activeCount === 0 && tombstoneCount > 0) {
    return (
      <HoverCard openDelay={200}>
        <HoverCardTrigger asChild>
          <div className="flex cursor-default items-center gap-2 px-2">
            <SizableText
              size="xs"
              className="text-muted-foreground select-none"
              style={{fontSize: 10}}
            >
              {tombstoneCount} deleted
            </SizableText>
          </div>
        </HoverCardTrigger>
        <HoverCardContent side="top" align="end" className="w-80">
          {hoverContent}
        </HoverCardContent>
      </HoverCard>
    )
  }

  // Only show download progress when actively downloading (not at 100%)
  const isDownloading = hasBlobs && blobsDownloaded < blobsDiscovered

  return (
    <HoverCard openDelay={200}>
      <HoverCardTrigger asChild>
        <div className="flex cursor-default items-center gap-2 px-2">
          {isDownloading ? (
            <>
              <SizableText
                size="xs"
                className="text-muted-foreground select-none"
                style={{fontSize: 10}}
              >
                Downloading ({Math.round(progress)}%)
              </SizableText>
              <Progress value={progress} className="h-1 w-16" />
            </>
          ) : (
            <>
              <SizableText
                size="xs"
                className="text-muted-foreground select-none"
                style={{fontSize: 10}}
              >
                Syncing...
              </SizableText>
              <Spinner size="small" className="text-muted-foreground" />
            </>
          )}
        </div>
      </HoverCardTrigger>
      <HoverCardContent side="top" align="end" className="w-80">
        {hoverContent}
      </HoverCardContent>
    </HoverCard>
  )
}
