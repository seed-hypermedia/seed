/**
 * Shared notification list item component used by both desktop and web.
 */
import {getDocumentTitle} from '@shm/shared/content'
import {abbreviateUid, formattedDateShort, hmId} from '@shm/shared'
import {useAccount, useResource} from '@shm/shared/models/entity'
import type {NotificationPayload} from '@shm/shared/models/notification-payload'
import {notificationTitle} from '@shm/shared/models/notification-helpers'
import {Button} from './button'
import {HMIcon} from './hm-icon'
import {Tooltip} from './tooltip'
import {cn} from './utils'
import {Check} from 'lucide-react'

/** Props for the notification list item. */
export type NotificationListItemProps = {
  item: NotificationPayload
  isRead: boolean
  onOpen: () => void | Promise<void>
  onToggleRead: () => void
}

/** A single notification row with author icon, title, date, and read toggle. */
export function NotificationListItem({item, isRead, onOpen, onToggleRead}: NotificationListItemProps) {
  const authorId = item.author.uid ? hmId(item.author.uid) : null
  const targetId = item.target.uid ? hmId(item.target.uid, {path: item.target.path ?? undefined}) : null
  const author = useAccount(item.author.uid || undefined)
  const target = useResource(targetId, {subscribed: true})

  const authorName =
    author.data?.metadata?.name || item.author.name || (item.author.uid ? abbreviateUid(item.author.uid) : undefined)
  const authorIcon = author.data?.metadata?.icon || item.author.icon || undefined
  const targetName = target.data?.type === 'document' ? getDocumentTitle(target.data.document) || undefined : undefined

  return (
    <div
      className={cn(
        'group flex w-full items-center gap-3 p-4 text-left transition-colors',
        isRead ? 'hover:bg-muted/40' : 'bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/40',
      )}
    >
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => void onOpen()}>
        <div className="pt-0.5">
          {authorId ? (
            <HMIcon size={24} id={authorId} name={authorName} icon={authorIcon} />
          ) : (
            <div className="bg-muted h-6 w-6 rounded-full" />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            {!isRead ? <span className="inline-block h-2 w-2 rounded-full bg-blue-600" /> : null}
            <p className={cn('truncate text-sm', !isRead && 'font-bold')}>
              {notificationTitle(item, {authorName, targetName})}
            </p>
          </div>
          <p className="text-muted-foreground text-xs">{formattedDateShort(new Date(item.eventAtMs))}</p>
        </div>
      </button>
      <Tooltip content={isRead ? 'Mark as unread' : 'Mark as read'}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={() => {
            onToggleRead()
          }}
        >
          <Check size={16} className={isRead ? 'text-brand' : 'text-muted-foreground'} />
        </Button>
      </Tooltip>
    </div>
  )
}
