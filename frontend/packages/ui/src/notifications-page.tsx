import type {NotificationPayload} from '@shm/shared/models/notification-payload'
import {Bell} from 'lucide-react'
import {ReactNode, useMemo} from 'react'
import {Button} from './button'
import {GeneralPageContainer, GeneralPageHeader} from './general-page'
import {NotificationListItem} from './notification-list-item'
import {Spinner} from './spinner'
import {SizableText, Text} from './text'

/** NotificationFilter controls whether all notifications or only unread notifications are shown. */
export type NotificationFilter = 'all' | 'unread'

/** NotificationPageEmptyState renders the shared centered empty/error state for notifications pages. */
export function NotificationPageEmptyState({
  title,
  description,
  titleSize = 'xl',
}: {
  title: string
  description: ReactNode
  titleSize?: 'xl' | '2xl'
}) {
  return (
    <div className="flex h-[60vh] w-full flex-col items-center justify-center gap-4">
      <div className="bg-muted flex size-20 items-center justify-center rounded-lg">
        <Bell size={50} className="text-muted-foreground" />
      </div>
      {titleSize === '2xl' ? (
        <Text weight="bold" size="2xl">
          {title}
        </Text>
      ) : (
        <SizableText size="xl">{title}</SizableText>
      )}
      <p className="text-muted-foreground max-w-lg text-center">{description}</p>
    </div>
  )
}

/** NotificationFilterTabs renders the shared All/Unread segmented control. */
export function NotificationFilterTabs({
  filter,
  onFilterChange,
}: {
  filter: NotificationFilter
  onFilterChange: (filter: NotificationFilter) => void
}) {
  return (
    <div className="flex self-start rounded-md border">
      <Button
        size="sm"
        variant={filter === 'all' ? 'secondary' : 'ghost'}
        className="rounded-r-none border-0"
        onClick={() => onFilterChange('all')}
      >
        All
      </Button>
      <Button
        size="sm"
        variant={filter === 'unread' ? 'secondary' : 'ghost'}
        className="rounded-l-none border-0"
        onClick={() => onFilterChange('unread')}
      >
        Unread
      </Button>
    </div>
  )
}

/** NotificationsPageContent renders the shared notifications page layout, filters, states, and list. */
export function NotificationsPageContent({
  filter,
  onFilterChange,
  notifications,
  isNotificationRead,
  onOpenNotification,
  onToggleNotificationRead,
  isLoading = false,
  headerLoading = isLoading,
  headerActions,
  errorMessage,
}: {
  filter: NotificationFilter
  onFilterChange: (filter: NotificationFilter) => void
  notifications: NotificationPayload[]
  isNotificationRead: (item: NotificationPayload) => boolean
  onOpenNotification: (item: NotificationPayload) => void | Promise<void>
  onToggleNotificationRead: (item: NotificationPayload, isRead: boolean) => void
  isLoading?: boolean
  headerLoading?: boolean
  headerActions?: ReactNode
  errorMessage?: string | null
}) {
  const filteredNotifications = useMemo(() => {
    if (filter === 'all') return notifications
    return notifications.filter((item) => !isNotificationRead(item))
  }, [filter, isNotificationRead, notifications])

  return (
    <GeneralPageContainer>
      <GeneralPageHeader title="Notifications" loading={headerLoading} actions={headerActions} />

      <NotificationFilterTabs filter={filter} onFilterChange={onFilterChange} />

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <Spinner />
        </div>
      ) : errorMessage ? (
        <NotificationPageEmptyState title="Could not load notifications" description={errorMessage} />
      ) : notifications.length === 0 ? (
        <NotificationPageEmptyState title="No notifications yet" description="Mentions and replies will appear here." />
      ) : filteredNotifications.length === 0 ? (
        <NotificationPageEmptyState title="All caught up" description="No unread notifications." />
      ) : (
        <div className="divide-border flex flex-col divide-y rounded-lg border">
          {filteredNotifications.map((item) => {
            const isRead = isNotificationRead(item)
            return (
              <NotificationListItem
                key={item.feedEventId}
                item={item}
                isRead={isRead}
                onOpen={() => onOpenNotification(item)}
                onToggleRead={() => onToggleNotificationRead(item, isRead)}
              />
            )
          })}
        </div>
      )}
    </GeneralPageContainer>
  )
}
