import {
  invalidateVaultDependentQueries,
  useMyAccountIds,
  useStartVaultConnection,
  useVaultStatus,
} from '@/models/daemon'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useOpenUrl} from '@/open-url'
import {client} from '@/trpc'
import {syncRemoteSignInSiteHomes} from '@/utils/create-site'
import {buildVaultConnectionURL, normalizeVaultOriginURL} from '@/utils/vault-connection'
import {useUniversalAppContext} from '@shm/shared'
import {VaultConnectionStatus} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'
import {DAEMON_HTTP_URL, DEFAULT_DESKTOP_VAULT_URL, DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useStream} from '@shm/shared/use-stream'
import {Button} from '@shm/ui/button'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {CreateAccountDialogContent, type CreateAccountDialogSubmit} from '@shm/ui/create-account-dialog'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react'

type DesktopAuthDialogInput = {
  initialSubmit?: CreateAccountDialogSubmit
  initialStep?: 'main' | 'custom-identity'
  onReady?: (accountUid: string) => void | Promise<void>
}

function DesktopAuthDialogContent({
  input,
  onClose,
  setDialogCloseProtection,
}: {
  input: DesktopAuthDialogInput
  onClose: () => void
  setDialogCloseProtection?: (state: {preventClose: boolean; showCloseButton: boolean}) => void
}) {
  const gatewayUrl = useGatewayUrl()
  const startVaultConnection = useStartVaultConnection()
  const openUrl = useOpenUrl()
  const {selectedIdentity, setSelectedIdentity} = useUniversalAppContext()
  const selectedIdentityValue = useStream(selectedIdentity)
  const [browserUrl, setBrowserUrl] = useState('')
  const vaultStatus = useVaultStatus({
    refetchInterval: browserUrl ? 2_000 : 10_000,
  })
  const accountIds = useMyAccountIds()
  const defaultVaultUrl = DEFAULT_DESKTOP_VAULT_URL || `${gatewayUrl.data || DEFAULT_GATEWAY_URL}/vault`
  const isConnected = vaultStatus.data?.connectionStatus === VaultConnectionStatus.CONNECTED
  const hasAccounts = !!accountIds.data?.length
  const isReady = isConnected && hasAccounts
  const handledReadyRef = useRef(false)
  const handledInitialSubmitRef = useRef(false)

  useLayoutEffect(() => {
    const preventClose = !!input.initialSubmit || !!browserUrl
    setDialogCloseProtection?.({preventClose, showCloseButton: !preventClose})
  }, [browserUrl, input.initialSubmit, setDialogCloseProtection])

  useEffect(() => {
    if (!browserUrl || isReady) return
    vaultStatus.refetch()
    accountIds.refetch()
    const interval = setInterval(() => {
      vaultStatus.refetch()
      accountIds.refetch()
    }, 500)
    return () => clearInterval(interval)
  }, [browserUrl, isReady, vaultStatus.refetch, accountIds.refetch])

  useEffect(() => {
    if (!isConnected) return
    invalidateVaultDependentQueries()
  }, [isConnected])

  useEffect(() => {
    const firstAccountId = accountIds.data?.[0]
    if (!isReady || !firstAccountId || handledReadyRef.current) return
    handledReadyRef.current = true
    const readyAccountId = firstAccountId

    async function finishRemoteSignIn() {
      onClose()
      if (browserUrl && accountIds.data?.length) {
        const toastId = toast.loading('Preparing your account…')
        try {
          await syncRemoteSignInSiteHomes(accountIds.data)
          toast.dismiss(toastId)
        } catch (error) {
          toast.error('Could not sync your content. Connect to the internet and try again.', {id: toastId})
          throw error
        }
      }
      if (!selectedIdentityValue) {
        setSelectedIdentity?.(readyAccountId)
      }
      client.selectIdentityForWindowsWithoutAccount.mutate(readyAccountId).catch((error) => {
        console.error('Failed to select remote vault account for windows', error)
      })
      await input.onReady?.(readyAccountId)
      if (!input.onReady) toast.success('Authenticated')
    }

    finishRemoteSignIn().catch((error) => {
      handledReadyRef.current = false
      console.error('Failed to finish remote vault sign-in', error)
    })
  }, [accountIds.data, browserUrl, input, isReady, onClose, selectedIdentityValue, setSelectedIdentity])

  const handleSubmit = useCallback(
    async (input: CreateAccountDialogSubmit) => {
      const rawVaultUrl = input.type === 'custom-id-server' ? input.url : defaultVaultUrl
      let normalizedVaultUrl = ''
      try {
        normalizedVaultUrl = normalizeVaultOriginURL(rawVaultUrl, 'identity server URL')
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Invalid identity server URL')
        return
      }

      try {
        const vaultConnect = await startVaultConnection.mutateAsync({
          vaultUrl: normalizedVaultUrl,
          force: true,
        })
        const nextBrowserUrl = buildVaultConnectionURL(
          vaultConnect.vaultUrl,
          vaultConnect.connectToken,
          DAEMON_HTTP_URL,
        )
        setBrowserUrl(nextBrowserUrl)
        openUrl(nextBrowserUrl)
      } catch (error) {
        toast.error('Failed to start identity sign-in: ' + (error instanceof Error ? error.message : String(error)))
      }
    },
    [defaultVaultUrl, openUrl, startVaultConnection],
  )

  useEffect(() => {
    if (!input.initialSubmit || handledInitialSubmitRef.current) return
    handledInitialSubmitRef.current = true
    handleSubmit(input.initialSubmit)
  }, [handleSubmit, input.initialSubmit])

  if (isReady) return null

  if (input.initialSubmit && !browserUrl) {
    return (
      <>
        <DialogTitle>Opening identity sign-in</DialogTitle>
        <DialogDescription>Opening your browser to continue.</DialogDescription>
      </>
    )
  }

  if (browserUrl) {
    return (
      <>
        <DialogTitle className="max-sm:text-base">Your browser will open to finish setup</DialogTitle>
        <DialogDescription className="max-sm:text-sm">
          Complete your identity creation there, then come back to Seed app.
        </DialogDescription>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" className="font-semibold" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" size="lg" className="font-semibold" onClick={() => openUrl(browserUrl)}>
            Ok, open browser
          </Button>
        </div>
      </>
    )
  }

  return (
    <CreateAccountDialogContent
      title="Your Hypermedia Identity"
      localAccountTitle="Create Account"
      localAccountDescription="Hypermedia accounts use public key cryptography."
      defaultCustomIdentityUrl={defaultVaultUrl}
      customIdentityPlaceholder={defaultVaultUrl}
      initialStep={input.initialStep}
      onSubmit={handleSubmit}
    />
  )
}

/** Returns the shared desktop identity auth dialog used by onboarding and account menus. */
export function useDesktopAuthDialog() {
  return useAppDialog(DesktopAuthDialogContent, {
    className: 'w-full sm:max-w-xl',
    showCloseButton: (input) => !input.initialSubmit,
    preventClose: (input) => !!input.initialSubmit,
  })
}
