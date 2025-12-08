import {SizableText} from '@shm/ui/text'

import type {Email} from '@/db'
import {
  useEmailNotificationsWithToken,
  useSetAccountOptions,
  useSetEmailUnsubscribed,
} from '@/email-notifications-token-models'
import {useSearchParams} from '@remix-run/react'
import {
  abbreviateUid,
  hmId,
  HMMetadata,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useResource} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {SwitchField} from '@shm/ui/form-fields'
import {HMIcon} from '@shm/ui/hm-icon'
import {Spinner} from '@shm/ui/spinner'

export default function EmailNotificationsPage() {
  return (
    <NotifySiteContainer>
      <EmailNotificationsContent />
    </NotifySiteContainer>
  )
}

function NotifySiteHeader() {
  return (
    <div className="flex flex-col gap-4 px-6 pt-8">
      <div className="flex items-center gap-2">
        <img
          src="/assets/seed-icon.svg"
          alt="Seed"
          className="h-6 w-6 flex-shrink-0 object-contain"
        />
        <h1 className="text-brand text-2xl font-bold">Seed Notify</h1>
      </div>
    </div>
  )
}

function NotifySiteContainer({children}: {children: React.ReactNode}) {
  return (
    <div className="bg-panel flex h-screen max-h-screen min-h-svh w-screen flex-col overflow-hidden">
      <NotifySiteHeader />
      <div className="dark:bg-background flex flex-1 gap-4 overflow-hidden overflow-y-auto bg-white px-6 py-8">
        <div className="flex flex-col gap-4">
          <div className="rounded-md border-1 p-4">{children}</div>
        </div>
      </div>
    </div>
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
            <h2 className="text-2xl font-bold">Notification Settings</h2>
            <p className="text-2xl text-gray-600">for {notifSettings.email}</p>
          </div>
          {notifSettings.isUnsubscribed ? (
            <>
              <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="font-bold text-red-700">
                  Unsubscribed from All Notifications
                </p>
                <SizableText className="mt-2 text-red-600">
                  You were subscribed to:
                </SizableText>
                <div className="mt-3 space-y-2">
                  {notifSettings.subscriptions.map((sub) => (
                    <LoadedAccountTitle key={sub.id} id={hmId(sub.id)} />
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

function LoadedAccountTitle({id}: {id: UnpackedHypermediaId}) {
  const {data: account} = useResource(id)
  if (!account) return null
  if (account.type !== 'document') return null
  return (
    <AccountTitle
      accountId={account.id}
      metadata={account.document?.metadata}
    />
  )
}

function AccountTitle({
  accountId,
  metadata,
}: {
  accountId: UnpackedHypermediaId
  metadata: HMMetadata
}) {
  const displayName = metadata?.name || abbreviateUid(accountId.uid)

  return (
    <div className="flex w-full items-center gap-2 border-t border-gray-300 pt-2">
      {accountId ? <HMIcon size={24} id={accountId} /> : null}
      <p className="text-lg font-bold">{displayName}</p>
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
  const {data: account} = useResource(hmId(subscription.id))
  if (!account) return null
  if (account.type !== 'document') return null
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <AccountTitle
          accountId={account.id}
          metadata={account.document?.metadata}
        />
      </div>

      <div className="space-y-6">
        <div className="space-y-3">
          <h4 className="font-bold text-gray-800">Site Activity</h4>
          <p className="text-sm text-gray-600">
            Get notified when something happens in{' '}
            {account.document?.metadata?.name}. Emails will be sent every 4
            hours at most.
          </p>
          <p className="text-sm text-gray-600">Notify me when:</p>
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

        <div className="space-y-3">
          <h4 className="font-bold text-gray-800">User Activity</h4>
          <p className="text-sm text-gray-600">
            Get notified about activity related to this user. Notify me
            immediately when:
          </p>
          <div className="space-y-3 pl-4">
            <AccountValueSwitch
              token={token}
              label="This user is mentioned"
              field="notifyAllMentions"
              subscription={subscription}
            />
            <AccountValueSwitch
              token={token}
              label="Someone replies to this user's comments"
              field="notifyAllReplies"
              subscription={subscription}
            />
            <AccountValueSwitch
              token={token}
              label="This user creates a comment"
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
