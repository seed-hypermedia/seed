import {appStore} from './app-store.mts'
import {appInvalidateQueries} from './app-invalidation'
import {t} from './app-trpc'
import {grpcClient} from './app-grpc'
import {seedClient} from './app-client'
import {
  createShapeHomeAnnouncementMachine,
  type ShapeHomePersisted,
  type ShapeHomeSiteRecord,
} from '@shm/shared/models/shape-home-machines'
import {loadShapeHomeStatus} from '@shm/shared/utils/shape-home'
import {hmId} from '@shm/shared'
import {type NavRoute} from '@shm/shared/routes'
import {
  createAppWindow,
  getAllWindows,
  getLastFocusedWindow,
  getSelectedIdentityFromWindowState,
  getWindowNavState,
} from './app-windows'
import {hypermediaUrlToRoute} from '@shm/shared/utils/url-to-route'
import * as log from './logger'
import {LEARN_MORE_URL} from '@shm/ui/shape-home-announcement'
import {createActor, type ActorRefFrom} from 'xstate'
import z from 'zod'

const STORAGE_KEY = 'ShapeHomeState-v001'
const QUERY_KEY = ['trpc.shapeHome.getState']

type NeedsShapingCache = Record<string, {candidateCount: number}>

type ShapeHomeState = ShapeHomePersisted & {needsShaping: NeedsShapingCache}

function defaultState(): ShapeHomeState {
  return {modalDone: false, sites: {}, needsShaping: {}}
}

function readState(): ShapeHomeState {
  const stored = appStore.get(STORAGE_KEY) as ShapeHomeState | undefined
  if (!stored) {
    const next = defaultState()
    appStore.set(STORAGE_KEY, next)
    return next
  }
  return {
    modalDone: stored.modalDone ?? false,
    sites: stored.sites ?? {},
    needsShaping: stored.needsShaping ?? {},
  }
}

let state: ShapeHomeState = readState()

function writeState(next: ShapeHomeState) {
  state = next
  appStore.set(STORAGE_KEY, next)
  appInvalidateQueries(QUERY_KEY)
}

function invalidate() {
  appInvalidateQueries(QUERY_KEY)
}

function setSiteRecordInternal(uid: string, record: ShapeHomeSiteRecord) {
  const needsShaping = {...state.needsShaping}
  delete needsShaping[uid]
  writeState({
    ...state,
    sites: {...state.sites, [uid]: record},
    needsShaping,
  })
}

let announcementActor: ActorRefFrom<ReturnType<typeof createShapeHomeAnnouncementMachine>> | null = null
let surfaceWindowId: string | null = null

function findTargetUid(): string | null {
  const selectedIdentity = getSelectedIdentityFromWindowState(
    getWindowNavState(),
    Array.from(getAllWindows().entries()).find(([, w]) => w === getLastFocusedWindow())?.[0] ?? null,
  )
  if (selectedIdentity && state.needsShaping[selectedIdentity]) return selectedIdentity
  for (const uid of Object.keys(state.needsShaping)) {
    return uid
  }
  return null
}

function openSurfaceWindow(uid: string): string {
  const route: NavRoute = {key: 'document', id: hmId(uid)}
  const existing = Array.from(getAllWindows().entries()).find(([id]) => id === surfaceWindowId)
  if (existing) {
    return existing[0]
  }
  const win = createAppWindow({routes: [route], selectedIdentity: uid})
  const id = Array.from(getAllWindows().entries()).find(([, w]) => w === win)?.[0] ?? null
  if (id) {
    surfaceWindowId = id
    win.once('closed', () => {
      if (surfaceWindowId === id) surfaceWindowId = null
      announcementActor?.send({type: 'surface.closed'})
    })
  }
  return id ?? ''
}

/** Starts the Shape Home announcement flow once per launch after windows open. */
export async function startShapeHome() {
  try {
    await rescanSites()
  } catch (error) {
    log.error('[ShapeHome] initial scan failed', {error: String(error)})
  }
  if (state.modalDone) return
  runAnnouncementMachine()
}

let rescanInFlight: Promise<void> | null = null
let scannedUidsKey: string | null = null

/** Scans local accounts once per distinct key set per launch; concurrent callers share the scan. */
function rescanSites(): Promise<void> {
  if (!rescanInFlight) {
    rescanInFlight = scanSites().finally(() => {
      rescanInFlight = null
    })
  }
  return rescanInFlight
}

async function scanSites() {
  const keys = await grpcClient.daemon.listKeys({})
  const uids = keys.keys.map((k) => k.publicKey).filter(Boolean) as string[]
  const uidsKey = [...uids].sort().join(',')
  if (uidsKey === scannedUidsKey) return
  const needsShaping: NeedsShapingCache = {}
  for (const uid of uids) {
    if (state.sites[uid]) continue
    try {
      const status = await loadShapeHomeStatus({request: seedClient.request} as any, uid)
      if (status.eligible) {
        needsShaping[uid] = {candidateCount: status.candidates.length}
      }
    } catch (error) {
      log.warn('[ShapeHome] scan failed for site; skipping this launch', {uid, error: String(error)})
    }
  }
  // A record may have been written while the scan awaited the network.
  for (const uid of Object.keys(needsShaping)) if (state.sites[uid]) delete needsShaping[uid]
  scannedUidsKey = uidsKey
  writeState({...state, needsShaping})
}

function runAnnouncementMachine() {
  if (announcementActor) return
  const machine = createShapeHomeAnnouncementMachine({
    findTarget: async () => {
      const uid = findTargetUid()
      if (!uid) return null
      try {
        const status = await loadShapeHomeStatus({request: seedClient.request} as any, uid)
        if (!status.eligible) return null
        return {uid, candidates: status.candidates}
      } catch (error) {
        log.warn('[ShapeHome] findTarget failed', {uid, error: String(error)})
        return null
      }
    },
    openSurface: (uid) => {
      openSurfaceWindow(uid)
    },
    showModal: () => {
      invalidate()
    },
    closeModal: () => {
      surfaceWindowId = null
      invalidate()
    },
    openLearnMore: () => {
      const route = hypermediaUrlToRoute(LEARN_MORE_URL)
      if (route) {
        createAppWindow({routes: [route]})
      }
    },
    persistModalDone: () => {
      writeState({...state, modalDone: true})
    },
    dismissSite: (uid) => {
      setSiteRecordInternal(uid, {status: 'dismissed'})
    },
    navigateHome: () => {
      // Window is already on the site Home; nothing to do.
    },
  })
  announcementActor = createActor(machine, {input: {modalDone: state.modalDone ?? false}})
  announcementActor.subscribe(() => invalidate())
  announcementActor.start()
  announcementActor.send({type: 'app.ready'})
}

function deriveModal(): {windowId: string; uid: string; candidateTitles: string[]} | null {
  if (!announcementActor || !surfaceWindowId) return null
  const snap = announcementActor.getSnapshot()
  if (!snap.matches('presenting')) return null
  const ctx = snap.context as {uid?: string; candidates?: {title: string}[]}
  if (!ctx.uid) return null
  return {
    windowId: surfaceWindowId,
    uid: ctx.uid,
    candidateTitles: (ctx.candidates ?? []).slice(0, 3).map((c) => c.title),
  }
}

/** tRPC API for the Shape Home migration announcement + helper. */
export const shapeHomeApi = t.router({
  /** Returns the current Shape Home state for the renderer. */
  getState: t.procedure.query(() => {
    const needsShaping = Object.keys(state.needsShaping)
    return {
      modal: deriveModal(),
      sites: state.sites,
      needsShaping,
    }
  }),
  /** Marks the modal as ready (surface.ready) in the announcement window. */
  modalReady: t.procedure.mutation(() => {
    announcementActor?.send({type: 'surface.ready'})
    return null
  }),
  /** Opens the Learn more URL in a new window; modal stays open. */
  modalLearnMore: t.procedure.mutation(() => {
    announcementActor?.send({type: 'modal.learnMore'})
    return null
  }),
  /** Dismisses the modal for this site and marks modalDone. */
  modalNotNow: t.procedure.mutation(() => {
    announcementActor?.send({type: 'modal.notNow'})
    return null
  }),
  /** Hands off to the helper on the site Home. */
  modalShapeHome: t.procedure.mutation(() => {
    announcementActor?.send({type: 'modal.shapeHome'})
    return null
  }),
  /** Persists a site record and removes the site from needsShaping. */
  setSiteRecord: t.procedure
    .input(
      z.object({
        uid: z.string(),
        record: z.discriminatedUnion('status', [
          z.object({status: z.literal('adding'), jobId: z.string()}),
          z.object({status: z.literal('dismissed')}),
          z.object({status: z.literal('shaped')}),
        ]),
      }),
    )
    .mutation(({input}) => {
      setSiteRecordInternal(input.uid, input.record)
      return null
    }),
  /** Re-scans local accounts for sites that need shaping. */
  rescan: t.procedure.mutation(async () => {
    await rescanSites()
    return null
  }),
})
