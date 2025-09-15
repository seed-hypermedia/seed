import {
  formattedDate,
  formattedDateMedium,
  getMetadataName,
  HMAccountsMetadata,
  HMActivitySummary,
  HMChangeGroup,
  HMChangeSummary,
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
import {Button} from './button'
import {ChangeItem} from './change-item'
import {HMIcon} from './hm-icon'
import {Version} from './icons'
import {SizableText} from './text'
import {cn} from './utils'

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
  const id = hmId(item.account, {
    path: item.path,
  })
  const isRead = markedAsRead || !item.activitySummary?.isUnread
  const linkProps = useRouteLink({key: 'document', id}, {handler: 'onClick'})
  return (
    <Button className={cn('h-auto items-start justify-start')} {...linkProps}>
      {!hideIcon && (
        <div
          className={`w-[${iconSize}px] h-[${iconSize}px] items-center justify-center rounded-full bg-gray-800 p-0.5`}
        >
          <Version size={16} color="white" />
        </div>
      )}
      <div className="flex w-full flex-1 flex-col justify-start">
        <SizableText
          weight={isRead ? 'normal' : 'bold'}
          className="flex-1 truncate overflow-hidden text-left whitespace-nowrap"
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
      <SizableText
        size="xs"
        color="muted"
        className="line-clamp-1"
        weight="light"
      >
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
      <SizableText
        size="xs"
        color="muted"
        className="line-clamp-1 shrink-0 opacity-80"
        weight="light"
      >
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
    return item.changes.map((change: HMChangeSummary) => {
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
      className="relative h-auto w-full items-start justify-start"
      key={item.id}
    >
      <div
        className={`w-[${iconSize}px] h-[${iconSize}px] items-center justify-center rounded-full bg-gray-800 p-0.5`}
      >
        <Version size={16} color="white" />
      </div>
      <HMIcon
        size={iconSize}
        id={author.id}
        name={author.metadata?.name}
        icon={author.metadata?.icon}
      />
      <div className="flex flex-1 flex-col justify-start">
        <p className="h-[${iconSize}px] flex w-full items-center justify-start gap-2 overflow-hidden">
          <SizableText
            size="sm"
            className="shrink truncate overflow-hidden whitespace-nowrap"
          >
            {getMetadataName(author.metadata)}
          </SizableText>

          <SizableText
            size="sm"
            weight="bold"
            className="flex-1 shrink-0 text-left"
          >
            {item.changes.length} versions
          </SizableText>
        </p>
        <SizableText
          size="xs"
          color="muted"
          className="shrink truncate overflow-hidden text-left whitespace-nowrap"
        >
          {formattedDateMedium(item.changes.at(-1)?.createTime)}
        </SizableText>
      </div>
      <div className="flex h-full items-center justify-center">
        <ChevronDown size={16} color="gray" />
      </div>
    </Button>
  )
}
