import {dispatchDraftStatus, DraftStatus} from '@/draft-status'
import {
  HMDraft,
  HMEntityContent,
  HMNavigationItem,
  invalidateQueries,
} from '@shm/shared'
import {assign, setup, StateFrom} from 'xstate'

export type DraftMachineState = StateFrom<typeof draftMachine>

export const draftMachine = setup({
  types: {
    input: {} as {
      id: string
      locationUid?: string
      locationPath?: string[]
      editUid?: string
      editPath?: string[]
      deps?: string[]
    },
    context: {} as {
      nameRef: null | HTMLTextAreaElement
      id: string
      metadata: HMDraft['metadata']
      deps: HMDraft['deps']
      locationUid: HMDraft['locationUid']
      locationPath: HMDraft['locationPath']
      editUid: HMDraft['editUid']
      editPath: HMDraft['editPath']
      signingAccount: HMDraft['signingAccount']
      navigation?: HMNavigationItem[]
      error: any // TODO: fix types
      changed: boolean
      hasChangedWhileSaving: boolean
      draftCreated: boolean
    },
    events: {} as
      | {
          type: 'fetch.success'
          payload:
            | {type: 'load.new.draft'}
            | {type: 'draft'; data: HMDraft}
            | {type: 'location'; data: HMEntityContent}
            | {type: 'edit'; data: HMEntityContent}
        }
      | {
          type: 'fetch.error'
          error: any
        }
      | {
          type: 'change'
          metadata?: HMDraft['metadata']
          signingAccount?: string
        }
      | {
          type: 'change.navigation'
          navigation: HMNavigationItem[]
        }
      | {
          type: 'reset.content'
        }
      | {
          type: 'set.nameRef'
          nameRef: HTMLTextAreaElement
        },
  },
  actions: {
    setErrorMessage: ({event}) => {
      if (event.type === 'fetch.error') {
        return {
          error: event.error,
        }
      }
    },
    onSaveSuccess: ({context, event}, params: {id: string}) => {
      invalidateQueries(['trpc.drafts.get', params.id])
    },
    onCreatingSuccess: ({context}) => {},
    populateData: assign({
      metadata: ({context, event}) => {
        if (event.type == 'fetch.success') {
          if (event.payload.type == 'draft') {
            return {
              ...context.metadata,
              ...event.payload.data.metadata,
            }
          } else if (event.payload.type != 'load.new.draft') {
            return {
              ...context.metadata,
              ...event.payload.data.document?.metadata,
            }
          }
        }
        return context.metadata
      },
      signingAccount: ({context, event}) => {
        if (event.type == 'fetch.success') {
          if (
            event.payload.type == 'draft' &&
            event.payload.data.signingAccount
          ) {
            return event.payload.data.signingAccount
          }
        }
        return context.signingAccount
      },
      deps: ({context, event}) => {
        if (event.type == 'fetch.success') {
          if (event.payload.type == 'draft' && event.payload.data.deps) {
            return event.payload.data.deps
          }
        }
        return context.deps
      },
      navigation: ({context, event}) => {
        if (event.type == 'fetch.success') {
          if (event.payload.type == 'draft') {
            return event.payload.data.navigation
          }
        }
        return context.navigation
      },
    }),
    focusContent: ({context}) => {},
    replaceRoute: ({context}, params: {id: string}) => {},
    setDraftId: assign({
      id: (_, params: {id: string}) => params.id,
    }),
    setNavigation: assign({
      navigation: ({event}) => {
        if (event.type === 'change.navigation') {
          console.log('Setting navigation in draft machine:', event.navigation)
          return event.navigation
        }
        return undefined
      },
    }),
    setAttributes: assign({
      metadata: ({context, event}) => {
        if (event.type == 'fetch.success') {
          if (event.payload.type == 'draft') {
            return {
              ...context.metadata,
              ...event.payload.data.metadata,
            }
          } else if (event.payload.type != 'load.new.draft') {
            return {
              ...context.metadata,
              ...event.payload.data.document?.metadata,
            }
          }
        }
        if (event.type == 'change') {
          return {
            ...context.metadata,
            ...event.metadata,
          }
        }
        return context.metadata
      },
    }),
    setSigningAccount: assign({
      signingAccount: ({event, context}) => {
        if (event.type == 'fetch.success') {
          if (
            event.payload.type == 'draft' &&
            event.payload.data.signingAccount
          ) {
            return event.payload.data.signingAccount
          } else {
            return context.signingAccount
          }
        } else if (event.type == 'change' && event.signingAccount) {
          return event.signingAccount
        }
        return context.signingAccount
      },
    }),
    resetContent: ({context}) => {
      return context
    },
    setDraftStatus: function (_, params: {status: DraftStatus}) {
      dispatchDraftStatus(params.status)
    },
    setNameRef: assign({
      nameRef: ({event}) => {
        if (event.type == 'set.nameRef') {
          return event.nameRef
        }
        return null
      },
    }),
    resetChangeWhileSaving: assign({
      hasChangedWhileSaving: false,
    }),
    focusEditor: function () {},
    setHasChangedWhileSaving: assign({
      hasChangedWhileSaving: true,
    }),
    setDraftCreated: assign({
      draftCreated: ({event}, params: {draftCreated: boolean}) => {
        return params.draftCreated
      },
    }),
  },
  guards: {
    didChangeWhileSaving: ({context}) => context.hasChangedWhileSaving,
  },
  delays: {
    autosaveTimeout: 500,
  },
}).createMachine({
  id: 'Draft',
  context: ({input}) => {
    return {
      id: input.id,
      metadata: {},
      deps: input.deps || [],
      locationUid: input.locationUid ?? '',
      locationPath: input.locationPath ?? [],
      editUid: input.editUid ?? '',
      editPath: input.editPath ?? [],
      signingAccount: '',
      navigation: undefined,
      nameRef: null,
      changed: false,
      hasChangedWhileSaving: false,
      draftCreated: !!input.id,
      error: '',
    }
  },
  initial: 'fetching',
  on: {
    change: {
      actions: [
        {
          type: 'setSigningAccount',
        },
      ],
    },
  },
  states: {
    fetching: {
      on: {
        'fetch.success': [
          {
            target: 'editing',
            guard: ({event}) => event.payload.type === 'load.new.draft',
          },
          {
            target: 'setupData',
          },
        ],
        'fetch.error': {
          target: 'error',
          actions: [{type: 'setErrorMessage'}],
        },
      },
    },
    setupData: {
      entry: ['populateData'],
      after: {
        100: {
          target: 'editing',
        },
      },
    },
    editing: {
      initial: 'idle',
      entry: [
        {
          type: 'setDraftStatus',
          params: {status: 'idle'},
        },
      ],
      on: {
        'change.navigation': [
          {
            target: '.saving',
            guard: ({context}) => !!context.id,
            actions: [
              {
                type: 'setNavigation',
              },
            ],
          },
          {
            target: '.creating',
            actions: [
              {
                type: 'setNavigation',
              },
            ],
          },
        ],
      },
      after: {
        200: {
          actions: [{type: 'focusContent'}],
        },
      },
      states: {
        idle: {
          on: {
            change: {
              target: 'changed',
              actions: [{type: 'setAttributes'}, {type: 'setSigningAccount'}],
            },
            'reset.content': {target: 'changed', actions: ['resetContent']},
          },
        },
        changed: {
          entry: [{type: 'setDraftStatus', params: {status: 'changed'}}],
          on: {
            change: {
              target: 'changed',
              actions: [{type: 'setAttributes'}, {type: 'setSigningAccount'}],
              reenter: true,
            },
            'reset.content': {
              target: 'changed',
              actions: [{type: 'resetContent'}],
              reenter: true,
            },
          },
          after: {
            autosaveTimeout: [
              {
                target: 'saving',
                guard: ({context}) => !!context.id,
              },
              {
                target: 'creating',
              },
            ],
          },
        },
        creating: {
          entry: [
            'resetChangeWhileSaving',
            {type: 'setDraftStatus', params: {status: 'saving'}},
          ],
          on: {
            change: {
              target: 'saving',
              actions: [
                {type: 'setHasChangedWhileSaving'},
                {type: 'setAttributes'},
                {type: 'setSigningAccount'},
              ],
              reenter: false,
            },
            'reset.content': {
              target: 'saving',
              actions: [
                {type: 'setHasChangedWhileSaving'},
                {type: 'resetContent'},
              ],
              reenter: false,
            },
          },
          invoke: {
            id: 'writeDraft',
            src: 'writeDraft',
            input: ({context}) => ({
              metadata: context.metadata,
              deps: context.deps,
              signingAccount: context.signingAccount,
              navigation: context.navigation,
            }),
            onDone: [
              {
                target: 'saving',
                actions: [
                  {type: 'setDraftCreated', params: {draftCreated: true}},
                ],
                guard: 'didChangeWhileSaving',
                reenter: true,
              },
              {
                target: 'idle',
                actions: [
                  {type: 'setDraftCreated', params: {draftCreated: true}},

                  {
                    type: 'setDraftStatus',
                    params: {status: 'saved'},
                  },
                  {
                    type: 'setDraftId',
                    params: ({event}: {event: any}) => event.output,
                  },
                  {
                    type: 'onCreatingSuccess',
                    params: ({event}: {event: any}) => event.output,
                  },
                  {
                    type: 'replaceRoute',
                    params: ({event}: {event: any}) => event.output,
                  },
                ],
              },
            ],
            onError: {
              actions: [
                () => {
                  console.log('=== DRAFT onError: ')
                },
              ],
            },
          },
        },
        saving: {
          entry: [
            'resetChangeWhileSaving',
            {type: 'setDraftStatus', params: {status: 'saving'}},
          ],
          on: {
            change: {
              target: 'saving',
              actions: [
                {type: 'setHasChangedWhileSaving'},
                {type: 'setAttributes'},
                {type: 'setSigningAccount'},
              ],
              reenter: false,
            },
            'reset.content': {
              target: 'saving',
              actions: [
                {type: 'setHasChangedWhileSaving'},
                {type: 'resetContent'},
              ],
              reenter: false,
            },
          },
          invoke: {
            id: 'writeDraft',
            src: 'writeDraft',
            input: ({context}) => ({
              metadata: context.metadata,
              deps: context.deps,
              signingAccount: context.signingAccount,
              navigation: context.navigation,
            }),
            onDone: [
              {
                target: 'saving',
                guard: 'didChangeWhileSaving',
                reenter: true,
              },
              {
                target: 'idle',
                actions: [
                  {
                    type: 'onSaveSuccess',
                    params: ({event}) => event.output,
                  },
                  // {type: 'setDraft'},
                  {type: 'setAttributes'},
                  {type: 'setSigningAccount'},
                  {
                    type: 'setDraftStatus',
                    params: {status: 'saved'},
                  },
                ],
              },
            ],
            onError: {
              actions: [
                () => {
                  console.log('=== DRAFT onError: ')
                },
              ],
            },
          },
        },
      },
    },
    error: {},
  },
})
