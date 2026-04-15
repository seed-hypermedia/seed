import {Fragment} from 'prosemirror-model'
import {Plugin} from 'prosemirror-state'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {BlockSchema} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {EventEmitter} from './blocknote/core/shared/EventEmitter'
import {
  createMentionSuggestionPlugin,
  MentionPluginState,
  mentionSuggestionPluginKey,
} from './mention-suggestion-plugin'

export type MentionMenuState = {
  show: boolean
  referencePos: DOMRect | undefined
  query: string
}

type MentionMenuEvents = {
  update: MentionMenuState
  keyboard: {key: 'ArrowUp' | 'ArrowDown' | 'Enter' | 'Escape'}
}

/** Bridge between the ProseMirror mention plugin and React UI. */
export class MentionMenuProsemirrorPlugin<BSchema extends BlockSchema> extends EventEmitter<MentionMenuEvents> {
  public readonly plugin: Plugin
  private deactivateFn: (view: import('prosemirror-view').EditorView) => void
  private currentState: MentionPluginState = {active: false, queryStartPos: undefined, decorationId: undefined}

  constructor(private readonly editor: BlockNoteEditor<BSchema>) {
    super()

    const {plugin, deactivate} = createMentionSuggestionPlugin({
      onStateChange: (state, query) => {
        this.currentState = state
        const referencePos = this.getReferencePos()
        this.emit('update', {
          show: state.active,
          referencePos,
          query,
        })
      },
      onKeyboard: (key) => {
        this.emit('keyboard', {key})
      },
      getReferencePos: () => this.getReferencePos(),
    })

    this.plugin = plugin
    this.deactivateFn = deactivate
  }

  /** Subscribe to popup show/hide/query changes. */
  public onUpdate(callback: (state: MentionMenuState) => void) {
    return this.on('update', callback)
  }

  /** Subscribe to keyboard navigation events. */
  public onKeyboard(callback: (event: {key: 'ArrowUp' | 'ArrowDown' | 'Enter' | 'Escape'}) => void) {
    return this.on('keyboard', callback)
  }

  /** Close the mention popup. */
  public close() {
    const view = this.editor._tiptapEditor.view
    if (view) {
      this.deactivateFn(view)
    }
  }

  /** Signal that the query returned no results and has enough chars to auto-close. */
  public closeNoResults() {
    const view = this.editor._tiptapEditor.view
    if (view) {
      view.dispatch(view.state.tr.setMeta(mentionSuggestionPluginKey, {closeNoResults: true}))
    }
  }

  /** Replace the `@query` range with an inline-embed node + trailing space. */
  public insertMention(link: string) {
    const view = this.editor._tiptapEditor.view
    if (!view) return

    const state = mentionSuggestionPluginKey.getState(view.state) as MentionPluginState
    if (!state.active || !state.queryStartPos) return

    const from = state.queryStartPos - 1
    const to = view.state.selection.from
    const node = view.state.schema.nodes['inline-embed']?.create({link})
    if (!node) return

    this.deactivateFn(view)
    view.dispatch(view.state.tr.replaceWith(from, to, Fragment.fromArray([node, view.state.schema.text(' ')])))
  }

  /** The current decoration ID, if the mention menu is active. */
  public get decorationId(): string | undefined {
    return this.currentState.decorationId
  }

  private getReferencePos(): DOMRect | undefined {
    if (!this.currentState.active || !this.currentState.decorationId) return undefined
    const decorationNode = document.querySelector(`[data-decoration-id="${this.currentState.decorationId}"]`)
    return decorationNode?.getBoundingClientRect()
  }
}
