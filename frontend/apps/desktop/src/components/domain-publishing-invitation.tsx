import {usePublishSite} from '@/components/publish-site'
import {domainPublishingInvitation, setDomainPublishingInvitation} from '@/models/domain-publishing-invitation'
import {Button} from '@shm/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shm/ui/components/dialog'
import {Globe} from 'lucide-react'
import {useSyncExternalStore} from 'react'

/** Keeps the first-publication invitation and hosting flow open across page navigation. */
export function DomainPublishingInvitation() {
  const id = useSyncExternalStore(domainPublishingInvitation.subscribe, domainPublishingInvitation.get)
  const publishSite = usePublishSite()
  const dismiss = () => setDomainPublishingInvitation(null)

  return (
    <>
      <Dialog open={!!id} onOpenChange={(open) => !open && dismiss()}>
        <DialogContent className="w-full max-w-md">
          <div className="bg-primary/10 text-primary flex size-12 items-center justify-center rounded-full">
            <Globe className="size-6" aria-hidden="true" />
          </div>
          <DialogHeader>
            <DialogTitle>Your space is published</DialogTitle>
            <DialogDescription>
              Give your space a web address so anyone can visit it in their browser. Choose a free Seed address or
              connect your own domain.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={dismiss}>
              Not now
            </Button>
            <Button
              onClick={() => {
                if (!id) return
                dismiss()
                publishSite.open({id})
              }}
            >
              Publish to a Domain
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {publishSite.content}
    </>
  )
}
