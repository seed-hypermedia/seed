import {Fragment} from 'prosemirror-model'
import {Plugin, TextSelection} from 'prosemirror-state'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {BlockSchema} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {
  createMentionSuggestionPlugin,
  MentionPluginState,
  MentionMode,
  mentionSuggestionPluginKey,
} from './mention-suggestion-plugin'

/** Navigation key pressed while the mention menu is active. */
export type MentionMenuKey = 'ArrowUp' | 'ArrowDown' | 'Enter' | 'Escape'

/**
 * Owns the mention suggestion ProseMirror plugin. React reads the plugin state
 * through {@link mentionSuggestionPluginKey} (active flag, query start and
 * decoration id) instead of subscribing to emitted state; this class only
 * exposes the commands that must dispatch back into the editor.
 */
export class MentionMenuProsemirrorPlugin<BSchema extends BlockSchema> {
  public readonly plugin: Plugin
  /** Called when the user presses a navigation key while the menu is active. */
  public onKeyboard: ((key: MentionMenuKey) => void) | null = null

  constructor(private readonly editor: BlockNoteEditor<BSchema>) {
    const {plugin} = createMentionSuggestionPlugin({
      onKeyboard: (key) => this.onKeyboard?.(key),
    })
    this.plugin = plugin
  }

  /** Close the mention popup. */
  public close() {
    const view = this.editor._tiptapEditor.view
    if (view) {
      const saved = mentionSuggestionPluginKey.getState(view.state)
      const tr = view.state.tr.setMeta(mentionSuggestionPluginKey, {deactivate: true})
      if (saved?.active && saved.suspended)
        tr.setSelection(
          TextSelection.create(view.state.doc, saved.from === saved.queryStartPos ? saved.from : saved.to, saved.to),
        )
      view.dispatch(tr)
    }
  }

  /** Open a picker at the current selection, without inserting a textual trigger. */
  public open(mode: MentionMode) {
    const view = this.editor._tiptapEditor.view
    view.dispatch(view.state.tr.setMeta(mentionSuggestionPluginKey, {activate: true, mode}))
  }

  /** Keep the replacement range while the mobile dialog owns focus. */
  public suspend(suspended = true) {
    const view = this.editor._tiptapEditor.view
    view.dispatch(view.state.tr.setMeta(mentionSuggestionPluginKey, {suspend: suspended}))
  }

  /** Replace the saved trigger/query selection with one atomic inline mention. */
  public insertMention(link: string, mentionKind: MentionMode = 'account') {
    const view = this.editor._tiptapEditor.view
    const state = mentionSuggestionPluginKey.getState(view.state) as MentionPluginState
    if (!state.active) return
    let to = state.to
    if (
      mentionKind === 'document' &&
      view.state.doc.textBetween(to, Math.min(to + 2, view.state.doc.content.size)) === ']]'
    )
      to += 2
    const node = view.state.schema.nodes['inline-embed']?.create({link, mentionKind})
    if (!node) return
    const tr = view.state.tr.replaceWith(state.from, to, Fragment.fromArray([node, view.state.schema.text(' ')]))
    tr.setSelection(TextSelection.create(tr.doc, state.from + node.nodeSize + 1))
    view.dispatch(tr.setMeta(mentionSuggestionPluginKey, {deactivate: true}).scrollIntoView())
  }
}
