import {useDesktopAuthDialog} from '@/components/desktop-auth-dialog'
import {MainWrapper} from '@/components/main-wrapper'
import {useSelectedAccountId} from '@/selected-account'
import {client} from '@/trpc'
import {useTriggerWindowEvent} from '@/utils/window-events'
import {useNavigate} from '@/utils/useNavigate'
import {useResource} from '@shm/shared/models/entity'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {PanelContainer} from '@shm/ui/container'
import {GeneralPageSurface} from '@shm/ui/general-page'
import {Plus, Search, User} from 'lucide-react'
import {nanoid} from 'nanoid'

export default function OnboardingPage() {
  const createAccountDialog = useDesktopAuthDialog()
  const selectedAccountId = useSelectedAccountId()
  const selectedSite = useResource(selectedAccountId ? hmId(selectedAccountId) : undefined)
  const hasSelectedSite = selectedSite.data?.type === 'document' && selectedSite.data.document
  const triggerWindowEvent = useTriggerWindowEvent()
  const navigate = useNavigate()

  return (
    <PanelContainer className="dark:bg-background bg-white">
      <MainWrapper scrollable>
        <GeneralPageSurface>
          <div className="mx-auto flex h-full max-w-3xl flex-col justify-center gap-6 p-8">
            <h1 className="text-3xl font-semibold tracking-tight">Welcome to Seed Hypermedia</h1>
            <p>A place where people build sites to share knowledge freely. Where would you like to start?</p>

            <div className="flex gap-2">
              <div className="flex flex-1 flex-col justify-between gap-4 rounded-lg border p-4 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="bg-brand-12 flex h-12 w-12 items-center justify-center rounded-xl">
                    <Search className="size-6" />
                  </div>
                  <div className="flex flex-col items-start gap-1">
                    <h3 className="font-bold">Join a Site</h3>
                    <p className="text-muted-foreground">Paste a site link in the bar above</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="border-emerald-600 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-700 dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-950 dark:hover:text-emerald-300"
                  onClick={() => triggerWindowEvent({type: 'focus_omnibar', mode: 'search'})}
                >
                  Search for a Site
                </Button>
              </div>
              {!hasSelectedSite ? (
                <div className="flex flex-1 flex-col justify-between gap-4 rounded-lg border p-4 shadow-sm">
                  <div className="flex items-start gap-4">
                    <div className="bg-brand-12 flex min-h-12 min-w-12 items-center justify-center rounded-xl">
                      <Plus className="size-6" />
                    </div>
                    <div className="flex flex-col items-start gap-1">
                      <h3 className="font-bold">Create a Site</h3>
                      <p className="text-muted-foreground">Start your own space to share knowledge</p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    className="border-emerald-600 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-700 dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-950 dark:hover:text-emerald-300"
                    disabled={!selectedAccountId}
                    onClick={async () => {
                      if (!selectedAccountId) return
                      const draftId = nanoid(10)
                      await client.drafts.write.mutate({
                        id: draftId,
                        editUid: selectedAccountId,
                        editPath: [],
                        metadata: {},
                        content: [],
                        deps: [],
                        visibility: 'PUBLIC',
                      })
                      navigate({
                        key: 'document',
                        id: hmId(selectedAccountId, {path: []}),
                      })
                    }}
                  >
                    Create my Site
                  </Button>
                </div>
              ) : null}
            </div>
            {!selectedAccountId ? (
              <>
                <div className="flex w-full items-center gap-2">
                  <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
                  <span className="text-xs text-neutral-400 dark:text-neutral-500">already have an identity?</span>
                  <div className="h-px flex-1 bg-neutral-200 dark:bg-neutral-700" />
                </div>
                <button
                  onClick={() => createAccountDialog.open({})}
                  className="flex items-center gap-4 rounded-lg border p-4 shadow-sm transition-all hover:shadow-lg"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dotted border-neutral-400 bg-white">
                    <User className="size-6 text-neutral-400" />
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
    </PanelContainer>
  )
}
