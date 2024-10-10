import {AccessoryContainer} from '@/components/accessory-sidebar'
import {EntityLinkThumbnail} from '@/components/account-link-thumbnail'
import {MenuItemType, OptionsDropdown} from '@/components/options-dropdown'
import {useAccount_deprecated} from '@/models/accounts'
import {TimelineChange, useDocHistory} from '@/models/changes'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useOpenUrl} from '@/open-url'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {
  Change,
  createWebHMUrl,
  formattedDateLong,
  NavRoute,
  packHmId,
  unpackHmId,
} from '@shm/shared'
import {hmId, UnpackedHypermediaId} from '@shm/shared/src/utils/entity-id-url'
import {
  ButtonText,
  Copy,
  copyUrlToClipboardWithFeedback,
  SizableText,
  Theme,
  XStack,
  YStack,
} from '@shm/ui'
import {ArrowUpRight} from '@tamagui/lucide-icons'

export function EntityVersionsAccessory({
  id,
  activeVersion,
  variantVersion,
}: {
  id?: UnpackedHypermediaId | null
  activeVersion: string | undefined
  variantVersion: string | undefined
}) {
  const changes = useDocHistory(id?.id, variantVersion)
  if (!id) return null
  return (
    <>
      <Theme name="subtle">
        <AccessoryContainer title="Variant History">
          <YStack
            paddingHorizontal="$4"
            paddingVertical="$2"
            paddingBottom="$6"
            borderBottomColor="$borderColor"
            borderBottomWidth={1}
          >
            {changes.map((item, index) => {
              const change = item?.change
              if (!change) return null
              return (
                <ChangeItem
                  prevListedChange={changes[index - 1]}
                  entityId={id.id}
                  key={change.id}
                  change={change}
                  activeVersion={activeVersion}
                />
              )
            })}
          </YStack>
        </AccessoryContainer>
      </Theme>
    </>
  )
}

function ChangeItem({
  change,
  prevListedChange,
  entityId,
  activeVersion,
}: {
  change: Change
  prevListedChange?: TimelineChange
  entityId: string
  activeVersion?: string
}) {
  const author = useAccount_deprecated(change.author)
  const navigate = useNavigate()
  const openAccount = (e: MouseEvent) => {
    e.stopPropagation()
    navigate({key: 'document', id: hmId('d', change.author)})
  }
  const navRoute = useNavRoute()
  const isActive = new Set(activeVersion?.split('.') || []).has(change.id)
  const shouldDisplayAuthorName =
    !prevListedChange || change.author !== prevListedChange.change.author
  const changeTimeText = (
    <SizableText size="$2" textAlign="left">
      {change.createTime ? formattedDateLong(change.createTime) : null}
    </SizableText>
  )
  const topRow = shouldDisplayAuthorName ? (
    <XStack paddingTop="$2" gap="$2">
      <EntityLinkThumbnail accountId={author?.data?.id} size={24} />
      <ButtonText
        onPress={openAccount}
        hoverStyle={{
          textDecorationLine: 'underline',
        }}
      >
        {author?.data?.profile?.alias || change.author}
      </ButtonText>
    </XStack>
  ) : (
    <XStack paddingLeft={35}>{changeTimeText}</XStack>
  )
  const dateRow = shouldDisplayAuthorName ? changeTimeText : null
  let destRoute: NavRoute | null = null
  if (navRoute.key === 'document') {
    destRoute = {
      key: 'document',
      documentId: entityId,
      versionId: change.id,
      accessory: {key: 'versions'},
    }
  }
  const parsedEntityId = unpackHmId(entityId)
  const gwUrl = useGatewayUrl()
  const publicWebUrl =
    parsedEntityId &&
    createWebHMUrl(parsedEntityId?.type, parsedEntityId?.uid, {
      version: change.id,
      hostname: gwUrl.data,
    })
  const menuItems: MenuItemType[] = []
  if (publicWebUrl) {
    menuItems.push({
      key: 'copyLink',
      icon: Copy,
      onPress: () => {
        copyUrlToClipboardWithFeedback(publicWebUrl, 'Version')
      },
      label: 'Copy Link to Version',
    })
  }
  const open = useOpenUrl()
  if (parsedEntityId) {
    menuItems.push({
      key: 'openNewWindow',
      icon: ArrowUpRight,
      onPress: () => {
        open(
          packHmId(
            hmId(parsedEntityId.type, parsedEntityId.uid, {
              version: change.id,
            }),
          ),
          true,
        )
      },
      label: 'Open in New Window',
    })
  }
  return (
    <XStack
      ai="center"
      gap="$2"
      group="item"
      borderRadius={'$2'}
      paddingHorizontal="$2"
      paddingVertical="$1"
      marginBottom="$1"
      backgroundColor={isActive ? '$brand5' : 'transparent'}
      userSelect="none"
    >
      <YStack
        f={1}
        overflow="hidden"
        onPress={() => {
          destRoute && navigate(destRoute)
        }}
        disabled={!destRoute}
        padding="$1"
        position="relative"
      >
        {topRow}
        {dateRow && (
          <XStack gap="$2">
            <XStack width={28} />
            {dateRow}
          </XStack>
        )}
      </YStack>
      <OptionsDropdown hiddenUntilItemHover menuItems={menuItems} />
    </XStack>
  )
}
