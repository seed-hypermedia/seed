import {Link, MessageSquare} from 'lucide-react'
import React, {useEffect, useMemo, useRef, useState} from 'react'
import {BlockNoteEditor} from '../../core/BlockNoteEditor'
import {
  BlockHoverActionsCallbacks,
  BlockHoverActionsProsemirrorPlugin,
  BlockHoverActionsState,
} from '../../core/extensions/BlockHoverActions/BlockHoverActionsPlugin'
import {BlockSchema} from '../../core/extensions/Blocks/api/blockTypes'

const HOVER_BG_CLASS = 'bn-block-hover-highlight'
const CARD_OVERLAP_PX = 0
const HORIZONTAL_NUDGE_PX = 8
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
  /** Optional app-level referenceability check for the hovered block id. */
  isBlockReferenceable?: (blockId: string) => boolean
  /** Optional lookup for the number of comments that reference a block. */
  getCommentCount?: (blockId: string) => number | undefined
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

function getPublishedBlockRevision<BSchema extends BlockSchema>(
  editor: EditorWithHoverActions<BSchema>,
  blockId: string,
): string {
  let revision = ''
  editor.prosemirrorView?.state?.doc?.descendants?.((node: any) => {
    if (revision) return false
    if (node.type?.name !== 'blockNode' || node.attrs?.id !== blockId) return
    if (typeof node.attrs?.revision === 'string') {
      revision = node.attrs.revision
    }
    node.forEach?.((child: any) => {
      if (revision) return
      if (child.type?.spec?.group === 'block' && typeof child.attrs?.revision === 'string') {
        revision = child.attrs.revision
      }
    })
    return false
  })
  if (revision) return revision

  const blockElement = editor.prosemirrorView?.dom?.querySelector(`[data-id="${blockId}"]`) as HTMLElement | null
  return blockElement?.querySelector('[data-revision]')?.getAttribute('data-revision') || ''
}

export function BlockHoverActionsPositioner<BSchema extends BlockSchema = BlockSchema>({
  editor,
  onCopyBlockLink,
  onStartComment,
  isBlockReferenceable,
  getCommentCount,
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

  // Follow the block on scroll/resize instead of hiding: the card's
  // visibility derives from selection state alone; scrolling only moves it.
  // Capture-phase listener catches scrolls of any inner scroll container
  // (e.g. the desktop ScrollArea viewport), rAF-throttled.
  useEffect(() => {
    if (!hoverState.show) return

    let raf = 0
    const reposition = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        editor.blockHoverActions?.refresh()
      })
    }
    window.addEventListener('scroll', reposition, {capture: true, passive: true})
    window.addEventListener('resize', reposition)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('scroll', reposition, {capture: true})
      window.removeEventListener('resize', reposition)
    }
  }, [hoverState.show, editor])

  // Referenceability and the supernumber-badge lookup depend only on the block
  // identity, not its rect, so memoize both. Otherwise every scroll frame (which
  // refreshes the rect) would re-run a full doc.descendants walk and a
  // querySelectorAll on gated surfaces. These hooks must run before the early
  // returns below; they tolerate a null blockId while the card is hidden.
  const canReferenceBlock = useMemo(() => {
    if (!hoverState.blockId) return false
    return isBlockReferenceable
      ? isBlockReferenceable(hoverState.blockId)
      : !!getPublishedBlockRevision(editor, hoverState.blockId)
  }, [hoverState.blockId, editor, isBlockReferenceable])

  const supernumberBadge = useMemo(() => {
    if (!hoverState.blockId) return undefined
    const dom = editor.prosemirrorView?.dom
    if (!dom) return undefined
    return Array.from(dom.querySelectorAll('.bn-supernumber-badge')).find(
      (badge) => badge instanceof HTMLElement && badge.dataset.blockId === hoverState.blockId,
    ) as HTMLElement | undefined
  }, [hoverState.blockId, editor, isBlockReferenceable])

  if (!hasActions || !hoverState.show || !hoverState.referenceRect || !hoverState.blockId) {
    return null
  }

  const rect = hoverState.referenceRect
  const blockId = hoverState.blockId
  if (!canReferenceBlock) {
    return null
  }
  const commentCount = getCommentCount?.(blockId) ?? 0

  const hasSupernumberBadge = !!supernumberBadge?.isConnected
  const anchorRect = hasSupernumberBadge ? supernumberBadge.getBoundingClientRect() : rect

  // Keep the action card out of document flow. Supernumber badges are covered
  // in place; blocks without a badge get a small overlap on the content edge so
  // moving into the card does not cross an empty gap.
  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : Infinity
  const anchorLeft = hasSupernumberBadge ? anchorRect.left : rect.right - CARD_OVERLAP_PX + HORIZONTAL_NUDGE_PX
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
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
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
          <div className="flex flex-col items-center gap-0.5">
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
            {commentCount > 0 ? (
              <span className="text-muted-foreground text-xs leading-none" aria-label={`${commentCount} comments`}>
                {commentCount}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
