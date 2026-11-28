import {client} from '@/trpc'
import {Dialog, DialogContent} from '@shm/ui/components/dialog'
import {ShapeHomeAnnouncement} from '@shm/ui/shape-home-announcement'
import {useQuery} from '@tanstack/react-query'
import {useEffect, useRef, useState} from 'react'

type ShapeHomeState = {
  modal: {windowId: string; uid: string; candidateTitles: string[]} | null
  sites: Record<string, any>
  needsShaping: string[]
}

declare global {
  interface Window {
    windowId?: string
  }
}

/** Renders the Shape Home announcement modal in the window that owns it. */
export function ShapeHomeAnnouncementDialog() {
  const query = useQuery({
    queryKey: ['trpc.shapeHome.getState'],
    queryFn: () => client.shapeHome.getState.query() as Promise<ShapeHomeState>,
  })
  const [open, setOpen] = useState(false)
  const readySent = useRef(false)

  const isThisWindow = query.data?.modal?.windowId === window.windowId

  useEffect(() => {
    if (!isThisWindow) return
    if (readySent.current) return
    readySent.current = true
    client.shapeHome.modalReady.mutate().catch(() => {})
    setOpen(true)
  }, [isThisWindow])

  if (!isThisWindow || !query.data?.modal) return null

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-lg"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        <ShapeHomeAnnouncement
          candidateTitles={query.data.modal.candidateTitles}
          onLearnMore={() => {
            client.shapeHome.modalLearnMore.mutate().catch(() => {})
          }}
          onNotNow={() => {
            setOpen(false)
            client.shapeHome.modalNotNow.mutate().catch(() => {})
          }}
          onShapeHome={() => {
            setOpen(false)
            client.shapeHome.modalShapeHome.mutate().catch(() => {})
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
