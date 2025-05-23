import {PlainMessage} from '@bufbuild/protobuf'
import {useRouteLink} from '@shm/shared'
import {DocumentChangeInfo} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {getMetadataName} from '@shm/shared/content'
import {
  HMChangeInfo,
  HMDocumentChangeInfo,
  HMDraftChange,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {Version} from '@shm/ui/icons'
import {ButtonText, SizableText, XStack, YStack} from 'tamagui'

export function ChangeItem({
  change,
  isActive,
  isLast = false,
  isCurrent,
  docId,
}: {
  change: HMDocumentChangeInfo
  isActive: boolean
  isLast: boolean
  isCurrent: boolean
  docId: UnpackedHypermediaId
}) {
  const iconSize = 20
  const isDraft = (c: HMChangeInfo): c is HMDraftChange =>
    'type' in c && c.type === 'draftChange'
  const getChangeTime = (c: HMChangeInfo) => {
    if (isDraft(c))
      return c.lastUpdateTime ? new Date(c.lastUpdateTime * 1000) : new Date()
    return (c as PlainMessage<DocumentChangeInfo>).createTime
  }

  const linkProps = useRouteLink({
    key: 'document',
    id: {...docId, version: change.id, latest: false},
  })

  return (
    <Button
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
      {...linkProps}
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
      {change.author.id && (
        <HMIcon
          flexGrow={0}
          flexShrink={0}
          size={iconSize}
          id={change.author.id}
          metadata={change.author.metadata}
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
          {change.author.id && <AuthorName author={change.author} />}
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

function AuthorName({author}: {author: HMMetadataPayload}) {
  const linkProps = useRouteLink({key: 'document', id: author.id})
  return (
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
      {...linkProps}
    >
      {getMetadataName(author.metadata)}
    </ButtonText>
  )
}
