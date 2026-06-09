import { useDesktopAuthDialog } from '@/components/desktop-auth-dialog'
import { MainWrapper } from '@/components/main-wrapper'
import { Button } from '@shm/ui/button'
import { PanelContainer } from '@shm/ui/container'
import { GeneralPageSurface } from '@shm/ui/general-page'
import { Search, User } from 'lucide-react'

export default function OnboardingPage() {
  const createAccountDialog = useDesktopAuthDialog()

  return (
    <PanelContainer className="dark:bg-background bg-white">
      <MainWrapper scrollable>
        <GeneralPageSurface>
          <div className="flex h-full flex-col justify-center gap-6 p-8 max-w-3xl mx-auto">
            <h1 className="text-3xl font-semibold tracking-tight">Welcome to Seed Hypermedia</h1>
            <p>A place where people build sites to share knowledge freely. Where would you like to start?</p>

            <div className="flex gap-2">
              <div className="flex flex-col gap-4 border rounded-lg p-4 flex-1 justify-between shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex items-center justify-center rounded-xl bg-brand-12 w-12 h-12">
                    <Search className="size-6" />
                  </div>
                  <div className="flex flex-col items-start gap-1">
                    <h3 className="font-bold">Join a Site</h3>
                    <p className="text-muted-foreground">Paste a site link in the bar above</p>
                  </div>
                </div>
                <Button variant="outline">Search for a Site</Button>
              </div>
              <div className="flex flex-col gap-4 border rounded-lg p-4 flex-1 justify-between shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex items-center justify-center rounded-xl bg-brand-12 min-w-12 min-h-12">
                    <User className="size-6" />
                  </div>
                  <div className="flex flex-col items-start gap-1">
                    <h3 className="font-bold">Create a Site</h3>
                    <p className="text-muted-foreground">Start your own space to share knowledge</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  className="border-emerald-600 text-emerald-700 dark:border-emerald-500 dark:text-emerald-300 hover:text-emerald-700 dark:hover:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950"
                >
                  Create my Site
                </Button>

              </div>
            </div>
            <div className="flex items-center gap-2 w-full">
              <div className="h-px bg-neutral-200 dark:bg-neutral-700 flex-1" />
              <span className="text-xs text-neutral-400 dark:text-neutral-500">already have an identity?</span>
              <div className="h-px bg-neutral-200 dark:bg-neutral-700 flex-1" />
            </div>
            <button onClick={() => createAccountDialog.open({})} className="flex items-center gap-4 border rounded-lg p-4 shadow-sm hover:shadow-lg transition-all">
              <div className="flex items-center justify-center rounded-full border-2 border-dotted border-neutral-400 bg-white w-10 h-10">
                <User className="size-6 text-neutral-400" />
              </div>

              <div className="flex flex-col items-start gap-1">

                <p className="font-bold">Sign in to Hypermedia or create an account</p>
                <p className="text-muted-foreground">Bring your existing identity to this device, or create a new identity</p>
              </div>
            </button>
          </div>
        </GeneralPageSurface>
      </MainWrapper >
      {createAccountDialog.content}
    </PanelContainer >
  )
}
