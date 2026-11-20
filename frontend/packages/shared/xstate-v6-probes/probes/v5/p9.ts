import {and, assign, createActor, emit, fromPromise, setup} from 'xstate'

type ProbeComment = {id: string; author: string}

type ProbeContext = {
  draft: string
  accountUid: string | null
  saved: ProbeComment | null
  attempts: number
  note: string
}

type ProbeEvent =
  | {type: 'draft.changed'; text: string}
  | {type: 'submit.requested'; accountUid: string | null}
  | {type: 'account.ready'; accountUid: string}
  | {type: 'dismissed'}

export const probeMachine = setup({
  types: {
    context: {} as ProbeContext,
    events: {} as ProbeEvent,
    emitted: {} as {type: 'account.required'} | {type: 'probe.saved'; comment: ProbeComment},
  },
  actors: {
    saveComment: fromPromise<ProbeComment, {draft: string; accountUid: string}>(async ({input}) => ({
      id: `comment-${input.draft}`,
      author: input.accountUid,
    })),
  },
  delays: {
    saveDelay: 500,
  },
  guards: {
    hasDraft: ({context}) => context.draft.length > 0,
    hasAccount: ({event}) => event.type === 'submit.requested' && !!event.accountUid,
  },
  actions: {
    storeDraft: assign({
      draft: ({event}) => (event.type === 'draft.changed' ? event.text : ''),
    }),
    bumpAttempts: assign({attempts: ({context}) => context.attempts + 1}),
    storeAccount: assign({
      accountUid: ({event}) =>
        event.type === 'submit.requested' || event.type === 'account.ready' ? event.accountUid : null,
    }),
    storeSaved: assign({saved: (_, params: {comment: ProbeComment}) => params.comment}),
    storeNote: assign({note: (_, params: {text: string}) => params.text}),
    emitAccountRequired: emit({type: 'account.required'}),
    emitSaved: emit((_, params: {comment: ProbeComment}) => ({type: 'probe.saved' as const, comment: params.comment})),
  },
}).createMachine({
  id: 'probe',
  context: {draft: '', accountUid: null, saved: null, attempts: 0, note: ''},
  initial: 'editing',
  states: {
    editing: {
      after: {saveDelya: {actions: 'bumpAttempts'}},
      on: {
        'draft.changed': {actions: ['storeDraft', 'bumpAttempts']},
        'submit.requested': [
          {guard: and(['hasDraft', 'hasAccount']), target: 'saving', actions: 'storeAccount'},
          {guard: 'hasDraft', actions: 'emitAccountRequired'},
        ],
        dismissed: {target: 'done'},
      },
    },
    saving: {
      invoke: {
        src: 'saveComment',
        input: ({context}) => ({draft: context.draft, accountUid: context.accountUid ?? 'anonymous'}),
        onDone: {
          target: 'saved',
          actions: [
            {type: 'storeSaved', params: ({event}) => ({comment: event.output})},
            {type: 'emitSaved', params: ({event}) => ({comment: event.output})},
          ],
        },
        onError: {target: 'editing'},
      },
    },
    saved: {type: 'final'},
    done: {type: 'final'},
  },
})

const actor = createActor(probeMachine)
actor.start()
actor.send({type: 'draft.changed', text: 'hello'})
actor.send({type: 'submit.requested', accountUid: 'alice'})
actor.send({type: 'account.ready', accountUid: 'bob'})
