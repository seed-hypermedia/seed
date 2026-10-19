import {useLocalKeyPair} from '@/auth'
import {ClientOnly} from '@/client-lazy'
import {
  useWebAccountUid,
  useWebMarkAllNotificationsRead,
  useWebMarkNotificationEventRead,
  useWebMarkNotificationEventUnread,
  useWebNotificationConfig,
  useWebNotificationInbox,
  useWebNotificationReadState,
  useWebRemoveNotificationConfig,
  useWebResendNotificationConfigVerification,
  useWebSetNotificationConfig,
} from '@/web-notifications'
import {useNavigate as useRemixNavigate} from '@remix-run/react'
import {routeToHref, useUniversalAppContext} from '@shm/shared'
import {markNotificationReadAndNavigate} from '@shm/shared/models/notification-helpers'
import {isNotificationEventRead} from '@shm/shared/models/notification-read-logic'
import type {NavRoute} from '@shm/shared/routes'
import {Button} from '@shm/ui/button'
import {
  NotificationEmailSettings,
  NotificationFilter,
  NotificationInbox,
  NotificationPageEmptyState,
} from '@shm/ui/notifications-page'
import {useCallback, useEffect, useState} from 'react'

/** The web To you tab, rendered only in the browser, where the session and the read filter live. */
export function WebNotificationInboxClientOnly({spaceUid}: {spaceUid: string}) {
  return (
    <ClientOnly>
      <WebNotificationInbox spaceUid={spaceUid} />
    </ClientOnly>
  )
}

/** Web To you tab of the space Activity view: the signed-in account's notifications within one space. */
export function WebNotificationInbox({spaceUid}: {spaceUid: string}) {
  const keyPair = useLocalKeyPair()
  const accountUid = useWebAccountUid()

  if (!keyPair || !accountUid) {
    return <NotificationPageEmptyState title="Notifications" description="Sign in to view your notifications." />
  }

  if (!keyPair.notifyServerUrl) {
    return (
      <NotificationPageEmptyState
        title="Notifications unavailable"
        description="Log out and log back in again to use notifications."
      />
    )
  }

  return <WebNotificationInboxForAccount accountUid={accountUid} spaceUid={spaceUid} />
}

const NOTIFICATIONS_VIEW_KEY = 'seed-notifications-view'

function WebNotificationInboxForAccount({accountUid, spaceUid}: {accountUid: string; spaceUid: string}) {
  const {origin, originHomeId} = useUniversalAppContext()
  const inbox = useWebNotificationInbox(spaceUid)
  const readState = useWebNotificationReadState(spaceUid)
  const markEventRead = useWebMarkNotificationEventRead(spaceUid)
  const markEventUnread = useWebMarkNotificationEventUnread(spaceUid)
  const markAllRead = useWebMarkAllNotificationsRead(spaceUid)

  const notifications = inbox.data?.notifications ?? []
  const [filter, setFilter] = useState<NotificationFilter>('all')

  // Restore the remembered All / Unread choice.
  useEffect(() => {
    if (localStorage.getItem(NOTIFICATIONS_VIEW_KEY) === 'unread') setFilter('unread')
  }, [])

  const changeFilter = useCallback((view: NotificationFilter) => {
    localStorage.setItem(NOTIFICATIONS_VIEW_KEY, view)
    setFilter(view)
  }, [])

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
    <NotificationInbox
      filter={filter}
      onFilterChange={changeFilter}
      notifications={notifications}
      isNotificationRead={isRead}
      isLoading={inbox.isLoading}
      errorMessage={queryError ? queryErrorMessage : null}
      headerActions={
        <>
          <WebNotificationEmailSettings />
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
        </>
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

function WebNotificationEmailSettings() {
  const config = useWebNotificationConfig()
  const setConfig = useWebSetNotificationConfig()
  const removeConfig = useWebRemoveNotificationConfig()
  const resendVerification = useWebResendNotificationConfigVerification()
  return (
    <NotificationEmailSettings
      // Show error if the notifications server can't be reached.
      config={
        config.isError
          ? {
              email: null,
              verifiedTime: null,
              verificationSendTime: null,
              verificationExpired: false,
              isNotifyServerConnected: false,
            }
          : config.data
      }
      isLoading={config.isLoading}
      onSave={async (email) => {
        const result = await setConfig.mutateAsync({email})
        return {verified: Boolean(result?.config.verifiedTime)}
      }}
      onRemove={() => removeConfig.mutateAsync()}
      onResendVerification={() => resendVerification.mutateAsync()}
    />
  )
}
