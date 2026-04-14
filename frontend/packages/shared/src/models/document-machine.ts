import {
  HMBlockNode,
  HMDocument,
  HMDraft,
  HMNavigationItem,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {assign, fromPromise, raise, setup, StateFrom} from 'xstate'

// -- Types --

/** Input provided when creating the document machine actor. */
export type DocumentMachineInput = {
  documentId: UnpackedHypermediaId
  canEdit: boolean
  isLatest?: boolean
  existingDraftId?: string
  editUid?: string
  editPath?: string[]
  locationUid?: string
  locationPath?: string[]
  deps?: string[]
  signingAccountId?: string
  publishAccountUid?: string
}

/** Full context managed by the machine. */
export type DocumentMachineContext = {
  documentId: UnpackedHypermediaId
  draftId: string | null
  document: HMDocument | null
  metadata: HMDraft['metadata']
  deps: string[]
  publishedVersion: string | null
  pendingRemoteVersion: string | null
  isLatestVersion: boolean
  navigation: HMNavigationItem[] | undefined
  locationUid: string
  locationPath: string[]
  editUid: string
  editPath: string[]
  canEdit: boolean
  hasChangedWhileSaving: boolean
  draftCreated: boolean
  /** True only when machine was initialized with an existingDraftId — drives auto-enter editing. Cleared after first use. */
  shouldAutoEdit: boolean
  signingAccountId: string | null
  publishAccountUid: string | null
  /** True once the document query has resolved during loading. */
  documentReady: boolean
  /** True once the draft query has resolved during loading (either found or not found). */
  draftReady: boolean
  /** Draft content loaded on init. Only set during loading — not updated on autosave. */
  draftContent: HMBlockNode[] | null
  /** Cursor position saved in the draft file; restored when re-entering editing after reload. */
  draftCursorPosition: number | null
  error: unknown
}

/** All events the machine can receive. */
export type DocumentMachineEvent =
  | {type: 'document.loaded'; document: HMDocument}
  | {type: 'document.error'; error: unknown}
  | {type: 'document.retry'}
  | {type: 'edit.start'}
  | {type: 'edit.cancel'}
  | {type: 'change'; metadata?: HMDraft['metadata']}
  | {type: 'change.navigation'; navigation: HMNavigationItem[]}
  | {type: 'reset.content'}
  | {type: 'publish.start'}
  | {type: 'document.remoteUpdate'; document: HMDocument}
  | {type: 'edit.discard'}
  | {type: 'capability.changed'; canEdit: boolean}
  | {type: 'account.changed'; signingAccountId?: string; publishAccountUid?: string}
  | {type: 'edit.confirm'}
  | {type: 'version.changed'; isLatest: boolean}
  | {type: 'draft.existing'; draftId: string}
  | {type: 'draft.resolved'; draftId: string | null; content: HMBlockNode[] | null; cursorPosition: number | null}
  | {type: '_save.started'}
  | {type: '_save.completed'}

/** Input for the writeDraft actor. */
export type WriteDraftInput = {
  draftId: string | null
  metadata: HMDraft['metadata']
  deps: string[]
  navigation: HMNavigationItem[] | undefined
  locationUid: string
  locationPath: string[]
  editUid: string
  editPath: string[]
  signingAccountId: string | null
}

/** Input for the publishDocument actor. */
export type PublishInput = {
  documentId: UnpackedHypermediaId
  draftId: string
  deps: string[]
  metadata: HMDraft['metadata']
  navigation: HMNavigationItem[] | undefined
  publishAccountUid: string | null
}

export type DocumentMachineState = StateFrom<typeof documentMachine>

// -- Machine --

export const documentMachine = setup({
  types: {
    input: {} as DocumentMachineInput,
    context: {} as DocumentMachineContext,
    events: {} as DocumentMachineEvent,
  },
  actions: {
    setDocumentData: assign({
      document: ({event}) => {
        if (event.type === 'document.loaded' || event.type === 'document.remoteUpdate') {
          return event.document
        }
        return null
      },
      publishedVersion: ({event}) => {
        if (event.type === 'document.loaded' || event.type === 'document.remoteUpdate') {
          return event.document.version
        }
        return null
      },
    }),
    setMetadata: assign({
      metadata: ({context, event}) => {
        if (event.type === 'change' && event.metadata) {
          return {...context.metadata, ...event.metadata}
        }
        return context.metadata
      },
    }),
    setNavigation: assign({
      navigation: ({event}) => {
        if (event.type === 'change.navigation') {
          return event.navigation
        }
        return undefined
      },
    }),
    setDepsFromPublished: assign({
      deps: ({context}) => (context.publishedVersion ? [context.publishedVersion] : context.deps),
    }),
    setPendingRemoteVersion: assign({
      pendingRemoteVersion: ({event}) => {
        if (event.type === 'document.remoteUpdate') {
          return event.document.version
        }
        return null
      },
    }),
    setDraftIdFromResult: assign({
      draftId: (_, params: {id: string}) => params.id,
    }),
    setDraftCreated: assign({
      draftCreated: true,
    }),
    resetChangeWhileSaving: assign({
      hasChangedWhileSaving: false,
    }),
    setHasChangedWhileSaving: assign({
      hasChangedWhileSaving: true,
    }),
    setError: assign({
      error: ({event}) => {
        if (event.type === 'document.error') {
          return event.error
        }
        return null
      },
    }),
    clearShouldAutoEdit: assign({
      shouldAutoEdit: false,
    }),
    setCanEdit: assign({
      canEdit: ({event}) => {
        if (event.type === 'capability.changed') {
          return event.canEdit
        }
        return false
      },
    }),
    setIsLatestVersion: assign({
      isLatestVersion: ({event}) => (event.type === 'version.changed' ? event.isLatest : true),
    }),
    clearDraftState: assign({
      draftId: null,
      draftCreated: false,
      hasChangedWhileSaving: false,
      pendingRemoteVersion: null,
      draftContent: null,
      draftCursorPosition: null,
      metadata: {},
      navigation: undefined,
    }),
    clearEditingState: assign({
      // Preserve draftId so re-entering editing reuses the same draft
      draftCreated: false,
      hasChangedWhileSaving: false,
      pendingRemoteVersion: null,
      metadata: {},
      navigation: undefined,
    }),
    markDocumentReady: assign({
      documentReady: true,
    }),
    setDraftResolved: assign({
      draftReady: true,
      draftId: ({event, context}) => {
        if (event.type === 'draft.resolved' && event.draftId) return event.draftId
        return context.draftId
      },
      draftCreated: ({event, context}) => {
        if (event.type === 'draft.resolved' && event.draftId) return true
        return context.draftCreated
      },
      shouldAutoEdit: ({event, context}) => {
        if (event.type === 'draft.resolved' && event.draftId) return true
        return context.shouldAutoEdit
      },
      draftContent: ({event}) => {
        if (event.type === 'draft.resolved') return event.content ?? null
        return null
      },
      draftCursorPosition: ({event}) => {
        if (event.type === 'draft.resolved') return event.cursorPosition ?? null
        return null
      },
    }),
    setExistingDraft: assign({
      draftId: ({event}) => {
        if (event.type === 'draft.existing') {
          return event.draftId
        }
        return null
      },
      draftCreated: true,
      shouldAutoEdit: true,
      draftReady: true,
    }),
    setAccountIds: assign({
      signingAccountId: ({context, event}) => {
        if (event.type === 'account.changed' && event.signingAccountId !== undefined) {
          return event.signingAccountId || null
        }
        return context.signingAccountId
      },
      publishAccountUid: ({context, event}) => {
        if (event.type === 'account.changed' && event.publishAccountUid !== undefined) {
          return event.publishAccountUid || null
        }
        return context.publishAccountUid
      },
    }),
    notifyPublishSuccess: () => {
      // Provided via .provide() in consuming app
    },
    updatePublishedVersion: assign({
      publishedVersion: ({event}) => {
        // After publish completes, the done event output is the new HMDocument
        // We extract the version from it
        const doc = (event as any).output as HMDocument
        return doc?.version ?? null
      },
      document: ({event}) => {
        const doc = (event as any).output as HMDocument
        return doc ?? null
      },
    }),
  },
  guards: {
    canTransitionToEditing: ({context}) => context.canEdit,
    canEditOldVersion: ({context}) => context.canEdit && !context.isLatestVersion,
    didChangeWhileSaving: ({context}) => context.hasChangedWhileSaving,
    hasDraftId: ({context}) => context.draftId !== null,
    hasExistingDraft: ({context}) => context.shouldAutoEdit,
    hasRemoteUpdate: ({context}) => context.pendingRemoteVersion !== null,
    bothSourcesReady: ({context}) => context.documentReady && context.draftReady,
    capabilityLost: ({event}) => event.type === 'capability.changed' && !event.canEdit,
  },
  actors: {
    writeDraft: fromPromise<{id: string}, WriteDraftInput>(async () => {
      throw new Error('writeDraft actor must be provided via .provide()')
    }),
    publishDocument: fromPromise<HMDocument, PublishInput>(async () => {
      throw new Error('publishDocument actor must be provided via .provide()')
    }),
  },
  delays: {
    autosaveTimeout: 500,
    loadingTimeout: 10_000,
    saveIndicatorDismiss: 1000,
  },
}).createMachine({
  /** @xstate-layout N4IgpgJg5mDOIC5QBED2BjArgWzAOwBcAZASwDMx0BPdAGzADpbUBDCEvKAYggx3wJNWESAG0ADAF1EoAA6pYJAiVR4ZIAB6IAHOIDsDACyGAnCYCse7SYCM2mw4A0IKogBM58QwBsAZmt63tp6Nt4WFgC+Ec5oWLiEpBTUdIzMbBzcvHECDGAATnmoeRLSSCDyisqq6loIpiYMFuL22m7ihuIehs6uCG6+5gzawd5u-d7ifg5RMXzxxOSUNPRC6ZxcGrAELASMLGS7eQAUaeycACokuKiYBACUXLH8CYvJK6cZJeoVSipqZbVzDZBn5tL5jOITNpRsCeohzGEfOZhiY3CZDHpkcYZiAnvNEksUqsRBAuJAlAwtiw8gQvmUflV-qBajZfFCGOIbP1fA4uX5vOY4Qg9B4GG4HOJzFCJYYxji8QICW9UsJIDw5jk8mBsKhdgBVWQQHZgOlyBS-aoAxAmPQNKGmXydSFBcFChzaJHWNnacyGcyWQLyjUvJLLFVsNWm8rmxk1RCs9mc7m8tz8wUuRC+PxGaxhTwmbyGByGIPZEOElbk5TrKsMdAsPDoMC0KMMv5xhCszkMLlF8H2foWboZhD2HvBNzQqysnmF0vPBaholVjJcdAACwbMAYeBYADcSFAdn9WzH21bO3pwT5UZy9HpDKNbUKBjYOeY2j6gh-J9p5-jXjDXJ2GrbgNy3RhdwPI9GVEGxSjNSpz2ZeMr0MG82hse9HzcZ8RxTBhbUCItDAGP0oX-RVAOXEDVyyBcGC1HV9UNY1TyQy0UL6B8DFIvlmnFXQ3DdaEGA-CZjARcxfF8NxSMo8tlWA35OAYEgIHoNdN04E0pG+M9OM0dxWi8TpRk5STPEmIVMUGWxtCLe8HPsLCFMXCtGBXVT1M0rVYDAQR0FUXZCHYi0mSMvoTI5VNMMs8RrJHH03w8EJbKCAdzDcpUgK8qA1I0sAuFkTAACNaBIWB10pbYaTC2MLw-N0eV8G92mMMwEtlGxsuoytaNU8CdNJIaYHq5DIp5XCGF8B80UhLCpVTIVvyGIFrBsSErALHrolxYN3KUvK620mBST8gK62CgRxsM2opta3R7VTUj7JWgYhhMfR-A-DETFk3ql36lT8tGtVNm2XYGH2Q4jhYW4FH3MBLmuW4HgVRTcoG0HTrEPT6QMiL7twhoxgFcRZtTPRORs4IjARbwsL9YFbRMQGPOU0CTog0kIeNaGDnyOGEdgJGUbAG57keA6cpokHueGuCEOjDiieMtoYvMmx4sS3pqY9CwHx9UiMoLdmjuxustWPdZeDwRgOD3VAAGtGAAdzyJQwGQPIYdutW+lfIwC1MJ9ZWGXw3WBdDvELRnsNsaSSz2jHDqx+X0Gt0D1XttS8Cd12GA9r2fb9+D9NVjt+iBYPCwLXDw7BN0KZBfxbUlATCz0c3065zOwBt7h8kKPIGFkWgdjIIpsCLz3dlLg5-aroPQ9Dhvf0jkd0Vax1OllRmWqCHu5b7rPVzBpeLzabxeLCVMbAsLM+yFMw3xCWwQ+CdpwWP4HT4H7OF1ArXVCvjRC4Uq6TFvqiRmj9CysiFLmGauhSJf0dPvX+nlLaiwPLbVQDt84u3dnPb2vtF5gJVhAi8Ax0SETktJEYaI8J60mI0SUuFZrWHRLtWYZY04nwyJSfcdF8F5wLsQkuZDaTlwJpXahjpBgP0COKKYQQX5XjFJw2BN8hxZRTjLPqWD5Y4NXMPIoY8J4ECnnkGexd55SMvlxcEGsBiTFTJKHknQhSmHQmMbWhYAxjFRJgzmgiTHrAvhQtsd1MwClaglL6WYrybShN4IUWIhi2jkgMIEkpQghOOuE7gQCrqEBulEwmHYszSQ5JCCmN9PGpO8dYMSHRDA+kCNTTw94QklXKpVdcgiOAAAVChQD8rAHOBDxFjzKhVKqqdHGTWaIRAstopTEVZHoRB3Yiwuk5AKOw4pelzIGUMvAozUDjLgJMsxo9x6T2nrM-pCyDpLNqDaVqsUzDBHaeKCwiDURiTCK+bqzQH4nJeYMwa9AGwZANFwd51oNHfKhEbf56ZejSTcKsiYaJ0GShvlEPaeBUAiHgGUVOst6AVyoVxAAtP4sS99QiDmkveIU9K7JmB5QKG+j5qZuBCR8TgtKGpcSBdCQs-gKaoP+m6IsYkZKJMhOJMwejeELmpeGEkYqJosjJjNGSD8ZyTD9MOXoAwDaYk6FCGSyIgQav2nw7VoTRWyLpZFUIok753gfE+EwQpUyPTjknHJvp5L6JdYYt1+UfJgD1TE7iDgjBFm1jOEIyI0lb0LHQx0LQsKEr-FGrVMbjpgwgImgOPJZRrU5Ale8skPyYsQFYbwPYvqFmGC0AsbMS0ASBkY-+g8q2QMfEMLCN8b5SlGNJKOdhCJ+jJiKKUsli2aoHRzQpwj3XgPFZNPwOKBgPkdbNZom89bIiGLHa+WzoQA37VRQdzz5nQqgKOi89L2TiQcKMNk7KQgrWzH4La1cEmBkfZjIkfTX3nMudc2AFK936sQFyrwP7WX-tmiEC1rbbC1K7t67ptpIWwZhQPPA8LZAfq4s2nsmJbAU02oEawNlPATvsP9aEzQP4FIKEUGjkURQpQ6X4fwX0sLbJHMYdtbJJwZTcTabwxKIhAA */
  id: 'DocumentLifecycle',
  context: ({input}) => ({
    documentId: input.documentId,
    draftId: input.existingDraftId ?? null,
    document: null,
    metadata: {},
    deps: input.deps ?? [],
    publishedVersion: null,
    pendingRemoteVersion: null,
    isLatestVersion: input.isLatest ?? true,
    navigation: undefined,
    locationUid: input.locationUid ?? '',
    locationPath: input.locationPath ?? [],
    editUid: input.editUid ?? '',
    editPath: input.editPath ?? [],
    canEdit: input.canEdit,
    hasChangedWhileSaving: false,
    draftCreated: !!input.existingDraftId,
    shouldAutoEdit: !!input.existingDraftId,
    signingAccountId: input.signingAccountId ?? null,
    publishAccountUid: input.publishAccountUid ?? null,
    documentReady: false,
    draftReady: !!input.existingDraftId,
    draftContent: null,
    draftCursorPosition: null,
    error: null,
  }),
  initial: 'loading',
  states: {
    loading: {
      on: {
        'document.loaded': {
          // Don't transition yet — wait for draft resolution too.
          actions: ['setDocumentData', 'markDocumentReady'],
        },
        'draft.resolved': {
          actions: ['setDraftResolved'],
        },
        'document.error': {
          // Stay in loading — React Query retries in the background.
          // Store the error for optional inline display (e.g. "retrying…").
          actions: ['setError'],
        },
        'capability.changed': {
          actions: ['setCanEdit'],
        },
        'account.changed': {
          actions: ['setAccountIds'],
        },
        'draft.existing': {
          actions: ['setExistingDraft'],
        },
        'version.changed': {
          actions: ['setIsLatestVersion'],
        },
      },
      always: {
        target: 'loaded',
        guard: 'bothSourcesReady',
      },
      after: {
        loadingTimeout: {
          target: 'error',
        },
      },
    },

    loaded: {
      on: {
        'edit.start': [
          {
            target: 'confirmingOldVersionEdit',
            guard: 'canEditOldVersion',
          },
          {
            target: 'editing',
            guard: 'canTransitionToEditing',
            actions: ['setDepsFromPublished'],
          },
        ],
        'document.remoteUpdate': {
          target: 'loaded',
          actions: ['setDocumentData'],
          reenter: true,
        },
        'capability.changed': {
          actions: ['setCanEdit'],
        },
        'account.changed': {
          actions: ['setAccountIds'],
        },
        'version.changed': {
          actions: ['setIsLatestVersion'],
        },
        'draft.existing': {
          target: 'editing',
          actions: ['setExistingDraft', 'clearShouldAutoEdit', 'setDepsFromPublished'],
        },
      },
      always: {
        target: 'editing',
        guard: ({context}) => context.shouldAutoEdit && context.isLatestVersion,
        actions: ['clearShouldAutoEdit', 'setDepsFromPublished'],
      },
    },

    confirmingOldVersionEdit: {
      on: {
        'edit.confirm': {
          target: 'editing',
          actions: ['setDepsFromPublished'],
        },
        'edit.cancel': {
          target: 'loaded',
        },
        'capability.changed': {
          actions: ['setCanEdit'],
        },
        'account.changed': {
          actions: ['setAccountIds'],
        },
        'version.changed': {
          actions: ['setIsLatestVersion'],
        },
      },
    },

    editing: {
      type: 'parallel',
      on: {
        'edit.cancel': {
          target: 'loaded',
          actions: ['clearEditingState'],
        },
        'edit.discard': {
          target: 'loaded',
          actions: ['clearDraftState'],
        },
        'capability.changed': [
          {
            target: 'loaded',
            guard: 'capabilityLost',
            actions: ['setCanEdit', 'clearEditingState'],
          },
          {
            actions: ['setCanEdit'],
          },
        ],
        'account.changed': {
          actions: ['setAccountIds'],
        },
        'document.remoteUpdate': {
          actions: ['setPendingRemoteVersion'],
        },
        'version.changed': {
          actions: ['setIsLatestVersion'],
        },
      },
      states: {
        draft: {
          initial: 'idle',
          on: {
            'change.navigation': [
              {
                target: '.saving',
                guard: 'hasDraftId',
                actions: ['setNavigation'],
              },
              {
                target: '.creating',
                actions: ['setNavigation'],
              },
            ],
          },
          states: {
            idle: {
              on: {
                change: {
                  target: 'changed',
                  actions: ['setMetadata'],
                },
                'reset.content': {
                  target: 'changed',
                },
                'publish.start': {
                  target: '#DocumentLifecycle.publishing',
                  guard: 'hasDraftId',
                },
              },
            },
            changed: {
              on: {
                change: {
                  target: 'changed',
                  actions: ['setMetadata'],
                  reenter: true,
                },
                'reset.content': {
                  target: 'changed',
                  reenter: true,
                },
              },
              after: {
                autosaveTimeout: [
                  {
                    target: 'saving',
                    guard: 'hasDraftId',
                  },
                  {
                    target: 'creating',
                  },
                ],
              },
            },
            creating: {
              entry: ['resetChangeWhileSaving', raise({type: '_save.started'})],
              on: {
                change: {
                  actions: ['setHasChangedWhileSaving', 'setMetadata'],
                },
                'reset.content': {
                  actions: ['setHasChangedWhileSaving'],
                },
              },
              invoke: {
                id: 'writeDraft',
                src: 'writeDraft',
                input: ({context}) => ({
                  draftId: context.draftId,
                  metadata: context.metadata,
                  deps: context.deps,
                  navigation: context.navigation,
                  locationUid: context.locationUid,
                  locationPath: context.locationPath,
                  editUid: context.editUid,
                  editPath: context.editPath,
                  signingAccountId: context.signingAccountId,
                }),
                onDone: [
                  {
                    target: 'saving',
                    guard: 'didChangeWhileSaving',
                    actions: [
                      'setDraftCreated',
                      {
                        type: 'setDraftIdFromResult',
                        params: ({event}: {event: any}) => event.output,
                      },
                    ],
                    reenter: true,
                  },
                  {
                    target: 'idle',
                    actions: [
                      'setDraftCreated',
                      {
                        type: 'setDraftIdFromResult',
                        params: ({event}: {event: any}) => event.output,
                      },
                      raise({type: '_save.completed'}),
                    ],
                  },
                ],
                onError: {
                  target: 'idle',
                  actions: [
                    ({event}: {event: any}) => {
                      console.error('Draft create failed:', event.error)
                    },
                    raise({type: '_save.completed'}),
                  ],
                },
              },
            },
            saving: {
              entry: ['resetChangeWhileSaving', raise({type: '_save.started'})],
              on: {
                change: {
                  actions: ['setHasChangedWhileSaving', 'setMetadata'],
                },
                'reset.content': {
                  actions: ['setHasChangedWhileSaving'],
                },
              },
              invoke: {
                id: 'writeDraft',
                src: 'writeDraft',
                input: ({context}) => ({
                  draftId: context.draftId,
                  metadata: context.metadata,
                  deps: context.deps,
                  navigation: context.navigation,
                  locationUid: context.locationUid,
                  locationPath: context.locationPath,
                  editUid: context.editUid,
                  editPath: context.editPath,
                  signingAccountId: context.signingAccountId,
                }),
                onDone: [
                  {
                    target: 'saving',
                    guard: 'didChangeWhileSaving',
                    reenter: true,
                  },
                  {
                    target: 'idle',
                    actions: [raise({type: '_save.completed'})],
                  },
                ],
                onError: {
                  target: 'idle',
                  actions: [
                    ({event}: {event: any}) => {
                      console.error('Draft save failed:', event.error)
                    },
                    raise({type: '_save.completed'}),
                  ],
                },
              },
            },
          },
        },
        saveIndicator: {
          initial: 'hidden',
          states: {
            hidden: {
              on: {
                '_save.started': {
                  target: 'saving',
                },
              },
            },
            saving: {
              on: {
                '_save.completed': {
                  target: 'saved',
                },
              },
            },
            saved: {
              after: {
                saveIndicatorDismiss: {
                  target: 'hidden',
                },
              },
              on: {
                '_save.started': {
                  target: 'saving',
                },
              },
            },
          },
        },
      },
    },

    publishing: {
      initial: 'inProgress',
      states: {
        inProgress: {
          invoke: {
            id: 'publishDocument',
            src: 'publishDocument',
            input: ({context}) => ({
              documentId: context.documentId,
              draftId: context.draftId!,
              deps: context.deps,
              metadata: context.metadata,
              navigation: context.navigation,
              publishAccountUid: context.publishAccountUid,
            }),
            onDone: {
              target: 'cleaningUp',
            },
            onError: {
              target: '#DocumentLifecycle.editing.draft.idle',
            },
          },
        },
        cleaningUp: {
          entry: ['notifyPublishSuccess', 'clearDraftState', 'updatePublishedVersion'],
          always: {
            target: '#DocumentLifecycle.loaded',
          },
        },
      },
    },

    error: {
      on: {
        'document.retry': {
          target: 'loading',
          actions: [assign({error: null})],
        },
        'capability.changed': {
          actions: ['setCanEdit'],
        },
        'account.changed': {
          actions: ['setAccountIds'],
        },
        'version.changed': {
          actions: ['setIsLatestVersion'],
        },
      },
    },
  },
})
