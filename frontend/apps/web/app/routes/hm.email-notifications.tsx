import {getDaemonAuthToken, withDaemonAuthToken} from '@/daemon-auth.server'
import {
  useEmailNotificationsWithToken,
  useSetAccountOptions,
  useSetEmailUnsubscribed,
  useUnsubscribeMyNotification,
  type EmailNotifTokenLoaderResponse,
} from '@/email-notifications-token-models'
import {loadSiteHeaderData} from '@/loaders'
import {defaultSiteIcon} from '@/meta'
import {getOptimizedImageUrl, WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {HeadersFunction, json, LoaderFunctionArgs, MetaFunction} from '@remix-run/node'
import {useLoaderData, useSearchParams} from '@remix-run/react'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {abbreviateUid, hmId, hostnameStripProtocol} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {SwitchField} from '@shm/ui/form-fields'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {HMIcon} from '@shm/ui/hm-icon'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'

// The page URL carries an email admin token; never leak it to other origins.
export const headers: HeadersFunction = () => ({'Referrer-Policy': 'no-referrer'})

export const meta: MetaFunction<typeof loader> = ({data}) => {
  const homeIcon = data?.siteIcon ? getOptimizedImageUrl(extractIpfsUrlCid(data.siteIcon), 'S') : null
  return [
    {title: 'Email Notification Settings'},
    {name: 'referrer', content: 'no-referrer'},
    {name: 'robots', content: 'noindex'},
    {tagName: 'link', rel: 'icon', href: homeIcon || defaultSiteIcon, type: 'image/png'},
  ]
}

// Open on members-only sites (token holders need not be members), so this only
// exposes what the sign-in page already does: the site's name and icon.
export const loader = async ({request}: LoaderFunctionArgs) => {
  const parsedRequest = parseRequest(request)
  const authToken = await getDaemonAuthToken(request)
  return withDaemonAuthToken(authToken, async () => {
    const {homeMetadata, origin, siteHost, originHomeId} = await loadSiteHeaderData(parsedRequest)
    return json({
      siteName: homeMetadata?.name || hostnameStripProtocol(origin),
      siteIcon: homeMetadata?.icon || null,
      siteUid: originHomeId?.uid ?? null,
      origin,
      siteHost,
    })
  })
}

export default function EmailNotificationsPage() {
  const {siteName, siteUid, origin, siteHost} = useLoaderData<typeof loader>()
  return (
    <WebSiteProvider origin={origin} siteHost={siteHost} originHomeId={siteUid ? hmId(siteUid) : undefined}>
      <div className="flex min-h-screen flex-col items-center px-4 py-12">
        <div className="bg-card text-card-foreground flex w-full max-w-2xl flex-col gap-6 rounded-xl border p-8 shadow-sm">
          <SizableText color="muted" size="sm">
            {siteName}
          </SizableText>
          <EmailNotificationsContent />
        </div>
      </div>
    </WebSiteProvider>
  )
}

function EmailNotificationsContent() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const {data: notifSettings, isLoading, error} = useEmailNotificationsWithToken(token)
  const {mutate: setEmailUnsubscribed} = useSetEmailUnsubscribed(token)
  if (!token) {
    return <SizableText>No token provided</SizableText>
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center">
        <Spinner />
        <SizableText className="ml-2">Loading notification settings…</SizableText>
      </div>
    )
  }

  if (error) {
    return (
      <SizableText color="destructive">
        Error loading notification settings: {error instanceof Error ? error.message : String(error)}
      </SizableText>
    )
  }
  if (!notifSettings) {
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-2xl font-bold">Notification Settings</h2>
        <p className="text-muted-foreground text-xl">for {notifSettings.email}</p>
      </div>
      {notifSettings.isUnsubscribed ? (
        <>
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950">
            <p className="font-bold text-red-700 dark:text-red-300">Unsubscribed from All Notifications</p>
            <SizableText className="mt-2 text-red-600 dark:text-red-300">You were subscribed to:</SizableText>
            <div className="mt-3 space-y-2">
              {notifSettings.subscriptions.map((sub) => (
                <AccountTitle key={sub.id} accountId={hmId(sub.id)} />
              ))}
            </div>
          </div>
          <MyNotificationsSection myNotifications={notifSettings.myNotifications} token={token} />
          <Button variant="default" onClick={() => setEmailUnsubscribed(false)}>
            Re-Enable Notifications
          </Button>
        </>
      ) : (
        <>
          <div className="space-y-6">
            {notifSettings.subscriptions.length ? (
              notifSettings.subscriptions.map((sub) => (
                <EmailNotificationSubscription key={sub.id} subscription={sub} token={token} />
              ))
            ) : (
              <p className="text-muted-foreground text-sm">No space subscriptions configured for this email yet.</p>
            )}
            <MyNotificationsSection myNotifications={notifSettings.myNotifications} token={token} />
          </div>

          <div className="border-t pt-4">
            <Button variant="destructive" onClick={() => setEmailUnsubscribed(true)}>
              Unsubscribe from all Notifications
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function MyNotificationsSection({
  myNotifications,
  token,
}: {
  myNotifications: EmailNotifTokenLoaderResponse['myNotifications']
  token: string
}) {
  if (!myNotifications.length) return null
  return (
    <div className="space-y-3 border-t pt-4">
      <h4 className="font-bold">My Notifications</h4>
      <p className="text-muted-foreground text-sm">
        These accounts are configured via signed account settings and receive immediate mention/reply notifications.
      </p>
      <div className="space-y-2">
        {myNotifications.map((config) => (
          <MyNotificationConfigRow
            key={`notification-config-${config.accountId}`}
            accountId={config.accountId}
            token={token}
          />
        ))}
      </div>
    </div>
  )
}

function MyNotificationConfigRow({accountId, token}: {accountId: string; token: string}) {
  const {mutate: unsubscribeMyNotification, isLoading} = useUnsubscribeMyNotification(token)
  return (
    <div className="flex items-center gap-3">
      <AccountTitle accountId={hmId(accountId)} />
      <Button variant="outline" size="sm" disabled={isLoading} onClick={() => unsubscribeMyNotification(accountId)}>
        {isLoading ? 'Removing…' : 'Unsubscribe'}
      </Button>
    </div>
  )
}

/** Name of the account, falling back to its abbreviated id when this site cannot load it (e.g. members-only). */
function useAccountName(accountId: UnpackedHypermediaId) {
  const {data: resource} = useResource(accountId)
  const metadata = resource?.type === 'document' ? resource.document?.metadata : undefined
  return {name: metadata?.name || abbreviateUid(accountId.uid), icon: metadata?.icon}
}

function AccountTitle({accountId}: {accountId: UnpackedHypermediaId}) {
  const {name, icon} = useAccountName(accountId)
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 border-t pt-2">
      <HMIcon size={24} id={accountId} icon={icon} />
      <p className="truncate text-lg font-bold">{name}</p>
    </div>
  )
}

function EmailNotificationSubscription({
  subscription,
  token,
}: {
  subscription: EmailNotifTokenLoaderResponse['subscriptions'][number]
  token: string
}) {
  const accountId = hmId(subscription.id)
  const {name} = useAccountName(accountId)
  return (
    <div className="flex flex-col gap-4">
      <AccountTitle accountId={accountId} />
      <div className="space-y-3">
        <h4 className="font-bold">Space Activity</h4>
        <p className="text-muted-foreground text-sm">
          Get notified when something happens in {name}. Emails will be sent every 4 hours at most.
        </p>
        <p className="text-muted-foreground text-sm">Notify me when:</p>
        <div className="space-y-3 pl-4">
          <AccountValueSwitch
            token={token}
            label="A Document is Created or Updated"
            field="notifyOwnedDocChange"
            subscription={subscription}
          />
          <AccountValueSwitch
            token={token}
            label="A Discussion is Created"
            field="notifySiteDiscussions"
            subscription={subscription}
          />
        </div>
      </div>
    </div>
  )
}

function AccountValueSwitch({
  token,
  label,
  field,
  subscription,
}: {
  token: string
  label: string
  field: 'notifyOwnedDocChange' | 'notifySiteDiscussions'
  subscription: EmailNotifTokenLoaderResponse['subscriptions'][number]
}) {
  const {mutate: setAccount, isLoading} = useSetAccountOptions(token)
  return (
    <SwitchField
      id={`${subscription.id}-${field}`}
      label={label}
      checked={subscription[field]}
      onCheckedChange={(checked) => {
        setAccount({
          accountId: subscription.id,
          [field]: checked,
        })
      }}
      disabled={isLoading}
    />
  )
}
