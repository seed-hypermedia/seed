import {
  formattedDate,
  formattedDateMedium,
  getMetadataName,
  HMAccountsMetadata,
  HMActivitySummary,
  HMChangeGroup,
  HMComment,
  hmId,
  HMLibraryDocument,
  HMMetadataPayload,
  normalizeDate,
  plainTextOfContent,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {ChevronDown} from 'lucide-react'
import {useState} from 'react'
import {ChangeItem} from './change-item'
import {Button} from './components/button'
import {HMIcon} from './hm-icon'
import {Version} from './icons'
import {SizableText} from './text'

const iconSize = 20

export function SubDocumentItem({
  item,
  accountsMetadata,
  markedAsRead,
  hideIcon,
}: {
  item: HMLibraryDocument
  accountsMetadata: HMAccountsMetadata
  markedAsRead?: boolean
  hideIcon?: boolean
}) {
  const metadata = item?.metadata
  const id = hmId('d', item.account, {
    path: item.path,
  })
  const isRead = markedAsRead || !item.activitySummary?.isUnread
  const linkProps = useRouteLink({key: 'document', id})
  return (
    <Button
      variant={isRead ? 'ghost' : 'outline'}
      className="items-start h-auto justify-start"
      {...linkProps}
    >
      {!hideIcon && (
        <div
          className={`w-[${iconSize}px] h-[${iconSize}px] items-center justify-center bg-gray-800 rounded-full p-0.5`}
        >
          <Version size={16} color="white" />
        </div>
      )}
      <div className="flex-1 flex flex-col justify-start">
        <SizableText
          weight={isRead ? 'normal' : 'bold'}
          className="flex-1 truncate whitespace-nowrap overflow-hidden text-left"
        >
          {getMetadataName(metadata)}
        </SizableText>

        {item.activitySummary && (
          <LibraryEntryUpdateSummary
            accountsMetadata={accountsMetadata}
            latestComment={item.latestComment}
            activitySummary={item.activitySummary}
          />
        )}
      </div>
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
    <div className="flex items-center justify-start gap-2">
      <SizableText size="xs" color="muted" className="line-clamp-1">
        {summaryText}
      </SizableText>
      <ActivityTime activitySummary={activitySummary} />
    </div>
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
      <SizableText size="xs" color="muted" className="shrink-0 line-clamp-1">
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

function ExpandChangeGroupButton({
  item,
  onExpand,
  author,
}: {
  item: HMChangeGroup
  onExpand: () => void
  author: HMMetadataPayload
}) {
  return (
    <Button
      variant="outline"
      onClick={onExpand}
      className="justify-start items-start relative h-auto items-start"
      key={item.id}
    >
      <div
        className={`w-[${iconSize}px] h-[${iconSize}px] items-center justify-center bg-gray-800 rounded-full p-0.5`}
      >
        <Version size={16} color="white" />
      </div>
      <HMIcon
        flexGrow={0}
        flexShrink={0}
        size={iconSize}
        id={author.id}
        metadata={author.metadata}
      />
      <div className="flex-1 flex flex-col justify-start">
        <p className="h-[${iconSize}px] overflow-hidden w-full flex items-center justify-start gap-2">
          <SizableText
            size="sm"
            className="shrink truncate overflow-hidden whitespace-nowrap"
          >
            {getMetadataName(author.metadata)}
          </SizableText>

          <SizableText
            size="sm"
            weight="bold"
            className="shrink-0 flex-1 text-left"
          >
            {item.changes.length} versions
          </SizableText>
        </p>
        <SizableText
          size="xs"
          color="muted"
          className="shrink truncate overflow-hidden whitespace-nowrap text-left"
        >
          {formattedDateMedium(item.changes.at(-1)?.createTime)}
        </SizableText>
      </div>
      <div className="flex items-center justify-center h-full">
        <ChevronDown size={16} color="gray" />
      </div>
    </Button>
  )
}
