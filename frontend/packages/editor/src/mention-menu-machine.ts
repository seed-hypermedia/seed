import {emptyInlineMentions, InlineMentionsResult} from '@shm/shared/models/inline-mentions'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {MentionMode} from './mention-suggestion-plugin'
import {hmId, packHmId} from '@shm/shared/utils/entity-id-url'
import {assign, fromCallback, fromPromise, setup} from 'xstate'
import type {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import type {MentionMenuKey} from './mention-menu-plugin'
import {mentionSuggestionPluginKey} from './mention-suggestion-plugin'

/** Fetches a single ranked list for one mention mode. */
export type MentionSearchFn = (
  query: string,
  perspectiveAccountUid?: string | null,
  options?: {mode: MentionMode; siteUid?: string; documentId?: UnpackedHypermediaId},
) => Promise<InlineMentionsResult>

function readDecorationRect(editor: BlockNoteEditor<any>, decorationId: string | undefined): DOMRect | undefined {
  if (!decorationId) return undefined
  return editor.domElement.querySelector(`[data-decoration-id="${decorationId}"]`)?.getBoundingClientRect()
}

function insertMentionItem(editor: BlockNoteEditor<any>, item: InlineMentionsResult[number]) {
  if (item.type === 'document' && !item.id.version) return
  const id =
    item.type === 'account'
      ? hmId(item.id.uid, {path: [':profile']})
      : hmId(item.id.uid, {path: item.id.path, version: item.id.version, latest: true})
  editor.mentionMenu?.insertMention(packHmId(id), item.type)
}

type MentionMenuEvent =
  | {type: 'plugin.updated'; active: boolean; query: string; decorationId: string | undefined; mode?: MentionMode}
  | {type: 'menu.scrolled'}
  | {type: 'menu.query'; query: string}
  | {type: 'menu.retry'}
  | {type: 'menu.key'; key: MentionMenuKey}
  | {type: 'menu.select'; item: InlineMentionsResult[number]}
  | {
      type: 'options.updated'
      search: MentionSearchFn
      perspectiveAccountUid?: string | null
      siteUid?: string
      documentId?: UnpackedHypermediaId
    }

type MentionMenuContext = {
  editor: BlockNoteEditor<any>
  search: MentionSearchFn
  perspectiveAccountUid: string | null | undefined
  query: string
  decorationId: string | undefined
  referencePos: DOMRect | undefined
  suggestions: InlineMentionsResult
  selected: number
  mode: MentionMode
  siteUid?: string
  documentId?: UnpackedHypermediaId
  error: boolean
}

type MentionMenuInput = {
  editor: BlockNoteEditor<any>
  search: MentionSearchFn
  perspectiveAccountUid?: string | null
  siteUid?: string
  documentId?: UnpackedHypermediaId
}

/**
 * Mirrors the mention suggestion plugin state into the machine on every editor
 * transaction: whether the menu is active, the current `@query`, and the
 * decoration id used to anchor the popup.
 */
const pluginListener = fromCallback<MentionMenuEvent, {editor: BlockNoteEditor<any>}>(({sendBack, input}) => {
  const tiptap = input.editor._tiptapEditor
  const onTransaction = () => {
    const state = mentionSuggestionPluginKey.getState(tiptap.state)
    if (state?.suspended || state?.composing) return
    sendBack({
      type: 'plugin.updated',
      active: !!state?.active,
      decorationId: state?.decorationId,
      mode: state?.mode,
      query:
        state?.active && state.queryStartPos !== undefined
          ? tiptap.state.doc
              .textBetween(state.queryStartPos, state.to)
              .replace(state.mode === 'document' ? /\]\]$/ : /$^/, '')
          : '',
    })
  }
  tiptap.on('transaction', onTransaction)
  return () => tiptap.off('transaction', onTransaction)
})

/**
 * Tracks the scrollable ancestor of the editor while the menu is open so the
 * popup position can be re-read when the document scrolls.
 */
const scrollListener = fromCallback<MentionMenuEvent, {editor: BlockNoteEditor<any>}>(({sendBack, input}) => {
  const scrollEl =
    input.editor.domElement.closest('[data-radix-scroll-area-viewport]') ??
    document.getElementById('scroll-page-wrapper') ??
    document.documentElement
  const onScroll = () => sendBack({type: 'menu.scrolled'})
  scrollEl.addEventListener('scroll', onScroll, {passive: true})
  return () => scrollEl.removeEventListener('scroll', onScroll)
})

const mentionSearch = fromPromise<
  InlineMentionsResult,
  {
    query: string
    perspectiveAccountUid: string | null | undefined
    search: MentionSearchFn
    mode: MentionMode
    siteUid?: string
    documentId?: UnpackedHypermediaId
  }
>(({input}) =>
  input.search(input.query, input.perspectiveAccountUid, {
    mode: input.mode,
    siteUid: input.siteUid,
    documentId: input.documentId,
  }),
)

/**
 * State machine driving the `@` mention menu: the ProseMirror plugin owns the
 * trigger/decoration lifecycle and reports it through `plugin.updated`; the
 * machine owns query debouncing, search results, keyboard selection, popup
 * anchoring, and the commands sent back into the editor.
 */
export const mentionMenuMachine = setup({
  types: {
    context: {} as MentionMenuContext,
    events: {} as MentionMenuEvent,
    input: {} as MentionMenuInput,
  },
  actors: {
    pluginListener,
    scrollListener,
    mentionSearch,
  },
  guards: {
    canSelectItem: ({context, event}) =>
      !context.error &&
      event.type === 'menu.select' &&
      event.item.type === context.mode &&
      context.suggestions.includes(event.item),
    canSelectHighlighted: ({context, event}) =>
      !context.error &&
      event.type === 'menu.key' &&
      event.key === 'Enter' &&
      context.suggestions[context.selected]?.type === context.mode,
    pluginActive: ({event}) => event.type === 'plugin.updated' && event.active,
    pluginInactive: ({event}) => event.type === 'plugin.updated' && !event.active,
    queryChanged: ({context, event}) =>
      event.type === 'plugin.updated' &&
      (event.query !== context.query || (event.mode !== undefined && event.mode !== context.mode)),
    keyIs: ({event}, params: {key: MentionMenuKey}) => event.type === 'menu.key' && event.key === params.key,
  },
  actions: {
    syncPluginState: assign(({context, event}) => {
      if (event.type !== 'plugin.updated') return {}
      return {
        query: event.query,
        mode: event.mode || 'account',
        decorationId: event.decorationId,
        referencePos: readDecorationRect(context.editor, event.decorationId),
      }
    }),
    resetMenu: assign({
      query: '',
      decorationId: undefined,
      referencePos: undefined,
      suggestions: () => emptyInlineMentions(),
      selected: 0,
    }),
    applySuggestions: assign(({context, event}) => {
      const suggestions = (event as any).output as InlineMentionsResult
      const previous = context.suggestions[context.selected]
      const index = previous ? suggestions.findIndex((item) => item.id.id === previous.id.id) : -1
      return {suggestions, selected: Math.max(0, index), error: false}
    }),
    updateOptions: assign(({event}) => {
      if (event.type !== 'options.updated') return {}
      return {
        search: event.search,
        perspectiveAccountUid: event.perspectiveAccountUid,
        siteUid: event.siteUid,
        documentId: event.documentId,
        suggestions: emptyInlineMentions(),
      }
    }),
    refreshAnchor: assign({
      referencePos: ({context}) => readDecorationRect(context.editor, context.decorationId),
    }),
    bindKeyboard: ({context, self}) => {
      const menu = context.editor.mentionMenu
      if (menu) {
        menu.onKeyboard = (key) => self.send({type: 'menu.key', key})
      }
    },
    unbindKeyboard: ({context}) => {
      const menu = context.editor.mentionMenu
      if (menu) menu.onKeyboard = null
    },
    selectPrev: assign({
      selected: ({context}) => (context.selected - 1 + context.suggestions.length) % (context.suggestions.length || 1),
    }),
    selectNext: assign({selected: ({context}) => (context.selected + 1) % (context.suggestions.length || 1)}),
    insertSelected: ({context}) => {
      const item = context.suggestions[context.selected]
      if (item) insertMentionItem(context.editor, item)
    },
    insertItem: ({context, event}) => {
      if (event.type === 'menu.select') insertMentionItem(context.editor, event.item)
    },
    setQuery: assign(({event}) => (event.type === 'menu.query' ? {query: event.query} : {})),
    setError: assign({error: true}),
    clearError: assign({error: false}),
    checkInsert: assign(({context, event}) => {
      const item = event.type === 'menu.select' ? event.item : context.suggestions[context.selected]
      return {error: !!item && item.type === 'document' && !item.id.version}
    }),
    logSearchError: ({event}) => console.warn('Mention search failed', (event as any).error),
  },
}).createMachine({
  id: 'mentionMenu',
  context: ({input}) => ({
    editor: input.editor,
    search: input.search,
    perspectiveAccountUid: input.perspectiveAccountUid,
    mode: 'account',
    siteUid: input.siteUid,
    documentId: input.documentId,
    error: false,
    query: '',
    decorationId: undefined,
    referencePos: undefined,
    suggestions: emptyInlineMentions(),
    selected: 0,
  }),
  invoke: {
    src: 'pluginListener',
    input: ({context}) => ({editor: context.editor}),
  },
  on: {
    'options.updated': {actions: 'updateOptions'},
  },
  initial: 'closed',
  states: {
    closed: {
      on: {
        'plugin.updated': {
          guard: 'pluginActive',
          target: 'open',
          actions: 'syncPluginState',
        },
      },
    },
    open: {
      entry: 'bindKeyboard',
      exit: 'unbindKeyboard',
      invoke: {
        src: 'scrollListener',
        input: ({context}) => ({editor: context.editor}),
      },
      initial: 'searching',
      states: {
        debouncing: {
          entry: 'clearError',
          after: {
            150: {target: 'searching'},
          },
        },
        searching: {
          entry: 'clearError',
          invoke: {
            src: 'mentionSearch',
            input: ({context}) => ({
              query: context.query,
              perspectiveAccountUid: context.perspectiveAccountUid,
              search: context.search,
              mode: context.mode,
              siteUid: context.siteUid,
              documentId: context.documentId,
            }),
            onDone: {target: 'loaded', actions: 'applySuggestions'},
            onError: {
              target: 'loaded',
              actions: ['logSearchError', 'setError'],
            },
          },
        },
        loaded: {
          on: {
            'menu.key': {guard: 'canSelectHighlighted', actions: ['checkInsert', 'insertSelected']},
            'menu.select': {guard: 'canSelectItem', actions: ['checkInsert', 'insertItem']},
          },
        },
      },
      on: {
        'plugin.updated': [
          {
            guard: 'pluginInactive',
            target: 'closed',
            actions: 'resetMenu',
          },
          {
            guard: 'queryChanged',
            target: '.debouncing',
            actions: 'syncPluginState',
          },
          {actions: 'syncPluginState'},
        ],
        'menu.query': {target: '.debouncing', actions: 'setQuery'},
        'menu.retry': {target: '.searching'},
        'menu.scrolled': {actions: 'refreshAnchor'},
        'menu.key': [
          {guard: {type: 'keyIs', params: {key: 'ArrowUp'}}, actions: 'selectPrev'},
          {guard: {type: 'keyIs', params: {key: 'ArrowDown'}}, actions: 'selectNext'},
        ],
        'options.updated': {target: '.debouncing', actions: 'updateOptions'},
      },
    },
  },
})
