import {useLocalKeyPair} from '@/auth'
import {setWebDomainRequest, webDomainRequest} from '@/models/domain-publishing'
import {useSiteContextSnapshot} from '@/site-context-bridge'
import {UniversalAppContext} from '@shm/shared'
import {NavContextProvider} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shm/ui/components/dialog'
import {Spinner} from '@shm/ui/spinner'
import {Globe} from 'lucide-react'
import {lazy, Suspense, useEffect, useState, useSyncExternalStore} from 'react'

const Hosting = lazy(() => import('./web-hosting').then((module) => ({default: module.WebHostingDialog})))
const Settings = lazy(() => import('./web-hosting').then((module) => ({default: module.WebDomainSettings})))

/** Keeps the publication invitation and hosting workflow alive across browser navigation. */
export function WebDomainHost() {
  const request = useSyncExternalStore(webDomainRequest.subscribe, webDomainRequest.get, () => null)
  const identity = useLocalKeyPair()
  const site = useSiteContextSnapshot()
  const [protection, setProtection] = useState({preventClose: false, showCloseButton: true})
  const isRequester =
    !!identity && (request?.requesterUid === identity.id || request?.requesterUid === identity.delegatedAccountUid)
  const dismiss = () => {
    if (!protection.preventClose) setWebDomainRequest(null)
  }

  useEffect(() => {
    if (request && identity && !isRequester) setWebDomainRequest(null)
  }, [request, identity, isRequester])

  if (!request || !site || !isRequester) return null
  return (
    <UniversalAppContext.Provider value={site.universal}>
      <NavContextProvider value={site.navigation}>
        <Dialog open onOpenChange={(open) => !open && dismiss()}>
          <DialogContent
            className="max-h-[calc(100dvh-4rem)] w-full max-w-lg"
            showCloseButton={protection.showCloseButton}
          >
            {request.view === 'invitation' ? (
              <>
                <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">
                  <Globe className="size-6" aria-hidden="true" />
                </div>
                <DialogHeader>
                  <DialogTitle>Your space is published</DialogTitle>
                  <DialogDescription>
                    Give your space a web address. Choose a free Seed address or connect your own domain.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost" onClick={dismiss}>
                    Not now
                  </Button>
                  <Button onClick={() => setWebDomainRequest({...request, view: 'hosting'})}>
                    Publish to a Domain
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <Suspense
                fallback={
                  <>
                    <DialogTitle>Web Domain</DialogTitle>
                    <Spinner />
                  </>
                }
              >
                {request.view === 'settings' ? (
                  <Settings siteId={request.id} />
                ) : (
                  <Hosting input={{id: request.id}} onClose={dismiss} setDialogCloseProtection={setProtection} />
                )}
              </Suspense>
            )}
          </DialogContent>
        </Dialog>
      </NavContextProvider>
    </UniversalAppContext.Provider>
  )
}
