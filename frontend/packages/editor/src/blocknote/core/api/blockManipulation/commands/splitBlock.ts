import {selectableNodeTypes} from '../../../extensions/BlockManipulation/BlockManipulationExtension'
import {Mark, Node} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {getBlockInfoFromPos} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'

const carryableMarkNames = new Set(['textSize', 'textFamily'])

/** Returns active text formatting marks that should continue after creating a new block. */
export function getCarryableStoredMarks(state: EditorState): Mark[] {
  const source = state.storedMarks ? 'storedMarks' : 'selection.$from.marks()'
  const marks = state.storedMarks ?? state.selection.$from.marks()
  const allNames = marks.map((m) => m.type.name)
  const filtered = marks.filter((mark) => carryableMarkNames.has(mark.type.name))
  const filteredNames = filtered.map((m) => `${m.type.name}=${JSON.stringify(m.attrs)}`)
  console.log('[CTF] getCarryableStoredMarks | source:', source, '| allMarks:', allNames, '| carryable:', filteredNames)
  return filtered
}

export const splitBlockCommand = (posInBlock: number, keepType?: boolean, keepProps?: boolean, insertNode?: Node) => {
  return ({state, dispatch}: {state: EditorState; dispatch: ((args?: any) => any) | undefined}) => {
    let tr = state.tr
    const storedMarks = getCarryableStoredMarks(state)

    const blockInfo = getBlockInfoFromPos(state, posInBlock)

    if (blockInfo.block.node.type.name !== 'blockNode') {
      throw new Error(`BlockContainer expected when calling splitBlock, position ${posInBlock}`)
    }

    const types = [
      {
        type: blockInfo.block.node.type, // always keep blockcontainer type
        attrs: keepProps ? {...blockInfo.block.node.attrs, id: undefined} : {},
      },
      {
        type: keepType ? blockInfo.blockContent.node.type : state.schema.nodes['paragraph'],
        attrs: keepProps ? {...blockInfo.blockContent.node.attrs} : {},
      },
    ]

    // @ts-ignore
    tr = tr.split(posInBlock, 2, types)

    if (insertNode) {
      const insertPos = tr.doc.resolve(tr.mapping.map(posInBlock))
      tr = tr.insert(insertPos.start() - 2, insertNode)
      let selection
      if (insertNode.firstChild && selectableNodeTypes.includes(insertNode.firstChild.type.name)) {
        selection = TextSelection.create(tr.doc, insertPos.start() + 2)
      } else {
        selection = TextSelection.create(tr.doc, insertPos.start())
      }
      tr = tr.setSelection(selection)
    }

    tr = tr.setStoredMarks(storedMarks)
    console.log(
      '[CTF] splitBlockCommand | setting storedMarks:',
      storedMarks.map((m) => `${m.type.name}=${JSON.stringify(m.attrs)}`),
    )

    if (dispatch) {
      dispatch(tr)
    }

    return true
  }
}
