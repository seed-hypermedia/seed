import {useFullRender} from '@/cache-policy'
import {loadSiteResource, SiteDocumentPayload} from '@/loaders'
import {PageFooter} from '@/page-footer'
import {WebSiteProvider} from '@/providers'
import {parseRequest} from '@/request'
import {getConfig} from '@/site-config'
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
  useSetSubscription,
} from '@/email-notifications-token-models'
import {useSearchParams} from '@remix-run/react'
import {useResource} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {FullCheckbox} from '@shm/ui/form-input'
import {HMIcon} from '@shm/ui/hm-icon'
import {Spinner} from '@shm/ui/spinner'

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
    enableWebSigning,
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
          <Container className="flex-1 gap-4 px-6 py-8">
            <EmailNotificationsContent />
          </Container>
        </div>
        <PageFooter enableWebSigning={enableWebSigning} />
      </div>
    </WebSiteProvider>
  )
}

export function EmailNotificationsContent() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const {mutate: setEmailUnsubscribed} = useSetSubscription(token)
  const {
    data: notifSettings,
    isLoading,
    error,
  } = useEmailNotificationsWithToken(token)

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
    <div className="flex flex-col gap-5">
      {notifSettings ? (
        <>
          <div className="flex flex-col gap-1">
            <p>{notifSettings.email}</p>
            <h2 className="text-2xl font-bold">Email Notification Settings</h2>
          </div>
          {notifSettings.isUnsubscribed ? (
            <>
              <p className="text-red-600">
                Unsubscribed from All Notifications
              </p>
              <SizableText>
                You can enable notifications for the following accounts:
              </SizableText>
              {notifSettings.accounts.map((account) => (
                <AccountTitle key={account.id} accountId={account.id} />
              ))}
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
              {notifSettings.accounts.map((account) => (
                <EmailNotificationAccount
                  key={account.id}
                  account={account}
                  token={token}
                />
              ))}
              <Button
                variant="destructive"
                onClick={() => {
                  setEmailUnsubscribed(true)
                }}
              >
                Unsubscribe from all Notifications
              </Button>
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
  const {data: entity} = useResource(hmId(accountId))
  const document = entity?.type === 'document' ? entity.document : undefined
  return (
    <div className="flex gap-2">
      {entity?.id ? (
        <HMIcon size={24} id={entity?.id} metadata={document?.metadata} />
      ) : null}
      <SizableText weight="bold">{document?.metadata.name}</SizableText>
    </div>
  )
}

function EmailNotificationAccount({
  account,
  token,
}: {
  account: Email['accounts'][number]
  token: string
}) {
  return (
    <div className="flex flex-col gap-3">
      <AccountTitle accountId={account.id} />
      <AccountValueCheckbox
        token={token}
        label="Notify on all mentions"
        field="notifyAllMentions"
        account={account}
      />
      <AccountValueCheckbox
        token={token}
        label="Notify on all replies"
        field="notifyAllReplies"
        account={account}
      />
      <AccountValueCheckbox
        token={token}
        label="Notify on owned document changes"
        field="notifyOwnedDocChange"
        account={account}
      />
      <AccountValueCheckbox
        token={token}
        label="Notify on created discussions in your site"
        field="notifySiteDiscussions"
        account={account}
      />
    </div>
  )
}

function AccountValueCheckbox({
  token,
  label,
  field,
  account,
}: {
  token: string
  label: string
  field:
    | 'notifyAllMentions'
    | 'notifyAllReplies'
    | 'notifyOwnedDocChange'
    | 'notifySiteDiscussions'
  account: Email['accounts'][number]
}) {
  const {mutate: setAccount, isLoading} = useSetAccountOptions(token)
  return (
    <FullCheckbox
      paddingLeft={30}
      // @ts-expect-error
      value={account[field]}
      onValue={() => {
        setAccount({accountId: account.id, [field]: !account[field]})
      }}
      isLoading={isLoading}
      label={label}
    />
  )
}
