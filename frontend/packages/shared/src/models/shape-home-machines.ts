import {setup, fromPromise, assign, type ActorRefFrom} from 'xstate'
import type {ShapeHomeCandidate} from '../utils/shape-home'
import type {DocumentCardCleanupJob} from './document-card-cleanup-machine'

/** Persisted per-site state for the Shape Home migration. */
export type ShapeHomeSiteRecord = {status: 'adding'; jobId: string} | {status: 'dismissed'} | {status: 'shaped'}

/** Persisted Shape Home state stored by the platform. */
export type ShapeHomePersisted = {modalDone?: boolean; sites: Record<string /*uid*/, ShapeHomeSiteRecord>}

/** Maps a cleanup job snapshot to a Shape Home helper job event, or null when terminal-but-not-failed. */
export function shapeHomeJobEventFromSnapshot(
  snapshot: DocumentCardCleanupJob,
): {type: 'job.done'; added: string[]; skipped: string[]} | {type: 'job.failed'; error: string} | null {
  if (snapshot.state === 'done') {
    return {type: 'job.done', added: snapshot.addedTargetIds || [], skipped: snapshot.skippedTargetIds || []}
  }
  if (snapshot.state === 'failedNeedsAttention' || snapshot.state === 'skippedTerminal') {
    return {type: 'job.failed', error: snapshot.lastError || 'Cleanup job failed'}
  }
  return null
}

type AnnouncementContext = {
  modalDone: boolean
  uid?: string
  candidates?: ShapeHomeCandidate[]
}

type AnnouncementEffects = {
  findTarget: () => Promise<{uid: string; candidates: ShapeHomeCandidate[]} | null>
  openSurface?: (uid: string) => void
  showModal?: () => void
  closeModal?: () => void
  openLearnMore?: () => void
  persistModalDone?: () => void
  dismissSite?: (uid: string) => void
  navigateHome?: (uid: string) => void
}

/** Creates the app-level Shape Home announcement machine (one per install/browser). */
export function createShapeHomeAnnouncementMachine(effects: AnnouncementEffects) {
  return setup({
    types: {} as {
      context: AnnouncementContext
      events:
        | {type: 'app.ready'}
        | {type: 'surface.ready'}
        | {type: 'surface.closed'}
        | {type: 'modal.learnMore'}
        | {type: 'modal.notNow'}
        | {type: 'modal.shapeHome'}
      input: {modalDone: boolean}
    },
    actors: {
      findTarget: fromPromise(async () => effects.findTarget()),
    },
    actions: {
      openSurface: assign(({event}) => {
        const output = (event as any).output as {uid: string; candidates: ShapeHomeCandidate[]}
        effects.openSurface?.(output.uid)
        return {uid: output.uid, candidates: output.candidates}
      }),
      showModal: () => effects.showModal?.(),
      closeModal: () => effects.closeModal?.(),
      openLearnMore: () => effects.openLearnMore?.(),
      persistModalDone: () => effects.persistModalDone?.(),
      dismissSite: ({context}) => {
        if (context.uid) effects.dismissSite?.(context.uid)
      },
      navigateHome: ({context}) => {
        if (context.uid) effects.navigateHome?.(context.uid)
      },
    },
    guards: {
      modalDone: ({context}) => context.modalDone,
      hasTarget: ({event}) => !!(event as any).output,
    },
  }).createMachine({
    id: 'shapeHomeAnnouncement',
    context: ({input}) => ({modalDone: input.modalDone}),
    initial: 'starting',
    states: {
      starting: {
        on: {
          'app.ready': [
            {
              target: 'skipped',
              guard: 'modalDone',
            },
            {
              target: 'checking',
            },
          ],
        },
      },
      checking: {
        invoke: {
          src: 'findTarget',
          onDone: [
            {
              guard: ({event}) => (event as any).output == null,
              target: 'nothingToShow',
            },
            {
              target: 'presenting.opening',
              actions: 'openSurface',
            },
          ],
          onError: {
            target: 'nothingToShow',
          },
        },
      },
      presenting: {
        initial: 'opening',
        states: {
          opening: {
            on: {
              'surface.ready': {
                target: 'open',
                actions: 'showModal',
              },
            },
          },
          open: {
            on: {
              'modal.learnMore': {
                actions: 'openLearnMore',
              },
              'modal.notNow': {
                target: '#shapeHomeAnnouncement.declined',
                actions: ['closeModal', 'persistModalDone', 'dismissSite'],
              },
              'modal.shapeHome': {
                target: '#shapeHomeAnnouncement.handedOff',
                actions: ['closeModal', 'persistModalDone', 'navigateHome'],
              },
            },
          },
        },
        on: {
          'surface.closed': {
            target: 'nothingToShow',
          },
        },
      },
      nothingToShow: {type: 'final'},
      skipped: {type: 'final'},
      declined: {type: 'final'},
      handedOff: {type: 'final'},
    },
  })
}

type HelperContext = {
  uid: string
  record?: ShapeHomeSiteRecord
  candidates: ShapeHomeCandidate[]
  selectedIds: Set<string>
  showAll: boolean
  jobId?: string
  result?: {added: string[]; skipped: string[]}
  error?: string
  resuming: boolean
}

export type HelperEffects = {
  loadCandidates: (uid: string) => Promise<ShapeHomeCandidate[]>
  enqueueAddCards: (uid: string, targetIds: string[]) => Promise<{jobId: string}>
  retryJob: (jobId: string) => Promise<void>
  persistRecord?: (uid: string, record: ShapeHomeSiteRecord) => void
  refreshHome?: (uid: string) => void
  toastResult?: (added: string[], skipped: string[]) => void
}

/** Creates the per-Home-view Shape Home helper machine. */
export function createShapeHomeHelperMachine(effects: HelperEffects) {
  return setup({
    types: {} as {
      context: HelperContext
      events:
        | {type: 'resumed'}
        | {type: 'toggle'; id: string}
        | {type: 'showMore'}
        | {type: 'notNow'}
        | {type: 'add'}
        | {type: 'retry'}
        | {type: 'job.done'; added: string[]; skipped: string[]}
        | {type: 'job.failed'; error: string}
      input: {uid: string; record?: ShapeHomeSiteRecord}
    },
    actors: {
      loadCandidates: fromPromise(async ({input}: {input: {uid: string}}) => effects.loadCandidates(input.uid)),
      enqueueAddCards: fromPromise(async ({input}: {input: {uid: string; targetIds: string[]}}) =>
        effects.enqueueAddCards(input.uid, input.targetIds),
      ),
      retryJob: fromPromise(async ({input}: {input: {jobId: string}}) => effects.retryJob(input.jobId)),
    },
    actions: {
      persistAdding: assign(({context, event}) => {
        const output = (event as any).output as {jobId: string}
        effects.persistRecord?.(context.uid, {status: 'adding', jobId: output.jobId})
        return {jobId: output.jobId}
      }),
      persistShaped: ({context}) => {
        effects.persistRecord?.(context.uid, {status: 'shaped'})
      },
      persistDismissed: ({context}) => {
        effects.persistRecord?.(context.uid, {status: 'dismissed'})
      },
      refreshHome: ({context}) => {
        effects.refreshHome?.(context.uid)
      },
      toastResult: ({context, event}) => {
        if (event.type === 'job.done') {
          effects.toastResult?.(event.added, event.skipped)
        } else if (context.result) {
          effects.toastResult?.(context.result.added, context.result.skipped)
        }
      },
      setResult: assign(({event}) => {
        if (event.type === 'job.done') {
          const result = {added: event.added, skipped: event.skipped}
          return {result}
        }
        return {}
      }),
      setError: assign(({event}) => ({
        error:
          event.type === 'job.failed'
            ? event.error
            : String((event as any).error?.message || (event as any).error || 'Operation failed'),
      })),
      toggle: assign(({context, event}) => {
        if (event.type !== 'toggle') return {}
        const selectedIds = new Set(context.selectedIds)
        if (selectedIds.has(event.id)) selectedIds.delete(event.id)
        else selectedIds.add(event.id)
        return {selectedIds}
      }),
      setShowAll: assign(() => ({showAll: true})),
      intersectSelection: assign(({context, event}) => {
        const candidates = (event as any).output as ShapeHomeCandidate[]
        const candidateIds = new Set(candidates.map((c) => c.id.id))
        const intersected = new Set(Array.from(context.selectedIds).filter((id) => candidateIds.has(id)))
        const selectedIds = intersected.size > 0 ? intersected : new Set(candidates.map((c) => c.id.id))
        return {candidates, selectedIds, resuming: false}
      }),
      setCandidates: assign(({event}) => {
        const candidates = (event as any).output as ShapeHomeCandidate[]
        return {
          candidates,
          selectedIds: new Set(candidates.map((c) => c.id.id)),
        }
      }),
      setResuming: assign(() => ({resuming: true})),
    },
    guards: {
      hasSelection: ({context}) => context.selectedIds.size > 0,
    },
  }).createMachine({
    id: 'shapeHomeHelper',
    context: ({input}) => ({
      uid: input.uid,
      record: input.record,
      candidates: [],
      selectedIds: new Set(),
      showAll: false,
      resuming: false,
    }),
    initial: 'starting',
    states: {
      starting: {
        always: [
          {
            guard: ({context}) => context.record?.status === 'adding',
            target: 'waitingForJob',
            actions: assign(({context}) => ({
              jobId: (context.record as {status: 'adding'; jobId: string}).jobId,
            })),
          },
          {
            guard: ({context}) => context.record?.status === 'dismissed' || context.record?.status === 'shaped',
            target: 'hidden',
          },
          {target: 'loading'},
        ],
      },
      loading: {
        invoke: {
          src: 'loadCandidates',
          input: ({context}) => ({uid: context.uid}),
          onDone: [
            {
              guard: ({event}) => (event.output as ShapeHomeCandidate[]).length === 0,
              target: 'hidden',
              actions: 'persistShaped',
            },
            {
              guard: ({context}) => context.resuming,
              target: 'choosing',
              actions: 'intersectSelection',
            },
            {
              target: 'choosing',
              actions: 'setCandidates',
            },
          ],
          onError: {
            target: 'loadFailed',
          },
        },
      },
      loadFailed: {
        on: {
          retry: {target: 'loading'},
          notNow: {target: 'dismissed', actions: 'persistDismissed'},
        },
      },
      choosing: {
        on: {
          toggle: {actions: 'toggle'},
          showMore: {actions: 'setShowAll'},
          notNow: {target: 'dismissed', actions: 'persistDismissed'},
          add: {
            target: 'enqueuing',
            guard: 'hasSelection',
          },
          resumed: {
            target: 'loading',
            actions: 'setResuming',
          },
        },
      },
      enqueuing: {
        invoke: {
          src: 'enqueueAddCards',
          input: ({context}) => ({
            uid: context.uid,
            targetIds: context.candidates.filter((c) => context.selectedIds.has(c.id.id)).map((c) => c.id.id),
          }),
          onDone: {
            target: 'waitingForJob',
            actions: 'persistAdding',
          },
          onError: {
            target: 'addFailed',
            actions: 'setError',
          },
        },
      },
      waitingForJob: {
        on: {
          'job.done': {
            target: 'finished',
            actions: ['setResult', 'persistShaped', 'refreshHome', 'toastResult'],
          },
          'job.failed': {
            target: 'addFailed',
            actions: 'setError',
          },
        },
      },
      addFailed: {
        on: {
          retry: {target: 'retrying'},
          notNow: {target: 'dismissed', actions: 'persistDismissed'},
        },
      },
      retrying: {
        invoke: {
          src: 'retryJob',
          input: ({context}) => ({jobId: context.jobId!}),
          onDone: {target: 'waitingForJob'},
          onError: {target: 'addFailed', actions: 'setError'},
        },
      },
      hidden: {type: 'final'},
      dismissed: {type: 'final'},
      finished: {type: 'final'},
    },
  })
}

export type ShapeHomeAnnouncementActor = ActorRefFrom<ReturnType<typeof createShapeHomeAnnouncementMachine>>
export type ShapeHomeHelperActor = ActorRefFrom<ReturnType<typeof createShapeHomeHelperMachine>>
