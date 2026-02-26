import {MainWrapper} from '@/components/main-wrapper'
import {useNotifyServiceHost} from '@/models/gateway-settings'
import {
  useNotificationConfig,
  useRemoveNotificationConfig,
  useResendNotificationConfigVerification,
  useSetNotificationConfig,
} from '@/models/notification-config'
import {useNotificationInbox} from '@/models/notification-inbox'
import {isNotificationEventRead} from '@/models/notification-read-logic'
import {
  useLocalNotificationReadState,
  useMarkAllNotificationsRead,
  useMarkNotificationEventRead,
  useMarkNotificationEventUnread,
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
import {formattedDateShort} from '@shm/shared'
import {Button} from '@shm/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {Container, PanelContainer} from '@shm/ui/container'
import {HMIcon} from '@shm/ui/hm-icon'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {Bell, Check, Info, Settings} from 'lucide-react'
import {useEffect, useMemo, useState} from 'react'

export default function NotificationsPage() {
  const selectedAccount = useSelectedAccount()
  const accountUid = selectedAccount?.id.uid

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
  const markEventUnread = useMarkNotificationEventUnread()
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
            <div className="flex items-center gap-2">
              <SizableText size="xl">Notifications</SizableText>
              {syncNow.isLoading ? <Spinner /> : null}
              {syncStatus.data?.lastSyncError ? (
                <Tooltip content={syncStatus.data.lastSyncError}>
                  <Info size={16} className="text-muted-foreground" />
                </Tooltip>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <NotificationEmailSettingsDialog accountUid={accountUid} />
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
          </div>

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
                    className="group hover:bg-muted/40 flex w-full items-center gap-3 p-4 text-left"
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
                      <p className="text-muted-foreground text-xs">
                        {formattedDateShort(new Date(item.event.eventAtMs))}
                      </p>
                    </div>
                    <Tooltip content={isRead ? 'Mark as unread' : 'Mark as read'}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation()
                          e.preventDefault()
                          if (isRead) {
                            markEventUnread.mutate({
                              accountUid,
                              eventId: item.event.feedEventId,
                              eventAtMs: item.event.eventAtMs,
                              otherLoadedEvents: notifications.map((n) => ({
                                eventId: n.event.feedEventId,
                                eventAtMs: n.event.eventAtMs,
                              })),
                            })
                          } else {
                            markEventRead.mutate({
                              accountUid,
                              eventId: item.event.feedEventId,
                              eventAtMs: item.event.eventAtMs,
                            })
                          }
                        }}
                      >
                        <Check size={16} className={isRead ? 'text-brand' : 'text-muted-foreground'} />
                      </Button>
                    </Tooltip>
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

function NotificationEmailSettingsDialog({accountUid}: {accountUid: string}) {
  const notifyServiceHost = useNotifyServiceHost() || 'https://notify.seed.hyper.media'
  const {data: config, isLoading} = useNotificationConfig(notifyServiceHost, accountUid)
  const setConfig = useSetNotificationConfig(notifyServiceHost, accountUid)
  const removeConfig = useRemoveNotificationConfig(notifyServiceHost, accountUid)
  const resendVerification = useResendNotificationConfigVerification(notifyServiceHost, accountUid)
  const [emailInput, setEmailInput] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const currentEmail = config?.email ?? null
  const isVerified = Boolean(config?.verifiedTime)
  const verificationSendTime = config?.verificationSendTime ?? null
  const verificationExpired = Boolean(config?.verificationExpired)
  const needsVerification = Boolean(currentEmail && !isVerified)
  const canResendVerification = needsVerification && (verificationExpired || !verificationSendTime)

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open)
        if (open) {
          setEmailInput(currentEmail || '')
          setIsEditing(false)
        }
      }}
    >
      <div className="flex min-w-0 items-center gap-2">
        {!isLoading && currentEmail ? (
          <div className="flex min-w-0 flex-col">
            <p className="text-muted-foreground max-w-[260px] truncate text-sm">{currentEmail}</p>
            {needsVerification ? <p className="text-xs text-amber-600">Email not verified</p> : null}
          </div>
        ) : null}
        <Tooltip content="Email notification settings">
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost">
              <Settings size={16} />
            </Button>
          </DialogTrigger>
        </Tooltip>
      </div>
      <DialogContent className="max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Email Notifications</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Spinner />
        ) : (
          <div className="flex flex-col gap-3">
            {needsVerification ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <p>
                  {verificationSendTime && !verificationExpired
                    ? 'Email verification is pending. Click the link in your inbox to activate notification emails.'
                    : verificationExpired
                    ? 'Your verification link expired. Request a new verification email.'
                    : 'Notification emails are paused until you verify this email address.'}
                </p>
                {canResendVerification ? (
                  <div className="mt-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={resendVerification.isLoading}
                      onClick={() => {
                        resendVerification.mutate(undefined, {
                          onSuccess: () => {
                            toast.success('Verification email sent. Check your inbox.')
                          },
                        })
                      }}
                    >
                      {resendVerification.isLoading ? 'Sending...' : 'Resend verification email'}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            {currentEmail && !isEditing ? (
              <>
                <div className="rounded-md border p-3">
                  <p className="text-sm font-medium">{currentEmail}</p>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEmailInput(currentEmail)
                      setIsEditing(true)
                    }}
                  >
                    Edit Email
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={removeConfig.isLoading}
                    onClick={() => {
                      removeConfig.mutate(undefined, {
                        onSuccess: () => {
                          setEmailInput('')
                          setIsEditing(false)
                          toast.success('Notification email removed')
                        },
                      })
                    }}
                  >
                    {removeConfig.isLoading ? 'Removing...' : 'Remove Email'}
                  </Button>
                </div>
              </>
            ) : (
              <form
                className="flex flex-col gap-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!emailInput) return
                  setConfig.mutate(
                    {email: emailInput},
                    {
                      onSuccess: (result: any) => {
                        setIsOpen(false)
                        setIsEditing(false)
                        if (result?.verifiedTime) {
                          toast.success('Email updated')
                        } else {
                          toast.success(
                            'Verification email sent. Click the link in your inbox to activate notifications.',
                          )
                        }
                      },
                    },
                  )
                }}
              >
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  autoFocus
                />
                <div className="flex justify-end gap-2">
                  {currentEmail ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setEmailInput(currentEmail)
                        setIsEditing(false)
                      }}
                    >
                      Cancel
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
                      Cancel
                    </Button>
                  )}
                  <Button type="submit" disabled={!emailInput || setConfig.isLoading}>
                    {setConfig.isLoading ? 'Saving...' : currentEmail ? 'Save Email' : 'Set Email'}
                  </Button>
                </div>
              </form>
            )}
            <div className="flex justify-end">
              <Button type="button" variant="ghost" onClick={() => setIsOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
