import {getUpdateStatusLabel, useUpdateStatus} from '@/components/auto-updater'
import {useConnectionSummary} from '@/models/contacts'
import {useNavRoute} from '@/utils/navigation'
import {COMMIT_HASH, VERSION} from '@shm/shared/constants'
import {Button} from '@shm/ui/button'
import {Cable} from '@shm/ui/icons'
import {ReactNode} from 'react'
import {OnlineIndicator} from './indicator'
import {useNetworkDialog} from './network-dialog'

export default function Footer({children}: {children?: ReactNode}) {
  const updateStatus = useUpdateStatus()
  return (
    <div className="flex py-0 w-full border-transparent border border-solid flex-none min-h-6 select-none items-stretch">
      <FooterNetworkingButton />
      <div className="flex items-center px-2 gap-4">
        <span className="text-xs select-none cursor-default text-gray-400 dark:text-gray-600">
          {`Seed ${VERSION} (${COMMIT_HASH.slice(0, 8)})`}
        </span>
        {updateStatus && updateStatus?.type != 'idle' && (
          <span className="text-xs select-none cursor-default text-gray-500 dark:text-gray-400">
            {getUpdateStatusLabel(updateStatus)}
          </span>
        )}
      </div>

      <div className="flex flex-1 items-center justify-end gap-1">
        {children}
      </div>
    </div>
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
  icon?: React.ReactNode
  onPress: () => void
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'default' : 'ghost'}
      onClick={onPress}
      className="px-2"
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
  const isActive = route.key === 'contacts'

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant={isActive ? 'default' : 'ghost'}
        className=""
        onClick={() => networkDialog.open(true)}
      >
        <OnlineIndicator online={summary.online} />
        {/* @ts-ignore */}
        <Cable className="size-3" />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {summary.connectedCount}
        </span>
      </Button>
      {networkDialog.content}
    </div>
  )
}
