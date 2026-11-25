import {useNotifyServiceHost} from '@/models/gateway-settings'
import {
  useNotificationConfig,
  useRemoveNotificationConfig,
  useResendNotificationConfigVerification,
  useSetNotificationConfig,
} from '@/models/notification-config'
import {useNotificationInbox} from '@/models/notification-inbox'
import {
  useLocalNotificationReadState,
  useMarkAllNotificationsRead,
  useMarkNotificationEventRead,
  useMarkNotificationEventUnread,
  useNotificationSyncStatus,
  useSyncNotificationReadState,
} from '@/models/notification-read-state'
import {useSelectedAccount} from '@/selected-account'
import {client} from '@/trpc'
import {useNavigate} from '@/utils/useNavigate'
import {markNotificationReadAndNavigate} from '@shm/shared/models/notification-helpers'
import {isNotificationEventRead, notificationMatchesSite} from '@shm/shared/models/notification-read-logic'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {Button} from '@shm/ui/button'
import {
  NotificationEmailSettings,
  NotificationFilter,
  NotificationInbox,
  NotificationPageEmptyState,
} from '@shm/ui/notifications-page'
import {Spinner} from '@shm/ui/spinner'
import {Tooltip} from '@shm/ui/tooltip'
import {useMutation, useQuery} from '@tanstack/react-query'
import {Info} from 'lucide-react'
import {useCallback, useEffect, useMemo} from 'react'

const NOTIFICATIONS_VIEW_KEY = 'notifications-view'

/** Desktop To you tab of the space Activity view: the selected account's notifications within one space. */
export function DesktopNotificationInbox({spaceUid}: {spaceUid: string}) {
  const selectedAccount = useSelectedAccount()
  const accountUid = selectedAccount?.id.uid
  if (!accountUid) {
    return <NotificationPageEmptyState title="Notifications" description="Select an account to view notifications." />
  }
  return <NotificationInboxForAccount accountUid={accountUid} spaceUid={spaceUid} />
}

function NotificationInboxForAccount({accountUid, spaceUid}: {accountUid: string; spaceUid: string}) {
  const navigate = useNavigate()
  const notifyServiceHost = useNotifyServiceHost()
  const readState = useLocalNotificationReadState(accountUid)
  const syncStatus = useNotificationSyncStatus(accountUid)
  const markEventRead = useMarkNotificationEventRead()
  const markEventUnread = useMarkNotificationEventUnread()
  const markAllRead = useMarkAllNotificationsRead()
  const syncNow = useSyncNotificationReadState()
  const inbox = useNotificationInbox(accountUid)
  const notifications = useMemo(
    () => (inbox.data || []).filter((notification) => notificationMatchesSite(notification, spaceUid)),
    [inbox.data, spaceUid],
  )

  const persistedView = useQuery({
    queryKey: [queryKeys.SETTINGS, NOTIFICATIONS_VIEW_KEY],
    queryFn: () => client.appSettings.getSetting.query(NOTIFICATIONS_VIEW_KEY),
  })
  const setPersistedView = useMutation({
    mutationFn: (view: string) => client.appSettings.setSetting.mutate({key: NOTIFICATIONS_VIEW_KEY, value: view}),
    onSuccess: () => invalidateQueries([queryKeys.SETTINGS, NOTIFICATIONS_VIEW_KEY]),
  })
  const filter: NotificationFilter = persistedView.data === 'unread' ? 'unread' : 'all'

  const isRead = useCallback(
    (item: (typeof notifications)[number]) =>
      isNotificationEventRead({
        readState: readState.data,
        eventId: item.feedEventId,
        eventAtMs: item.eventAtMs,
      }),
    [readState.data],
  )

  useEffect(() => {
    if (!notifyServiceHost) return
    if (syncNow.isLoading) return
    syncNow.mutate({accountUid, notifyServiceHost})
  }, [accountUid, notifyServiceHost])

  return (
    <NotificationInbox
      filter={filter}
      onFilterChange={(view) => setPersistedView.mutate(view)}
      notifications={notifications}
      isNotificationRead={isRead}
      isLoading={inbox.isLoading}
      headerActions={
        <>
          {syncNow.isLoading ? <Spinner size="small" /> : null}
          {syncStatus.data?.lastSyncError ? (
            <Tooltip content={syncStatus.data.lastSyncError}>
              <Info size={16} className="text-muted-foreground" />
            </Tooltip>
          ) : null}
          <DesktopNotificationEmailSettings accountUid={accountUid} />
          <Button
            size="sm"
            variant="outline"
            disabled={!notifications.length || markAllRead.isLoading}
            onClick={() => markAllRead.mutate({accountUid, siteUid: spaceUid})}
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
            otherLoadedEvents: (inbox.data || []).map((notification) => ({
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

function DesktopNotificationEmailSettings({accountUid}: {accountUid: string}) {
  const notifyServiceHost = useNotifyServiceHost()
  const config = useNotificationConfig(notifyServiceHost, accountUid, {enabled: Boolean(notifyServiceHost)})
  const setConfig = useSetNotificationConfig(notifyServiceHost, accountUid)
  const removeConfig = useRemoveNotificationConfig(notifyServiceHost, accountUid)
  const resendVerification = useResendNotificationConfigVerification(notifyServiceHost, accountUid)
  return (
    <NotificationEmailSettings
      config={config.data}
      isLoading={config.isLoading}
      onSave={async (email) => {
        const result = await setConfig.mutateAsync({email})
        return {verified: Boolean(result?.verifiedTime)}
      }}
      onRemove={() => removeConfig.mutateAsync(undefined)}
      onResendVerification={() => resendVerification.mutateAsync(undefined)}
    />
  )
}
