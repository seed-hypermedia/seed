import {useAccounts} from '@/models/accounts'
import {useDocumentCommentGroups} from '@/models/comments'
import {useEntity} from '@/models/entities'
import {
  AccountsMetadata,
  LibraryDocument,
  useChildrenActivity,
} from '@/models/library'
import {useDocumentPublishedChanges, useVersionChanges} from '@/models/versions'
import {LibraryEntryUpdateSummary} from '@/pages/library2'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {
  formattedDateMedium,
  getAccountName,
  getMetadataName,
  HMChangeGroup,
  HMChangeSummary,
  HMCommentGroup,
  HMDocumentInfo,
  hmId,
  normalizeDate,
  UnpackedHypermediaId,
} from '@shm/shared'
import {
  Button,
  ChevronDown,
  ChevronUp,
  CommentGroup,
  EmptyDiscussion,
  HMIcon,
  SizableText,
  useTheme,
  Version,
  XStack,
  YStack,
} from '@shm/ui'
import {useState} from 'react'
import {
  CommentDraft,
  CommentReplies,
  renderCommentContent,
  RepliesEditor,
  useCommentGroupAuthors,
} from './commenting'
import {ChangeItem} from './versions-panel'

export function DocumentActivity({docId}: {docId: UnpackedHypermediaId}) {
  return (
    <YStack paddingVertical="$6" marginBottom={100} gap="$4">
      <XStack
        borderBottomWidth={2}
        borderBottomColor="$brand4"
        pb="$2"
        paddingHorizontal="$2"
      >
        <SizableText fontSize={20} fontWeight="600">
          Activity
        </SizableText>
      </XStack>
      <ActivityList docId={docId} />
      <CommentDraft docId={docId} />
    </YStack>
  )
}

function getActivityTime(
  activity: HMCommentGroup | HMChangeSummary | HMDocumentInfo | HMChangeGroup,
) {
  if (activity.type === 'change') return normalizeDate(activity.createTime)
  if (activity.type === 'commentGroup')
    return normalizeDate(activity.comments[0].createTime)
  if (activity.type === 'document') {
    const updateTime = normalizeDate(activity.updateTime)
    const commentTime = normalizeDate(
      activity.activitySummary?.latestCommentTime,
    )
    // return the largest value
    if (commentTime && updateTime && commentTime > updateTime)
      return commentTime
    return updateTime
  }
  if (activity.type === 'changeGroup') {
    return normalizeDate(activity.changes.at(-1)?.createTime)
  }
  return undefined
}

function ActivityList({docId}: {docId: UnpackedHypermediaId}) {
  const latestDoc = useEntity({...docId, version: null, latest: true})
  const latestDocChanges = new Set<string>(
    latestDoc?.data?.document?.version?.split('.') || [],
  )
  const commentGroups = useDocumentCommentGroups(docId)
  const activeChangeIds = useVersionChanges(docId)
  const childrenActivity = useChildrenActivity(docId)
  const accounts = useAccounts()
  const changes = useDocumentPublishedChanges(docId)
  const [visibleCount, setVisibleCount] = useState(10)
  const authors = useCommentGroupAuthors(commentGroups)
  const route = useNavRoute()
  const theme = useTheme()
  const activity: (HMCommentGroup | HMChangeSummary | HMDocumentInfo)[] = [
    ...commentGroups,
    ...(changes.data || []),
    ...(childrenActivity?.data || []),
  ]
  activity.sort((a, b) => {
    const aTime = getActivityTime(a)
    const bTime = getActivityTime(b)
    if (!aTime) return 1
    if (!bTime) return -1
    return aTime.getTime() - bTime.getTime()
  })
  const activityWithGroups: (
    | HMCommentGroup
    | HMChangeGroup
    | HMDocumentInfo
  )[] = []
  let currentChangeGroup: HMChangeGroup | null = null
  activity?.forEach((item) => {
    if (item.type !== 'change') {
      if (currentChangeGroup) {
        activityWithGroups.push(currentChangeGroup)
        currentChangeGroup = null
      }
      activityWithGroups.push(item)
    } else if (
      currentChangeGroup &&
      item.author === currentChangeGroup.changes[0]?.author
    ) {
      currentChangeGroup.changes.push(item)
    } else if (currentChangeGroup) {
      activityWithGroups.push(currentChangeGroup)
      currentChangeGroup = {
        id: item.id,
        type: 'changeGroup',
        changes: [item],
      }
    } else {
      currentChangeGroup = {
        id: item.id,
        type: 'changeGroup',
        changes: [item],
      }
    }
  })
  if (currentChangeGroup) {
    activityWithGroups.push(currentChangeGroup)
  }

  if (route.key !== 'document') return null
  if (activityWithGroups.length == 0) {
    return (
      <YStack padding="$4" jc="center" ai="center" gap="$4">
        <EmptyDiscussion color={theme.color6.val} />
        <SizableText color="$color7" fontWeight="500" size="$5">
          There is no activity yet.
        </SizableText>
      </YStack>
    )
  }
  const prevActivity = activityWithGroups.at(-visibleCount)
  const prevActivityTime = prevActivity && getActivityTime(prevActivity)
  return (
    <>
      {visibleCount < activityWithGroups.length && prevActivity && (
        <Button
          onPress={() => setVisibleCount((count) => count + 10)}
          size="$2"
          icon={ChevronUp}
        >
          {prevActivityTime
            ? `Activity before ${formattedDateMedium(prevActivityTime)}`
            : 'Previous Activity'}
        </Button>
      )}
      {activityWithGroups.slice(-visibleCount).map((activityItem) => {
        if (activityItem.type === 'commentGroup') {
          return (
            <YStack key={activityItem.id} paddingHorizontal="$1.5">
              <CommentGroup
                key={activityItem.id}
                docId={docId}
                commentGroup={activityItem}
                isLastGroup={activityItem === activity[activity.length - 1]}
                authors={authors}
                renderCommentContent={renderCommentContent}
                RepliesEditor={RepliesEditor}
                CommentReplies={CommentReplies}
              />
            </YStack>
          )
        }
        if (activityItem.type === 'changeGroup') {
          return (
            <ChangeGroup
              item={activityItem}
              key={activityItem.id}
              latestDocChanges={latestDocChanges}
              activeChangeIds={activeChangeIds}
            />
          )
        }
        if (activityItem.type === 'document') {
          return (
            <SubDocumentItem
              item={activityItem}
              accountsMetadata={accounts.data?.accountsMetadata || {}}
            />
          )
        }
      })}
    </>
  )
}

export function SubDocumentItem({
  item,
  indent,
  accountsMetadata,
}: {
  item: LibraryDocument
  indent?: boolean
  accountsMetadata: AccountsMetadata
}) {
  const navigate = useNavigate()
  const metadata = item?.metadata
  const id = hmId('d', item.account, {
    path: item.path,
  })
  const isRead = !item.activitySummary?.isUnread
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
      onPress={() => {
        navigate({key: 'document', id})
      }}
      h="auto"
      marginVertical={'$1'}
      ai="center"
    >
      <XStack
        flexGrow={0}
        flexShrink={0}
        w={20}
        h={20}
        zi="$zIndex.2"
        ai="center"
        bg={'#2C2C2C'}
        jc="center"
        borderRadius={10}
        p={1}
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

function ChangeGroup({
  item,
  latestDocChanges,
  activeChangeIds,
}: {
  item: HMChangeGroup
  latestDocChanges: Set<string>
  activeChangeIds: Set<string> | null
}) {
  const replace = useNavigate('replace')
  const route = useNavRoute()
  if (route.key !== 'document') return null
  const [isCollapsed, setIsCollapsed] = useState(true)
  if (!isCollapsed || item.changes.length <= 1) {
    return item.changes.map((change) => {
      if (!change.createTime?.seconds) return null
      const isActive = activeChangeIds?.has(change.id) || false
      return (
        <ChangeItem
          key={change.id}
          change={change}
          onPress={() => {
            replace({
              ...route,
              id: {
                ...route.id,
                version: change.id,
              },
            })
          }}
          isActive={isActive}
          isLast={true}
          isCurrent={latestDocChanges.has(item.id)}
        />
      )
    })
  }
  return (
    <ExpandChangeGroupButton
      item={item}
      onExpand={() => setIsCollapsed(false)}
    />
  )
}

function ExpandChangeGroupButton({
  item,
  onExpand,
}: {
  item: HMChangeGroup
  onExpand: () => void
}) {
  const iconSize = 20
  const authorEntity = useEntity(hmId('d', item.changes[0].author))

  return (
    <Button
      onPress={onExpand}
      key={item.id}
      h="auto"
      p="$3"
      paddingHorizontal="$1.5"
      paddingRight="$3"
      borderRadius="$2"
      hoverStyle={{
        backgroundColor: '$color6',
        borderColor: '$borderTransparent',
      }}
      ai="flex-start"
      position="relative"
    >
      <XStack
        flexGrow={0}
        flexShrink={0}
        w={20}
        h={20}
        zi="$zIndex.2"
        ai="center"
        bg={'#2C2C2C'}
        jc="center"
        borderRadius={10}
        p={1}
      >
        <Version size={16} color="white" />
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
