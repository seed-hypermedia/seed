import {useLocalKeyPair} from '@/auth'
import {
  useWebAccountUid,
  useWebNotificationInbox,
  useWebNotificationReadState,
  useWebMarkNotificationEventRead,
  useWebMarkNotificationEventUnread,
  useWebMarkAllNotificationsRead,
} from '@/web-notifications'
import {routeToHref, useUniversalAppContext} from '@shm/shared'
import {
  getMaxLoadedNotificationEventAtMs,
  markNotificationReadAndNavigate,
} from '@shm/shared/models/notification-helpers'
import {isNotificationEventRead} from '@shm/shared/models/notification-read-logic'
import type {NavRoute} from '@shm/shared/routes'
import {Button} from '@shm/ui/button'
import {NotificationListItem} from '@shm/ui/notification-list-item'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {useNavigate as useRemixNavigate} from '@remix-run/react'
import {Bell} from 'lucide-react'
import {useCallback, useMemo, useState} from 'react'

/** Client-only notifications page content for the web app. */
export function WebNotificationsPage() {
  const keyPair = useLocalKeyPair()
  const accountUid = useWebAccountUid()

  if (!keyPair || !accountUid) {
    return (
      <div className="flex h-[60vh] w-full flex-col items-center justify-center gap-4">
        <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-lg">
          <Bell size={50} className="text-muted-foreground" />
        </div>
        <SizableText size="xl">Notifications</SizableText>
        <p className="text-muted-foreground max-w-lg text-center">Sign in to view your notifications.</p>
      </div>
    )
  }

  if (!keyPair.notifyServerUrl) {
    return (
      <div className="flex h-[60vh] w-full flex-col items-center justify-center gap-4">
        <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-lg">
          <Bell size={50} className="text-muted-foreground" />
        </div>
        <SizableText size="xl">Notifications unavailable</SizableText>
        <p className="text-muted-foreground max-w-lg text-center">
          Log out and log back in again to use notifications.
        </p>
      </div>
    )
  }

  return <WebNotificationsForAccount accountUid={accountUid} />
}

function WebNotificationsForAccount({accountUid}: {accountUid: string}) {
  const {origin, originHomeId} = useUniversalAppContext()
  const inbox = useWebNotificationInbox()
  const readState = useWebNotificationReadState()
  const markEventRead = useWebMarkNotificationEventRead()
  const markEventUnread = useWebMarkNotificationEventUnread()
  const markAllRead = useWebMarkAllNotificationsRead()

  const notifications = inbox.data?.notifications ?? []
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const filteredNotifications = useMemo(() => {
    if (filter === 'all') return notifications
    return notifications.filter(
      (item) =>
        !isNotificationEventRead({
          readState: readState.data ?? undefined,
          eventId: item.feedEventId,
          eventAtMs: item.eventAtMs,
        }),
    )
  }, [notifications, filter, readState.data])

  const maxLoadedEventAtMs = useMemo(() => {
    return getMaxLoadedNotificationEventAtMs(notifications)
  }, [notifications])

  const remixNavigate = useRemixNavigate()
  const navigate = useCallback(
    (route: NavRoute) => {
      const href = routeToHref(route, {originHomeId, origin})
      if (href) remixNavigate(href)
    },
    [originHomeId, origin, remixNavigate],
  )

  return (
    <div className="flex flex-col gap-4 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SizableText size="xl">Notifications</SizableText>
          {inbox.isLoading ? <Spinner /> : null}
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!notifications.length || markAllRead.isLoading}
          onClick={() =>
            markAllRead.mutate({
              accountUid,
              markAllReadAtMs: maxLoadedEventAtMs,
            })
          }
        >
          {markAllRead.isLoading ? 'Marking...' : 'Mark all as read'}
        </Button>
      </div>

      <div className="flex self-start rounded-md border">
        <Button
          size="sm"
          variant={filter === 'all' ? 'secondary' : 'ghost'}
          className="rounded-r-none border-0"
          onClick={() => setFilter('all')}
        >
          All
        </Button>
        <Button
          size="sm"
          variant={filter === 'unread' ? 'secondary' : 'ghost'}
          className="rounded-l-none border-0"
          onClick={() => setFilter('unread')}
        >
          Unread
        </Button>
      </div>

      {inbox.isLoading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <Spinner />
        </div>
      ) : notifications.length === 0 ? (
        <div className="flex h-[60vh] w-full flex-col items-center justify-center gap-4">
          <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-lg">
            <Bell size={50} className="text-muted-foreground" />
          </div>
          <SizableText size="xl">No notifications yet</SizableText>
          <p className="text-muted-foreground max-w-lg text-center">Mentions and replies will appear here.</p>
        </div>
      ) : filteredNotifications.length === 0 ? (
        <div className="flex h-[60vh] w-full flex-col items-center justify-center gap-4">
          <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-lg">
            <Bell size={50} className="text-muted-foreground" />
          </div>
          <SizableText size="xl">All caught up</SizableText>
          <p className="text-muted-foreground max-w-lg text-center">No unread notifications.</p>
        </div>
      ) : (
        <div className="divide-border flex flex-col divide-y rounded-lg border">
          {filteredNotifications.map((item) => {
            const isRead = isNotificationEventRead({
              readState: readState.data ?? undefined,
              eventId: item.feedEventId,
              eventAtMs: item.eventAtMs,
            })
            return (
              <NotificationListItem
                key={item.feedEventId}
                item={item}
                isRead={isRead}
                onOpen={async () => {
                  await markNotificationReadAndNavigate({
                    accountUid,
                    item,
                    markEventRead: (params) => markEventRead.mutateAsync(params).then(() => undefined),
                    navigate,
                  })
                }}
                onToggleRead={() => {
                  if (isRead) {
                    markEventUnread.mutate({
                      accountUid,
                      eventId: item.feedEventId,
                      eventAtMs: item.eventAtMs,
                      otherLoadedEvents: notifications.map((n) => ({
                        eventId: n.feedEventId,
                        eventAtMs: n.eventAtMs,
                      })),
                    })
                  } else {
                    markEventRead.mutate({
                      accountUid,
                      eventId: item.feedEventId,
                      eventAtMs: item.eventAtMs,
                    })
                  }
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
