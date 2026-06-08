import {useLocalKeyPair} from '@/auth'
import {
  useWebAccountUid,
  useWebMarkAllNotificationsRead,
  useWebMarkNotificationEventRead,
  useWebMarkNotificationEventUnread,
  useWebNotificationInbox,
  useWebNotificationReadState,
} from '@/web-notifications'
import {useNavigate as useRemixNavigate, useSearchParams} from '@remix-run/react'
import {routeToHref, useUniversalAppContext} from '@shm/shared'
import {markNotificationReadAndNavigate} from '@shm/shared/models/notification-helpers'
import {isNotificationEventRead} from '@shm/shared/models/notification-read-logic'
import type {NavRoute} from '@shm/shared/routes'
import {Button} from '@shm/ui/button'
import {NotificationPageEmptyState, NotificationsPageContent} from '@shm/ui/notifications-page'
import {useCallback, useEffect} from 'react'

/** Client-only notifications page content for the web app. */
export function WebNotificationsPage() {
  const keyPair = useLocalKeyPair()
  const accountUid = useWebAccountUid()

  if (!keyPair || !accountUid) {
    return (
      <NotificationPageEmptyState
        title="Notifications"
        titleSize="2xl"
        description="Sign in to view your notifications."
      />
    )
  }

  if (!keyPair.notifyServerUrl) {
    return (
      <NotificationPageEmptyState
        title="Notifications unavailable"
        titleSize="2xl"
        description="Log out and log back in again to use notifications."
      />
    )
  }

  return <WebNotificationsForAccount accountUid={accountUid} />
}

const NOTIFICATIONS_VIEW_KEY = 'seed-notifications-view'

function WebNotificationsForAccount({accountUid}: {accountUid: string}) {
  const {origin, originHomeId} = useUniversalAppContext()
  const siteUid = originHomeId?.uid
  const inbox = useWebNotificationInbox(siteUid)
  const readState = useWebNotificationReadState(siteUid)
  const markEventRead = useWebMarkNotificationEventRead(siteUid)
  const markEventUnread = useWebMarkNotificationEventUnread(siteUid)
  const markAllRead = useWebMarkAllNotificationsRead(siteUid)

  const notifications = inbox.data?.notifications ?? []
  const [searchParams, setSearchParams] = useSearchParams()
  const viewParam = searchParams.get('view')
  const filter = viewParam === 'unread' ? 'unread' : 'all'

  const setFilter = useCallback(
    (view: 'all' | 'unread') => {
      localStorage.setItem(NOTIFICATIONS_VIEW_KEY, view)
      setSearchParams({view}, {replace: true})
    },
    [setSearchParams],
  )

  // On mount, if no view in URL, restore from localStorage
  useEffect(() => {
    if (viewParam) return
    const stored = localStorage.getItem(NOTIFICATIONS_VIEW_KEY)
    if (stored === 'unread') {
      setSearchParams({view: 'unread'}, {replace: true})
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const queryError = inbox.error ?? readState.error
  const queryErrorMessage =
    queryError instanceof Error ? queryError.message : queryError ? String(queryError) : 'Unknown notification error'

  const isRead = useCallback(
    (item: (typeof notifications)[number]) =>
      isNotificationEventRead({
        readState: readState.data ?? undefined,
        eventId: item.feedEventId,
        eventAtMs: item.eventAtMs,
      }),
    [readState.data],
  )

  const remixNavigate = useRemixNavigate()
  const navigate = useCallback(
    (route: NavRoute) => {
      const href = routeToHref(route, {originHomeId, origin})
      if (href) remixNavigate(href)
    },
    [originHomeId, origin, remixNavigate],
  )

  return (
    <NotificationsPageContent
      filter={filter}
      onFilterChange={setFilter}
      notifications={notifications}
      isNotificationRead={isRead}
      isLoading={inbox.isLoading}
      errorMessage={queryError ? queryErrorMessage : null}
      headerActions={
        <Button
          size="sm"
          variant="outline"
          disabled={!notifications.length || markAllRead.isLoading}
          onClick={() =>
            markAllRead.mutate({
              accountUid,
            })
          }
        >
          {markAllRead.isLoading ? 'Marking…' : 'Mark all as read'}
        </Button>
      }
      onOpenNotification={(item) =>
        markNotificationReadAndNavigate({
          accountUid,
          item,
          markEventRead: (params) => markEventRead.mutateAsync(params).then(() => undefined),
          navigate,
        })
      }
      onToggleNotificationRead={(item, itemIsRead) => {
        if (itemIsRead) {
          markEventUnread.mutate({
            accountUid,
            eventId: item.feedEventId,
            eventAtMs: item.eventAtMs,
            otherLoadedEvents: notifications.map((notification) => ({
              eventId: notification.feedEventId,
              eventAtMs: notification.eventAtMs,
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
}
