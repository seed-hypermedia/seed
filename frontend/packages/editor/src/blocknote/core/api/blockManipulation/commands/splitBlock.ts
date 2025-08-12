import {selectableNodeTypes} from '../../../extensions/BlockManipulation/BlockManipulationExtension'
import {Node} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {getBlockInfoFromPos} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'

export const splitBlockCommand = (
  posInBlock: number,
  keepType?: boolean,
  keepProps?: boolean,
  insertNode?: Node,
) => {
  return ({
    state,
    dispatch,
  }: {
    state: EditorState
    dispatch: ((args?: any) => any) | undefined
  }) => {
    let tr = state.tr

    const blockInfo = getBlockInfoFromPos(state, posInBlock)

    if (blockInfo.block.node.type.name !== 'blockContainer') {
      throw new Error(
        `BlockContainer expected when calling splitBlock, position ${posInBlock}`,
      )
    }

    const types = [
      {
        type: blockInfo.block.node.type, // always keep blockcontainer type
        attrs: keepProps ? {...blockInfo.block.node.attrs, id: undefined} : {},
      },
      {
        type: keepType
          ? blockInfo.blockContent.node.type
          : state.schema.nodes['paragraph'],
        attrs: keepProps ? {...blockInfo.blockContent.node.attrs} : {},
      },
    ]

    // @ts-ignore
    tr = tr.split(posInBlock, 2, types)

    if (insertNode) {
      const insertPos = tr.doc.resolve(tr.mapping.map(posInBlock))
      tr = tr.insert(insertPos.start() - 2, insertNode)
      let selection
      if (
        insertNode.firstChild &&
        selectableNodeTypes.includes(insertNode.firstChild.type.name)
      ) {
        selection = TextSelection.create(tr.doc, insertPos.start() + 2)
      } else {
        selection = TextSelection.create(tr.doc, insertPos.start())
      }
      tr = tr.setSelection(selection)
    }

    if (dispatch) {
      dispatch(tr)
    }

    return true
  }
}
