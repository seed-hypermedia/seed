import {dispatchDraftStatus, DraftStatus} from '@/draft-status'
import {HMDraft, HMEntityContent, HMMetadata} from '@shm/shared'
import {assign, fromPromise, setup, StateFrom} from 'xstate'

export type DraftMachineState = StateFrom<typeof draftMachine>

export const draftMachine = setup({
  types: {
    context: {} as {
      nameRef: null | HTMLTextAreaElement
      metadata: HMMetadata
      draft: null | HMDraft
      signingAccount: null | string
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
    onSaveSuccess: ({context}) => context,
    oncreatingSuccess: ({context}) => context,
    populateEditor: ({context, event}) => {
      // Add your editor population logic here
      return context
    },
    focusName: ({context}) => {
      // Add your focus name logic here
      return context
    },
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
        } else if (
          // @ts-expect-error ignore this XState error
          event.type == 'xstate.done.actor.updateDraft' &&
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
  actors: {
    create: fromPromise(
      async ({
        input,
      }: {
        input: {
          metadata: HMMetadata
          currentDraft: HMDraft | null
          signingAccount: string | null
          draftCreated: boolean
        }
      }) => {
        console.log('=== DRAFT invoke creating: CREATE')

        return {} as HMDraft & {id: string}
      },
    ),
    update: fromPromise(
      async ({
        input,
      }: {
        input: {
          metadata: HMMetadata
          currentDraft: HMDraft | null
          signingAccount: string | null
          draftCreated: boolean
        }
      }) => {
        console.log('=== DRAFT invoke updateDraft: UPDATE')

        return {} as HMDraft & {id: string}
      },
    ),
  },
}).createMachine({
  id: 'Draft',
  context: {
    nameRef: null,
    error: '',
    metadata: {},
    draft: null,
    signingAccount: null,
    changed: false,
    hasChangedWhileSaving: false,
    draftCreated: false,
  },
  initial: 'fetching',
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
      // always: {
      //   target: 'editing',
      //   actions: ['populateEditor'],
      // },
    },
    editing: {
      initial: 'idle',
      entry: [
        {
          type: 'setDraftStatus',
          params: {status: 'idle'},
        },
        {type: 'focusEditor'},
      ],
      after: {
        100: {
          actions: [{type: 'focusName'}],
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
                guard: ({context}) => context.draftCreated,
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
            id: 'create',
            src: 'create',
            input: ({context}) => ({
              metadata: context.metadata,
              currentDraft: context.draft,
              signingAccount: context.signingAccount,
              draftCreated: context.draftCreated,
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
            id: 'update',
            src: 'update',
            input: ({context}) => ({
              metadata: context.metadata,
              currentDraft: context.draft,
              signingAccount: context.signingAccount,
              draftCreated: context.draftCreated,
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
