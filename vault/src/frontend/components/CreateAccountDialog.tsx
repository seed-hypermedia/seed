import {AccountProfileDialog} from '@/frontend/components/AccountProfileDialog'
import {useActions, useAppState} from '@/frontend/store'

/** Dialog for creating a new Hypermedia account. */
export function CreateAccountDialog() {
  const {creatingAccount, loading, error} = useAppState()
  const actions = useActions()

  return (
    <AccountProfileDialog
      open={creatingAccount}
      onOpenChange={actions.setCreatingAccount}
      title="Create Account"
      descriptionText="Create a new Hypermedia identity account."
      submitLabel="Create Account"
      loading={loading}
      error={error}
      onSubmit={({name, description}) => actions.createAccount(name, description)}
    />
  )
}
