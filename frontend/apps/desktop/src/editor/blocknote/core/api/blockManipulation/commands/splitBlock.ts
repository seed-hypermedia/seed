import {EditorState} from 'prosemirror-state'
import {
  getBlockInfoFromPos,
  getBlockInfoFromResolvedPos,
  getNearestBlockPos,
} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'

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
    const blockInfo = getBlockInfoFromPos(state.doc, posInBlock)
    const newBlockInfo = getBlockInfoFromResolvedPos(
      state.doc.resolve(
        getNearestBlockPos(state.doc, posInBlock).posBeforeNode,
      ),
    )

    if (blockInfo.node.type.name !== 'blockContainer') {
      throw new Error(
        `BlockContainer expected when calling splitBlock, position ${posInBlock}`,
      )
    }

    const types = [
      {
        type: blockInfo.node.type, // always keep blockcontainer type
        attrs: keepProps ? {...blockInfo.node.attrs, id: undefined} : {},
      },
      {
        type: keepType
          ? blockInfo.contentNode.type
          : state.schema.nodes['paragraph'],
        attrs: keepProps ? {...blockInfo.contentNode.attrs} : {},
      },
    ]

    if (dispatch) {
      state.tr.split(posInBlock, 2, types)
    }

    return true
  }
}
