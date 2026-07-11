import {useState} from 'react'
import * as navigation from '@/frontend/navigation'
import {Card, CardContent, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {StepIndicator} from '@/frontend/components/StepIndicator'
import {getPendingFlowPath, useActions, useAppState} from '@/frontend/store'
import {AccountProfileForm, type AccountProfileFormValues} from '@shm/ui/components/account-profile-form'

/**
 * View for creating a profile after account security setup (Step 3 of 3).
 */
export function CreateProfileView() {
  const {loading, error, delegationRequest, vaultConnectionRequest, vaultConnectionInProgress, session, email} =
    useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()

  const [shareEmailWithNotificationServer, setShareEmailWithNotificationServer] = useState(true)
  const sessionEmail = session?.email?.trim() || email.trim()
  const notificationEmailLabel = sessionEmail ? `Notify me at ${sessionEmail}` : 'Notify me by email'

  async function handleSubmit({name, imageFile}: AccountProfileFormValues) {
    const didCreateAccount = await actions.createAccount(name, undefined, imageFile, {
      notificationRegistration: {
        includeEmail: shareEmailWithNotificationServer,
      },
    })

    if (!didCreateAccount) {
      return
    }

    // The user already chose to sign in from the desktop app, so complete the
    // connection right away instead of asking them to confirm it again.
    if (vaultConnectionRequest && !delegationRequest) {
      const didConnect = await actions.completeVaultConnection()
      if (!didConnect) {
        navigate('/connect')
      }
      return
    }

    navigate(getPendingFlowPath({delegationRequest, vaultConnectionRequest}))
  }

  return (
    <Card>
      <CardHeader>
        <StepIndicator currentStep={3} />
        <CardTitle className="text-left text-xl">Create your profile</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-6 text-sm">Add a name and photo so people recognize you.</p>

        <AccountProfileForm
          showDescription={false}
          submitLabel="Start participating"
          loading={loading || vaultConnectionInProgress}
          error={error}
          notificationOption={{
            label: notificationEmailLabel,
            description:
              'Leave this on to register notifications with that email. If you turn it off, your account will still be registered without an email address.',
            checked: shareEmailWithNotificationServer,
            onCheckedChange: setShareEmailWithNotificationServer,
          }}
          onSubmit={handleSubmit}
        />
      </CardContent>
    </Card>
  )
}
