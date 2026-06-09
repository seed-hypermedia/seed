import {MainWrapper} from '@/components/main-wrapper'
import {Button} from '@shm/ui/button'
import {PanelContainer} from '@shm/ui/container'
import {CreateAccountDialogContent} from '@shm/ui/create-account-dialog'
import {GeneralPageSurface} from '@shm/ui/general-page'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'

function DesktopCreateAccountDialog() {
  const handleNotImplemented = () => {
    toast.message('Account sign-in is coming soon on desktop.')
  }

  return (
    <CreateAccountDialogContent
      title="Your Hypermedia Identity"
      localAccountTitle="Create Account"
      localAccountDescription="Hypermedia accounts use public key cryptography."
      defaultCustomIdentityUrl="https://hyper.media"
      customIdentityPlaceholder="https://hyper.media/vault/delegate"
      onSubmit={handleNotImplemented}
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
