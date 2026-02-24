import {MainWrapper} from '@/components/main-wrapper'
import {useNotifyServiceHost} from '@/models/gateway-settings'
import {useNotificationInbox} from '@/models/notification-inbox'
import {isNotificationEventRead} from '@/models/notification-read-logic'
import {
  useLocalNotificationReadState,
  useMarkAllNotificationsRead,
  useMarkNotificationEventRead,
  useNotificationSyncStatus,
  useSyncNotificationReadState,
} from '@/models/notification-read-state'
import {
  getMaxLoadedNotificationEventAtMs,
  markNotificationReadAndNavigate,
  notificationTitle,
} from '@/pages/notifications-helpers'
import {useSelectedAccount} from '@/selected-account'
import {useNavigate} from '@/utils/useNavigate'
import {useUniversalAppContext} from '@shm/shared'
import {formattedDateShort} from '@shm/shared/utils/date'
import {Button} from '@shm/ui/button'
import {Container, PanelContainer} from '@shm/ui/container'
import {HMIcon} from '@shm/ui/hm-icon'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {Bell} from 'lucide-react'
import {useEffect, useMemo} from 'react'

export default function NotificationsPage() {
  const {experiments} = useUniversalAppContext()
  const selectedAccount = useSelectedAccount()
  const accountUid = selectedAccount?.id.uid

  if (!experiments?.notifications) {
    return (
      <PanelContainer>
        <MainWrapper scrollable>
          <Container centered className="h-full">
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
              <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-lg">
                <Bell size={50} className="text-muted-foreground" />
              </div>
              <SizableText size="xl">Notifications are experimental</SizableText>
              <p className="text-muted-foreground max-w-lg text-center">
                Enable the Notifications experiment in settings to use this page.
              </p>
            </div>
          </Container>
        </MainWrapper>
      </PanelContainer>
    )
  }

  if (!accountUid) {
    return (
      <PanelContainer>
        <MainWrapper scrollable>
          <Container centered className="h-full">
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
              <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-lg">
                <Bell size={50} className="text-muted-foreground" />
              </div>
              <SizableText size="xl">Notifications</SizableText>
              <p className="text-muted-foreground max-w-lg text-center">Select an account to view notifications.</p>
            </div>
          </Container>
        </MainWrapper>
      </PanelContainer>
    )
  }

  return <NotificationsForAccount accountUid={accountUid} />
}

function NotificationsForAccount({accountUid}: {accountUid: string}) {
  const navigate = useNavigate()
  const notifyServiceHost = useNotifyServiceHost()
  const readState = useLocalNotificationReadState(accountUid)
  const syncStatus = useNotificationSyncStatus(accountUid)
  const markEventRead = useMarkNotificationEventRead()
  const markAllRead = useMarkAllNotificationsRead()
  const syncNow = useSyncNotificationReadState()
  const inbox = useNotificationInbox(accountUid)
  const notifications = inbox.data || []

  const maxLoadedEventAtMs = useMemo(() => {
    return getMaxLoadedNotificationEventAtMs(notifications)
  }, [notifications])

  useEffect(() => {
    if (!notifyServiceHost) return
    if (syncNow.isLoading) return
    syncNow.mutate({accountUid, notifyServiceHost})
  }, [accountUid, notifyServiceHost])

  return (
    <PanelContainer>
      <MainWrapper scrollable>
        <Container centered className="gap-4">
          <div className="flex items-center justify-between">
            <SizableText size="xl">Notifications</SizableText>
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

          {syncStatus.data?.lastSyncError ? (
            <p className="text-muted-foreground text-sm">Sync pending: {syncStatus.data.lastSyncError}</p>
          ) : null}

          {inbox.isLoading ? (
            <div className="flex flex-1 items-center justify-center">
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
          ) : (
            <div className="divide-border flex flex-col divide-y rounded-lg border">
              {notifications.map((item) => {
                const isRead = isNotificationEventRead({
                  readState: readState.data,
                  eventId: item.event.feedEventId,
                  eventAtMs: item.event.eventAtMs,
                })
                return (
                  <button
                    key={item.event.feedEventId}
                    className="hover:bg-muted/40 flex w-full items-start gap-3 p-4 text-left"
                    onClick={async () => {
                      await markNotificationReadAndNavigate({
                        accountUid,
                        item,
                        markEventRead: (params) => markEventRead.mutateAsync(params).then(() => undefined),
                        navigate,
                      })
                    }}
                  >
                    <div className="pt-0.5">
                      {item.event.author?.id ? (
                        <HMIcon
                          size={24}
                          id={item.event.author.id}
                          name={item.event.author.metadata?.name}
                          icon={item.event.author.metadata?.icon}
                        />
                      ) : (
                        <div className="bg-muted h-6 w-6 rounded-full" />
                      )}
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        {!isRead ? <span className="bg-brand inline-block h-2 w-2 rounded-full" /> : null}
                        <p className="truncate text-sm">{notificationTitle(item)}</p>
                      </div>
                      <p className="text-muted-foreground text-xs">{formattedDateShort(new Date(item.event.eventAtMs))}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </Container>
      </MainWrapper>
    </PanelContainer>
  )
}
