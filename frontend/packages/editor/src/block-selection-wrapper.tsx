import {useState} from 'react'
import {AllSelection, NodeSelection, TextSelection} from 'prosemirror-state'
import {Node as PMNode} from 'prosemirror-model'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {getBlockInfoWithManualOffset} from './blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos'
import {MultipleNodeSelection} from './blocknote/core/extensions/SideMenu/MultipleNodeSelection'
import {useEditorSelectionChange} from './blocknote/react/hooks/useEditorSelectionChange'
import {HMBlockSchema} from './schema'
import {cn} from '@shm/ui/utils'
import './blockSelection.css'

function updateSelection(
  editor: BlockNoteEditor<HMBlockSchema>,
  block: Block<HMBlockSchema>,
  setSelected: (selected: boolean) => void,
) {
  const {view} = editor._tiptapEditor
  const {selection} = view.state
  let isSelected = false

  if (selection instanceof NodeSelection) {
    const selectedNode = view.state.doc.resolve(selection.from).parent
    if (selectedNode && selectedNode.attrs && selectedNode.attrs.id === block.id) {
      isSelected = true
    }
  } else if (selection instanceof AllSelection) {
    isSelected = true
  } else if (selection instanceof MultipleNodeSelection) {
    for (const node of selection.nodes) {
      if (node.attrs && node.attrs.id === block.id) {
        isSelected = true
        break
      }
    }
  } else if (selection instanceof TextSelection) {
    const {from, to} = selection
    view.state.doc.descendants((node: PMNode, pos: number) => {
      if (node.type.name === 'blockNode' && node.attrs?.id === block.id) {
        try {
          const blockInfo = getBlockInfoWithManualOffset(node, pos)
          const contentStart = blockInfo.blockContent.beforePos + 1
          const contentEnd = blockInfo.blockContent.afterPos - 1
          if (from <= contentStart && to >= contentEnd) {
            isSelected = true
          }
        } catch {}
        return false
      }
      return true
    })
  }

  setSelected(isSelected)
}

export function BlockSelectionWrapper({
  editor,
  block,
  children,
  className,
}: {
  editor: BlockNoteEditor<HMBlockSchema>
  block: Block<HMBlockSchema>
  children: React.ReactNode
  className?: string
}) {
  const [selected, setSelected] = useState(false)

  useEditorSelectionChange(editor, () => updateSelection(editor, block, setSelected))

  return (
    <div contentEditable={false} className={cn(className, selected && 'bn-media-selected')}>
      {children}
    </div>
  )
}
