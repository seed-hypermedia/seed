import {useHideOnDocumentScroll} from '@shm/shared/models/use-document-machine'
import {Link, MessageSquare} from 'lucide-react'
import React, {useCallback, useEffect, useRef, useState} from 'react'
import {BlockNoteEditor} from '../../core/BlockNoteEditor'
import {
  BlockHoverActionsCallbacks,
  BlockHoverActionsProsemirrorPlugin,
  BlockHoverActionsState,
} from '../../core/extensions/BlockHoverActions/BlockHoverActionsPlugin'
import {BlockSchema} from '../../core/extensions/Blocks/api/blockTypes'

const HOVER_BG_CLASS = 'bn-block-hover-highlight'

/**
 * Helper type: once `blockHoverActions` is registered on the editor the
 * property will be present.  Until then, the optional cast lets us detect the
 * absence at runtime without a TypeScript error.
 */
type EditorWithHoverActions<BSchema extends BlockSchema> = BlockNoteEditor<BSchema> & {
  blockHoverActions?: BlockHoverActionsProsemirrorPlugin<BSchema> | null
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/**
 * Props accepted by {@link BlockHoverActionsPositioner}.
 */
export type BlockHoverActionsPositionerProps<BSchema extends BlockSchema = BlockSchema> = {
  /** The BlockNote editor instance. */
  editor: EditorWithHoverActions<BSchema>
} & BlockHoverActionsCallbacks

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Renders a small floating action card anchored to the top-right corner of the
 * block currently under the mouse cursor.
 *
 * Subscribe to the editor's `blockHoverActions` plugin via the EventEmitter and
 * position itself using the block's bounding rect.
 *
 * Only active when the editor is in **read-only** mode (the plugin suppresses
 * emissions when the editor is editable).
 *
 * @example
 * ```tsx
 * <BlockHoverActionsPositioner
 *   editor={editor}
 *   onCopyBlockLink={(id) => copyLinkToBlock(id)}
 *   onStartComment={(id) => openCommentThread(id)}
 * />
 * ```
 */
export function BlockHoverActionsPositioner<BSchema extends BlockSchema = BlockSchema>({
  editor,
  onCopyBlockLink,
  onStartComment,
}: BlockHoverActionsPositionerProps<BSchema>): React.ReactElement | null {
  const [hoverState, setHoverState] = useState<BlockHoverActionsState>({
    show: false,
    blockId: null,
    referenceRect: null,
  })

  // Keep a ref to latest rect so we can re-compute on scroll without stale
  // closure issues.
  const rectRef = useRef<DOMRect | null>(null)

  // Track the currently-highlighted DOM element so we can remove the class.
  const highlightedElRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const plugin = editor.blockHoverActions

    if (!plugin) {
      return
    }

    return plugin.onUpdate((state) => {
      rectRef.current = state.referenceRect
      setHoverState(state)

      // Manage highlight class on the hovered block element.
      const prev = highlightedElRef.current
      if (prev) {
        prev.classList.remove(HOVER_BG_CLASS)
        highlightedElRef.current = null
      }

      if (state.show && state.blockId) {
        const el = editor.prosemirrorView.dom.querySelector(`[data-id="${state.blockId}"]`) as HTMLElement | null
        if (el) {
          el.classList.add(HOVER_BG_CLASS)
          highlightedElRef.current = el
        }
      }
    })
  }, [editor])

  // Clean up highlight on unmount.
  useEffect(() => {
    return () => {
      highlightedElRef.current?.classList.remove(HOVER_BG_CLASS)
    }
  }, [])

  // Hide the card and remove highlight class on document scroll.
  useHideOnDocumentScroll(
    useCallback(() => {
      setHoverState({show: false, blockId: null, referenceRect: null})
      highlightedElRef.current?.classList.remove(HOVER_BG_CLASS)
      highlightedElRef.current = null
    }, []),
  )

  if (!hoverState.show || !hoverState.referenceRect || !hoverState.blockId) {
    return null
  }

  const rect = hoverState.referenceRect
  const blockId = hoverState.blockId

  // Anchor the card to the top-right of the block, nudged up by 16px so it
  // sits slightly above the block's first line (keeps positioning consistent
  // regardless of block height — tall blocks no longer place the card in the
  // middle). The wrapper overlaps the block by ~8px on its left side so the
  // cursor can travel from the block into the buttons without crossing a gap
  // and losing hover; small padding on the right keeps outward mouse travel
  // forgiving too.
  const OVERLAP_PX = 8
  const TOP_OFFSET_PX = -16
  const style: React.CSSProperties = {
    position: 'fixed',
    top: rect.top + TOP_OFFSET_PX,
    left: rect.right - OVERLAP_PX,
    zIndex: 50,
    paddingLeft: OVERLAP_PX,
    paddingRight: 4,
  }

  return (
    <div
      style={style}
      onMouseEnter={() => editor.blockHoverActions?.freeze()}
      onMouseLeave={() => {
        editor.blockHoverActions?.unfreeze()
        // Clear highlight immediately when leaving the card.
        highlightedElRef.current?.classList.remove(HOVER_BG_CLASS)
        highlightedElRef.current = null
      }}
    >
      <div className="bg-popover flex items-center gap-1 rounded-md border p-1 shadow-sm">
        {onCopyBlockLink && (
          <button
            type="button"
            aria-label="Copy block link"
            title="Copy block link"
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1"
            onClick={(e) => {
              e.stopPropagation()
              onCopyBlockLink(blockId)
            }}
          >
            <Link size={14} />
          </button>
        )}
        {onStartComment && (
          <button
            type="button"
            aria-label="Start comment"
            title="Start comment"
            className="text-muted-foreground hover:bg-accent hover:text-foreground rounded p-1"
            onClick={(e) => {
              e.stopPropagation()
              onStartComment(blockId)
            }}
          >
            <MessageSquare size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
