import {Plugin, PluginKey} from 'prosemirror-state'
import {Decoration, DecorationSet, EditorView} from 'prosemirror-view'

/** Shared trigger mode for account and document mentions. */
export type MentionMode = 'account' | 'document'
/** State key for mention ranges, including ranges held by a mobile dialog. */
export const mentionSuggestionPluginKey = new PluginKey<MentionPluginState>('MentionSuggestionPlugin')
/** The replacement range is mapped through every document transaction. */
export type MentionPluginState = {
  active: boolean
  mode: MentionMode
  from: number
  to: number
  queryStartPos: number
  decorationId?: string
  suspended: boolean
  composing?: boolean
}
const inactive: MentionPluginState = {
  active: false,
  mode: 'account',
  from: 0,
  to: 0,
  queryStartPos: 0,
  suspended: false,
}
/** Recognizes text transactions, including mobile keyboards and IME, without intercepting character input. */
export function createMentionSuggestionPlugin(opts: {
  onKeyboard: (key: 'ArrowUp' | 'ArrowDown' | 'Enter' | 'Escape') => void
}) {
  let domComposing: boolean | undefined
  const deactivate = (view: EditorView) =>
    view.dispatch(view.state.tr.setMeta(mentionSuggestionPluginKey, {deactivate: true}))
  const plugin = new Plugin<MentionPluginState>({
    key: mentionSuggestionPluginKey,
    state: {
      init: () => inactive,
      apply(tr, prev, _old, next) {
        const meta = tr.getMeta(mentionSuggestionPluginKey)
        const composing =
          meta?.composing ?? domComposing ?? (tr.getMeta('composition') !== undefined || !!prev.composing)
        if (meta?.deactivate) return inactive
        if (meta?.activate)
          return {
            active: true,
            mode: meta.mode || 'account',
            from: next.selection.from,
            to: next.selection.to,
            queryStartPos: next.selection.from,
            suspended: false,
            decorationId: `mention_${next.selection.from}`,
          }
        if (prev.active) {
          const start = tr.mapping.mapResult(prev.from, 1)
          const end = tr.mapping.mapResult(prev.to, -1)
          const queryStartPos = tr.mapping.map(prev.queryStartPos, -1)
          if (start.deletedAcross || end.deletedAcross) return inactive
          const from = tr.mapping.map(prev.from, -1)
          if (
            prev.queryStartPos > prev.from &&
            next.doc.textBetween(from, queryStartPos) !== (prev.mode === 'account' ? '@' : '[[')
          )
            return inactive
          if (!prev.suspended && next.selection.$from.parent !== next.doc.resolve(from).parent) return inactive
          const suspended = meta?.suspend ?? prev.suspended
          if (suspended) return {...prev, from: start.pos, to: end.pos, queryStartPos, suspended: true}
          if (!next.selection.empty || next.selection.from < queryStartPos || tr.getMeta('pointer')) return inactive
          return {
            ...prev,
            from: tr.mapping.map(prev.from, -1),
            to: next.selection.from,
            queryStartPos,
            composing,
            suspended: false,
          }
        }
        if (composing) return {...prev, composing}
        if ((!tr.docChanged && meta?.composing !== false) || !next.selection.empty) return prev
        const {$from} = next.selection
        if (
          $from.parent.type.spec.code ||
          $from.marks().some((mark) => mark.type.name === 'code' || mark.type.name === 'link')
        )
          return prev
        const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc')
        const match = (
          meta?.composing === false ? /(?:^|[\s([{])(@|\[\[)([^@\[\]\n]*)$/ : /(?:^|[\s([{])(@|\[\[)$/
        ).exec(before)
        if (!match) return prev
        const trigger = match[1]!
        return {
          active: true,
          mode: trigger === '@' ? 'account' : 'document',
          from: $from.pos - trigger.length - (match[2]?.length || 0),
          to: $from.pos,
          queryStartPos: $from.pos - (match[2]?.length || 0),
          suspended: false,
          decorationId: `mention_${$from.pos}`,
        }
      },
    },
    props: {
      handleDOMEvents: {
        compositionstart(view) {
          domComposing = true
          view.dispatch(view.state.tr.setMeta(mentionSuggestionPluginKey, {composing: true}))
          return false
        },
        compositionend(view) {
          domComposing = false
          view.dispatch(view.state.tr.setMeta(mentionSuggestionPluginKey, {composing: false}))
          return false
        },
      },
      handleKeyDown(view, event) {
        if (event.isComposing || view.composing || !mentionSuggestionPluginKey.getState(view.state)?.active)
          return false
        if (event.key === 'Escape') {
          deactivate(view)
          return true
        }
        if (event.key === 'Enter' || event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          opts.onKeyboard(event.key)
          return true
        }
        return false
      },
      handleClick(view) {
        if (mentionSuggestionPluginKey.getState(view.state)?.active) deactivate(view)
      },
      decorations(state) {
        const s = mentionSuggestionPluginKey.getState(state)
        if (!s?.active || s.from === s.queryStartPos) return null
        return DecorationSet.create(state.doc, [
          Decoration.inline(s.from, s.queryStartPos, {
            nodeName: 'span',
            class: 'suggestion-decorator',
            'data-decoration-id': s.decorationId!,
          }),
        ])
      },
    },
  })
  return {plugin, deactivate}
}
