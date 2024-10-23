import {dispatchDraftStatus, DraftStatus} from '@/draft-status'
import {HMDocument, HMDraft, HMMetadata} from '@shm/shared'
import {assign, setup, StateFrom} from 'xstate'

export type DraftMachineState = StateFrom<typeof draftMachine>

export const draftMachine = setup({
  types: {
    context: {} as {
      metadata: HMMetadata
      signingAccount: null | string
      draft: null | HMDraft
      document: null | HMDocument
      errorMessage: string
      restoreTries: number
      changed: boolean
      hasChangedWhileSaving: boolean
    },
    events: {} as
      | {
          type: 'CHANGE'
          metadata?: HMDraft['metadata']
          signingAccount?: string
        }
      | {type: 'RESET.DRAFT'}
      | {type: 'RESTORE.DRAFT'}
      | {type: 'RESET.CORRUPT.DRAFT'}
      | {type: 'GET.DRAFT.ERROR'; error: any}
      | {type: 'GET.DRAFT.RETRY'}
      | {type: 'GET.DRAFT.SUCCESS'; draft: HMDraft; document: null | HMDocument}
      | {type: 'SAVE.ON.EXIT'}
      | {type: 'EMPTY.ID'},
  },

  actions: {
    setDraft: assign({
      draft: ({event}) => {
        if (event.type == 'GET.DRAFT.SUCCESS') {
          return event.draft
        }
        return null
      },
    }),
    setDocument: assign({
      document: ({event}) => {
        if (event.type == 'GET.DRAFT.SUCCESS') {
          return event.document
        }
        return null
      },
    }),
    setAttributes: assign({
      metadata: ({context, event}) => {
        if (event.type == 'GET.DRAFT.SUCCESS') {
          if (event.draft) {
            return {
              ...context.metadata,
              ...event.draft.metadata,
            }
          } else if (event.document) {
            return {
              ...context.metadata,
              ...event.document.metadata,
            }
          }
        }
        if (event.type == 'CHANGE') {
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
        if (event.type == 'GET.DRAFT.SUCCESS') {
          if (event.draft && event.draft.signingAccount) {
            return event.draft.signingAccount
          } else {
            return context.signingAccount
          }
        } else if (event.type == 'CHANGE' && event.signingAccount) {
          return event.signingAccount
        } else if (
          // @ts-expect-error ignore this XState error
          event.type == 'xstate.done.actor.createOrUpdateDraft' &&
          // @ts-expect-error ignore this XState error
          event.output.draft.signingAccount
        ) {
          // @ts-expect-error ignore this XState error
          return event.output.draft.signingAccount
        } else {
          return context.signingAccount
        }
      },
    }),
    setErrorMessage: assign({
      errorMessage: ({context, event}) => {
        if (event.type == 'GET.DRAFT.ERROR') {
          return JSON.stringify(event.error, null) || ''
        }
        return context.errorMessage
      },
    }),
    setChanged: assign({
      changed: ({context}) => {
        if (!context.changed) {
          return true
        }
        return false
      },
    }),
    setHasChangedWhileSaving: assign({
      hasChangedWhileSaving: true,
    }),
    resetChangeWhileSaving: assign({
      hasChangedWhileSaving: false,
    }),
    setDraftStatus: function (_, params: {status: DraftStatus}) {
      dispatchDraftStatus(params.status)
    },
    populateEditor: function () {},
    replaceRouteifNeeded: function () {},
    focusEditor: function () {},
    onSaveSuccess: function ({context}) {},
  },
  guards: {
    didChangeWhileSaving: ({context}) => context.hasChangedWhileSaving,
  },
  actors: {},
  delays: {
    autosaveTimeout: 500,
  },
}).createMachine({
  id: 'Draft',
  context: {
    metadata: {},
    draft: null,
    signingAccount: null,
    document: null,
    errorMessage: '',
    restoreTries: 0,
    changed: false,
    hasChangedWhileSaving: false,
  },
  initial: 'idle',
  states: {
    idle: {
      on: {
        'EMPTY.ID': {
          target: 'ready',
        },
        'GET.DRAFT.SUCCESS': [
          {
            target: 'setupData',
            actions: [
              {type: 'setDraft'},
              {type: 'setDocument'},
              {type: 'setAttributes'},
              {type: 'setSigningAccount'},
            ],
          },
        ],
        'GET.DRAFT.ERROR': {
          target: 'error',
          actions: [{type: 'setErrorMessage'}],
        },
        CHANGE: {
          actions: [{type: 'setSigningAccount'}],
        },
      },
    },
    setupData: {
      always: {
        target: 'ready',
        actions: [{type: 'populateEditor'}],
      },
    },
    error: {},
    ready: {
      initial: 'idle',
      entry: [
        {
          type: 'focusEditor',
        },
        {
          type: 'setDraftStatus',
          params: {status: 'idle'},
        },
      ],
      states: {
        idle: {
          on: {
            CHANGE: {
              target: 'changed',
              actions: [{type: 'setAttributes'}, {type: 'setSigningAccount'}],
            },
          },
        },
        changed: {
          entry: [
            {
              type: 'setDraftStatus',
              params: {status: 'changed'},
            },
          ],
          on: {
            CHANGE: {
              target: 'changed',
              actions: [{type: 'setAttributes'}, {type: 'setSigningAccount'}],
              reenter: true,
            },
          },
          after: {
            autosaveTimeout: {
              target: 'saving',
            },
          },
        },
        saving: {
          entry: [
            {
              type: 'resetChangeWhileSaving',
            },
            {
              type: 'setDraftStatus',
              params: {status: 'saving'},
            },
          ],
          on: {
            CHANGE: {
              target: 'saving',
              actions: [
                {type: 'setHasChangedWhileSaving'},
                {type: 'setAttributes'},
                {type: 'setSigningAccount'},
              ],
              reenter: false,
            },
          },
          invoke: {
            input: ({context}) => ({
              metadata: context.metadata,
              currentDraft: context.draft,
              signingAccount: context.signingAccount,
            }),
            id: 'createOrUpdateDraft',
            src: 'createOrUpdateDraft',
            onDone: [
              {
                target: 'saving',
                actions: [
                  {
                    type: 'replaceRouteifNeeded',
                  },
                ],
                guard: {
                  type: 'didChangeWhileSaving',
                },
                reenter: true,
              },
              {
                target: 'idle',
                actions: [
                  {
                    type: 'onSaveSuccess',
                  },
                  {type: 'setDraft'},
                  {type: 'setAttributes'},
                  {type: 'setSigningAccount'},
                  {type: 'replaceRouteifNeeded'},
                  {
                    type: 'setDraftStatus',
                    params: {status: 'saved'},
                  },
                ],
              },
            ],
          },
        },
      },
    },
  },
})
