import {cn} from '@shm/ui/utils'
import {useEffect, useState} from 'react'
import {selectBlockNodeById} from './block-utils'
import type {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import type {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {fullBlockSelectionPluginKey} from './blocknote/core/extensions/FullBlockSelection/FullBlockSelectionPlugin'
import './blockSelection.css'
import type {HMBlockSchema} from './schema'

/**
 * Click targets that must never trigger block selection: real interactive
 * elements inside a block (links, buttons, inputs) and elements that opt out
 * explicitly. Mirrors MediaContainer.selectBlock's guard.
 */
const INTERACTIVE_CLICK_TARGET =
  'a[href], .link, button, input, textarea, select, [role="button"], [data-media-container-ignore-select]'

/**
 * Single source of truth for "is this block selected": the FullBlockSelection
 * plugin's blockIds — the same state that drives the side-menu block tools and
 * the full-block-selected decorations. Selection chrome (outline, embed action
 * strips, block tools) all derive from this one plugin state, so they update on
 * the same transaction and cannot disagree.
 */
export function isBlockSelected(editor: BlockNoteEditor<HMBlockSchema>, blockId: string): boolean {
  const view = editor._tiptapEditor?.view
  if (!view) return false

  // A read-only, unfocused editor cannot have a user-made selection — this is
  // ProseMirror's mandatory initial selection landing on the first selectable
  // node (e.g. a document whose content starts with a Query block). Readers
  // should never see selection chrome for it.
  if (!editor.isEditable && !view.hasFocus()) return false

  const blockIds = fullBlockSelectionPluginKey.getState(view.state)?.blockIds ?? []
  return blockIds.includes(blockId)
}

/**
 * true when the given block is fully selected. Reactive wrapper around
 * {@link isBlockSelected}, updating when the FullBlockSelection plugin's
 * blockIds change.
 */
export function useIsBlockSelected(editor: BlockNoteEditor<HMBlockSchema>, block: Block<HMBlockSchema>): boolean {
  const [selected, setSelected] = useState(() => isBlockSelected(editor, block.id))
  useEffect(() => {
    const update = () => setSelected(isBlockSelected(editor, block.id))
    const unsubscribe = editor.fullBlockSelection?.onUpdate(update)
    update()
    return unsubscribe
  }, [editor, block.id])
  return selected
}

export function BlockSelectionWrapper({
  editor,
  block,
  children,
  className,
  onSelectionChange,
  selectOnMouseDown,
  onSelectMouseDown,
}: {
  editor: BlockNoteEditor<HMBlockSchema>
  block: Block<HMBlockSchema>
  children: React.ReactNode
  className?: string
  onSelectionChange?: (selected: boolean) => void
  /**
   * First-click-selects for blocks WITHOUT their own robust click-selection
   * path (query, math, button rows). ProseMirror's click handling does
   * node-select these, but the browser also moves the DOM selection into or
   * past their non-editable DOM, and ProseMirror's DOM observer then
   * downgrades the block selection to a stray caret. Handling mousedown in
   * the capture phase (immune to inner stopPropagation) and preventing the
   * default stops the DOM selection from ever moving. Do NOT enable for
   * media/embed blocks — their select-then-open logic depends on the
   * mousedown→click ordering of the existing paths.
   */
  selectOnMouseDown?: boolean
  /**
   * Called on the selecting mousedown BEFORE the selection is dispatched,
   * with whether the block was already selected. Select-then-act blocks
   * (e.g. math's open-editor-on-second-click) need this pre-dispatch
   * snapshot — their own bubble-phase mousedown handlers run AFTER this
   * capture handler has already selected the block.
   */
  onSelectMouseDown?: (wasSelected: boolean) => void
}) {
  const selected = useIsBlockSelected(editor, block)
  useEffect(() => {
    onSelectionChange?.(selected)
  }, [onSelectionChange, selected])

  const handleMouseDownCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectOnMouseDown || !editor.isEditable) return
    if (e.button !== 0 || e.shiftKey) return
    const target = e.target as Element | null
    if (target?.closest?.(INTERACTIVE_CLICK_TARGET)) return
    e.preventDefault()
    const wasSelected = isBlockSelected(editor, block.id)
    onSelectMouseDown?.(wasSelected)
    if (!wasSelected) {
      selectBlockNodeById(editor, block.id)
    }
  }

  return (
    <div
      contentEditable={false}
      className={cn(className, selected && 'bn-media-selected')}
      onMouseDownCapture={selectOnMouseDown ? handleMouseDownCapture : undefined}
    >
      {children}
    </div>
  )
}
