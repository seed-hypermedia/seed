import {Button} from '@/frontend/components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/frontend/components/ui/card'
import * as navigation from '@/frontend/navigation'
import {useActions, useAppState} from '@/frontend/store'
import * as blobs from '@shm/shared/blobs'
import {useEffect, useMemo} from 'react'

/**
 * Shown after the desktop app has been linked with this vault.
 */
export function ConnectSuccessView() {
  const navigate = navigation.useHashNavigate()
  const actions = useActions()
  const {vaultData, selectedAccountIndex, profiles} = useAppState()

  // Prefer the account the user is working with; fall back to the first one.
  const principal = useMemo(() => {
    const accounts = vaultData?.accounts ?? []
    const account = accounts[selectedAccountIndex] ?? accounts[0]
    if (!account) return null
    const kp = blobs.nobleKeyPairFromSeed(account.seed)
    return blobs.principalToString(kp.principal)
  }, [vaultData, selectedAccountIndex])

  useEffect(() => {
    if (principal) void actions.ensureProfileLoaded(principal)
  }, [principal, actions])

  const name = principal ? profiles[principal]?.name : undefined

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-left text-2xl font-bold">
          {name ? `You're all set, ${name}` : "You're all set"}
        </CardTitle>
        <CardDescription className="text-left">Time to build knowledge, share and create discussions.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-muted-foreground text-sm">
          Your identity settings are always available in{' '}
          <button
            type="button"
            className="text-blue-600 underline-offset-4 hover:underline dark:text-blue-400"
            onClick={() => navigate('/')}
          >
            account settings.
          </button>
        </p>
        <Button
          className="w-full bg-green-700 text-white shadow-xs hover:bg-green-800"
          onClick={() => {
            // The desktop app registers the hm:// scheme and hm://open
            // brings it to the front.
            window.location.href = 'hm://open'
          }}
        >
          Open Seed
        </Button>
      </CardContent>
    </Card>
  )
}
