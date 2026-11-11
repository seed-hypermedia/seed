import type {HMBlockNode, HMComment} from '@seed-hypermedia/client/hm-types'
import {and, assign, emit, fromPromise, raise, setup, stateIn} from 'xstate'
import {hasBlockContent} from '../content'

/** Serialized composer content plus optional platform media references (web IndexedDB media). */
export type CommentComposerContent = {
  blocks: HMBlockNode[]
  mediaRefs?: Record<string, string>
}

/** Request handed to the platform publish effect. */
export type CommentComposerPublishRequest = {
  content: CommentComposerContent
  accountUid: string
}

/** Platform effects supplied when starting one composer actor for one draft target. */
export type CommentComposerInput = {
  loadDraft: () => Promise<CommentComposerContent | null>
  saveDraft: (content: CommentComposerContent) => Promise<void>
  removeDraft: () => Promise<void>
  publish: (request: CommentComposerPublishRequest) => Promise<HMComment>
}

/** Events accepted by the comment composer actor. */
export type CommentComposerEvent =
  | {type: 'content.changed'; content: CommentComposerContent}
  | {type: 'content.flushRequested'}
  | {type: 'submit.requested'; accountUid: string | null}
  | {type: 'account.ready'; accountUid: string}
  | {type: 'account.cancelled'}
  | {type: 'comment.publishedExternally'; comment: HMComment}
  | {type: 'composer.opened'}
  | {type: 'composer.closed'}
  | {type: 'draft.changed'}
  | {type: 'draft.flushRequested'}
  | {type: 'draft.discardRequested'}

/** Notifications the actor emits to the host and the mounted editor. */
export type CommentComposerEmitted =
  | {type: 'editor.cleared'}
  | {type: 'account.required'; content: CommentComposerContent}
  | {type: 'published'; comment: HMComment}
  | {type: 'publish.failed'; error: unknown}
  | {type: 'draft.saveFailed'; error: unknown}

type Context = {
  input: CommentComposerInput
  content: CommentComposerContent
  accountUid: string | null
  error: unknown
}

const emptyContent = (): CommentComposerContent => ({blocks: []})

/** Whether serialized composer content has anything worth saving or publishing. */
export function composerContentHasText(content: CommentComposerContent): boolean {
  return content.blocks.some(hasBlockContent)
}

/**
 * Owns one comment draft session: loading the persisted draft, debounced and strictly
 * serialized draft persistence, submission (including the sign-in detour), and the
 * published transition that clears the editor and discards the draft.
 *
 * Two regions run in parallel under `active`:
 * - `session` is the user-facing lifecycle (loading → editing ⇄ awaitingAccount → publishing).
 * - `persistence` is the only place that touches draft storage. It never runs a save and a
 *   remove concurrently, so a late save can never resurrect a discarded draft.
 *
 * `closing` waits for persistence to go idle before the actor finishes, so unmounting a
 * composer never drops a pending save or an in-flight discard.
 */
export const commentComposerMachine = setup({
  types: {
    context: {} as Context,
    input: {} as CommentComposerInput,
    events: {} as CommentComposerEvent,
    emitted: {} as CommentComposerEmitted,
  },
  actors: {
    loadDraft: fromPromise<CommentComposerContent | null, CommentComposerInput>(({input}) => input.loadDraft()),
    saveDraft: fromPromise<void, {input: CommentComposerInput; content: CommentComposerContent}>(({input}) =>
      input.input.saveDraft(input.content),
    ),
    removeDraft: fromPromise<void, CommentComposerInput>(({input}) => input.removeDraft()),
    publish: fromPromise<HMComment, {input: CommentComposerInput; request: CommentComposerPublishRequest}>(({input}) =>
      input.input.publish(input.request),
    ),
  },
  delays: {
    saveDelay: 500,
  },
  guards: {
    hasContent: ({context}) => composerContentHasText(context.content),
    hasAccount: ({event}) => event.type === 'submit.requested' && !!event.accountUid,
    persistenceIdle: stateIn({active: {persistence: 'idle'}}),
    discardQueued: stateIn({active: {persistence: {writing: 'discardQueued'}}}),
    writeStale: stateIn({active: {persistence: {writing: 'stale'}}}),
    closeRequested: stateIn({active: {session: {publishing: 'detached'}}}),
  },
  actions: {
    storeContent: assign({
      content: ({context, event}) => (event.type === 'content.changed' ? event.content : context.content),
    }),
    storeAccount: assign({
      accountUid: ({context, event}) =>
        event.type === 'submit.requested' || event.type === 'account.ready' ? event.accountUid : context.accountUid,
    }),
    clearContent: assign({content: () => emptyContent(), error: () => null}),
    storeError: assign({error: (_, params: {error: unknown}) => params.error}),
    requestDraftSave: raise({type: 'draft.changed'}),
    requestDraftFlush: raise({type: 'draft.flushRequested'}),
    requestDraftDiscard: raise({type: 'draft.discardRequested'}),
    emitEditorCleared: emit({type: 'editor.cleared'}),
    emitAccountRequired: emit(({context}) => ({type: 'account.required' as const, content: context.content})),
    emitPublished: emit((_, params: {comment: HMComment}) => ({type: 'published' as const, comment: params.comment})),
    emitPublishFailed: emit((_, params: {error: unknown}) => ({type: 'publish.failed' as const, error: params.error})),
    emitSaveFailed: emit((_, params: {error: unknown}) => ({type: 'draft.saveFailed' as const, error: params.error})),
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
                onDone: {
                  target: 'editing',
                  actions: assign({content: ({event}) => event.output ?? emptyContent()}),
                },
                onError: {target: 'editing'},
              },
              on: {
                'composer.closed': {target: 'closing'},
              },
            },
            editing: {
              on: {
                'content.changed': {actions: ['storeContent', 'requestDraftSave']},
                'content.flushRequested': {actions: 'requestDraftFlush'},
                'submit.requested': [
                  {guard: and(['hasContent', 'hasAccount']), target: 'publishing', actions: 'storeAccount'},
                  {guard: 'hasContent', target: 'awaitingAccount', actions: 'emitAccountRequired'},
                ],
                'comment.publishedExternally': {
                  actions: [
                    'clearContent',
                    'emitEditorCleared',
                    'requestDraftDiscard',
                    {type: 'emitPublished', params: ({event}) => ({comment: event.comment})},
                  ],
                },
                'composer.closed': {target: 'closing'},
              },
            },
            awaitingAccount: {
              tags: ['awaitingAccount'],
              on: {
                'content.changed': {actions: ['storeContent', 'requestDraftSave']},
                'content.flushRequested': {actions: 'requestDraftFlush'},
                'submit.requested': [
                  {guard: and(['hasContent', 'hasAccount']), target: 'publishing', actions: 'storeAccount'},
                  {guard: 'hasContent', actions: 'emitAccountRequired'},
                ],
                'account.ready': {target: 'publishing', actions: 'storeAccount'},
                'account.cancelled': {target: 'editing'},
                'comment.publishedExternally': {
                  target: 'editing',
                  actions: [
                    'clearContent',
                    'emitEditorCleared',
                    'requestDraftDiscard',
                    {type: 'emitPublished', params: ({event}) => ({comment: event.comment})},
                  ],
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
                onDone: [
                  {
                    guard: 'closeRequested',
                    target: 'closing',
                    actions: [
                      'clearContent',
                      'emitEditorCleared',
                      'requestDraftDiscard',
                      {type: 'emitPublished', params: ({event}) => ({comment: event.output})},
                    ],
                  },
                  {
                    target: 'editing',
                    actions: [
                      'clearContent',
                      'emitEditorCleared',
                      'requestDraftDiscard',
                      {type: 'emitPublished', params: ({event}) => ({comment: event.output})},
                    ],
                  },
                ],
                onError: [
                  {
                    guard: 'closeRequested',
                    target: 'closing',
                    actions: [
                      {type: 'storeError', params: ({event}) => ({error: event.error})},
                      {type: 'emitPublishFailed', params: ({event}) => ({error: event.error})},
                    ],
                  },
                  {
                    target: 'editing',
                    actions: [
                      {type: 'storeError', params: ({event}) => ({error: event.error})},
                      {type: 'emitPublishFailed', params: ({event}) => ({error: event.error})},
                    ],
                  },
                ],
              },
            },
            closing: {
              entry: 'requestDraftFlush',
              always: {guard: 'persistenceIdle', target: '#commentComposer.closed'},
              on: {
                'content.changed': {actions: ['storeContent', 'requestDraftSave', 'requestDraftFlush']},
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
              always: [{guard: 'hasContent', target: 'writing'}, {target: 'removing'}],
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
                onDone: [
                  {guard: 'discardQueued', target: 'removing'},
                  {guard: 'writeStale', target: 'committing'},
                  {target: 'idle'},
                ],
                onError: [
                  {
                    guard: 'discardQueued',
                    target: 'removing',
                    actions: {type: 'emitSaveFailed', params: ({event}) => ({error: event.error})},
                  },
                  {target: 'idle', actions: {type: 'emitSaveFailed', params: ({event}) => ({error: event.error})}},
                ],
              },
            },
            removing: {
              tags: ['persisting'],
              invoke: {
                src: 'removeDraft',
                input: ({context}) => context.input,
                onDone: [{guard: 'hasContent', target: 'scheduled'}, {target: 'idle'}],
                onError: [
                  {
                    guard: 'hasContent',
                    target: 'scheduled',
                    actions: {type: 'emitSaveFailed', params: ({event}) => ({error: event.error})},
                  },
                  {target: 'idle', actions: {type: 'emitSaveFailed', params: ({event}) => ({error: event.error})}},
                ],
              },
            },
          },
        },
      },
    },
    closed: {type: 'final'},
  },
})
