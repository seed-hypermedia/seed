import {getUpdateStatusLabel, useUpdateStatus} from '@/components/auto-updater'
import {useConnectionSummary} from '@/models/contacts'
import {useNavRoute} from '@/utils/navigation'
import {COMMIT_HASH, VERSION} from '@shm/shared/constants'
import {Button} from '@shm/ui/button'
import {FooterWrapper} from '@shm/ui/footer'
import {Cable} from '@shm/ui/icons'
import {SizableText} from '@shm/ui/text'
import {ReactNode} from 'react'
import {ButtonProps, XStack} from 'tamagui'
import {OnlineIndicator} from './indicator'
import {useNetworkDialog} from './network-dialog'

export default function Footer({children}: {children?: ReactNode}) {
  const updateStatus = useUpdateStatus()
  return (
    <FooterWrapper style={{flex: 'none'}}>
      <FooterNetworkingButton />
      <XStack alignItems="center" paddingHorizontal="$2" gap="$4">
        <SizableText
          size="xs"
          color="muted"
          className="select-none cursor-default"
          style={{fontSize: 10}}
        >
          {`Seed ${VERSION} (${COMMIT_HASH.slice(0, 8)})`}
        </SizableText>
        {updateStatus && updateStatus?.type != 'idle' && (
          <SizableText
            size="xs"
            color="muted"
            className="select-none cursor-default"
            style={{fontSize: 10}}
          >
            {getUpdateStatusLabel(updateStatus)}
          </SizableText>
        )}
      </XStack>

      <XStack flex={1} alignItems="center" justifyContent="flex-end" gap="$1">
        {children}
      </XStack>
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
  icon?: ButtonProps['icon']
  onPress: () => void
}) {
  return (
    <Button
      size="$1"
      chromeless={!active}
      onPress={onPress}
      theme={active ? 'blue' : undefined}
      icon={icon}
      paddingHorizontal="$2"
    >
      {label}
    </Button>
  )
}

function FooterNetworkingButton() {
  const route = useNavRoute()
  const networkDialog = useNetworkDialog()
  const summary = useConnectionSummary()
  return (
    <XStack alignItems="center" gap="$2">
      <Button
        size="$1"
        chromeless={route.key != 'contacts'}
        color={route.key == 'contacts' ? '$brand5' : undefined}
        paddingHorizontal="$2"
        onPress={() => networkDialog.open(true)}
      >
        <OnlineIndicator online={summary.online} />
        <Cable size={12} />
        <SizableText size="xs">{summary.connectedCount}</SizableText>
      </Button>
      {networkDialog.content}
    </XStack>
  )
}
