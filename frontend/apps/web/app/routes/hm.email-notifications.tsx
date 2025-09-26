import {useFullRender} from '@/cache-policy'
import {loadSiteResource, SiteDocumentPayload} from '@/loaders'
import {queryAPI} from '@/models'
import {PageFooter} from '@/page-footer'
import {WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config.server'
import {WebSiteHeader} from '@/web-site-header'
import {unwrap} from '@/wrapping'
import {useLoaderData} from '@remix-run/react'
import {hmId} from '@shm/shared'
import {SizableText} from '@shm/ui/text'
import {Container} from '../ui/container'

import type {Email} from '@/db'
import {
  useEmailNotificationsWithToken,
  useSetAccountOptions,
  useSetEmailUnsubscribed,
} from '@/email-notifications-token-models'
import {useSearchParams} from '@remix-run/react'
import {Button} from '@shm/ui/button'
import {SwitchField} from '@shm/ui/form-fields'
import {HMIcon} from '@shm/ui/hm-icon'
import {Spinner} from '@shm/ui/spinner'
import {useEffect, useState} from 'react'

export const loader = async ({request}: {request: Request}) => {
  const parsedRequest = parseRequest(request)
  if (!useFullRender(parsedRequest)) return null
  const {hostname} = parsedRequest
  const serviceConfig = await getConfig(hostname)
  if (!serviceConfig) throw new Error(`No config defined for ${hostname}`)
  const {registeredAccountUid} = serviceConfig
  if (!registeredAccountUid)
    throw new Error(`No registered account uid defined for ${hostname}`)

  // Load the site resource for the header/footer, but don't fail if it doesn't exist
  try {
    return await loadSiteResource(
      parsedRequest,
      hmId(registeredAccountUid, {path: [], latest: true}),
    )
  } catch (error) {
    console.warn(
      'Failed to load site resource for email notifications page:',
      error,
    )
    // Return minimal data structure for the page to work
    return {
      originHomeId: hmId(registeredAccountUid),
      siteHost: hostname,
      homeMetadata: null,
      id: null,
      document: null,
      supportDocuments: [],
      supportQueries: [],
      origin: `http://${hostname}`,
      enableWebSigning: false,
    }
  }
}

export default function EmailNotificationsPage() {
  const data = unwrap<SiteDocumentPayload>(useLoaderData())
  const {
    originHomeId,
    siteHost,
    homeMetadata,
    id,
    document,
    supportDocuments,
    supportQueries,
    origin,
  } = data
  return (
    <WebSiteProvider
      origin={origin}
      originHomeId={originHomeId}
      siteHost={siteHost}
    >
      <div className="bg-panel flex h-screen max-h-screen min-h-svh w-screen flex-col overflow-hidden">
        <WebSiteHeader
          homeMetadata={homeMetadata}
          originHomeId={originHomeId}
          docId={id}
          document={document}
          supportDocuments={supportDocuments}
          supportQueries={supportQueries}
          origin={origin}
        />
        <div className="dark:bg-background flex flex-1 overflow-hidden bg-white">
          <Container className="flex-1 gap-4 overflow-y-auto px-6 py-8">
            <EmailNotificationsContent />
          </Container>
        </div>
        <PageFooter />
      </div>
    </WebSiteProvider>
  )
}

export function EmailNotificationsContent() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const {
    data: notifSettings,
    isLoading,
    error,
  } = useEmailNotificationsWithToken(token)
  const {mutate: setEmailUnsubscribed} = useSetEmailUnsubscribed(token)
  const {mutate: setAccountOptions} = useSetAccountOptions(token)
  if (!token) {
    return <SizableText>No token provided</SizableText>
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center">
        <Spinner />
        <SizableText className="ml-2">
          Loading notification settings...
        </SizableText>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-red-600">
        <SizableText>
          Error loading notification settings: {String(error)}
        </SizableText>
      </div>
    )
  }
  return (
    <div className="flex max-w-2xl flex-col gap-6">
      {notifSettings ? (
        <>
          <div className="flex flex-col gap-1">
            <p className="text-sm text-gray-600">{notifSettings.email}</p>
            <h2 className="text-2xl font-bold">Set Up Email Notifications</h2>
          </div>
          {notifSettings.isUnsubscribed ? (
            <>
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="font-medium text-red-700">
                  Unsubscribed from All Notifications
                </p>
                <SizableText className="mt-2 text-red-600">
                  You can enable notifications for the following sites:
                </SizableText>
                <div className="mt-3 space-y-2">
                  {notifSettings.subscriptions.map((sub) => (
                    <AccountTitle key={sub.id} accountId={sub.id} />
                  ))}
                </div>
              </div>
              <Button
                variant="default"
                onClick={() => {
                  setEmailUnsubscribed(false)
                }}
              >
                Re-Enable Notifications
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-6">
                <div className="space-y-4">
                  <SwitchField
                    id="all-notifications"
                    label="Enable All Notifications"
                    checked={notifSettings.subscriptions.every(
                      (sub) =>
                        sub.notifyOwnedDocChange &&
                        sub.notifySiteDiscussions &&
                        sub.notifyAllMentions &&
                        sub.notifyAllReplies &&
                        sub.notifyAllComments,
                    )}
                    onCheckedChange={(checked) => {
                      // Set all subscriptions to the same value
                      notifSettings.subscriptions.forEach((sub) => {
                        setAccountOptions({
                          accountId: sub.id,
                          notifyOwnedDocChange: checked === true,
                          notifySiteDiscussions: checked === true,
                          notifyAllMentions: checked === true,
                          notifyAllReplies: checked === true,
                          notifyAllComments: checked === true,
                        })
                      })
                    }}
                  />
                  <p className="ml-0 text-sm text-gray-600">
                    Enable all notification types for all subscribed sites and
                    users. You can customize individual settings below.
                  </p>
                </div>

                {notifSettings.subscriptions.map((sub) => (
                  <EmailNotificationSubscription
                    key={sub.id}
                    subscription={sub}
                    token={token}
                  />
                ))}
              </div>

              <div className="border-t pt-4">
                <Button
                  variant="destructive"
                  onClick={() => {
                    setEmailUnsubscribed(true)
                  }}
                >
                  Unsubscribe from all Notifications
                </Button>
              </div>
            </>
          )}
        </>
      ) : (
        <div className="flex items-center justify-center">
          <Spinner />
        </div>
      )}
    </div>
  )
}

function AccountTitle({accountId}: {accountId: string}) {
  const [accountData, setAccountData] = useState<{
    id: any
    metadata: any
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadAccount() {
      try {
        const response = (await queryAPI(`/hm/api/account/${accountId}`)) as any
        setAccountData(response)
      } catch (error) {
        console.error('Error loading account:', error)
      } finally {
        setLoading(false)
      }
    }
    loadAccount()
  }, [accountId])

  const displayName =
    accountData?.metadata?.name || accountId.slice(0, 8) + '...'

  if (loading) {
    return (
      <div className="flex gap-2">
        <SizableText weight="bold">{accountId.slice(0, 8)}...</SizableText>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      {accountData?.id ? <HMIcon size={24} id={accountData.id} /> : null}
      <SizableText weight="bold">{displayName}</SizableText>
    </div>
  )
}

function EmailNotificationSubscription({
  subscription,
  token,
}: {
  subscription: Email['subscriptions'][number]
  token: string
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <AccountTitle accountId={subscription.id} />
      </div>

      <div className="space-y-6">
        <div className="space-y-3">
          <h4 className="font-medium text-gray-900">Site Activity</h4>
          <p className="text-sm text-gray-600">
            Get notified about activity happening on this site.
          </p>
          <div className="space-y-3 pl-4">
            <AccountValueSwitch
              token={token}
              label="Document changes on this site"
              field="notifyOwnedDocChange"
              subscription={subscription}
            />
            <AccountValueSwitch
              token={token}
              label="New comments on this site"
              field="notifySiteDiscussions"
              subscription={subscription}
            />
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="font-medium text-gray-900">User Activity</h4>
          <p className="text-sm text-gray-600">
            Get notified about activity related to this user.
          </p>
          <div className="space-y-3 pl-4">
            <AccountValueSwitch
              token={token}
              label="When this user is mentioned"
              field="notifyAllMentions"
              subscription={subscription}
            />
            <AccountValueSwitch
              token={token}
              label="When someone replies to this user's comments"
              field="notifyAllReplies"
              subscription={subscription}
            />
            <AccountValueSwitch
              token={token}
              label="When this user makes comments"
              field="notifyAllComments"
              subscription={subscription}
            />
          </div>
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
  field:
    | 'notifyOwnedDocChange'
    | 'notifySiteDiscussions'
    | 'notifyAllMentions'
    | 'notifyAllReplies'
    | 'notifyAllComments'
  subscription: Email['subscriptions'][number]
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
