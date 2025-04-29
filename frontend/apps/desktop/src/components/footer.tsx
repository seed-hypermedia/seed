import {getUpdateStatusLabel, useUpdateStatus} from '@/components/auto-updater'
import {useConnectionSummary} from '@/models/contacts'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {DocumentRoute} from '@shm/shared'
import {COMMIT_HASH, VERSION} from '@shm/shared/constants'
import {Button} from '@shm/ui/button'
import {FooterWrapper} from '@shm/ui/footer'
import {Cable} from '@shm/ui/icons'
import {ReactNode} from 'react'
import {ButtonProps, SizableText, XStack} from 'tamagui'
import {OnlineIndicator} from './indicator'
import {useNetworkDialog} from './network-dialog'

export default function Footer({children}: {children?: ReactNode}) {
  const updateStatus = useUpdateStatus()
  return (
    <FooterWrapper style={{flex: 'none'}}>
      <FooterNetworkingButton />
      <XStack alignItems="center" paddingHorizontal="$2" gap="$4">
        <SizableText
          fontSize={10}
          userSelect="none"
          hoverStyle={{
            cursor: 'default',
          }}
          color="$color8"
        >
          {`Seed ${VERSION} (${COMMIT_HASH.slice(0, 8)})`}
        </SizableText>
        {updateStatus && updateStatus?.type != 'idle' && (
          <SizableText
            fontSize={10}
            userSelect="none"
            hoverStyle={{
              cursor: 'default',
            }}
            color="$color8"
          >
            {getUpdateStatusLabel(updateStatus)}
          </SizableText>
        )}
      </XStack>

      <XStack flex={1} alignItems="center" justifyContent="flex-end" gap="$1">
        {children}
      </XStack>
      <DocumentViewButton />
    </FooterWrapper>
  )
}

function DocumentViewButton() {
  const route = useNavRoute()
  const replace = useNavigate('replace')
  const docRoute = route.key === 'document' ? route : null
  if (!docRoute) return null
  const activeView = docRoute.view || 'default'
  function toggleView() {
    if (!docRoute) return null
    const view = activeView === 'default' ? 'blame' : 'default'
    replace({...docRoute, view} satisfies DocumentRoute)
  }
  return (
    <Button onPress={toggleView} size="$1">
      View:{activeView}
    </Button>
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
        <SizableText size="$1" color="$color">
          {summary.connectedCount}
        </SizableText>
      </Button>
      {networkDialog.content}
    </XStack>
  )
}
