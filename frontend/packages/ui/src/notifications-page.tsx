import type {NotificationPayload} from '@shm/shared/models/notification-payload'
import {Bell, Settings, X} from 'lucide-react'
import {FormEvent, ReactNode, useMemo, useState} from 'react'
import {z} from 'zod'
import {Button} from './button'
import {Input} from './components/input'
import {Label} from './components/label'
import {Popover, PopoverContent, PopoverTrigger} from './components/popover'
import {DocumentMaintenanceBanner} from './document-maintenance'
import {NotificationListItem} from './notification-list-item'
import {Spinner} from './spinner'
import {SizableText, Text} from './text'
import {toast} from './toast'
import {Tooltip} from './tooltip'

/** NotificationFilter controls whether all notifications or only unread notifications are shown. */
export type NotificationFilter = 'all' | 'unread'

/** NotificationPageEmptyState renders the shared centered empty/error state of the activity's to you tab. */
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
    <div className="flex w-full flex-col items-center justify-center gap-4 py-16">
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

/** NotificationInbox renders the "To you" tab of the Activity view. */
export function NotificationInbox({
  filter,
  onFilterChange,
  notifications,
  isNotificationRead,
  onOpenNotification,
  onToggleNotificationRead,
  isLoading = false,
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
  headerActions?: ReactNode
  errorMessage?: string | null
}) {
  const filteredNotifications = useMemo(() => {
    if (filter === 'all') return notifications
    return notifications.filter((item) => !isNotificationRead(item))
  }, [filter, isNotificationRead, notifications])

  return (
    <div className="flex flex-col gap-4 p-4">
      <DocumentMaintenanceBanner />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <NotificationFilterTabs filter={filter} onFilterChange={onFilterChange} />
        {headerActions ? <div className="flex items-center gap-2">{headerActions}</div> : null}
      </div>

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
        <div className="flex flex-col gap-2">
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
    </div>
  )
}

/** The notification email settings both platforms share. Each platform loads them with its own hooks. */
export type NotificationEmailConfig = {
  email: string | null
  verifiedTime: string | null
  verificationSendTime: string | null
  verificationExpired: boolean
  /** Desktop only. False when the notification server can't be reached. */
  isNotifyServerConnected?: boolean
}

const emailSchema = z.string().email()

/** Gear button and popover for the notification email. */
export function NotificationEmailSettings({
  config,
  isLoading,
  onSave,
  onRemove,
  onResendVerification,
}: {
  config: NotificationEmailConfig | undefined
  isLoading: boolean
  onSave: (email: string) => Promise<{verified: boolean}>
  onRemove: () => Promise<unknown>
  onResendVerification: () => Promise<unknown>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [emailInput, setEmailInput] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isResending, setIsResending] = useState(false)

  const currentEmail = config?.email ?? null
  const needsVerification = Boolean(currentEmail && !config?.verifiedTime)
  const canResend = needsVerification && (config?.verificationExpired || !config?.verificationSendTime)
  const isConnected = config?.isNotifyServerConnected !== false
  const email = emailInput.trim()
  const isValid = email === '' || emailSchema.safeParse(email).success
  const canSave = isConnected && isValid && email !== (currentEmail ?? '') && !isSaving

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!canSave) return
    setIsSaving(true)
    try {
      if (email) {
        const {verified} = await onSave(email)
        toast.success(
          verified ? 'Email updated' : 'Confirmation email sent. Open the link in it to turn on notifications.',
        )
      } else {
        await onRemove()
        toast.success('Notification email removed')
      }
      setIsOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save the email')
    } finally {
      setIsSaving(false)
    }
  }

  async function resend() {
    setIsResending(true)
    try {
      await onResendVerification()
      toast.success('Confirmation email sent. Check your inbox.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not send the confirmation email')
    } finally {
      setIsResending(false)
    }
  }

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open)
        if (open) setEmailInput(currentEmail ?? '')
      }}
    >
      <Tooltip content="Email notifications">
        <PopoverTrigger asChild>
          <Button size="icon" variant="ghost" className="relative" aria-label="Email notifications">
            <Settings className="size-4" />
            {needsVerification ? (
              <>
                <span aria-hidden="true" className="absolute top-1 right-1 size-2 rounded-full bg-amber-500" />
                <span className="sr-only">Email waiting for confirmation</span>
              </>
            ) : null}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="flex w-80 flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <Text weight="semibold" size="lg">
            Email notifications
          </Text>
          <Button size="icon" variant="ghost" aria-label="Close" onClick={() => setIsOpen(false)}>
            <X className="size-4" />
          </Button>
        </div>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <form className="flex flex-col gap-4" onSubmit={save}>
            {!isConnected ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                You are not connected to the notification server.
              </p>
            ) : needsVerification ? (
              <div className="flex flex-col items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                <p>
                  {config?.verificationExpired
                    ? 'The confirmation link expired. Send a new one to turn on notifications.'
                    : config?.verificationSendTime
                      ? 'Open the confirmation link we emailed you to turn on notifications.'
                      : 'Notifications are paused until you confirm this email.'}
                </p>
                {canResend ? (
                  <Button type="button" size="sm" variant="outline" disabled={isResending} onClick={resend}>
                    {isResending ? 'Sending…' : 'Send confirmation email'}
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="notification-email">Your email</Label>
              <Input
                id="notification-email"
                type="email"
                placeholder="you@example.com"
                value={emailInput}
                onChangeText={setEmailInput}
                aria-invalid={!isValid}
                autoFocus
              />
              {!isValid ? <p className="text-destructive text-sm">Enter a valid email address.</p> : null}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" className="flex-1" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="brand" className="flex-1" disabled={!canSave}>
                {isSaving ? 'Saving…' : currentEmail ? 'Save' : 'Set email'}
              </Button>
            </div>
          </form>
        )}
      </PopoverContent>
    </Popover>
  )
}
