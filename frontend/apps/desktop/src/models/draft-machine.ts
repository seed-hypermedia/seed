import {dispatchDraftStatus, DraftStatus} from '@/draft-status'
import {HMDocument, HMDraft} from '@shm/shared'
import {assign, setup, StateFrom} from 'xstate'

export type DraftMachineState = StateFrom<typeof draftMachine>

export const draftMachine = setup({
  types: {
    context: {} as {
      name: string
      thumbnail: string
      cover: string
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
          name?: string
          thumbnail?: string
          cover?: string
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
    setName: assign({
      name: ({context, event}) => {
        if (event.type == 'GET.DRAFT.SUCCESS') {
          if (event.draft) {
            return event.draft.metadata?.name
          } else if (event.document) {
            return event.document.metadata?.name
          }
        }
        if (event.type == 'CHANGE' && event.name) {
          return event.name
        }
        return context.name
      },
    }),
    setThumbnail: assign({
      thumbnail: ({context, event}) => {
        if (event.type == 'GET.DRAFT.SUCCESS') {
          if (event.draft) {
            return event.draft.metadata.thumbnail
          } else if (event.document) {
            return event.document.metadata.thumbnail
          }
        }
        if (event.type == 'CHANGE' && event.thumbnail) {
          return event.thumbnail
        }
        return context.thumbnail
      },
    }),
    setCover: assign({
      cover: ({context, event}) => {
        if (event.type == 'GET.DRAFT.SUCCESS') {
          if (event.draft) {
            return event.draft.metadata.cover
          } else if (event.document) {
            return event.document.metadata.cover
          }
        }
        if (event.type == 'CHANGE' && event.cover) {
          return event.cover
        }
        return context.cover
      },
    }),
    setSigningAccount: assign({
      signingAccount: ({event, context}) => {
        if (event.type == 'GET.DRAFT.SUCCESS') {
          if (event.draft) {
            return event.draft.signingAccount
          }
          // TODO: horacio: where should we get the signingaccount from document?
          //  else if (event.document) {
          //   return event.document.metadata.thumbnail
          // }
        }
        if (event.type == 'CHANGE' && event.signingAccount) {
          return event.signingAccount
        }
        return context.signingAccount
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
    name: '',
    thumbnail: '',
    cover: '',
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
              {type: 'setName'},
              {type: 'setThumbnail'},
              {type: 'setCover'},
              {type: 'setSigningAccount'},
            ],
          },
        ],
        'GET.DRAFT.ERROR': {
          target: 'error',
          actions: [{type: 'setErrorMessage'}],
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
              actions: [
                {type: 'setName'},
                {type: 'setThumbnail'},
                {type: 'setCover'},
                {type: 'setSigningAccount'},
              ],
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
              actions: [
                {type: 'setName'},
                {type: 'setThumbnail'},
                {type: 'setCover'},
                {type: 'setSigningAccount'},
              ],
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
                {type: 'setName'},
                {type: 'setThumbnail'},
                {type: 'setCover'},
                {type: 'setSigningAccount'},
              ],
              reenter: false,
            },
          },
          invoke: {
            input: ({context}) => ({
              name: context.name,
              thumbnail: context.thumbnail,
              currentDraft: context.draft,
              cover: context.cover,
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
                  {type: 'setName'},
                  {type: 'setThumbnail'},
                  {type: 'setCover'},
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
