import {useFullRender} from '@/cache-policy'
import {loadSiteDocument, SiteDocumentPayload} from '@/loaders'
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
import {useEntity} from '@shm/shared/models/entity'
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
  const result = await loadSiteDocument(
    parsedRequest,
    hmId('d', registeredAccountUid, {path: [], latest: true}),
  )
  return result
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
      <WebSiteHeader
        homeMetadata={homeMetadata}
        originHomeId={originHomeId}
        docId={id}
        document={document}
        supportDocuments={supportDocuments}
        supportQueries={supportQueries}
        origin={origin}
      >
        <Container className="flex-1 gap-4 px-6">
          <EmailNotificationsContent />
        </Container>
      </WebSiteHeader>
      <PageFooter enableWebSigning={enableWebSigning} />
    </WebSiteProvider>
  )
}

export function EmailNotificationsContent() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const {data: notifSettings} = useEmailNotificationsWithToken(token)
  const {mutate: setEmailUnsubscribed} = useSetSubscription(token)
  if (!token) {
    return <SizableText>No token provided</SizableText>
  }

  console.log('notifSettings', notifSettings)
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
  const {data: entity} = useEntity(hmId('d', accountId))
  console.log('entity', entity?.document?.metadata)
  return (
    <div className="flex gap-2">
      {entity?.id ? (
        <HMIcon
          size={24}
          id={entity?.id}
          metadata={entity?.document?.metadata}
        />
      ) : null}
      <SizableText weight="bold">{entity?.document?.metadata.name}</SizableText>
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
  field: 'notifyAllMentions' | 'notifyAllReplies' | 'notifyOwnedDocChange'
  account: Email['accounts'][number]
}) {
  const {mutate: setAccount, isLoading} = useSetAccountOptions(token)
  return (
    <FullCheckbox
      paddingLeft={30}
      value={account[field]}
      onValue={() => {
        setAccount({accountId: account.id, [field]: !account[field]})
      }}
      isLoading={isLoading}
      label={label}
    />
  )
}
