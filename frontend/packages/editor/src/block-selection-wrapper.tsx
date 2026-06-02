import {cn} from '@shm/ui/utils'
import {Node as PMNode} from 'prosemirror-model'
import {AllSelection, NodeSelection, TextSelection} from 'prosemirror-state'
import {useEffect, useState} from 'react'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {getBlockInfoWithManualOffset} from './blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos'
import {MultipleNodeSelection} from './blocknote/core/extensions/SideMenu/MultipleNodeSelection'
import {useEditorSelectionChange} from './blocknote/react/hooks/useEditorSelectionChange'
import './blockSelection.css'
import {HMBlockSchema} from './schema'

/**
 * Returns true when the current editor selection should show selected-block
 * media chrome for the given block.
 */
export function computeSelected(editor: BlockNoteEditor<HMBlockSchema>, block: Block<HMBlockSchema>): boolean {
  const {view} = editor._tiptapEditor
  const {selection} = view.state

  if (selection instanceof NodeSelection) {
    const selectedNode = view.state.doc.resolve(selection.from).parent
    if (selectedNode && selectedNode.attrs && selectedNode.attrs.id === block.id) {
      return true
    }
  } else if (selection instanceof AllSelection) {
    return true
  } else if (selection instanceof MultipleNodeSelection) {
    for (const node of selection.nodes) {
      if (node.attrs && node.attrs.id === block.id) return true
    }
  } else if (selection instanceof TextSelection) {
    if (selection.empty) return false

    const {from, to} = selection
    let found = false
    view.state.doc.descendants((node: PMNode, pos: number) => {
      if (found) return false
      if (node.type.name === 'blockNode' && node.attrs?.id === block.id) {
        try {
          const blockInfo = getBlockInfoWithManualOffset(node, pos)
          const contentStart = blockInfo.blockContent.beforePos + 1
          const contentEnd = blockInfo.blockContent.afterPos - 1
          if (from <= contentStart && to >= contentEnd) found = true
        } catch {}
        return false
      }
      return true
    })
    return found
  }

  return false
}

/**
 * true when the given block is the current ProseMirror
 * selection target. Use inside custom block specs that
 * need to react to selection state
 */
export function useIsBlockSelected(editor: BlockNoteEditor<HMBlockSchema>, block: Block<HMBlockSchema>): boolean {
  const [selected, setSelected] = useState(() => computeSelected(editor, block))
  useEditorSelectionChange(editor, () => setSelected(computeSelected(editor, block)))
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
