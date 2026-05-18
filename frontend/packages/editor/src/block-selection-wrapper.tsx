import {useState} from 'react'
import {NodeSelection, TextSelection} from 'prosemirror-state'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {MultipleNodeSelection} from './blocknote/core/extensions/SideMenu/MultipleNodeSelection'
import {useEditorSelectionChange} from './blocknote/react/hooks/useEditorSelectionChange'
import {HMBlockSchema} from './schema'
import {getNodesInSelection} from './utils'
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
  } else if (selection instanceof TextSelection || selection instanceof MultipleNodeSelection) {
    const selectedNodes = getNodesInSelection(view)
    isSelected = selectedNodes.some((node) => node.attrs && node.attrs.id === block.id)
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
    <div contentEditable={false} className={cn(className, selected && 'bn-media-selected bg-background')}>
      {children}
    </div>
  )
}
