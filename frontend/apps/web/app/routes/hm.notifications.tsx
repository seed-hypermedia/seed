import {loadSiteHeaderData, SiteHeaderPayload} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {PageFooter} from '@/page-footer'
import {getOptimizedImageUrl, NavigationLoadingContent, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {WebSiteHeader} from '@/web-site-header'
import {unwrap} from '@/wrapping'
import {wrapJSON} from '@/wrapping.server'
import {LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {MetaDescriptor, useLoaderData} from '@remix-run/react'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {ClientOnly} from '@/client-lazy'
import {WebAccountFooter} from '@/web-utils'
import {Suspense} from 'react'
import {Spinner} from '@shm/ui/spinner'

type NotificationsPagePayload = SiteHeaderPayload

export const meta: MetaFunction = ({data}) => {
  const {homeMetadata} = unwrap<NotificationsPagePayload>(data)
  const meta: MetaDescriptor[] = []
  const homeIcon = homeMetadata?.icon ? getOptimizedImageUrl(extractIpfsUrlCid(homeMetadata.icon), 'S') : null
  meta.push({
    tagName: 'link',
    rel: 'icon',
    href: homeIcon || defaultSiteIcon,
    type: 'image/png',
  })
  meta.push({title: 'Notifications'})
  return meta
}

export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const headerData = await loadSiteHeaderData(parsedRequest)
  return wrapJSON(headerData satisfies NotificationsPagePayload)
}

export default function NotificationsRoute() {
  const {originHomeId, siteHost, origin, homeMetadata, dehydratedState} = unwrap<NotificationsPagePayload>(
    useLoaderData(),
  )
  if (!originHomeId) {
    return <h2>Invalid origin home id</h2>
  }
  return (
    <WebSiteProvider origin={origin} originHomeId={originHomeId} siteHost={siteHost} dehydratedState={dehydratedState}>
      <WebAccountFooter siteUid={originHomeId.uid} liftForPageFooter>
        <div className="flex min-h-screen flex-1 flex-col items-center">
          <WebSiteHeader
            homeMetadata={homeMetadata}
            originHomeId={originHomeId}
            siteHomeId={originHomeId}
            docId={null}
            origin={origin}
          />
          <NavigationLoadingContent className="flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-[var(--site-header-h)] sm:pt-0">
            <ClientOnly>
              <Suspense fallback={<Spinner />}>
                <WebNotificationsPage />
              </Suspense>
            </ClientOnly>
          </NavigationLoadingContent>
          <PageFooter hideDeviceLinkToast />
        </div>
      </WebAccountFooter>
    </WebSiteProvider>
  )
}

// Lazy-imported client component below
import {useLocalKeyPair} from '@/auth'
import {
  useWebAccountUid,
  useWebNotificationInbox,
  useWebNotificationReadState,
  useWebMarkNotificationEventRead,
  useWebMarkNotificationEventUnread,
  useWebMarkAllNotificationsRead,
} from '@/web-notifications'
import {isNotificationEventRead} from '@shm/shared/models/notification-read-logic'
import {
  getMaxLoadedNotificationEventAtMs,
  markNotificationReadAndNavigate,
} from '@shm/shared/models/notification-helpers'
import {NotificationListItem} from '@shm/ui/notification-list-item'
import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'
import {Bell} from 'lucide-react'
import {useMemo, useState, useCallback} from 'react'
import {routeToHref, useUniversalAppContext} from '@shm/shared'
import type {NavRoute} from '@shm/shared/routes'
import {useNavigate as useRemixNavigate} from '@remix-run/react'

/** Client-only notifications page content. */
function WebNotificationsPage() {
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
