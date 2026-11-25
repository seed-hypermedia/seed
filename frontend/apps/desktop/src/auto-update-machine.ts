import {assign, fromCallback, fromPromise, setup, type ActorRefFrom, type SnapshotFrom} from 'xstate'
import type {UpdateInfo, UpdateStatus} from './types/updater-types'

/** Downloaded artifact and the integrity digest from its verified manifest. */
export type DownloadedUpdate = {filePath: string; expectedSha256?: string}

/** Events produced by the platform download subscription. */
export type UpdateDownloadCallbacks = {
  onProgress: (progress: number) => void
  onComplete: (download: DownloadedUpdate) => void
  onError: (error: unknown) => void
}

/** Platform effects owned by the update actor's state lifecycle. */
export type AutoUpdateDependencies = {
  checkForUpdates: (signal: AbortSignal) => Promise<UpdateInfo | null>
  downloadUpdate: (updateInfo: UpdateInfo, callbacks: UpdateDownloadCallbacks) => () => void
  verifyUpdate: (download: DownloadedUpdate) => Promise<void>
  installUpdate: (filePath: string) => Promise<void>
  usesExternalDownload: () => boolean
  openDownloadPage: () => void
}

type UpdateContext = {
  updateInfo: UpdateInfo | null
  download: DownloadedUpdate | null
  progress: number
  manualCheck: boolean
  error: string | null
}

type UpdateEvent =
  | {type: 'check.requested'; manual: boolean}
  | {type: 'download.requested'}
  | {type: 'download.progress'; progress: number}
  | {type: 'download.completed'; download: DownloadedUpdate}
  | {type: 'download.failed'; error: unknown}
  | {type: 'restart.requested'}
  | {type: 'dismiss'}

/** Orchestrates updates; installation is reachable only through explicit restart consent. */
export function createAutoUpdateMachine(dependencies: AutoUpdateDependencies) {
  return setup({
    types: {
      context: {} as UpdateContext,
      events: {} as UpdateEvent,
    },
    actors: {
      check: fromPromise<UpdateInfo | null>(({signal}) => dependencies.checkForUpdates(signal)),
      download: fromCallback<UpdateEvent, UpdateInfo>(({input, sendBack}) =>
        dependencies.downloadUpdate(input, {
          onProgress: (progress) => sendBack({type: 'download.progress', progress}),
          onComplete: (download) => sendBack({type: 'download.completed', download}),
          onError: (error) => sendBack({type: 'download.failed', error}),
        }),
      ),
      verify: fromPromise<void, DownloadedUpdate>(({input}) => dependencies.verifyUpdate(input)),
      install: fromPromise<void, DownloadedUpdate>(async ({input}) => {
        await dependencies.verifyUpdate(input)
        await dependencies.installUpdate(input.filePath)
      }),
    },
    actions: {
      beginCheck: assign(({event}) => ({
        updateInfo: null,
        download: null,
        progress: 0,
        manualCheck: event.type === 'check.requested' && event.manual,
        error: null,
      })),
      recordError: assign({
        error: (_, params: {error: unknown}) =>
          params.error instanceof Error ? params.error.message : String(params.error),
      }),
      openDownloadPage: () => dependencies.openDownloadPage(),
    },
    guards: {
      usesExternalDownload: () => dependencies.usesExternalDownload(),
      isManualCheck: ({event}) => event.type === 'check.requested' && event.manual,
    },
  }).createMachine({
    id: 'autoUpdate',
    initial: 'idle',
    context: {updateInfo: null, download: null, progress: 0, manualCheck: false, error: null},
    states: {
      idle: {on: {'check.requested': {target: 'checking'}}},
      checking: {
        entry: 'beginCheck',
        invoke: {
          src: 'check',
          onDone: [
            {
              guard: ({event}) => event.output !== null,
              target: 'available',
              actions: assign({updateInfo: ({event}) => event.output}),
            },
            {guard: ({context}) => context.manualCheck, target: 'upToDate'},
            {target: 'idle'},
          ],
          onError: {
            target: 'error',
            actions: {type: 'recordError', params: ({event}) => ({error: event.error})},
          },
        },
      },
      upToDate: {on: {'check.requested': {target: 'checking'}}},
      available: {
        on: {
          'check.requested': {target: 'checking'},
          'download.requested': [{guard: 'usesExternalDownload', actions: 'openDownloadPage'}, {target: 'downloading'}],
          dismiss: {target: 'idle'},
        },
      },
      downloading: {
        invoke: {
          src: 'download',
          input: ({context}) => context.updateInfo!,
          onError: {
            target: 'error',
            actions: {type: 'recordError', params: ({event}) => ({error: event.error})},
          },
        },
        on: {
          'download.progress': {actions: assign({progress: ({event}) => event.progress})},
          'download.completed': {
            target: 'verifying',
            actions: assign({download: ({event}) => event.download}),
          },
          'download.failed': {
            target: 'error',
            actions: {type: 'recordError', params: ({event}) => ({error: event.error})},
          },
        },
      },
      verifying: {
        invoke: {
          src: 'verify',
          input: ({context}) => context.download!,
          onDone: {target: 'ready'},
          onError: {
            target: 'error',
            actions: {type: 'recordError', params: ({event}) => ({error: event.error})},
          },
        },
      },
      ready: {
        initial: 'prompt',
        on: {
          'restart.requested': {target: 'restarting'},
          'check.requested': {guard: 'isManualCheck', target: '.prompt'},
        },
        states: {
          prompt: {on: {dismiss: {target: 'deferred'}}},
          deferred: {},
        },
      },
      restarting: {
        invoke: {
          src: 'install',
          input: ({context}) => context.download!,
          onDone: {target: 'idle'},
          onError: {
            target: 'error',
            actions: {type: 'recordError', params: ({event}) => ({error: event.error})},
          },
        },
      },
      error: {
        on: {
          'check.requested': {target: 'checking'},
          dismiss: {target: 'idle'},
        },
      },
    },
  })
}

/** Main-process update coordinator actor. */
export type AutoUpdateActor = ActorRefFrom<ReturnType<typeof createAutoUpdateMachine>>

/** Projects the actor's authoritative state into the renderer IPC contract. */
export function getAutoUpdateStatus(snapshot: SnapshotFrom<ReturnType<typeof createAutoUpdateMachine>>): UpdateStatus {
  const {context} = snapshot
  if (snapshot.matches('available')) return {type: 'update-available', updateInfo: context.updateInfo!}
  if (snapshot.matches('downloading')) return {type: 'downloading', progress: context.progress}
  if (snapshot.matches('verifying')) return {type: 'verifying'}
  if (snapshot.matches('ready')) {
    return {type: 'ready-to-restart', updateInfo: context.updateInfo!, deferred: snapshot.matches({ready: 'deferred'})}
  }
  if (snapshot.matches('restarting')) return {type: 'restarting'}
  if (snapshot.matches('checking')) return {type: 'checking'}
  if (snapshot.matches('upToDate')) return {type: 'up-to-date'}
  if (snapshot.matches('error')) return {type: 'error', error: context.error!}
  return {type: 'idle'}
}
