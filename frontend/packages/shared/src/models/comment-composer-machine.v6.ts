import type {HMComment} from '@seed-hypermedia/client/hm-types'
import {createAsyncLogic, matchesState, setup, types} from 'xstate6'
import type {
  CommentComposerContent,
  CommentComposerInput,
  CommentComposerPublishRequest,
} from './comment-composer-machine'
import {composerContentHasText} from './comment-composer-machine'

export type {
  CommentComposerContent,
  CommentComposerEmitted,
  CommentComposerInput,
  CommentComposerPublishRequest,
} from './comment-composer-machine'
export {composerContentHasText}

type Context = {
  input: CommentComposerInput
  content: CommentComposerContent
  accountUid: string | null
  error: unknown
}

const emptyContent = (): CommentComposerContent => ({blocks: []})

const loadDraftLogic = createAsyncLogic({
  schemas: {input: types<CommentComposerInput>()},
  run: async ({input}) => input.loadDraft(),
})

const saveDraftLogic = createAsyncLogic({
  schemas: {input: types<{input: CommentComposerInput; content: CommentComposerContent}>()},
  run: async ({input}) => input.input.saveDraft(input.content),
})

const removeDraftLogic = createAsyncLogic({
  schemas: {input: types<CommentComposerInput>()},
  run: async ({input}) => input.removeDraft(),
})

const publishLogic = createAsyncLogic({
  schemas: {
    input: types<{input: CommentComposerInput; request: CommentComposerPublishRequest}>(),
  },
  run: async ({input}) => input.input.publish(input.request),
})

/**
 * v6 port of `commentComposerMachine`. Same state structure, events, emitted
 * events, tags, and 500ms save delay; only the authoring API differs.
 *
 * Cross-region coordination note: v5 `stateIn(...)` guards read the in-progress
 * macrostep configuration. In v6, `self.getSnapshot()` inside a transition
 * function returns the snapshot committed *before* the current event, so it
 * cannot observe sibling-region changes made earlier in the same macrostep
 * (verified empirically — using it deadlocks `closing`). The `value` argument
 * carries the in-progress state value, so the guards below use
 * `matchesState(pattern, value)`, which preserves `stateIn` semantics.
 */
export const commentComposerMachineV6 = setup({
  schemas: {
    context: types<Context>(),
    input: types<CommentComposerInput>(),
    events: {
      'content.changed': types<{content: CommentComposerContent}>(),
      'content.flushRequested': types<void>(),
      'submit.requested': types<{accountUid: string | null}>(),
      'account.ready': types<{accountUid: string}>(),
      'account.cancelled': types<void>(),
      'comment.publishedExternally': types<{comment: HMComment}>(),
      'composer.opened': types<void>(),
      'composer.closed': types<void>(),
      'draft.changed': types<void>(),
      'draft.flushRequested': types<void>(),
      'draft.discardRequested': types<void>(),
    },
    emitted: {
      'editor.cleared': types<void>(),
      'account.required': types<{content: CommentComposerContent}>(),
      published: types<{comment: HMComment}>(),
      'publish.failed': types<{error: unknown}>(),
      'draft.saveFailed': types<{error: unknown}>(),
    },
  },
  actors: {
    loadDraft: loadDraftLogic,
    saveDraft: saveDraftLogic,
    removeDraft: removeDraftLogic,
    publish: publishLogic,
  },
  delays: {
    saveDelay: 500,
  },
}).createMachine({
  id: 'commentComposer',
  context: ({input}) => ({input, content: emptyContent(), accountUid: null, error: null}),
  initial: 'active',
  states: {
    active: {
      type: 'parallel',
      states: {
        session: {
          initial: 'loading',
          states: {
            loading: {
              tags: ['loading'],
              invoke: {
                src: 'loadDraft',
                input: ({context}) => context.input,
                onDone: ({event}) => ({
                  target: 'editing',
                  context: {content: event.output ?? emptyContent()},
                }),
                onError: {target: 'editing'},
              },
              on: {
                'composer.closed': {target: 'closing'},
              },
            },
            editing: {
              on: {
                'content.changed': ({event}, enq) => {
                  enq.raise({type: 'draft.changed'})
                  return {context: {content: event.content}}
                },
                'content.flushRequested': (_, enq) => {
                  enq.raise({type: 'draft.flushRequested'})
                },
                'submit.requested': ({context, event}, enq) => {
                  if (!composerContentHasText(context.content)) return undefined
                  if (event.accountUid) {
                    return {target: 'publishing', context: {accountUid: event.accountUid}}
                  }
                  enq.emit({type: 'account.required', content: context.content})
                  return {target: 'awaitingAccount'}
                },
                'comment.publishedExternally': ({event}, enq) => {
                  enq.emit({type: 'editor.cleared'})
                  enq.raise({type: 'draft.discardRequested'})
                  enq.emit({type: 'published', comment: event.comment})
                  return {context: {content: emptyContent(), error: null}}
                },
                'composer.closed': {target: 'closing'},
              },
            },
            awaitingAccount: {
              tags: ['awaitingAccount'],
              on: {
                'content.changed': ({event}, enq) => {
                  enq.raise({type: 'draft.changed'})
                  return {context: {content: event.content}}
                },
                'content.flushRequested': (_, enq) => {
                  enq.raise({type: 'draft.flushRequested'})
                },
                'submit.requested': ({context, event}, enq) => {
                  if (!composerContentHasText(context.content)) return undefined
                  if (event.accountUid) {
                    return {target: 'publishing', context: {accountUid: event.accountUid}}
                  }
                  enq.emit({type: 'account.required', content: context.content})
                  return undefined
                },
                'account.ready': ({event}) => ({
                  target: 'publishing',
                  context: {accountUid: event.accountUid},
                }),
                'account.cancelled': {target: 'editing'},
                'comment.publishedExternally': ({event}, enq) => {
                  enq.emit({type: 'editor.cleared'})
                  enq.raise({type: 'draft.discardRequested'})
                  enq.emit({type: 'published', comment: event.comment})
                  return {target: 'editing', context: {content: emptyContent(), error: null}}
                },
                'composer.closed': {target: 'closing'},
              },
            },
            publishing: {
              tags: ['busy'],
              initial: 'attached',
              states: {
                attached: {on: {'composer.closed': {target: 'detached'}}},
                detached: {on: {'composer.opened': {target: 'attached'}}},
              },
              invoke: {
                src: 'publish',
                input: ({context}) => ({
                  input: context.input,
                  request: {content: context.content, accountUid: context.accountUid!},
                }),
                onDone: ({event, value}, enq) => {
                  const closeRequested = matchesState({active: {session: {publishing: 'detached'}}}, value)
                  enq.emit({type: 'editor.cleared'})
                  enq.raise({type: 'draft.discardRequested'})
                  enq.emit({type: 'published', comment: event.output})
                  return {
                    target: closeRequested ? 'closing' : 'editing',
                    context: {content: emptyContent(), error: null},
                  }
                },
                onError: ({event, value}, enq) => {
                  const closeRequested = matchesState({active: {session: {publishing: 'detached'}}}, value)
                  enq.emit({type: 'publish.failed', error: event.error})
                  return {
                    target: closeRequested ? 'closing' : 'editing',
                    context: {error: event.error},
                  }
                },
              },
            },
            closing: {
              entry: (_, enq) => {
                enq.raise({type: 'draft.flushRequested'})
              },
              always: ({value}) =>
                matchesState({active: {persistence: 'idle'}}, value) ? {target: '#commentComposer.closed'} : undefined,
              on: {
                'content.changed': ({event}, enq) => {
                  enq.raise({type: 'draft.changed'})
                  enq.raise({type: 'draft.flushRequested'})
                  return {context: {content: event.content}}
                },
                'composer.opened': {target: 'editing'},
              },
            },
          },
        },
        persistence: {
          initial: 'idle',
          states: {
            idle: {
              on: {
                'draft.changed': {target: 'scheduled'},
                'draft.discardRequested': {target: 'removing'},
              },
            },
            scheduled: {
              after: {saveDelay: {target: 'committing'}},
              on: {
                'draft.changed': {target: 'scheduled', reenter: true},
                'draft.flushRequested': {target: 'committing'},
                'draft.discardRequested': {target: 'removing'},
              },
            },
            committing: {
              always: ({context}) =>
                composerContentHasText(context.content) ? {target: 'writing'} : {target: 'removing'},
            },
            writing: {
              tags: ['persisting'],
              initial: 'current',
              states: {
                current: {
                  on: {
                    'draft.changed': {target: 'stale'},
                    'draft.discardRequested': {target: 'discardQueued'},
                  },
                },
                stale: {
                  on: {'draft.discardRequested': {target: 'discardQueued'}},
                },
                discardQueued: {},
              },
              invoke: {
                src: 'saveDraft',
                input: ({context}) => ({input: context.input, content: context.content}),
                onDone: ({value}) => {
                  if (matchesState({active: {persistence: {writing: 'discardQueued'}}}, value)) {
                    return {target: 'removing'}
                  }
                  if (matchesState({active: {persistence: {writing: 'stale'}}}, value)) {
                    return {target: 'committing'}
                  }
                  return {target: 'idle'}
                },
                onError: ({event, value}, enq) => {
                  enq.emit({type: 'draft.saveFailed', error: event.error})
                  if (matchesState({active: {persistence: {writing: 'discardQueued'}}}, value)) {
                    return {target: 'removing'}
                  }
                  return {target: 'idle'}
                },
              },
            },
            removing: {
              tags: ['persisting'],
              invoke: {
                src: 'removeDraft',
                input: ({context}) => context.input,
                onDone: ({context}) =>
                  composerContentHasText(context.content) ? {target: 'scheduled'} : {target: 'idle'},
                onError: ({context, event}, enq) => {
                  enq.emit({type: 'draft.saveFailed', error: event.error})
                  return {
                    target: composerContentHasText(context.content) ? 'scheduled' : 'idle',
                  }
                },
              },
            },
          },
        },
      },
    },
    closed: {type: 'final'},
  },
})
