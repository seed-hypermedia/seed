import {useEntity} from '@/models/entities'
import {useDocumentChanges, useVersionChanges} from '@/models/versions'
import {useNavigate} from '@/utils/useNavigate'
import {
  DocumentRoute,
  formattedDateMedium,
  getAccountName,
  HMChangeInfo,
  hmId,
} from '@shm/shared'
import {Button, Thumbnail, Version} from '@shm/ui'
import {SizableText, XStack, YStack} from 'tamagui'
import {AccessoryContainer} from './accessory-sidebar'

export function VersionsPanel({
  route,
  onClose,
}: {
  route: DocumentRoute
  onClose: () => void
}) {
  const navigate = useNavigate()
  const activeChangeIds = useVersionChanges(route.id)
  const changes = useDocumentChanges(route.id)
  return (
    <AccessoryContainer title="Versions" onClose={onClose}>
      <YStack>
        {changes.data?.map((change, idx) => {
          const isActive = activeChangeIds?.has(change.id) || false
          return (
            <ChangeItem
              change={change}
              isActive={isActive}
              onPress={() => {
                navigate({...route, id: {...route.id, version: change.id}})
              }}
              isLast={idx === changes.data.length - 1}
            />
          )
        })}
      </YStack>
    </AccessoryContainer>
  )
}

function ChangeItem({
  change,
  isActive,
  onPress,
  isLast = false,
}: {
  change: HMChangeInfo
  onPress: () => void
  isActive: boolean
  isLast: boolean
}) {
  const thumbnailSize = 20
  const authorEntity = useEntity(hmId('d', change.author))
  return (
    <Button
      onPress={onPress}
      key={change.id}
      h="auto"
      p="$3"
      paddingHorizontal="$1"
      paddingRight="$3"
      borderRadius="$2"
      borderWidth={0}
      backgroundColor={isActive ? '$brand5' : '$backgroundTransparent'}
      hoverStyle={{
        backgroundColor: isActive ? '$brand6' : '$color6',
        borderColor: '$borderTransparent',
      }}
      ai="flex-start"
      position="relative"
    >
      <XStack
        w={1}
        h="100%"
        bg="$color8"
        position="absolute"
        top={14}
        left={22}
        opacity={isLast ? 0 : 1}
        zi={1}
      />

      <XStack
        flexGrow={0}
        flexShrink={0}
        w={20}
        h={20}
        zi={2}
        ai="center"
        bg="#2C2C2C"
        jc="center"
        borderRadius={10}
        p={1}
      >
        <Version size={16} color="white" />
      </XStack>
      <Thumbnail
        flexGrow={0}
        flexShrink={0}
        size={thumbnailSize}
        id={authorEntity.data?.id}
        metadata={authorEntity.data?.document?.metadata}
      />
      <YStack f={1}>
        <XStack
          h={thumbnailSize}
          ai="center"
          gap="$2"
          overflow="hidden"
          width="100%"
        >
          <SizableText
            size="$2"
            flexShrink={1}
            textOverflow="ellipsis"
            overflow="hidden"
            whiteSpace="nowrap"
          >
            {getAccountName(authorEntity.data?.document)}
          </SizableText>
          <SizableText size="$2" fontWeight={700} flexShrink={0}>
            version
          </SizableText>
        </XStack>
        <SizableText
          size="$1"
          color="$color9"
          flexShrink={1}
          textOverflow="ellipsis"
          overflow="hidden"
          whiteSpace="nowrap"
        >
          {formattedDateMedium(change.createTime)}
        </SizableText>
      </YStack>
    </Button>
  )
}
