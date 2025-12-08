import {getUpdateStatusLabel, useUpdateStatus} from '@/components/auto-updater'
import {useConnectionSummary} from '@/models/contacts'
import {getAggregatedDiscoveryStream} from '@/models/entities'
import {COMMIT_HASH, VERSION} from '@shm/shared/constants'
import {useStream} from '@shm/shared/use-stream'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {Progress} from '@shm/ui/components/progress'
import {FooterWrapper} from '@shm/ui/footer'
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

function DiscoveryIndicator() {
  const discovery = useStream(getAggregatedDiscoveryStream())
  if (!discovery || discovery.activeCount === 0) return null

  const {blobsDiscovered, blobsDownloaded} = discovery
  const hasBlobs = blobsDiscovered > 0
  const progress = hasBlobs ? (blobsDownloaded / blobsDiscovered) * 100 : 0

  return (
    <div className="flex items-center gap-2 px-2">
      {hasBlobs ? (
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
            Scanning...
          </SizableText>
          <Spinner size="small" className="text-muted-foreground" />
        </>
      )}
    </div>
  )
}
