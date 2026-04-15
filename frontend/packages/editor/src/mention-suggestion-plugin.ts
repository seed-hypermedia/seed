import {Plugin, PluginKey} from 'prosemirror-state'
import {Decoration, DecorationSet, EditorView} from 'prosemirror-view'

export const mentionSuggestionPluginKey = new PluginKey('MentionSuggestionPlugin')

/** State tracked by the mention suggestion ProseMirror plugin. */
export type MentionPluginState = {
  active: boolean
  queryStartPos: number | undefined
  decorationId: string | undefined
}

function getDefaultState(): MentionPluginState {
  return {
    active: false,
    queryStartPos: undefined,
    decorationId: undefined,
  }
}

/**
 * Creates a ProseMirror plugin that activates on `@` trigger and intercepts
 * keyboard events while the mention popup is open.
 */
export function createMentionSuggestionPlugin(opts: {
  onStateChange: (state: MentionPluginState, query: string) => void
  onKeyboard: (key: 'ArrowUp' | 'ArrowDown' | 'Enter' | 'Escape') => void
  getReferencePos: () => DOMRect | undefined
}) {
  const deactivate = (view: EditorView) => {
    view.dispatch(view.state.tr.setMeta(mentionSuggestionPluginKey, {deactivate: true}))
  }

  const plugin = new Plugin<MentionPluginState>({
    key: mentionSuggestionPluginKey,

    state: {
      init(): MentionPluginState {
        return getDefaultState()
      },

      apply(transaction, prev, _oldState, newState): MentionPluginState {
        if (transaction.getMeta('orderedListIndexing') !== undefined) {
          return prev
        }

        if (transaction.getMeta(mentionSuggestionPluginKey)?.activate) {
          return {
            active: true,
            queryStartPos: newState.selection.from,
            decorationId: `mention_${Math.floor(Math.random() * 0xffffffff)}`,
          }
        }

        if (!prev.active) {
          return prev
        }

        if (
          newState.selection.from !== newState.selection.to ||
          transaction.getMeta(mentionSuggestionPluginKey)?.deactivate ||
          transaction.getMeta('focus') ||
          transaction.getMeta('blur') ||
          transaction.getMeta('pointer') ||
          newState.selection.from < prev.queryStartPos!
        ) {
          return getDefaultState()
        }

        if (transaction.getMeta(mentionSuggestionPluginKey)?.closeNoResults) {
          return getDefaultState()
        }

        return prev
      },
    },

    view() {
      return {
        update(view) {
          const state: MentionPluginState = mentionSuggestionPluginKey.getState(view.state)
          let query = ''
          if (state.active && state.queryStartPos !== undefined) {
            query = view.state.doc.textBetween(state.queryStartPos, view.state.selection.from)
          }
          opts.onStateChange(state, query)
        },
      }
    },

    props: {
      handleKeyDown(view, event) {
        const menuIsActive = (this as Plugin).getState(view.state).active

        if (event.key === '@' && !menuIsActive) {
          const {state} = view
          const {selection} = state

          if (selection.from !== selection.to) return false

          const posBefore = selection.$from.pos - 1
          const isStart = !selection.$from.parent.textContent.length || selection.$from.parentOffset === 0

          if (!isStart) {
            const charBefore = state.doc.textBetween(posBefore, posBefore + 1, undefined, '\ufffc')
            if (charBefore !== ' ') return false
          }

          view.dispatch(
            state.tr
              .insertText('@')
              .scrollIntoView()
              .setMeta(mentionSuggestionPluginKey, {activate: true}),
          )
          return true
        }

        if (!menuIsActive) {
          return false
        }

        if (event.key === 'ArrowUp') {
          opts.onKeyboard('ArrowUp')
          return true
        }
        if (event.key === 'ArrowDown') {
          opts.onKeyboard('ArrowDown')
          return true
        }
        if (event.key === 'Enter') {
          opts.onKeyboard('Enter')
          return true
        }
        if (event.key === 'Escape') {
          deactivate(view)
          return true
        }

        return false
      },

      handleClick(view) {
        const state: MentionPluginState = (this as Plugin).getState(view.state)
        if (state.active) {
          deactivate(view)
        }
      },

      decorations(state) {
        const pluginState: MentionPluginState = (this as Plugin).getState(state)
        if (!pluginState.active || !pluginState.queryStartPos || !pluginState.decorationId) {
          return null
        }

        return DecorationSet.create(state.doc, [
          Decoration.inline(pluginState.queryStartPos - 1, pluginState.queryStartPos, {
            nodeName: 'span',
            class: 'suggestion-decorator',
            'data-decoration-id': pluginState.decorationId,
          }),
        ])
      },
    },
  })

  return {plugin, deactivate}
}
