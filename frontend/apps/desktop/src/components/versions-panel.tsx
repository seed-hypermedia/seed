import {useEntity, useSubscribedEntity} from '@/models/entities'
import {useDocumentChanges, useVersionChanges} from '@/models/versions'
import {useNavigate} from '@/utils/useNavigate'
import {getAccountName} from '@shm/shared/content'
import {HMChangeInfo} from '@shm/shared/hm-types'
import {DocumentRoute, DraftRoute} from '@shm/shared/routes'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {
  Button,
  Draft,
  HMIcon,
  SizableText,
  Version,
  XStack,
  YStack,
} from '@shm/ui'
import {AccessoryContainer} from './accessory-sidebar'

export function VersionsPanel({
  route,
  onClose,
}: {
  route: DocumentRoute | DraftRoute
  onClose: () => void
}) {
  const navigate = useNavigate()
  if (!route.id) throw new Error('VersionsPanel must have document id')
  const activeChangeIds = useVersionChanges(route.id)
  const currentEntity = useSubscribedEntity({...route.id, version: null})
  const changes = useDocumentChanges(route.id, route.key == 'draft')
  return (
    <AccessoryContainer title="Versions" onClose={onClose}>
      <YStack>
        {changes.data?.map((change, idx) => {
          const isActive = activeChangeIds?.has(change.id) || false
          return (
            <ChangeItem
              key={change.id}
              change={change}
              isActive={isActive}
              onPress={() => {
                route.id
                  ? navigate({
                      ...route,
                      key: 'document',
                      id: {...route.id, version: change.id},
                    })
                  : null
              }}
              isLast={idx === changes.data.length - 1}
              isCurrent={change.id === currentEntity.data?.document?.version}
            />
          )
        })}
      </YStack>
    </AccessoryContainer>
  )
}

export function ChangeItem({
  change,
  isActive,
  onPress,
  isLast = false,
  isCurrent,
}: {
  change: HMChangeInfo
  onPress: () => void
  isActive: boolean
  isLast: boolean
  isCurrent: boolean
}) {
  const iconSize = 20
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
      backgroundColor={isActive ? '$brand12' : '$backgroundTransparent'}
      hoverStyle={{
        backgroundColor: isActive ? '$brand11' : '$color6',
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
        left={21}
        opacity={isLast ? 0 : 1}
        zi="$zIndex.1"
      />

      <XStack
        flexGrow={0}
        flexShrink={0}
        w={20}
        h={20}
        zi="$zIndex.2"
        ai="center"
        bg={change.isDraft ? '$brand7' : '#2C2C2C'}
        jc="center"
        borderRadius={10}
        p={1}
      >
        {change.isDraft ? (
          <Draft size={10} color="white" />
        ) : (
          <Version size={16} color="white" />
        )}
      </XStack>
      <HMIcon
        flexGrow={0}
        flexShrink={0}
        size={iconSize}
        id={authorEntity.data?.id}
        metadata={authorEntity.data?.document?.metadata}
      />
      <YStack f={1}>
        <XStack
          h={iconSize}
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
          {change.isDraft ? (
            <SizableText size="$2" fontWeight={700} flexShrink={0}>
              DRAFT
            </SizableText>
          ) : (
            <SizableText size="$2" fontWeight={700} flexShrink={0}>
              {isCurrent ? 'current version' : 'version'}
            </SizableText>
          )}
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
