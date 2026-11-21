import {Gapcursor} from '@tiptap/extension-gapcursor'
import {GapCursor, gapCursor} from '@tiptap/pm/gapcursor'
import {ResolvedPos} from 'prosemirror-model'
import {EditorState, NodeSelection, Plugin, PluginKey, Selection, TextSelection} from 'prosemirror-state'
import {Decoration, DecorationSet, EditorView} from 'prosemirror-view'

const ARROW_DIRECTIONS: Partial<Record<string, -1 | 1>> = {ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1}

/**
 * Lets a click in the space between two blocks that hold no text, such as two embed cards, place a gap cursor
 * there. Typing or pressing Enter at a gap cursor starts a new paragraph between the blocks.
 */
export const GapCursorExtension = Gapcursor.extend({
  priority: 1000,

  addProseMirrorPlugins() {
    const stock = gapCursor()

    /** A gap cursor at `$pos`, or null where none is allowed. */
    const gapCursorAt = (view: EditorView, $pos: ResolvedPos) => {
      if ($pos.parent.type.name !== 'blockChildren' || $pos.parent.attrs.listType === 'Grid') return null
      // Gives a gap cursor only where one is valid.
      const gap = stock.props.createSelectionBetween?.call(stock, view, $pos, $pos)
      return gap instanceof GapCursor ? gap : null
    }

    return [
      new Plugin({
        key: new PluginKey('gapCursor'),
        props: {
          createSelectionBetween: stock.props.createSelectionBetween,
          // Lets IME composition start at a gap cursor.
          handleDOMEvents: stock.props.handleDOMEvents,
          handleClick(view, pos) {
            if (!view.editable) return false
            let $pos = view.state.doc.resolve(pos)
            // Between a block's content and its nested blocks, the click resolves inside that block. The gap there is
            // the start of the nested list, so typing adds its first item.
            if ($pos.parent.type.name === 'blockNode' && $pos.nodeAfter?.type.name === 'blockChildren') {
              $pos = view.state.doc.resolve(pos + 1)
            }
            const gap = gapCursorAt(view, $pos)
            if (!gap) return false
            view.dispatch(view.state.tr.setSelection(gap))
            return true
          },
          handleKeyDown(view, event) {
            const {selection, schema} = view.state
            if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false
            // From a selected block, left and right arrow keys move to the gap on that side.
            if (selection instanceof NodeSelection && selection.$from.parent.type.name === 'blockNode') {
              const side =
                event.key === 'ArrowLeft' ? selection.from - 1 : event.key === 'ArrowRight' ? selection.to + 1 : null
              const gap = side == null ? null : gapCursorAt(view, view.state.doc.resolve(side))
              if (!gap) return false
              view.dispatch(view.state.tr.setSelection(gap).scrollIntoView())
              return true
            }
            if (!(selection instanceof GapCursor)) return false
            const {$head} = selection
            // Enter starts an empty paragraph in the gap.
            if (event.key === 'Enter') {
              const block = schema.nodes.blockNode!.create(null, schema.nodes.paragraph!.create())
              const tr = view.state.tr.insert($head.pos, block)
              view.dispatch(tr.setSelection(TextSelection.near(tr.doc.resolve($head.pos + 1))).scrollIntoView())
              return true
            }
            // Arrow keys select the block on that side of the gap.
            const dir = ARROW_DIRECTIONS[event.key]
            if (!dir) return false
            const next = Selection.findFrom($head, dir)
            if (next) view.dispatch(view.state.tr.setSelection(next).scrollIntoView())
            return true
          },
          decorations: drawGapCursor,
        },
        view: () => ({update: centreLineInGap}),
      }),
    ]
  },
})

/**
 * Sets `--gap-cursor-offset` to half the space above the block marked `before`, so the line sits in the middle of
 * the gap whatever its size.
 */
function centreLineInGap(view: EditorView) {
  const {selection} = view.state
  const below = selection instanceof GapCursor && selection.$head.nodeAfter ? view.nodeDOM(selection.$head.pos) : null
  if (!(below instanceof HTMLElement)) {
    view.dom.style.removeProperty('--gap-cursor-offset')
    return
  }
  const {$head} = selection
  // At the start of a nested list, the block above is the parent block's own content.
  const abovePos = $head.nodeBefore
    ? $head.pos - $head.nodeBefore.nodeSize
    : $head.depth > 1
      ? $head.before($head.depth - 1) + 1
      : null
  const above = abovePos == null ? null : view.nodeDOM(abovePos)
  const gap =
    above instanceof HTMLElement
      ? below.getBoundingClientRect().top - above.getBoundingClientRect().bottom
      : parseFloat(getComputedStyle(below).marginTop)
  view.dom.style.setProperty('--gap-cursor-offset', `${gap / 2}px`)
}

/** Marks the block below the gap cursor, or above it at the end of a list, so CSS can draw the line in the gap. */
function drawGapCursor(state: EditorState) {
  const {selection} = state
  if (!(selection instanceof GapCursor)) return null
  const {$head} = selection
  const after = $head.nodeAfter
  const decoration = after
    ? Decoration.node($head.pos, $head.pos + after.nodeSize, {'data-gap-cursor': 'before'})
    : Decoration.node($head.pos - $head.nodeBefore!.nodeSize, $head.pos, {'data-gap-cursor': 'after'})
  return DecorationSet.create(state.doc, [decoration])
}
