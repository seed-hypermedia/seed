import {useAllDocumentComments} from '@/models/comments'
import {useContactList} from '@/models/contacts'
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
import {useEntity} from '@shm/shared/models/entity'
import {DocumentAccessory} from '@shm/shared/routes'
import {formattedDateMedium, normalizeDate} from '@shm/shared/utils/date'
import {ChangeGroup, SubDocumentItem} from '@shm/ui/activity'
import {Button} from '@shm/ui/button'
import {CommentGroup} from '@shm/ui/discussion'
import {ChevronUp} from '@shm/ui/icons'

import {Spinner} from '@shm/ui/spinner'
import {SizableText, Text} from '@shm/ui/text'
import {Sparkle} from 'lucide-react'
import {useState} from 'react'
import {useTheme, YStack} from 'tamagui'
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
  const accounts = useContactList()
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
  const changeAuthors: HMAccountsMetadata = Object.fromEntries(
    changeAuthorIds
      .map((uid, index) => [
        uid,
        accounts.data?.accounts?.find((a) => a.id === uid)?.metadata,
      ])
      .filter(([k, v]) => !!v),
  )
  if (route.key !== 'document') return null
  const isInitialLoad =
    commentGroups.isInitialLoading ||
    changes.isInitialLoading ||
    childrenActivity.isInitialLoading
  if (isInitialLoad) {
    return (
      <div className="flex items-center justify-center p-4">
        <Spinner />
      </div>
    )
  }
  if (activityWithGroups.length == 0) {
    return (
      <YStack padding="$4" jc="center" ai="center" gap="$4">
        <Sparkle className="size-25" color={theme.color6.val} />
        <SizableText color="muted" weight="medium" size="xl">
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
          variant="outline"
          className="relative w-full"
          onClick={() => setVisibleCount((count) => count + 10)}
          size="sm"
        >
          <ChevronUp size={12} color="gray" />
          <Text color="muted" size="sm">
            {prevActivityTime
              ? `Activity before ${formattedDateMedium(prevActivityTime)}`
              : 'Previous Activity'}
          </Text>
        </Button>
      )}
      {activityWithGroups.slice(-visibleCount).map((activityItem) => {
        if (activityItem.type === 'commentGroup') {
          return (
            <div key={activityItem.id} className="p-1.5">
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
              />
            </div>
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

function ActivitySection({children}: {children: React.ReactNode}) {
  return (
    <div className="py-6 mb-[100px] gap-4 flex flex-col">
      <div className="border-b-2 border-brand pb-2 px-2 flex">
        <SizableText size="md" weight="semibold">
          Activity
        </SizableText>
      </div>
      {children}
    </div>
  )
}
