import {cn} from '@shm/ui/utils'
import {useEffect, useState} from 'react'
import type {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import type {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {fullBlockSelectionPluginKey} from './blocknote/core/extensions/FullBlockSelection/FullBlockSelectionPlugin'
import './blockSelection.css'
import type {HMBlockSchema} from './schema'

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
}: {
  editor: BlockNoteEditor<HMBlockSchema>
  block: Block<HMBlockSchema>
  children: React.ReactNode
  className?: string
  onSelectionChange?: (selected: boolean) => void
}) {
  const selected = useIsBlockSelected(editor, block)
  useEffect(() => {
    onSelectionChange?.(selected)
  }, [onSelectionChange, selected])
  return (
    <div contentEditable={false} className={cn(className, selected && 'bn-media-selected')}>
      {children}
    </div>
  )
}
