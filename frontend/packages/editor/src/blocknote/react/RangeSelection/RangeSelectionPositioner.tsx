import {Link, MessageSquare} from 'lucide-react'
import React, {useEffect, useRef, useState} from 'react'
import {BlockNoteEditor} from '../../core/BlockNoteEditor'
import {BlockSchema} from '../../core/extensions/Blocks/api/blockTypes'
import {
  RangeSelectionProsemirrorPlugin,
  RangeSelectionState,
} from '../../core/extensions/RangeSelection/RangeSelectionPlugin'

/**
 * Helper type: once `rangeSelection` is registered on the editor the property
 * will be present.  The optional cast lets us detect the absence at runtime
 * without a TypeScript error.
 */
type EditorWithRangeSelection<BSchema extends BlockSchema> = BlockNoteEditor<BSchema> & {
  rangeSelection?: RangeSelectionProsemirrorPlugin<BSchema> | null
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Props accepted by {@link RangeSelectionPositioner}.
 */
export type RangeSelectionPositionerProps<BSchema extends BlockSchema = BlockSchema> = {
  /** The BlockNote editor instance. */
  editor: EditorWithRangeSelection<BSchema>
  /**
   * Called when the user clicks the "Copy Link" button.
   *
   * @param blockId   The `data-id` of the block containing the selection.
   * @param rangeStart  Zero-based Unicode codepoint offset of selection start.
   * @param rangeEnd    Zero-based Unicode codepoint offset of selection end.
   */
  onCopyFragmentLink?: (blockId: string, rangeStart: number, rangeEnd: number) => void
  /**
   * Called when the user clicks the "Comment" button.
   *
   * @param blockId   The `data-id` of the block containing the selection.
   * @param rangeStart  Zero-based Unicode codepoint offset of selection start.
   * @param rangeEnd    Zero-based Unicode codepoint offset of selection end.
   */
  onComment?: (blockId: string, rangeStart: number, rangeEnd: number) => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders a small floating bubble with "Cite" and "Comment" actions anchored
 * above the current text selection.
 *
 * Subscribes to the editor's `rangeSelection` plugin via the EventEmitter and
 * positions itself using the selection's bounding rect.  The bubble is only
 * visible when the editor is in **read-only** mode and there is a non-empty
 * text selection (the plugin suppresses emissions otherwise).
 *
 * @example
 * ```tsx
 * <RangeSelectionPositioner
 *   editor={editor}
 *   onCite={(blockId, start, end) => openCiteModal(blockId, start, end)}
 *   onComment={(blockId, start, end) => openCommentThread(blockId, start, end)}
 * />
 * ```
 */
export function RangeSelectionPositioner<BSchema extends BlockSchema = BlockSchema>({
  editor,
  onCopyFragmentLink,
  onComment,
}: RangeSelectionPositionerProps<BSchema>) {
  const [selectionState, setSelectionState] = useState<RangeSelectionState>({
    show: false,
    blockId: null,
    rangeStart: null,
    rangeEnd: null,
    referenceRect: null,
  })

  const rectRef = useRef<DOMRect | null>(null)

  useEffect(() => {
    const plugin = editor.rangeSelection

    if (!plugin) {
      return
    }

    return plugin.onUpdate((state) => {
      rectRef.current = state.referenceRect
      setSelectionState(state)
    })
  }, [editor])

  if (
    !selectionState.show ||
    !selectionState.referenceRect ||
    !selectionState.blockId ||
    selectionState.rangeStart === null ||
    selectionState.rangeEnd === null
  ) {
    return null
  }

  const rect = selectionState.referenceRect
  const {blockId, rangeStart, rangeEnd} = selectionState

  // Position the bubble centered above the selection, 8 px above the top edge.
  // `fixed` positioning lets us use the viewport-relative coords from
  // getBoundingClientRect / posToDOMRect directly.
  const bubbleStyle: React.CSSProperties = {
    position: 'fixed',
    top: rect.top - 8,
    left: rect.left + rect.width / 2,
    transform: 'translate(-50%, -100%)',
    zIndex: 50,
  }

  return (
    <div style={bubbleStyle} onMouseDown={stopPropagation}>
      <div className="bg-popover flex items-center gap-1 rounded-md border p-1 shadow-md transition-all duration-150">
        {onCopyFragmentLink && (
          <button
            type="button"
            aria-label="Copy link to selection"
            title="Copy Link"
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1"
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.stopPropagation()
              onCopyFragmentLink(blockId, rangeStart, rangeEnd)
            }}
          >
            <Link size={14} />
          </button>
        )}
        {onComment && (
          <button
            type="button"
            aria-label="Comment on selection"
            title="Comment"
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1"
            onMouseDown={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onClick={(e) => {
              e.stopPropagation()
              onComment(blockId, rangeStart, rangeEnd)
            }}
          >
            <MessageSquare size={14} />
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Prevents mousedown events on the bubble from clearing the editor selection. */
function stopPropagation(e: React.MouseEvent) {
  e.stopPropagation()
}
