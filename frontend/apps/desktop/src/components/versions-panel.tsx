import {useSubscribedEntity} from '@/models/entities'
import {useDocumentChanges, useVersionChanges} from '@/models/versions'
import {useNavigate} from '@/utils/useNavigate'
import {PlainMessage} from '@bufbuild/protobuf'
import {DocumentChangeInfo} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {getMetadataName} from '@shm/shared/content'
import {
  HMChangeInfo,
  HMDraftChange,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {useAccount} from '@shm/shared/models/entity'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {Version} from '@shm/ui/icons'
import {ButtonText, SizableText, XStack, YStack} from 'tamagui'
import {AccessoryContent} from './accessory-sidebar'

export function VersionsPanel({docId}: {docId: UnpackedHypermediaId}) {
  console.log('== VERSIONS PANEL', docId)
  const navigate = useNavigate()

  const activeChangeIds = useVersionChanges(docId)
  const currentEntity = useSubscribedEntity({...docId, version: null})
  const changes = useDocumentChanges(docId, false)
  return (
    <AccessoryContent>
      <YStack>
        {changes.data?.map((change, idx) => {
          const isActive = activeChangeIds?.has(change.id) || false
          return (
            <ChangeItem
              key={change.id}
              change={change}
              isActive={isActive}
              onPress={() => {
                docId && typeof docId === 'object'
                  ? navigate({
                      ...docId,
                      key: 'document',
                      id: {...docId, version: change.id},
                    })
                  : null
              }}
              isLast={idx === changes.data.length - 1}
              isCurrent={change.id === currentEntity.data?.document?.version}
            />
          )
        })}
      </YStack>
    </AccessoryContent>
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
  const author = useAccount(change.author)
  const authorId = author.data?.id
  const navigate = useNavigate()
  const isDraft = (c: HMChangeInfo): c is HMDraftChange =>
    'type' in c && c.type === 'draftChange'
  const getChangeTime = (c: HMChangeInfo) => {
    if (isDraft(c))
      return c.lastUpdateTime ? new Date(c.lastUpdateTime * 1000) : new Date()
    return (c as PlainMessage<DocumentChangeInfo>).createTime
  }

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
        backgroundColor: isActive ? '$brand12' : '$color6',
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
        bg="#2C2C2C"
        jc="center"
        borderRadius={10}
        p={1}
      >
        <Version size={16} color="white" />
      </XStack>
      {authorId && (
        <HMIcon
          flexGrow={0}
          flexShrink={0}
          size={iconSize}
          id={authorId}
          metadata={author.data?.metadata}
        />
      )}
      <YStack f={1}>
        <XStack
          h={iconSize}
          ai="center"
          gap="$2"
          overflow="hidden"
          width="100%"
        >
          <ButtonText
            size="$2"
            flexShrink={1}
            textOverflow="ellipsis"
            overflow="hidden"
            whiteSpace="nowrap"
            fontWeight="bold"
            hoverStyle={{
              bg: '$color3',
            }}
            onPress={(e) => {
              e.stopPropagation()
              const id = author.data?.id
              if (!id) return
              navigate({
                key: 'document',
                id,
              })
            }}
          >
            {getMetadataName(author.data?.metadata)}
          </ButtonText>
          <SizableText size="$2" flexShrink={0}>
            {isCurrent ? 'current version' : 'version'}
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
          {formattedDateMedium(getChangeTime(change))}
        </SizableText>
      </YStack>
    </Button>
  )
}
