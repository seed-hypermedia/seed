import {Dialog, DialogContent} from '@shm/ui/components/dialog'
import {LEARN_MORE_URL, ShapeHomeAnnouncement} from '@shm/ui/shape-home-announcement'
import {createShapeHomeAnnouncementMachine} from '@shm/shared/models/shape-home-machines'
import type {ShapeHomeCandidate} from '@shm/shared/utils/shape-home'
import {hmId, unpackHmId, createWebHMUrl} from '@shm/shared/utils/entity-id-url'
import {routeToHref, useUniversalAppContext} from '@shm/shared'
import {useActorRef, useSelector} from '@xstate/react'
import {useEffect, useState} from 'react'
import {useNavigate} from '@remix-run/react'
import {persistShapeHomeModalDone, persistShapeHomeSiteRecord} from './store'
import {useWebShapeHomeGate} from './use-web-shape-home-gate'

/** Shape Home announcement modal root for web. Mounted once at the app root. */
export function WebShapeHomeAnnouncement() {
  const gate = useWebShapeHomeGate()
  // The machine starts only once the gate has resolved, so its target is fixed for this page load.
  if (!gate.uid || !gate.eligible || gate.modalDone || !gate.status) return null
  return <ShapeHomeAnnouncementRunner uid={gate.uid} candidates={gate.status.candidates} />
}

function ShapeHomeAnnouncementRunner({uid, candidates}: {uid: string; candidates: ShapeHomeCandidate[]}) {
  const navigate = useNavigate()
  const {originHomeId} = useUniversalAppContext()
  const [machine] = useState(() =>
    createShapeHomeAnnouncementMachine({
      findTarget: async () => ({uid, candidates}),
      openLearnMore: () => {
        const id = unpackHmId(LEARN_MORE_URL)
        if (id) window.open(createWebHMUrl(id.uid, {path: id.path, latest: true}), '_blank', 'noopener,noreferrer')
      },
      persistModalDone: persistShapeHomeModalDone,
      dismissSite: (siteUid) => persistShapeHomeSiteRecord(siteUid, {status: 'dismissed'}),
      navigateHome: (siteUid) => {
        const href = routeToHref({key: 'document', id: hmId(siteUid)}, {originHomeId: originHomeId ?? undefined})
        if (href) navigate(href)
      },
    }),
  )
  const actor = useActorRef(machine, {input: {modalDone: false}})
  const isOpening = useSelector(actor, (s) => s.matches({presenting: 'opening'}))
  const isOpen = useSelector(actor, (s) => s.matches({presenting: 'open'}))

  useEffect(() => {
    actor.send({type: 'app.ready'})
  }, [actor])

  // The current tab is the surface: it is ready as soon as the machine asks for it.
  useEffect(() => {
    if (isOpening) actor.send({type: 'surface.ready'})
  }, [actor, isOpening])

  if (!isOpen) return null

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-lg"
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        showCloseButton={false}
      >
        <ShapeHomeAnnouncement
          candidateTitles={candidates.slice(0, 3).map((c) => c.title)}
          onLearnMore={() => actor.send({type: 'modal.learnMore'})}
          onNotNow={() => actor.send({type: 'modal.notNow'})}
          onShapeHome={() => actor.send({type: 'modal.shapeHome'})}
        />
      </DialogContent>
    </Dialog>
  )
}
