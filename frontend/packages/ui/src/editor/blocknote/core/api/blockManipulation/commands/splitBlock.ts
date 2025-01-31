import {EditorState} from 'prosemirror-state'
import {getBlockInfoFromPos} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'

export const splitBlockCommand = (
  posInBlock: number,
  keepType?: boolean,
  keepProps?: boolean,
) => {
  return ({
    state,
    dispatch,
  }: {
    state: EditorState
    dispatch: ((args?: any) => any) | undefined
  }) => {
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

    if (dispatch) {
      const $pos = state.doc.resolve(posInBlock)
      console.log($pos.parent)
      state.tr.split(posInBlock, 2, types)
    }

    return true
  }
}
