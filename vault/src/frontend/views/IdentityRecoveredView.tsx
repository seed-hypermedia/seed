import {AccountSelectionItem} from '@/frontend/components/AccountSelectionItem'
import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent} from '@/frontend/components/ui/card'
import * as navigation from '@/frontend/navigation'
import {getProfileDisplayName} from '@/frontend/profile'
import {getPendingFlowPath, useActions, useAppState} from '@/frontend/store'
import * as blobs from '@shm/shared/blobs'
import {Check} from 'lucide-react'
import {useEffect, useMemo} from 'react'
import {useSearchParams} from 'react-router-dom'

/**
 * Success shown after signing in with recovery words, with account picker.
 */
export function IdentityRecoveredView() {
  const {
    vaultData,
    selectedAccountIndex,
    profiles,
    profileLoadStates,
    backendHttpBaseUrl,
    delegationRequest,
    vaultConnectionRequest,
  } = useAppState()
  const actions = useActions()
  const navigate = navigation.useHashNavigate()
  const [searchParams] = useSearchParams()
  const next = searchParams.get('next')
  const returnToPath = next?.startsWith('/') && !next.startsWith('//') ? next : undefined

  const principals = useMemo(
    () =>
      (vaultData?.accounts ?? []).map((account) =>
        blobs.principalToString(blobs.nobleKeyPairFromSeed(account.seed).principal),
      ),
    [vaultData],
  )

  useEffect(() => {
    principals.forEach((principal) => actions.ensureProfileLoaded(principal))
  }, [principals, actions])

  useEffect(() => {
    if (principals.length > 0 && (selectedAccountIndex < 0 || selectedAccountIndex >= principals.length)) {
      actions.selectAccount(0)
    }
  }, [principals.length, selectedAccountIndex, actions])

  const selectedPrincipal = principals[selectedAccountIndex]
  const selectedName = selectedPrincipal
    ? getProfileDisplayName(profiles[selectedPrincipal], profileLoadStates[selectedPrincipal])
    : null

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-6 py-6">
        <div className="bg-brand/15 flex size-14 items-center justify-center rounded-full">
          <Check className="text-brand size-7" />
        </div>
        <h2 className="text-center text-xl font-bold">
          Your identity is recovered.
          {principals.length > 1 ? (
            <>
              <br />
              Which account would you like to use?
            </>
          ) : null}
        </h2>

        {/* Only ask which account when there's a choice. */}
        {principals.length > 1 ? (
          <div className="w-full space-y-1">
            {principals.map((principal, index) => (
              <AccountSelectionItem
                key={principal}
                profile={profiles[principal]}
                profileLoadState={profileLoadStates[principal]}
                backendHttpBaseUrl={backendHttpBaseUrl}
                isSelected={index === selectedAccountIndex}
                onClick={() => actions.selectAccount(index)}
              />
            ))}
          </div>
        ) : null}

        <Button
          className="w-full"
          onClick={() => navigate(getPendingFlowPath({delegationRequest, vaultConnectionRequest, returnToPath}))}
        >
          {selectedName ? `Continue as ${selectedName}` : 'Continue'}
        </Button>
      </CardContent>
    </Card>
  )
}
