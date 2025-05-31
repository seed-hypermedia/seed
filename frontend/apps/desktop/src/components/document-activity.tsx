import {useAccountList} from '@/models/accounts'
import {useAllDocumentComments} from '@/models/comments'
import {useChildrenActivity} from '@/models/library'
import {useDocumentPublishedChanges, useVersionChanges} from '@/models/versions'
import {useNavRoute} from '@/utils/navigation'
import {useCommentGroups} from '@shm/shared/discussion'
import {
  HMAccountsMetadata,
  HMChangeGroup,
  HMChangeSummary,
  HMCommentGroup,
  HMDocumentInfo,
  UnpackedHypermediaId,
} from '@shm/shared/hm-types'
import {getActivityTime} from '@shm/shared/models/activity'
import {useAccounts, useEntity} from '@shm/shared/models/entity'
import {DocumentAccessory} from '@shm/shared/routes'
import {formattedDateMedium, normalizeDate} from '@shm/shared/utils/date'
import {ChangeGroup, SubDocumentItem} from '@shm/ui/activity'
import {Button} from '@shm/ui/button'
import {CommentGroup} from '@shm/ui/discussion'
import {ChevronUp, EmptyDiscussion} from '@shm/ui/icons'
import {ActivitySection} from '@shm/ui/page-components'
import {Spinner} from '@shm/ui/spinner'
import {useState} from 'react'
import {SizableText, useTheme, YStack} from 'tamagui'
import {
  CommentBox,
  renderCommentContent,
  useCommentGroupAuthors,
} from './commenting'

export function DocumentActivity({
  docId,
  isCommentingPanelOpen,
  onAccessory,
}: {
  docId: UnpackedHypermediaId
  isCommentingPanelOpen: boolean
  onAccessory: (accessory: DocumentAccessory) => void
}) {
  return (
    <ActivitySection>
      <ActivityList
        docId={docId}
        onCommentFocus={
          isCommentingPanelOpen
            ? (commentId, isReplying) => {
                onAccessory({
                  key: 'discussions',
                  openComment: commentId,
                  openBlockId: undefined,
                  isReplying,
                })
              }
            : undefined
        }
      />
      {isCommentingPanelOpen ? null : <CommentBox docId={docId} />}
    </ActivitySection>
  )
}

export function ActivityList({
  docId,
  onCommentFocus,
}: {
  docId: UnpackedHypermediaId
  onCommentFocus?: (commentId: string, isReplying?: boolean) => void
}) {
  const latestDoc = useEntity({...docId, version: null, latest: true})
  const latestDocChanges = new Set<string>(
    latestDoc?.data?.document?.version?.split('.') || [],
  )
  const comments = useAllDocumentComments(docId)
  const commentGroups = useCommentGroups(comments.data)
  const activeChangeIds = useVersionChanges(docId)
  const childrenActivity = useChildrenActivity(docId)
  const accounts = useAccountList()
  const changes = useDocumentPublishedChanges(docId)
  const [visibleCount, setVisibleCount] = useState(10)
  const authors = useCommentGroupAuthors(commentGroups.data)
  const route = useNavRoute()
  const theme = useTheme()
  const activity: (HMCommentGroup | HMChangeSummary | HMDocumentInfo)[] = [
    ...commentGroups.data,
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
    if (item.type === 'change') {
      const date = normalizeDate(item.createTime)
      // if this is the genesis change, we don't want to show it as activity
      if (!date || date.getTime() === 0) return
    }
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
  const changeAuthorIdsSet = new Set<string>()
  changes.data?.forEach((item) => {
    item?.author && changeAuthorIdsSet.add(item?.author)
  })
  const changeAuthorIds = Array.from(changeAuthorIdsSet)
  const changeAuthorQueries = useAccounts(changeAuthorIds)
  const changeAuthors: HMAccountsMetadata = Object.fromEntries(
    changeAuthorIds
      .map((uid, index) => [uid, changeAuthorQueries[index].data])
      .filter(([k, v]) => !!v),
  )
  if (route.key !== 'document') return null
  const isInitialLoad =
    commentGroups.isInitialLoading ||
    changes.isInitialLoading ||
    childrenActivity.isInitialLoading
  if (isInitialLoad) {
    return (
      <div className="flex justify-center items-center p-4">
        <Spinner />
      </div>
    )
  }
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
                rootReplyCommentId={null}
                key={activityItem.id}
                commentGroup={activityItem}
                authors={authors}
                renderCommentContent={renderCommentContent}
                enableReplies={true}
                highlightLastComment={
                  activityItem === activity[activity.length - 1]
                }
                // onReplyClick={
                //   onCommentFocus
                //     ? (replyCommentId) => {
                //         onCommentFocus(replyCommentId, true)
                //       }
                //     : undefined
                // }
                // onReplyCountClick={
                //   onCommentFocus
                //     ? (replyCommentId) => {
                //         onCommentFocus(replyCommentId, false)
                //       }
                //     : undefined
                // }
              />
            </YStack>
          )
        }
        if (activityItem.type === 'changeGroup') {
          const author = changeAuthors[activityItem.changes[0].author]
          if (!author) return null
          return (
            <ChangeGroup
              item={activityItem}
              key={activityItem.id}
              latestDocChanges={latestDocChanges}
              activeChangeIds={activeChangeIds}
              docId={docId}
              author={author}
            />
          )
        }
        if (activityItem.type === 'document') {
          return (
            <SubDocumentItem
              item={activityItem}
              key={activityItem.account + '/' + activityItem.path.join('/')}
              accountsMetadata={accounts.data?.accountsMetadata || {}}
            />
          )
        }
      })}
    </>
  )
}
