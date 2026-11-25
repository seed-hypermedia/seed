/**
 * Shared notification card used by the To you tab on desktop and web.
 */
import {abbreviateUid, formattedDateShort, hmId} from '@shm/shared'
import {getDocumentTitle} from '@shm/shared/content'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {getNotificationTargetName, notificationAction} from '@shm/shared/models/notification-helpers'
import type {NotificationPayload} from '@shm/shared/models/notification-payload'
import {Check} from 'lucide-react'
import {AccountAvatar} from './account-avatar'
import {Button} from './button'
import {Spinner} from './spinner'
import {Tooltip} from './tooltip'
import {cn} from './utils'

/** Props for the notification list item. */
export type NotificationListItemProps = {
  item: NotificationPayload
  isRead: boolean
  onOpen: () => void | Promise<void>
  onToggleRead: () => void
}

/** A notification card with author avatar, action, date, origin and read toggle. */
export function NotificationListItem({item, isRead, onOpen, onToggleRead}: NotificationListItemProps) {
  const authorId = item.author.uid ? hmId(item.author.uid) : null
  const targetId = item.target.uid ? hmId(item.target.uid, {path: item.target.path ?? undefined}) : null
  const author = useAccount(item.author.uid || undefined, {subscribe: true})
  const target = useResource(targetId, {subscribed: true})

  const resolvedName = author.data?.metadata?.name
  const authorName = resolvedName || item.author.name || (item.author.uid ? abbreviateUid(item.author.uid) : 'Someone')
  const authorIcon = author.data?.metadata?.icon || item.author.icon || undefined
  const resolvedTargetName =
    target.data?.type === 'document' ? getDocumentTitle(target.data.document) || undefined : undefined

  return (
    <div
      className={cn(
        'group flex w-full items-start gap-3 rounded-lg border p-3 transition-colors',
        isRead
          ? 'bg-background hover:bg-muted/40'
          : 'border-blue-100 bg-blue-50 hover:bg-blue-100 dark:border-blue-900/50 dark:bg-blue-900/30 dark:hover:bg-blue-900/40',
      )}
    >
      <div className="shrink-0" onClick={(event) => event.stopPropagation()}>
        {authorId ? (
          <AccountAvatar size={28} id={authorId} name={authorName} icon={authorIcon} />
        ) : (
          <div className="bg-muted size-7 rounded-full" />
        )}
      </div>
      <button type="button" className="flex min-w-0 flex-1 flex-col items-start gap-1.5 text-left" onClick={onOpen}>
        <span className="text-sm font-semibold">
          {authorName} {notificationAction(item)}
          {!resolvedName && item.author.uid ? (
            <span className="ml-1 inline-block align-middle">
              <Spinner size="small" />
            </span>
          ) : null}
          {isRead ? null : <span className="sr-only"> (unread)</span>}
        </span>
        <span className="bg-background ring-border max-w-full truncate rounded px-1.5 py-0.5 text-sm ring-1">
          {getNotificationTargetName(item, resolvedTargetName)}
        </span>
      </button>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-muted-foreground text-xs">{formattedDateShort(new Date(item.eventAtMs))}</span>
        <Tooltip content={isRead ? 'Mark as unread' : 'Mark as read'}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={isRead ? 'Mark as unread' : 'Mark as read'}
            className="size-7 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
            onClick={onToggleRead}
          >
            <Check size={16} className={isRead ? 'text-brand' : 'text-muted-foreground'} />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}
