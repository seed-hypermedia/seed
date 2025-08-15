import {useAllDiscussions} from '@/models/comments'
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
import {DocumentAccessory} from '@shm/shared/routes'
import {formattedDateMedium, normalizeDate} from '@shm/shared/utils/date'
import {ChangeGroup, SubDocumentItem} from '@shm/ui/activity'
import {Button} from '@shm/ui/button'
import {CommentGroup} from '@shm/ui/discussion'
import {ChevronUp} from '@shm/ui/icons'

import {hmId} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {Spinner} from '@shm/ui/spinner'
import {SizableText, Text} from '@shm/ui/text'
import {Sparkle} from 'lucide-react'
import {useState} from 'react'
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
  const latestDoc = useResource({...docId, version: null, latest: true})
  const latestDocChanges = new Set<string>(
    // @ts-expect-error
    latestDoc?.data?.document?.version?.split('.') || [],
  )
  const comments = useAllDiscussions(docId)

  const commentGroups = useCommentGroups(comments.data)
  const activeChangeIds = useVersionChanges(docId)
  const childrenActivity = useChildrenActivity(docId)
  const accounts = useContactList()
  const changes = useDocumentPublishedChanges(docId)
  const [visibleCount, setVisibleCount] = useState(10)
  const authors = useCommentGroupAuthors(commentGroups.data)
  const route = useNavRoute()
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
      .map((uid, index) => {
        const accountMetadata = accounts.data?.accounts?.find(
          (a) => a.id === uid,
        )?.metadata
        if (!accountMetadata) return [uid, undefined]
        return [
          uid,
          {
            id: hmId(uid),
            metadata: accountMetadata,
          },
        ]
      })
      .filter(([k, v]) => !!v),
  )
  if (route.key !== 'document') return null
  const isInitialLoad =
    changes.isInitialLoading || childrenActivity.isInitialLoading
  if (isInitialLoad) {
    return (
      <div className="flex items-center justify-center p-4">
        <Spinner />
      </div>
    )
  }
  if (activityWithGroups.length == 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-4">
        <Sparkle className="text-muted-foreground size-25" />
        <SizableText color="muted" weight="medium" size="xl">
          There is no activity yet.
        </SizableText>
      </div>
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
      {/* @ts-ignore */}
      {activityWithGroups.slice(-visibleCount).map((activityItem) => {
        if (activityItem.type === 'commentGroup') {
          return (
            <div key={activityItem.id} className="p-1.5">
              <CommentGroup
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
          {
            /* @ts-ignore */
          }
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
    <div className="mb-[100px] flex flex-col gap-4 py-6">
      <div className="border-brand flex border-b-2 px-2 pb-2">
        <SizableText size="md" weight="semibold">
          Activity
        </SizableText>
      </div>
      {children}
    </div>
  )
}
