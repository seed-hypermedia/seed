import type {HMMentionCandidate} from '@seed-hypermedia/client/hm-types'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {assign, emit, setup} from 'xstate'

/**
 * Parses a leading mention trigger in the collection search box: `@name` looks up
 * Hypermedia profiles, `[[name` looks up documents. The trigger must start the
 * search text because search matching is whole-string — a mention combined with
 * other text would never match a ref key.
 */
export function parseQueryBlockSearchMention(text: string): {mode: 'account' | 'document'; query: string} | null {
  const match = /^\s*(@|\[\[)([^\]\n]*)$/.exec(text)
  if (!match) return null
  return {mode: match[1] === '@' ? 'account' : 'document', query: (match[2] ?? '').trim()}
}

/**
 * Canonical ref URL a picked mention filters the collection by: version, latest,
 * blockRef, and blockRange are stripped; an account also drops its profile path
 * (`hm://<uid>`), a document keeps its path (`hm://<uid>/<path>`).
 */
export function getQueryBlockMentionRef(candidate: HMMentionCandidate): string {
  const stripped = {...candidate.id, version: null, latest: null, blockRef: null, blockRange: null}
  return packHmId(candidate.type === 'account' ? {...stripped, path: null} : stripped)
}

type QueryBlockSearchContext = {
  draft: string
  suggestions: HMMentionCandidate[]
  isFetching: boolean
  isError: boolean
  selected: number
}

type QueryBlockSearchEvent =
  | {type: 'search.expanded'; search: string}
  | {type: 'search.cleared'}
  | {type: 'input.changed'; value: string}
  | {type: 'mention.results'; suggestions: HMMentionCandidate[]; isFetching: boolean; isError: boolean}
  | {type: 'mention.picked'; candidate: HMMentionCandidate}
  | {type: 'key.down'}
  | {type: 'key.up'}
  | {type: 'key.enter'}
  | {type: 'key.escape'}
  | {type: 'input.blurred'}

/** Values the host applies as the collection's viewer search. */
export type QueryBlockSearchEmitted = {type: 'search.applied'; value: string}

/**
 * State machine for the collection/query block toolbar search: plain text in
 * `editing.text`, a leading `@`/`[[` mention draft in `editing.mention` (tagged
 * `menuOpen`), and `editing.dismissed` after Escape keeps a trigger text literal
 * until it no longer parses. The machine owns the input draft and suggestion
 * bookkeeping only; the applied search stays with the host, which receives it
 * through emitted `search.applied` events.
 */
export const queryBlockSearchMachine = setup({
  types: {
    context: {} as QueryBlockSearchContext,
    events: {} as QueryBlockSearchEvent,
    emitted: {} as QueryBlockSearchEmitted,
  },
  guards: {
    hasTrigger: ({event}) => event.type === 'input.changed' && parseQueryBlockSearchMention(event.value) != null,
    canPickHighlighted: ({context}) =>
      !context.isFetching && !context.isError && context.suggestions[context.selected] != null,
    hasSuggestions: ({context}) => context.suggestions.length > 0,
  },
  actions: {
    setDraft: assign({draft: ({event}) => (event.type === 'input.changed' ? event.value : '')}),
    startEditing: assign(({event}) => ({
      draft: event.type === 'search.expanded' ? event.search : '',
      suggestions: [],
      isFetching: false,
      isError: false,
      selected: 0,
    })),
    resetSelection: assign({selected: 0}),
    applyResults: assign(({context, event}) => {
      if (event.type !== 'mention.results') return {}
      const {suggestions, isFetching, isError} = event
      return {
        suggestions,
        isFetching,
        isError,
        selected: suggestions.length ? Math.min(context.selected, suggestions.length - 1) : 0,
      }
    }),
    selectNext: assign({
      selected: ({context}) => (context.selected + 1) % context.suggestions.length,
    }),
    selectPrev: assign({
      selected: ({context}) => (context.selected - 1 + context.suggestions.length) % context.suggestions.length,
    }),
    applyDraft: emit(({context}): QueryBlockSearchEmitted => ({type: 'search.applied', value: context.draft})),
    applyEmpty: emit({type: 'search.applied', value: ''}),
    applyChanged: emit(
      ({event}): QueryBlockSearchEmitted => ({
        type: 'search.applied',
        value: event.type === 'input.changed' ? event.value : '',
      }),
    ),
    applyPicked: emit(
      ({context, event}): QueryBlockSearchEmitted => ({
        type: 'search.applied',
        value: getQueryBlockMentionRef(
          (event.type === 'mention.picked' ? event.candidate : context.suggestions[context.selected])!,
        ),
      }),
    ),
  },
}).createMachine({
  id: 'queryBlockSearch',
  context: {
    draft: '',
    suggestions: [],
    isFetching: false,
    isError: false,
    selected: 0,
  },
  initial: 'collapsed',
  states: {
    collapsed: {
      on: {
        'search.expanded': {target: 'editing.text', actions: 'startEditing'},
        'search.cleared': {actions: 'applyEmpty'},
      },
    },
    editing: {
      initial: 'text',
      states: {
        text: {
          on: {
            'input.changed': [
              {
                guard: 'hasTrigger',
                target: 'mention',
                actions: ['setDraft', 'resetSelection', 'applyEmpty'],
              },
              {actions: ['setDraft', 'applyChanged']},
            ],
          },
        },
        mention: {
          tags: 'menuOpen',
          on: {
            'input.changed': [
              {guard: 'hasTrigger', actions: ['setDraft', 'resetSelection']},
              {target: 'text', actions: ['setDraft', 'applyChanged']},
            ],
            'mention.results': {actions: 'applyResults'},
            'mention.picked': {target: '#queryBlockSearch.collapsed', actions: 'applyPicked'},
            'key.down': {guard: 'hasSuggestions', actions: 'selectNext'},
            'key.up': {guard: 'hasSuggestions', actions: 'selectPrev'},
            'key.enter': {
              guard: 'canPickHighlighted',
              target: '#queryBlockSearch.collapsed',
              actions: 'applyPicked',
            },
            'key.escape': {target: 'dismissed', actions: 'applyDraft'},
            'input.blurred': {target: '#queryBlockSearch.collapsed', actions: 'applyDraft'},
          },
        },
        dismissed: {
          on: {
            'input.changed': [
              {guard: 'hasTrigger', actions: ['setDraft', 'applyChanged']},
              {target: 'text', actions: ['setDraft', 'applyChanged']},
            ],
          },
        },
      },
    },
  },
  on: {
    'input.blurred': {target: '.collapsed'},
  },
})
