import {
  formattedDate,
  getMetadataName,
  HMAccountsMetadata,
  HMActivitySummary,
  HMComment,
  hmId,
  HMLibraryDocument,
  normalizeDate,
  plainTextOfContent,
  useRouteLink,
} from '@shm/shared'
import {Button} from './button'
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
  const linkProps = useRouteLink({key: 'document', id})
  return (
    <Button className={cn('justify-start items-start h-auto')} {...linkProps}>
      {!hideIcon && (
        <div
          className={`w-[${iconSize}px] h-[${iconSize}px] items-center justify-center rounded-full bg-gray-800 p-0.5`}
        >
          <Version size={16} color="white" />
        </div>
      )}
      <div className="flex flex-col flex-1 justify-start w-full">
        <SizableText
          weight={isRead ? 'normal' : 'bold'}
          className="overflow-hidden flex-1 text-left truncate whitespace-nowrap"
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
    <div className="flex gap-2 justify-start items-center">
      <SizableText
        size="xs"
        color="muted"
        className="font-sans line-clamp-1"
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
        className="opacity-80 line-clamp-1 shrink-0"
        weight="light"
      >
        ({formattedDate(displayTime)})
      </SizableText>
    )
  }
  return null
}
