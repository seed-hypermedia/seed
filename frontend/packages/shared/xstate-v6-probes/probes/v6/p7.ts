import {createActor, createAsyncLogic, setup, types} from 'xstate6'

type ProbeComment = {id: string; author: string}

type ProbeContext = {
  draft: string
  accountUid: string | null
  saved: ProbeComment | null
  attempts: number
  note: string
}

export const probeMachine = setup({
  schemas: {
    context: types<ProbeContext>(),
    events: {
      'draft.changed': types<{text: string}>(),
      'submit.requested': types<{accountUid: string | null}>(),
      'account.ready': types<{accountUid: string}>(),
      dismissed: types<void>(),
    },
    emitted: {
      'account.required': types<void>(),
      'probe.saved': types<{comment: ProbeComment}>(),
    },
  },
  actors: {
    saveComment: createAsyncLogic({
      schemas: {input: types<{draft: string; accountUid: string}>()},
      run: async ({input}) => ({id: `comment-${input.draft}`, author: input.accountUid}),
    }),
  },
  delays: {
    saveDelay: 500,
  },
}).createMachine({
  id: 'probe',
  context: {draft: '', accountUid: null, saved: null, attempts: 0, note: ''},
  initial: 'editing',
  states: {
    editing: {
      after: {
        saveDelay: ({context}) => ({context: {attempts: context.attempts + 1}}),
      },
      on: {
        'draft.changed': ({context, event}) => ({
          context: {draft: event.text, attempts: context.attempts + 1},
        }),
        'submit.requested': ({context, event}, enq) => {
          if (context.draft.length === 0) return undefined
          if (event.accountUid) {
            return {target: 'saving', context: {accountUid: event.accountUid}}
          }
          enq.emit({type: 'account.required'})
          return undefined
        },
        dismissed: {target: 'editting'},
      },
    },
    saving: {
      invoke: {
        src: 'saveComment',
        input: ({context}) => ({draft: context.draft, accountUid: context.accountUid ?? 'anonymous'}),
        onDone: ({event}, enq) => {
          enq.emit({type: 'probe.saved', comment: event.output})
          return {target: 'saved', context: {saved: event.output}}
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
