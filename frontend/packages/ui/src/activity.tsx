import {
  formattedDate,
  formattedDateMedium,
  getMetadataName,
  HMAccountsMetadata,
  HMActivitySummary,
  HMChangeGroup,
  HMChangeInfo,
  HMComment,
  hmId,
  HMLibraryDocument,
  HMMetadataPayload,
  normalizeDate,
  plainTextOfContent,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {Button} from '@tamagui/button'
import {ChevronDown} from '@tamagui/lucide-icons'
import {XStack, YStack} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import {useState} from 'react'
import {HMIcon} from './hm-icon'
import {Version} from './icons'

export function SubDocumentItem({
  item,
  accountsMetadata,
  markedAsRead,
}: {
  item: HMLibraryDocument
  accountsMetadata: HMAccountsMetadata
  markedAsRead?: boolean
}) {
  const metadata = item?.metadata
  const id = hmId('d', item.account, {
    path: item.path,
  })
  const isRead = markedAsRead || !item.activitySummary?.isUnread
  const linkProps = useRouteLink({key: 'document', id})
  return (
    <Button
      group="item"
      borderWidth={0}
      hoverStyle={{
        bg: '$color5',
      }}
      bg={isRead ? '$colorTransparent' : '$backgroundStrong'}
      // elevation="$1"
      paddingHorizontal={16}
      paddingVertical="$2"
      height="auto"
      marginVertical={'$1'}
      alignItems="center"
      {...linkProps}
    >
      <XStack
        flexGrow={0}
        flexShrink={0}
        width={20}
        height={20}
        zIndex="$zIndex.2"
        alignItems="center"
        backgroundColor={'#2C2C2C'}
        justifyContent="center"
        borderRadius={10}
        padding={1}
      >
        <Version size={16} color="white" />
      </XStack>
      <YStack f={1}>
        <XStack gap="$3" ai="center">
          <SizableText
            f={1}
            fontWeight={isRead ? undefined : 'bold'}
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            overflow="hidden"
          >
            {getMetadataName(metadata)}
          </SizableText>
        </XStack>
        {item.activitySummary && (
          <LibraryEntryUpdateSummary
            accountsMetadata={accountsMetadata}
            latestComment={item.latestComment}
            activitySummary={item.activitySummary}
          />
        )}
      </YStack>
    </Button>
  )
}

export function LibraryEntryUpdateSummary({
  activitySummary,
  accountsMetadata,
  latestComment,
}: {
  activitySummary: HMActivitySummary
  accountsMetadata: HMAccountsMetadata | undefined
  latestComment: HMComment | undefined | null
}) {
  const latestChangeTime = normalizeDate(activitySummary?.latestChangeTime)
  const latestCommentTime = normalizeDate(activitySummary?.latestCommentTime)
  let summaryText = ''
  if (latestChangeTime) {
    summaryText = `Document Changed`
  }
  if (
    latestCommentTime &&
    latestChangeTime &&
    latestCommentTime > latestChangeTime
  ) {
    const author = latestComment?.author
      ? accountsMetadata?.[latestComment?.author]
      : undefined
    const authorName = author?.metadata?.name
    summaryText = `Comment`
    if (authorName && latestComment) {
      summaryText = `${authorName}: ${plainTextOfContent(
        latestComment.content,
      )}`
    }
  }
  return (
    <XStack gap="$2">
      <SizableText numberOfLines={1} size="$1" color="$color9">
        {summaryText}
      </SizableText>
      <ActivityTime activitySummary={activitySummary} />
    </XStack>
  )
}

export function ActivityTime({
  activitySummary,
}: {
  activitySummary: HMActivitySummary
}) {
  const latestChangeTime = normalizeDate(activitySummary?.latestChangeTime)
  const latestCommentTime = normalizeDate(activitySummary?.latestCommentTime)
  const displayTime =
    latestCommentTime &&
    latestChangeTime &&
    latestCommentTime > latestChangeTime
      ? latestCommentTime
      : latestChangeTime
  if (displayTime) {
    return (
      <SizableText flexShrink={0} numberOfLines={1} size="$1" color="$color9">
        ({formattedDate(displayTime)})
      </SizableText>
    )
  }
  return null
}

export function ChangeGroup({
  item,
  docId,
  latestDocChanges,
  activeChangeIds,
  author,
}: {
  item: HMChangeGroup
  docId: UnpackedHypermediaId
  latestDocChanges: Set<string>
  activeChangeIds: Set<string> | null
  author: HMMetadataPayload
}) {
  const [isCollapsed, setIsCollapsed] = useState(true)
  if (!isCollapsed || item.changes.length <= 1) {
    return item.changes.map((change) => {
      const isActive = activeChangeIds?.has(change.id) || false
      return (
        <ChangeItem
          key={change.id}
          change={change}
          isActive={isActive}
          isLast={true}
          isCurrent={latestDocChanges.has(item.id)}
          docId={docId}
          author={author}
        />
      )
    })
  }
  return (
    <ExpandChangeGroupButton
      item={item}
      onExpand={() => setIsCollapsed(false)}
      author={author}
    />
  )
}

export function ChangeItem({
  change,
  isActive,
  isLast = false,
  isCurrent,
  author,
  docId,
}: {
  change: HMChangeInfo
  isActive: boolean
  isLast: boolean
  isCurrent: boolean
  docId: UnpackedHypermediaId
  author: HMMetadataPayload
}) {
  const iconSize = 20
  const linkProps = useRouteLink(
    {
      key: 'document',
      id: {
        ...docId,
        version: change.id,
      },
    },
    undefined,
    {
      replace: true,
    },
  )
  return (
    <Button
      key={change.id}
      height="auto"
      padding="$3"
      paddingHorizontal="$1"
      paddingRight="$3"
      borderRadius="$2"
      backgroundColor={isActive ? '$brand12' : '$backgroundTransparent'}
      hoverStyle={{
        backgroundColor: isActive ? '$brand12' : '$color6',
        borderColor: '$borderTransparent',
      }}
      alignItems="flex-start"
      position="relative"
      {...linkProps}
    >
      <XStack
        width={1}
        height="100%"
        backgroundColor="$color8"
        position="absolute"
        top={14}
        left={21}
        opacity={isLast ? 0 : 1}
        zi="$zIndex.1"
      />

      <XStack
        flexGrow={0}
        flexShrink={0}
        width={20}
        height={20}
        zIndex="$zIndex.2"
        alignItems="center"
        backgroundColor={'#2C2C2C'}
        justifyContent="center"
        borderRadius={10}
        padding={1}
      >
        <Version size={16} color="white" />
      </XStack>
      <HMIcon
        flexGrow={0}
        flexShrink={0}
        size={iconSize}
        id={author.id}
        metadata={author.metadata}
      />
      <YStack f={1}>
        <XStack
          height={iconSize}
          alignItems="center"
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
            {getMetadataName(author.metadata)}
          </SizableText>
          <SizableText size="$2" fontWeight={700} flexShrink={0}>
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
          {formattedDateMedium(change.createTime)}
        </SizableText>
      </YStack>
    </Button>
  )
}

function ExpandChangeGroupButton({
  item,
  onExpand,
  author,
}: {
  item: HMChangeGroup
  onExpand: () => void
  author: HMMetadataPayload
}) {
  const iconSize = 20
  return (
    <Button
      onPress={onExpand}
      key={item.id}
      height="auto"
      padding="$3"
      borderRadius="$2"
      hoverStyle={{
        backgroundColor: '$color6',
        borderColor: '$borderTransparent',
      }}
      alignItems="flex-start"
      position="relative"
    >
      <XStack
        flexGrow={0}
        flexShrink={0}
        width={20}
        height={20}
        zIndex="$zIndex.2"
        alignItems="center"
        backgroundColor={'#2C2C2C'}
        justifyContent="center"
        borderRadius={10}
        padding={1}
      >
        <Version size={16} color="white" />
      </XStack>
      <HMIcon
        flexGrow={0}
        flexShrink={0}
        size={iconSize}
        id={author.id}
        metadata={author.metadata}
      />
      <YStack f={1} alignItems="flex-start">
        <XStack
          height={iconSize}
          alignItems="center"
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
            {getMetadataName(author.metadata)}
          </SizableText>

          <SizableText size="$2" fontWeight={700} flexShrink={0}>
            {item.changes.length} versions
          </SizableText>
          <ChevronDown size={16} />
        </XStack>
        <SizableText
          size="$1"
          color="$color9"
          flexShrink={1}
          textOverflow="ellipsis"
          overflow="hidden"
          whiteSpace="nowrap"
        >
          {formattedDateMedium(item.changes.at(-1)?.createTime)}
        </SizableText>
      </YStack>
    </Button>
  )
}
