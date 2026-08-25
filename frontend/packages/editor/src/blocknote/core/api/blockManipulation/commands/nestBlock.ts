import {HMBlockChildrenType} from '@seed-hypermedia/client/hm-types'
import {Editor} from '@tiptap/core'
import {Fragment, NodeType, Slice} from '@tiptap/pm/model'
import {ReplaceAroundStep} from '@tiptap/pm/transform'
import {EditorState, TextSelection} from 'prosemirror-state'
import {BlockNoteEditor} from '../../../BlockNoteEditor'
import {getBlockInfoFromPos, getBlockInfoFromSelection} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'
import {getGroupInfoFromPos} from '../../../extensions/Blocks/helpers/getGroupInfoFromPos'
import {isInGridContainer} from '../../../extensions/Blocks/nodes/BlockChildren'
import {getCarryableStoredMarks} from './splitBlock'
import {liftSlotItem, liftSlotSelection} from './updateGroup'

function liftListItem(editor: Editor, posInBlock: number) {
  return function ({state, dispatch}: {state: EditorState; dispatch: any}) {
    const storedMarks = getCarryableStoredMarks(state)
    const blockInfo = getBlockInfoFromPos(state, posInBlock)

    if (state.selection.$from.depth - 1 > 2 && dispatch) {
      // If there are children, need to manually append siblings
      // into block's children to avoid the range error.
      if (blockInfo.block.node.childCount > 1) {
        const blockChildren = state.tr.doc
          .resolve(blockInfo.block.beforePos + blockInfo.blockContent.node.nodeSize + 2)
          .node().content

        const parentBlockInfo = getBlockInfoFromPos(
          state,
          state.tr.doc.resolve(blockInfo.block.beforePos + 1).start(-2),
        )!

        const siblingBlocksAfter = state.tr.doc.slice(
          blockInfo.block.afterPos,
          parentBlockInfo.block.afterPos - 2,
        ).content

        // If last child or the only child, just lift list item.
        if (Fragment.empty.eq(siblingBlocksAfter)) {
          setTimeout(() => {
            editor.chain().liftListItem('blockNode').run()
          })
          return true
        }

        // Move all siblings after the block into its children.
        const children = blockChildren.append(siblingBlocksAfter)

        const childGroup = getGroupInfoFromPos(
          blockInfo.block.beforePos + blockInfo.blockContent.node.nodeSize + 2,
          state,
        )

        // Checks if the block is the first child of its group,
        // then delete the entire `blockGroup`
        // of the parent. Otherwise, only delete the
        // children after the block.
        if (
          parentBlockInfo.block.beforePos + parentBlockInfo.blockContent.node.nodeSize + 2 ===
          blockInfo.block.beforePos
        ) {
          state.tr.delete(
            parentBlockInfo.block.beforePos + parentBlockInfo.blockContent.node.nodeSize + 1,
            parentBlockInfo.block.afterPos - 1,
          )
        } else {
          state.tr.delete(blockInfo.block.beforePos, parentBlockInfo.block.afterPos - 2)
        }

        const blockContent = [blockInfo.blockContent.node]
        // If there are children of the unnested block,
        // create a new group for them and attach to block content.
        if (children) {
          // @ts-ignore
          const blockGroup = state.schema.nodes['blockChildren'].create(
            childGroup ? {listType: childGroup.group.attrs.listType} : null,
            children,
          )
          blockContent.push(blockGroup)
        }
        // Create and insert the manually built block instead of
        // using tiptap's liftListItem command.
        // @ts-ignore
        const block = state.schema.nodes['blockNode'].create(blockInfo.block.node.attrs, blockContent)

        const insertPos = state.tr.mapping.map(parentBlockInfo.block.afterPos)

        state.tr.insert(insertPos, block)
        state.tr.setSelection(new TextSelection(state.tr.doc.resolve(insertPos + 2)))
        state.tr.setStoredMarks(storedMarks)

        dispatch(state.tr)

        return true
      } else {
        setTimeout(() => {
          editor.commands.liftListItem('blockNode')
        })
        return true
      }
    }

    return true
  }
}

export function sinkListItem(itemType: NodeType, groupType: NodeType, listType: HMBlockChildrenType) {
  return function ({state, dispatch}: {state: EditorState; dispatch: any}) {
    const storedMarks = getCarryableStoredMarks(state)
    const {$from, $to} = state.selection
    const range = $from.blockRange(
      $to,
      (node) => node.childCount > 0 && node.type.name === 'blockChildren', // change necessary to not look at first item child type
    )
    if (!range) {
      return false
    }
    const startIndex = range.startIndex
    if (startIndex === 0) {
      return false
    }
    const parent = range.parent
    const nodeBefore = parent.child(startIndex - 1)
    if (nodeBefore.type !== itemType) {
      return false
    }
    if (dispatch) {
      const nestedBefore = nodeBefore.lastChild && nodeBefore.lastChild.type === groupType // change necessary to check groupType instead of parent.type
      const inner = Fragment.from(nestedBefore ? itemType.create() : null)
      const slice = new Slice(
        Fragment.from(
          itemType.create(null, Fragment.from(groupType.create({listType: listType}, inner))), // change necessary to create "groupType" instead of parent.type
        ),
        nestedBefore ? 3 : 1,
        0,
      )

      const before = range.start
      const after = range.end
      dispatch(
        state.tr
          .step(new ReplaceAroundStep(before - (nestedBefore ? 3 : 1), after, before, after, slice, 1, true))
          .setStoredMarks(storedMarks)
          .scrollIntoView(),
      )
    }
    return true
  }
}

export function nestBlock(editor: BlockNoteEditor<any>, listType: HMBlockChildrenType) {
  return editor._tiptapEditor.commands.command(
    sinkListItem(
      editor._tiptapEditor.schema.nodes['blockNode'],
      editor._tiptapEditor.schema.nodes['blockChildren'],
      listType,
    ),
  )
}

export function unnestBlock(editor: Editor, posInBlock: number) {
  if (editor.state.selection.empty && editor.commands.command(liftSlotItem())) return true
  if (editor.commands.command(liftSlotSelection())) return true
  return editor.commands.command(liftListItem(editor, posInBlock))
}

export function canNestBlock(editor: BlockNoteEditor<any>) {
  const state = editor._tiptapEditor.state
  if (isInGridContainer(state, state.selection.from)) return false
  const {block: blockContainer} = getBlockInfoFromSelection(state)

  return state.doc.resolve(blockContainer.beforePos).nodeBefore !== null
}

export function canUnnestBlock(editor: BlockNoteEditor<any>) {
  const state = editor._tiptapEditor.state
  if (isInGridContainer(state, state.selection.from)) return false
  const {block: blockContainer} = getBlockInfoFromSelection(state)

  return state.doc.resolve(blockContainer.beforePos).depth > 1
}
