import {
  invalidateVaultDependentQueries,
  useMyAccountIds,
  useStartVaultConnection,
  useVaultStatus,
} from '@/models/daemon'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useOpenUrl} from '@/open-url'
import {client} from '@/trpc'
import {buildVaultConnectionURL, normalizeVaultOriginURL} from '@/utils/vault-connection'
import {useUniversalAppContext} from '@shm/shared'
import {VaultConnectionStatus} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'
import {DAEMON_HTTP_URL, DEFAULT_DESKTOP_VAULT_URL, DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {useStream} from '@shm/shared/use-stream'
import {Button} from '@shm/ui/button'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {CreateAccountDialogContent, type CreateAccountDialogSubmit} from '@shm/ui/create-account-dialog'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {useEffect, useState} from 'react'

function DesktopAuthDialogContent() {
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
    if (!isReady || !firstAccountId) return
    if (!selectedIdentityValue) {
      setSelectedIdentity?.(firstAccountId)
    }
    client.selectIdentityForWindowsWithoutAccount.mutate(firstAccountId).catch((error) => {
      console.error('Failed to select remote vault account for windows', error)
    })
  }, [accountIds.data, isReady, selectedIdentityValue, setSelectedIdentity])

  const handleSubmit = async (input: CreateAccountDialogSubmit) => {
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
      const nextBrowserUrl = buildVaultConnectionURL(vaultConnect.vaultUrl, vaultConnect.connectToken, DAEMON_HTTP_URL)
      setBrowserUrl(nextBrowserUrl)
      openUrl(nextBrowserUrl)
      toast.success('Opened identity sign-in in your browser.')
    } catch (error) {
      toast.error('Failed to start identity sign-in: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  if (isReady) {
    return (
      <>
        <DialogTitle>Your identity is connected</DialogTitle>
        <DialogDescription>Your remote vault has been linked. You can now continue using Seed.</DialogDescription>
      </>
    )
  }

  if (browserUrl) {
    return (
      <>
        <DialogTitle>Complete sign-in in your browser</DialogTitle>
        <DialogDescription>
          We opened your browser to finish connecting your identity. Return to Seed after sign-in completes.
        </DialogDescription>
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <div className="text-muted-foreground text-xs">Manual browser link</div>
          <input className="rounded border px-3 py-2 text-sm" value={browserUrl} readOnly />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => copyTextToClipboard(browserUrl)}>
              Copy Link
            </Button>
            <Button variant="default" className="flex-1" onClick={() => openUrl(browserUrl)}>
              Open Browser
            </Button>
          </div>
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
      onSubmit={handleSubmit}
    />
  )
}

/** Returns the shared desktop identity auth dialog used by onboarding and account menus. */
export function useDesktopAuthDialog() {
  return useAppDialog(DesktopAuthDialogContent, {
    className: 'w-full sm:max-w-xl',
  })
}
