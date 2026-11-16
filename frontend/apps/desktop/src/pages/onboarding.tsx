import {useDesktopAuthDialog} from '@/components/desktop-auth-dialog'
import {useDesktopAccountIntent} from '@/components/desktop-intents'
import {MainWrapper} from '@/components/main-wrapper'
import {useSelectedAccountId} from '@/selected-account'
import {findExistingSiteHome} from '@/utils/create-site'
import {useNavigate} from '@/utils/useNavigate'
import {useTriggerWindowEvent} from '@/utils/window-events'
import {useResource} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {useOpenCreateSpace} from '@shm/ui/create-space-context'
import {PanelContainer} from '@shm/ui/container'
import {GeneralPageSurface} from '@shm/ui/general-page'
import {toast} from '@shm/ui/toast'
import {Plus, Search, User} from 'lucide-react'
import {useState} from 'react'

export default function OnboardingPage() {
  const createAccountDialog = useDesktopAuthDialog()
  const selectedAccountId = useSelectedAccountId()
  const selectedSite = useResource(selectedAccountId ? hmId(selectedAccountId) : undefined)
  const hasSelectedSite = selectedSite.data?.type === 'document' && selectedSite.data.document
  const triggerWindowEvent = useTriggerWindowEvent()
  const navigate = useNavigate()
  const createSiteIntent = useDesktopAccountIntent()
  const openCreateSpace = useOpenCreateSpace()
  const [isCreatingSite, setIsCreatingSite] = useState(false)

  const createSite = async (accountUid: string) => {
    setIsCreatingSite(true)
    try {
      // An identity signed in from elsewhere may already have a space.
      const existingHomeId = await findExistingSiteHome(accountUid)
      if (existingHomeId) {
        navigate({key: 'document', id: existingHomeId})
      } else {
        openCreateSpace?.()
      }
    } catch (error) {
      console.error('Failed to verify site before creating space:', error)
      toast.error('Could not verify whether your space already exists. Please try again.')
    } finally {
      setIsCreatingSite(false)
    }
  }

  return (
    <PanelContainer className="dark:bg-background bg-white">
      <MainWrapper scrollable>
        <GeneralPageSurface>
          <div className="mx-auto flex h-full max-w-3xl flex-col justify-center gap-6 p-8">
            <h1 className="text-3xl font-semibold tracking-tight">Welcome to Seed Hypermedia 👋</h1>
            <p>A place where people build spaces to share knowledge freely. Where would you like to start?</p>

            <div className="flex gap-2">
              <div className="flex flex-1 flex-col justify-between gap-4 rounded-lg border p-4 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="bg-brand-12 flex h-12 w-12 items-center justify-center rounded-xl">
                    <Search className="size-6" />
                  </div>
                  <div className="flex flex-col items-start gap-1">
                    <h3 className="font-bold">Find and Join a Space</h3>
                    <p className="text-muted-foreground">Paste a space link in the bar above</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  className="text-muted-foreground bg-muted hover:bg-accent justify-start gap-2 rounded-full border-0"
                  onClick={() => triggerWindowEvent({type: 'focus_omnibar', mode: 'search'})}
                >
                  <Search className="size-4" />
                  Input a Space URL
                </Button>
              </div>
              {!hasSelectedSite ? (
                <div className="flex flex-1 flex-col justify-between gap-4 rounded-lg border p-4 shadow-sm">
                  <div className="flex items-start gap-4">
                    <div className="bg-brand-12 flex min-h-12 min-w-12 items-center justify-center rounded-xl">
                      <Plus className="size-6" />
                    </div>
                    <div className="flex flex-col items-start gap-1">
                      <h3 className="font-bold">Create a Space</h3>
                      <p className="text-muted-foreground">Start your own space to share knowledge</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="border-emerald-600 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-700 dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-950 dark:hover:text-emerald-300"
                    disabled={isCreatingSite}
                    onClick={() => createSiteIntent.requireAccount(createSite)}
                  >
                    Create my Space
                  </Button>
                </div>
              ) : null}
            </div>
            {!selectedAccountId ? (
              <>
                <div className="flex w-full items-center gap-2">
                  <div className="bg-border h-px flex-1" />
                  <span className="text-muted-foreground text-sm">already have an identity?</span>
                  <div className="bg-border h-px flex-1" />
                </div>
                <button
                  onClick={() => createAccountDialog.open({})}
                  className="flex items-center gap-4 rounded-lg border p-4 shadow-sm transition-shadow duration-150 hover:shadow-md"
                >
                  <div className="border-muted-foreground/50 bg-card flex h-10 w-10 items-center justify-center rounded-full border-2 border-dotted">
                    <User className="text-muted-foreground size-6" />
                  </div>

                  <div className="flex flex-col items-start gap-1">
                    <p className="font-bold">Sign in to Hypermedia or create an account</p>
                    <p className="text-muted-foreground">
                      Bring your existing identity to this device, or create a new identity
                    </p>
                  </div>
                </button>
              </>
            ) : null}
          </div>
        </GeneralPageSurface>
      </MainWrapper>
      {createAccountDialog.content}
      {createSiteIntent.content}
    </PanelContainer>
  )
}
