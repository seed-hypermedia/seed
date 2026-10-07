import {useState} from 'react'
import * as navigation from '@/frontend/navigation'
import {Card, CardContent, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {FlowHeader} from '@/frontend/components/FlowHeader'
import {getPendingFlowPath, useActions, useAppState} from '@/frontend/store'
import {AccountProfileForm, type AccountProfileFormValues} from '@shm/ui/components/account-profile-form'

/**
 * View for creating a profile after account security setup (Step 4 of 4).
 */
export function CreateProfileView() {
  const {loading, error, delegationRequest, vaultConnectionRequest, vaultConnectionInProgress} = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()

  const [shareEmailWithNotificationServer, setShareEmailWithNotificationServer] = useState(true)

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

    // The user just created their only account in this flow, so there is
    // nothing to choose or confirm — complete the delegation right away.
    // (Signing in with an existing account still shows the confirmation step.)
    if (delegationRequest) {
      const didDelegate = await actions.completeDelegation()
      if (!didDelegate) {
        // Show the confirmation screen with the error.
        navigate('/delegate')
      }
      return
    }

    navigate(getPendingFlowPath({delegationRequest, vaultConnectionRequest}))
  }

  return (
    <Card>
      <CardHeader>
        <FlowHeader step={4} />
        <CardTitle className="text-left text-xl">Create your profile</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground mb-6 text-sm">We are almost there. Add a name and a photo.</p>

        <AccountProfileForm
          showDescription={false}
          submitLabel="Create profile"
          loading={loading || vaultConnectionInProgress}
          error={error}
          notificationOption={{
            label: 'Get email notifications about mentions and replies activity.',
            description: '',
            checked: shareEmailWithNotificationServer,
            onCheckedChange: setShareEmailWithNotificationServer,
          }}
          onSubmit={handleSubmit}
        />
      </CardContent>
    </Card>
  )
}
