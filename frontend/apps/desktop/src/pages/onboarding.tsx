import {MainWrapper} from '@/components/main-wrapper'
import {useGatewayUrl} from '@/models/gateway-settings'
import {useStartVaultConnection} from '@/models/daemon'
import {useOpenUrl} from '@/open-url'
import {buildVaultConnectionURL, normalizeVaultOriginURL} from '@/utils/vault-connection'
import {Button} from '@shm/ui/button'
import {PanelContainer} from '@shm/ui/container'
import {DAEMON_HTTP_URL, DEFAULT_DESKTOP_VAULT_URL, DEFAULT_GATEWAY_URL} from '@shm/shared/constants'
import {CreateAccountDialogContent, type CreateAccountDialogSubmit} from '@shm/ui/create-account-dialog'
import {GeneralPageSurface} from '@shm/ui/general-page'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'

function DesktopCreateAccountDialog() {
  const gatewayUrl = useGatewayUrl()
  const startVaultConnection = useStartVaultConnection()
  const openUrl = useOpenUrl()
  const defaultVaultUrl = DEFAULT_DESKTOP_VAULT_URL || `${gatewayUrl.data || DEFAULT_GATEWAY_URL}/vault`

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
      openUrl(buildVaultConnectionURL(vaultConnect.vaultUrl, vaultConnect.connectToken, DAEMON_HTTP_URL))
      toast.success('Opened identity sign-in in your browser.')
    } catch (error) {
      toast.error('Failed to start identity sign-in: ' + (error instanceof Error ? error.message : String(error)))
    }
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

export default function OnboardingPage() {
  const createAccountDialog = useAppDialog(DesktopCreateAccountDialog, {
    className: 'w-full sm:max-w-xl',
  })

  return (
    <PanelContainer className="dark:bg-background bg-white">
      <MainWrapper scrollable>
        <GeneralPageSurface>
          <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
            <h1 className="text-3xl font-semibold tracking-tight">Welcome to Seed Hypermedia</h1>
            <Button variant="default" onClick={() => createAccountDialog.open({})}>
              Log in or Create Account
            </Button>
          </div>
        </GeneralPageSurface>
      </MainWrapper>
      {createAccountDialog.content}
    </PanelContainer>
  )
}
