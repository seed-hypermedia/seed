import {getUpdateStatusLabel, useUpdateStatus} from '@/components/auto-updater'
import {useConnectionSummary} from '@/models/contacts'
import {useNavRoute} from '@/utils/navigation'
import {COMMIT_HASH, VERSION} from '@shm/shared/constants'
import {Button} from '@shm/ui/button'
import {FooterWrapper} from '@shm/ui/footer'
import {Cable} from '@shm/ui/icons'
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
      <div className="flex items-center gap-4 px-2">
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
      className={cn('px-2', active && 'bg-blue-500 hover:bg-blue-600')}
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
        size="sm"
        variant={route.key == 'contacts' ? 'default' : 'ghost'}
        className={cn('px-2', route.key == 'contacts' && 'text-primary')}
        onClick={() => networkDialog.open(true)}
      >
        <OnlineIndicator online={summary.online} />
        <Cable size={12} />
        <SizableText size="xs">{summary.connectedCount}</SizableText>
      </Button>
      {networkDialog.content}
    </div>
  )
}
