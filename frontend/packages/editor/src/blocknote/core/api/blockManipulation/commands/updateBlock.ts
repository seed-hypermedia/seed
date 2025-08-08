import {Fragment, NodeType, Slice} from '@tiptap/pm/model'
import {ReplaceStep} from '@tiptap/pm/transform'
import {Node as PMNode} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {BlockNoteEditor} from '../../../BlockNoteEditor'
import {
  Block,
  BlockIdentifier,
  BlockSchema,
  PartialBlock,
} from '../../../extensions/Blocks/api/blockTypes'
import {
  BlockInfo,
  getBlockInfoFromPos,
} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'
import {UnreachableCaseError} from '../../../shared/utils'
import {
  blockToNode,
  inlineContentToNodes,
  nodeToBlock,
} from '../../nodeConversions/nodeConversions'
import {getNodeById} from '../../util/nodeUtil'

export const updateBlockCommand =
  <BSchema extends BlockSchema>(
    // editor: BlockNoteEditor<BSchema>,
    posBeforeBlock: number,
    block: PartialBlock<BSchema>,
    keepSelection?: boolean,
  ) =>
  ({
    state,
    dispatch,
  }: {
    state: EditorState
    dispatch: ((args?: any) => any) | undefined
  }) => {
    const blockInfo = getBlockInfoFromPos(state, posBeforeBlock)

    if (dispatch) {
      // Adds blockGroup node with child blocks if necessary.
      const oldNodeType = state.schema.nodes[blockInfo.blockContentType]
      const newNodeType =
        state.schema.nodes[block.type || blockInfo.blockContentType]
      const newBlockNodeType = newNodeType.isInGroup('block')
        ? newNodeType
        : state.schema.nodes['blockContainer']

      if (newNodeType.isInGroup('blockContent')) {
        updateChildren(block, state, blockInfo)
        // The code below determines the new content of the block.
        // or "keep" to keep as-is
        updateBlockContentNode(
          block,
          state,

          // @ts-expect-error
          oldNodeType,
          newNodeType,
          blockInfo,
          keepSelection,
        )
      }

      // Adds all provided props as attributes to the parent blockContainer node too, and also preserves existing
      // attributes.
      state.tr.setNodeMarkup(blockInfo.block.beforePos, newBlockNodeType, {
        ...blockInfo.block.node.attrs,
        ...block.props,
      })
    }

    return true
  }

function updateBlockContentNode<BSchema extends BlockSchema>(
  block: PartialBlock<BSchema>,
  state: EditorState,
  // editor: BlockNoteEditor<BSchema>,
  oldNodeType: NodeType,
  newNodeType: NodeType,
  blockInfo: {
    childContainer?:
      | {node: PMNode; beforePos: number; afterPos: number}
      | undefined
    blockContent: {node: PMNode; beforePos: number; afterPos: number}
  },
  keepSelection?: boolean,
) {
  let content: PMNode[] | 'keep' = 'keep'

  // Has there been any custom content provided?
  if (block.content) {
    if (typeof block.content === 'string') {
      // Adds a single text node with no marks to the content.
      // @ts-expect-error
      content = inlineContentToNodes([block.content], state.schema)
    } else if (Array.isArray(block.content)) {
      // Adds a text node with the provided styles converted into marks to the content,
      // for each InlineContent object.
      content = inlineContentToNodes(block.content, state.schema)
    } else {
      // @ts-expect-error
      throw new UnreachableCaseError(block.content.type)
    }
  } else {
    // no custom content has been provided, use existing content IF possible
    // Since some block types contain inline content and others don't,
    // we either need to call setNodeMarkup to just update type &
    // attributes, or replaceWith to replace the whole blockContent.
    if (oldNodeType.spec.content === '') {
      // keep old content, because it's empty anyway and should be compatible with
      // any newContentType
    } else if (newNodeType.spec.content !== oldNodeType.spec.content) {
      // the content type changed, replace the previous content
      content = []
    } else {
      // keep old content, because the content type is the same and should be compatible
    }
  }

  // Now, changes the blockContent node type and adds the provided props
  // as attributes. Also preserves all existing attributes that are
  // compatible with the new type.
  //
  // Use either setNodeMarkup or replaceWith depending on whether the
  // content is being replaced or not.
  if (content === 'keep') {
    // use setNodeMarkup to only update the type and attributes
    state.tr.setNodeMarkup(
      blockInfo.blockContent.beforePos,
      block.type === undefined ? undefined : state.schema.nodes[block.type],
      {
        ...blockInfo.blockContent.node.attrs,
        ...block.props,
      },
    )
  } else {
    const selectionPos = state.selection.$from
    // use replaceWith to replace the content and the block itself
    // also reset the selection since replacing the block content
    // sets it to the next block.
    state.tr.replaceWith(
      blockInfo.blockContent.beforePos,
      blockInfo.blockContent.afterPos,
      newNodeType.createChecked(
        {
          ...blockInfo.blockContent.node.attrs,
          ...block.props,
        },
        content,
      ),
    )
    if (keepSelection)
      state.tr.setSelection(
        new TextSelection(state.tr.doc.resolve(selectionPos.pos)),
      )
  }
}

function updateChildren<BSchema extends BlockSchema>(
  block: PartialBlock<BSchema>,
  state: EditorState,
  // editor: BlockNoteEditor<BSchema>,
  blockInfo: BlockInfo,
) {
  if (block.children && block.children.length > 0) {
    const childNodes = block.children.map((child) => {
      return blockToNode(child, state.schema)
    })

    // Checks if a blockGroup node already exists.
    if (blockInfo.childContainer) {
      // Replaces all child nodes in the existing blockGroup with the ones created earlier.

      // use a replacestep to avoid the fitting algorithm
      state.tr.step(
        new ReplaceStep(
          blockInfo.childContainer.beforePos + 1,
          blockInfo.childContainer.afterPos - 1,
          new Slice(Fragment.from(childNodes), 0, 0),
        ),
      )
    } else {
      // Inserts a new blockGroup containing the child nodes created earlier.
      state.tr.insert(
        blockInfo.blockContent.afterPos,
        // @ts-expect-error
        state.schema.nodes['blockGroup'].createChecked({}, childNodes),
      )
    }
  }
}

export function updateBlock<BSchema extends BlockSchema>(
  editor: BlockNoteEditor<BSchema>,
  blockToUpdate: BlockIdentifier,
  update: PartialBlock<BSchema>,
  keepSelection?: boolean,
): Block<BSchema> {
  const ttEditor = editor._tiptapEditor

  const id =
    typeof blockToUpdate === 'string' ? blockToUpdate : blockToUpdate.id

  const posInfo = getNodeById(id, ttEditor.state.doc)
  if (!posInfo) {
    throw new Error(`Block with ID ${id} not found`)
  }

  // @ts-expect-error
  ttEditor.commands.command(({state, dispatch}) => {
    updateBlockCommand(
      posInfo.posBeforeNode,
      update,
      keepSelection,
    )({state, dispatch})
    return true
  })

  const blockContainerNode = ttEditor.state.doc
    .resolve(posInfo.posBeforeNode + 1) // TODO: clean?
    .node()

  return nodeToBlock(blockContainerNode, editor.schema, editor.blockCache)
}
