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
        className="line-clamp-1 font-sans"
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
