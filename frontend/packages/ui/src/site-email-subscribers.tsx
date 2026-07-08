import type {SiteEmailSubscriber} from '@shm/shared/models/notification-service'
import type {NavRoute} from '@shm/shared/routes'
import {useTxString} from '@shm/shared/translation'
import {formattedDateShort} from '@shm/shared/utils/date'
import {Mail} from 'lucide-react'
import type {MenuItemType} from './options-dropdown'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {cn} from './utils'

/**
 * Document-options menu entry that opens the site's email subscribers page.
 * Shared between the web and desktop document options menus.
 */
export function createEmailSubscribersMenuItem({
  navigate,
  accountUid,
}: {
  navigate: (route: NavRoute) => void
  accountUid?: string
}): MenuItemType {
  return {
    key: 'email-subscribers',
    label: 'Email Subscribers',
    icon: <Mail className="size-4" />,
    onClick: () => navigate({key: 'site-settings-emails', accountUid}),
  }
}

/**
 * Page body for the email subscribers page: heading, description, and either
 * a status message or the subscriber list. Shared between web and desktop;
 * the platform pages provide their own chrome and data fetching.
 */
export function SiteEmailSubscribersPanel({
  message,
  subscribers,
  isLoading,
  errorMessage,
}: {
  /** When set, shown instead of the list (sign-in / not-owner / unavailable states). */
  message?: string | null
  subscribers?: SiteEmailSubscriber[] | undefined
  isLoading?: boolean
  errorMessage?: string | null
}) {
  const tx = useTxString()
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8">
      <SizableText size="2xl" weight="bold" asChild>
        <h1>{tx('Email Subscribers')}</h1>
      </SizableText>
      <SizableText size="sm" className="text-muted-foreground">
        {tx('People who subscribed to receive updates from this site.')}
      </SizableText>
      {message ? (
        <SizableText className="text-muted-foreground">{message}</SizableText>
      ) : (
        <SiteEmailSubscribersList subscribers={subscribers} isLoading={!!isLoading} errorMessage={errorMessage} />
      )}
    </div>
  )
}

/**
 * Renders the list of emails subscribed to a site. Shared between the web
 * and desktop email subscribers pages.
 */
export function SiteEmailSubscribersList({
  subscribers,
  isLoading,
  errorMessage,
}: {
  subscribers: SiteEmailSubscriber[] | undefined
  isLoading: boolean
  errorMessage?: string | null
}) {
  const tx = useTxString()

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    )
  }

  if (errorMessage) {
    return <SizableText className="text-red-500">{errorMessage}</SizableText>
  }

  if (!subscribers?.length) {
    return <SizableText className="text-muted-foreground">{tx('No one has subscribed to this site yet.')}</SizableText>
  }

  const activeCount = subscribers.filter((s) => !s.isUnsubscribed).length

  return (
    <div className="flex flex-col gap-3">
      <SizableText size="sm" className="text-muted-foreground">
        {activeCount === 1 ? tx('1 subscriber') : `${activeCount} ${tx('subscribers')}`}
      </SizableText>
      <div className="border-border flex flex-col divide-y rounded-md border">
        {subscribers.map((subscriber) => (
          <div key={subscriber.email} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="flex flex-col">
              <SizableText
                weight="medium"
                className={cn(subscriber.isUnsubscribed && 'text-muted-foreground line-through')}
              >
                {subscriber.email}
              </SizableText>
              <SizableText size="xs" className="text-muted-foreground">
                {tx('Subscribed')} {formattedDateShort(subscriber.createdAt)}
              </SizableText>
            </div>
            <div className="flex items-center gap-2">
              {subscriber.isUnsubscribed ? (
                <SubscriberTag label={tx('Unsubscribed')} />
              ) : (
                <>
                  {subscriber.notifyOwnedDocChange && <SubscriberTag label={tx('Document Changes')} />}
                  {subscriber.notifySiteDiscussions && <SubscriberTag label={tx('Discussions')} />}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SubscriberTag({label}: {label: string}) {
  return (
    <SizableText size="xs" className="bg-muted text-muted-foreground rounded-full px-2 py-0.5">
      {label}
    </SizableText>
  )
}
