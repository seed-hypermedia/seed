import {AccountProfileDialog} from '@/frontend/components/AccountProfileDialog'
import {useActions, useAppState} from '@/frontend/store'
import {useEffect, useState} from 'react'

/** Dialog for creating a new Hypermedia account. */
export function CreateAccountDialog() {
  const {creatingAccount, loading, error, session, email} = useAppState()
  const actions = useActions()
  const [shareEmailWithNotificationServer, setShareEmailWithNotificationServer] = useState(true)
  const sessionEmail = session?.email?.trim() || email.trim()
  const notificationEmailLabel = sessionEmail ? `Notify me at ${sessionEmail}` : 'Notify me by email'

  useEffect(() => {
    if (!creatingAccount) {
      setShareEmailWithNotificationServer(true)
    }
  }, [creatingAccount])

  return (
    <AccountProfileDialog
      open={creatingAccount}
      onOpenChange={(open) => {
        if (!open) {
          setShareEmailWithNotificationServer(true)
        }
        actions.setCreatingAccount(open)
      }}
      title="Create Account"
      descriptionText="Create a new Hypermedia identity account."
      submitLabel="Create Account"
      loading={loading}
      error={error}
      notificationEmailOption={{
        label: notificationEmailLabel,
        description:
          'Leave this on to register notifications with that email. If you turn it off, the account will still be registered without an email address.',
        checked: shareEmailWithNotificationServer,
        onCheckedChange: setShareEmailWithNotificationServer,
      }}
      onSubmit={({name, description, avatarFile}) =>
        actions.createAccount(name, description, avatarFile, {
          notificationRegistration: {
            includeEmail: shareEmailWithNotificationServer,
          },
        })
      }
    />
  )
}
