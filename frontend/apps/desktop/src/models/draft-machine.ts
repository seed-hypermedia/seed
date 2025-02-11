import {dispatchDraftStatus, DraftStatus} from '@/draft-status'
import {HMBlockNode, HMDraft, HMEntityContent, HMMetadata} from '@shm/shared'
import {assign, setup, StateFrom} from 'xstate'

export type DraftMachineState = StateFrom<typeof draftMachine>

export const draftMachine = setup({
  types: {
    context: {} as {
      metadata: HMMetadata
      signingAccount: null | string
      draft: null | HMDraft
      entity: null | HMEntityContent
      errorMessage: string
      restoreTries: number
      changed: boolean
      hasChangedWhileSaving: boolean
      nameRef: null | HTMLTextAreaElement
    },
    events: {} as
      | {
          type: 'CHANGE'
          metadata?: HMDraft['metadata']
          signingAccount?: string
        }
      | {type: 'RESET.DRAFT'}
      | {type: 'FINISH.REBASE'; entity: HMEntityContent}
      | {type: 'SET.NAME.REF'; nameRef: HTMLTextAreaElement}
      | {type: 'RESTORE.DRAFT'}
      | {type: 'RESET.CORRUPT.DRAFT'}
      | {type: 'GET.DRAFT.ERROR'; error: any}
      | {type: 'GET.DRAFT.RETRY'}
      | {
          type: 'GET.DRAFT.SUCCESS'
          draft: HMDraft | null
          entity: HMEntityContent | null
        }
      | {type: 'SAVE.ON.EXIT'}
      | {type: 'EMPTY.ID'}
      | {type: 'RESET.CONTENT'; blockNodes: HMBlockNode[]},
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
    setEntity: assign({
      entity: ({event}) => {
        if (
          event.type == 'GET.DRAFT.SUCCESS' ||
          event.type == 'FINISH.REBASE'
        ) {
          return event.entity
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
          } else if (event.entity?.document) {
            return {
              ...context.metadata,
              ...event.entity.document.metadata,
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
    setNameRef: assign({
      nameRef: ({event}) => {
        if (event.type == 'SET.NAME.REF') {
          return event.nameRef
        }
        return null
      },
    }),
    populateEditor: function () {},
    replaceRouteifNeeded: function () {},
    focusEditor: function () {},
    focusName: function () {},
    onSaveSuccess: function ({context}) {},
    resetContent: function () {},
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
    nameRef: null,
    metadata: {},
    draft: null,
    signingAccount: null,
    entity: null,
    errorMessage: '',
    restoreTries: 0,
    changed: false,
    hasChangedWhileSaving: false,
  },
  initial: 'idle',
  on: {
    'SET.NAME.REF': {
      actions: [{type: 'setNameRef'}],
    },
    'FINISH.REBASE': {
      actions: [{type: 'setEntity'}],
    },
  },
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
              {type: 'setEntity'},
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
          type: 'setDraftStatus',
          params: {status: 'idle'},
        },
        {
          type: 'focusEditor',
        },
      ],
      after: {
        100: {
          actions: [{type: 'focusName'}],
        },
      },
      states: {
        idle: {
          on: {
            CHANGE: {
              target: 'changed',
              actions: [{type: 'setAttributes'}, {type: 'setSigningAccount'}],
            },
            'RESET.CONTENT': {
              target: 'changed',
              actions: [{type: 'resetContent'}],
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
            'RESET.CONTENT': {
              target: 'changed',
              actions: [{type: 'resetContent'}],
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
            'RESET.CONTENT': {
              target: 'saving',
              actions: [
                {type: 'setHasChangedWhileSaving'},
                {type: 'resetContent'},
              ],
              reenter: false,
            },
          },
          invoke: {
            input: ({context}) => ({
              metadata: context.metadata,
              currentDraft: context.draft,
              signingAccount: context.signingAccount,
              entity: context.entity,
            }),
            id: 'createOrUpdateDraft',
            src: 'createOrUpdateDraft',
            onDone: [
              {
                target: 'saving',
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
