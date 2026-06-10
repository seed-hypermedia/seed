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
const CARD_OVERLAP_PX = 0
const HORIZONTAL_NUDGE_PX = 0
const VIEWPORT_PADDING_PX = 4
const VERTICAL_POPOVER_WIDTH_ESTIMATE_PX = 40

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
 * Renders a small vertical floating action card for the block selected by
 * the `blockHoverActions` plugin.
 *
 * Subscribe to the editor's `blockHoverActions` plugin via the EventEmitter and
 * position itself using the block's bounding rect. When a block has a
 * supernumber badge, the card overlays the badge instead of shifting outward.
 *
 * Active in editable and read-only editor states; the plugin suppresses
 * emissions while text selection is active.
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
  const hasActions = !!(onCopyBlockLink || onStartComment)
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

  if (!hasActions || !hoverState.show || !hoverState.referenceRect || !hoverState.blockId) {
    return null
  }

  const rect = hoverState.referenceRect
  const blockId = hoverState.blockId
  const supernumberBadge = Array.from(editor.prosemirrorView.dom.querySelectorAll('.bn-supernumber-badge')).find(
    (badge) => badge instanceof HTMLElement && badge.dataset.blockId === blockId,
  ) as HTMLElement | undefined
  const anchorRect = supernumberBadge?.isConnected ? supernumberBadge.getBoundingClientRect() : rect

  // Keep the action card out of document flow. Supernumber badges are covered
  // in place; blocks without a badge get a small overlap on the content edge so
  // moving into the card does not cross an empty gap.
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : Infinity
  const anchorLeft =
    (supernumberBadge?.isConnected ? anchorRect.left : rect.right - CARD_OVERLAP_PX) + HORIZONTAL_NUDGE_PX
  const wouldOverflow = anchorLeft + VERTICAL_POPOVER_WIDTH_ESTIMATE_PX > viewportWidth - VIEWPORT_PADDING_PX
  const style: React.CSSProperties = wouldOverflow
    ? {
        position: 'fixed',
        top: anchorRect.top,
        right: VIEWPORT_PADDING_PX,
        zIndex: 50,
      }
    : {
        position: 'fixed',
        top: anchorRect.top,
        left: anchorLeft,
        zIndex: 50,
      }

  return (
    <div
      data-bn-block-hover-actions="true"
      style={style}
      onMouseEnter={() => editor.blockHoverActions?.freeze()}
      onMouseLeave={() => {
        editor.blockHoverActions?.unfreeze()
        // Clear highlight immediately when leaving the card.
        highlightedElRef.current?.classList.remove(HOVER_BG_CLASS)
        highlightedElRef.current = null
      }}
    >
      <div className="bg-popover flex flex-col items-center gap-1 rounded-md border p-1 shadow-sm">
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
