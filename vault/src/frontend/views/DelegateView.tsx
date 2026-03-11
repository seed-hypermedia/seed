import {CreateAccountDialog} from '@/frontend/components/CreateAccountDialog'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import {
  getProfileAvatarImageSrc,
  getProfileDisplayName,
  type AccountProfileSummary,
  type ProfileLoadState,
} from '@/frontend/profile'
import {useActions, useAppState} from '@/frontend/store'
import * as blobs from '@shm/shared/blobs'
import * as hmauth from '@shm/shared/hmauth'
import {ExternalLink, Plus, Shield, User} from 'lucide-react'
import {useEffect} from 'react'
import {Navigate, useSearchParams} from 'react-router-dom'

function getProfileStatusTextClass(profileLoadState?: ProfileLoadState) {
  if (profileLoadState === 'not_found') return 'text-yellow-700 dark:text-yellow-400'
  if (profileLoadState === 'unavailable') return 'text-destructive'
  return ''
}

/**
 * Consent screen for delegating authority to a third-party site.
 * Shows the requesting origin, allows account selection, and lets the user
 * authorize or deny the delegation request.
 */
export function DelegateView() {
  const {
    delegationRequest,
    vaultData,
    selectedAccountIndex,
    creatingAccount,
    loading,
    error,
    profiles,
    profileLoadStates,
    backendHttpBaseUrl,
  } = useAppState()
  const actions = useActions()
  const [searchParams] = useSearchParams()

  const accounts = vaultData?.accounts ?? []

  useEffect(() => {
    accounts.forEach((account) => {
      const kp = blobs.nobleKeyPairFromSeed(account.seed)
      const principal = blobs.principalToString(kp.principal)
      actions.ensureProfileLoaded(principal)
    })
  }, [accounts, actions])

  if (!delegationRequest && !searchParams.has(hmauth.PARAM_CLIENT_ID)) {
    return <Navigate to="/" replace />
  }

  // URL has params but store hasn't synced yet — wait for the effect.
  if (!delegationRequest) {
    return null
  }

  const hasAccounts = accounts.length > 0

  if (!hasAccounts && vaultData) {
    return (
      <>
        <Card>
          <CardHeader>
            <div className="mb-2 flex items-center justify-center">
              <div className="bg-primary/10 flex size-12 items-center justify-center rounded-full">
                <User className="text-primary size-6" />
              </div>
            </div>
            <CardTitle className="text-center">No Accounts</CardTitle>
            <CardDescription className="text-center">
              You need to create an account before you can authorize access.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => actions.setCreatingAccount(true)}>
              <Plus className="size-4" />
              Create Account
            </Button>
          </CardContent>
        </Card>
        <CreateAccountDialog />
      </>
    )
  }

  const hasValidSelection = selectedAccountIndex >= 0 && selectedAccountIndex < accounts.length

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex items-center justify-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <Shield className="size-6 text-amber-600 dark:text-amber-400" />
          </div>
        </div>
        <CardTitle className="text-center">Authorize Access</CardTitle>
        <CardDescription className="text-center">
          <ExternalLink className="inline size-3.5 align-text-bottom" />{' '}
          <span className="text-foreground font-medium">{delegationRequest.clientId}</span> is requesting access to act
          on behalf of your account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!creatingAccount && <ErrorMessage message={error} />}

        {/* Account selection */}
        {accounts.length > 1 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Select an account</p>
            <div className="space-y-1">
              {accounts.map((account, index) => {
                const kp = blobs.nobleKeyPairFromSeed(account.seed)
                const principal = blobs.principalToString(kp.principal)
                const isSelected = index === selectedAccountIndex
                return (
                  <AccountSelectionItem
                    key={principal}
                    principal={principal}
                    profile={profiles[principal]}
                    profileLoadState={profileLoadStates[principal]}
                    backendHttpBaseUrl={backendHttpBaseUrl}
                    isSelected={isSelected}
                    onClick={() => actions.selectAccount(index)}
                  />
                )
              })}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <Button
            className="w-full"
            loading={loading}
            disabled={!hasValidSelection}
            onClick={actions.completeDelegation}
          >
            Authorize
          </Button>
          <Button variant="ghost" className="w-full" disabled={loading} onClick={actions.cancelDelegation}>
            Deny
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function AccountSelectionItem({
  principal,
  profile,
  profileLoadState,
  backendHttpBaseUrl,
  isSelected,
  onClick,
}: {
  principal: string
  profile?: AccountProfileSummary
  profileLoadState?: ProfileLoadState
  backendHttpBaseUrl: string
  isSelected: boolean
  onClick: () => void
}) {
  const name = getProfileDisplayName(profile, profileLoadState)
  const statusTextClass = getProfileStatusTextClass(profileLoadState)

  return (
    <button
      type="button"
      className={`flex w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
        isSelected ? 'border-primary bg-primary/5 ring-primary/20 ring-1' : 'hover:bg-muted/50 border-transparent'
      }`}
      onClick={onClick}
    >
      <div className="bg-primary/10 flex size-8 shrink-0 items-center justify-center rounded-full">
        {profile?.avatar ? (
          <img
            src={getProfileAvatarImageSrc(backendHttpBaseUrl, profile.avatar)}
            className="size-full object-cover"
            alt=""
          />
        ) : (
          <User className="text-primary size-4" />
        )}
      </div>
      <div className="min-w-0">
        <div className={`truncate text-sm font-medium ${statusTextClass}`}>{name}</div>
        <div className="text-muted-foreground truncate font-mono text-xs">{principal}</div>
      </div>
    </button>
  )
}
