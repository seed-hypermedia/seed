import {HMBlockChildrenType} from '@shm/shared/hm-types'
import {Editor} from '@tiptap/core'
import {Fragment, NodeType, Slice} from '@tiptap/pm/model'
import {ReplaceAroundStep} from '@tiptap/pm/transform'
import {EditorState, TextSelection} from 'prosemirror-state'
import {BlockNoteEditor} from '../../../BlockNoteEditor'
import {
  getBlockInfoFromPos,
  getBlockInfoFromSelection,
} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'
import {
  getGroupInfoFromPos,
  getParentGroupInfoFromPos,
} from '../../../extensions/Blocks/helpers/getGroupInfoFromPos'
import {
  isBlockContainer,
  isBlockGroup,
  isListContainer,
  isListGroup,
} from '../helpers/containerHelpers'
import {updateGroupChildrenCommand} from './updateGroup'

function liftListItem(editor: Editor, posInBlock: number) {
  return function ({state, dispatch}: {state: EditorState; dispatch: any}) {
    const blockInfo = getBlockInfoFromPos(state, posInBlock)

    // Detect what type of container we're lifting
    const currentContainer = blockInfo.block.node
    const isLiftingListContainer = isListContainer(currentContainer)

    // Get current group data
    const {group: currentGroup} = getGroupInfoFromPos(
      state.selection.from,
      state,
    )

    if (state.selection.$from.depth - 1 > 2 && dispatch) {
      // If there are children, need to manually append siblings
      // into block's children to avoid the range error.
      if (blockInfo.block.node.childCount > 1) {
        const blockChildren = state.tr.doc
          .resolve(
            blockInfo.block.beforePos +
              blockInfo.blockContent.node.nodeSize +
              2,
          )
          .node().content

        const parentBlockInfo = getBlockInfoFromPos(
          state,
          state.tr.doc.resolve(blockInfo.block.beforePos + 1).start(-2),
        )!

        const siblingBlocksAfter = state.tr.doc.slice(
          blockInfo.block.afterPos,
          parentBlockInfo.block.afterPos - 2,
        ).content

        // If last child or the only child, manually lift and convert if needed
        if (Fragment.empty.eq(siblingBlocksAfter)) {
          const {group, container, $pos, depth} = getGroupInfoFromPos(
            state.selection.from,
            state,
          )

          const {node: parentGroup, pos: parentGroupPos} =
            getParentGroupInfoFromPos(group, $pos, depth)

          // Determine what container type we need based on parent group
          const shouldCreateListContainer =
            parentGroup && isListGroup(parentGroup)
          const targetContainerType = shouldCreateListContainer
            ? state.schema.nodes['listContainer']!
            : state.schema.nodes['blockContainer']!

          // If we need to convert container type, do it manually
          if (
            (isListContainer(currentContainer) && !shouldCreateListContainer) ||
            (isBlockContainer(currentContainer) && shouldCreateListContainer)
          ) {
            // Manual lift with conversion
            const containerPos = blockInfo.block.beforePos
            const newContainer = targetContainerType.create(
              blockInfo.block.node.attrs,
              blockInfo.block.node.content,
            )

            // Delete current container and insert converted one at parent level
            const parentPos = state.doc
              .resolve(containerPos)
              .start(state.doc.resolve(containerPos).depth - 2)

            state.tr
              .delete(
                containerPos,
                containerPos + blockInfo.block.node.nodeSize,
              )
              .insert(parentPos - 1, newContainer)
              .setSelection(
                new TextSelection(
                  state.tr.doc.resolve(
                    parentPos - 1 + blockInfo.blockContent.node.nodeSize,
                  ),
                ),
              )

            dispatch(state.tr)
            return true
          } else {
            // Same container type, use TipTap's liftListItem
            const containerTypeToLift = isListContainer(currentContainer)
              ? 'listContainer'
              : 'blockContainer'

            setTimeout(() => {
              editor
                .chain()
                .liftListItem(containerTypeToLift)
                .command(
                  updateGroupChildrenCommand(
                    group,
                    container!,
                    $pos,
                    parentGroup && isListGroup(parentGroup)
                      ? parentGroup.attrs.listType === 'Unordered'
                        ? parseInt(parentGroup.attrs.listLevel) + 1
                        : parseInt(parentGroup.attrs.listLevel)
                      : parentGroup?.attrs.listType === 'Unordered'
                      ? parseInt(parentGroup.attrs.listLevel) + 1
                      : parseInt(group.attrs.listLevel || '1'),
                    isListGroup(group)
                      ? group.attrs.listType
                      : group.attrs.listType,
                    false,
                  ),
                )
                .run()
            })
            return true
          }
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
          parentBlockInfo.block.beforePos +
            parentBlockInfo.blockContent.node.nodeSize +
            2 ===
          blockInfo.block.beforePos
        ) {
          state.tr.delete(
            parentBlockInfo.block.beforePos +
              parentBlockInfo.blockContent.node.nodeSize +
              1,
            parentBlockInfo.block.afterPos - 1,
          )
        } else {
          state.tr.delete(
            blockInfo.block.beforePos,
            parentBlockInfo.block.afterPos - 2,
          )
        }

        // Determine what container type to create based on where we're lifting to
        // Find the target group by walking up to find the parent blockGroup or listGroup
        const $containerPos = state.doc.resolve(blockInfo.block.beforePos)
        const containerDepth = $containerPos.depth

        // Walk up the tree to find the parent blockGroup or listGroup
        // (the one that contains the current group)
        let targetGroup = null
        let targetDepth = -1
        for (let d = containerDepth - 1; d >= 0; d--) {
          const node = $containerPos.node(d)
          if (
            (isBlockGroup(node) || isListGroup(node)) &&
            d < containerDepth - 1
          ) {
            targetGroup = node
            targetDepth = d
            break
          }
        }

        const shouldCreateListContainer =
          targetGroup && isListGroup(targetGroup)
        const containerType = shouldCreateListContainer
          ? state.schema.nodes['listContainer']
          : state.schema.nodes['blockContainer']

        const blockContent = [blockInfo.blockContent.node]
        // If there are children of the unnested block,
        // create a new group for them and attach to block content.
        if (children) {
          // Determine group type based on child group
          const shouldUseListGroup = childGroup && isListGroup(childGroup.group)

          const groupType = shouldUseListGroup
            ? state.schema.nodes['listGroup']
            : state.schema.nodes['blockGroup']

          const groupAttrs =
            childGroup && isListGroup(childGroup.group)
              ? {
                  listType: childGroup.group.attrs.listType,
                  listLevel:
                    parseInt(childGroup.group.attrs.listLevel) > 1
                      ? (
                          parseInt(childGroup.group.attrs.listLevel) - 1
                        ).toString()
                      : '1',
                }
              : childGroup
              ? {
                  listType: childGroup.group.attrs.listType,
                  listLevel:
                    childGroup.group.attrs.listLevel > 1
                      ? childGroup.group.attrs.listLevel - 1
                      : 1,
                }
              : null

          // @ts-ignore
          const childGroupNode = groupType.create(groupAttrs, children)
          blockContent.push(childGroupNode)
        }
        // Create and insert the manually built block instead of
        // using tiptap's liftListItem command.
        // @ts-ignore
        const block = containerType.create(
          blockInfo.block.node.attrs,
          blockContent,
        )

        const insertPos =
          state.tr.selection.from -
          (childGroup.group.attrs.listLevel === '3' ? 4 : 2)

        state.tr.insert(insertPos, block)
        state.tr.setSelection(
          new TextSelection(
            state.tr.doc.resolve(state.tr.selection.from - block.nodeSize),
          ),
        )

        dispatch(state.tr)

        return true
      } else {
        // Simple lift case (no children or siblings to handle)
        // But we still need to handle container type conversion

        const $containerPos = state.selection.$from
        const containerDepth = $containerPos.depth - 1

        // Walk up the tree to find the target group (parent of current group)
        let targetGroup = null
        let targetDepth = -1
        for (let d = containerDepth - 1; d >= 0; d--) {
          const node = $containerPos.node(d)
          if (
            (isBlockGroup(node) || isListGroup(node)) &&
            d < containerDepth - 1
          ) {
            targetGroup = node
            targetDepth = d
            break
          }
        }

        const shouldCreateListContainer =
          targetGroup && isListGroup(targetGroup)

        const needsConversion =
          (isLiftingListContainer && !shouldCreateListContainer) ||
          (!isLiftingListContainer && shouldCreateListContainer)

        if (needsConversion) {
          // Manual lift with conversion
          const targetContainerType = shouldCreateListContainer
            ? state.schema.nodes['listContainer']!
            : state.schema.nodes['blockContainer']!

          const containerPos = blockInfo.block.beforePos
          const newContainer = targetContainerType.create(
            blockInfo.block.node.attrs,
            blockInfo.block.node.content,
          )

          // Calculate target position (parent level)
          const targetPos = state.selection.$from.start(containerDepth - 1) - 1

          state.tr
            .delete(containerPos, containerPos + blockInfo.block.node.nodeSize)
            .insert(targetPos, newContainer)
            .setSelection(
              new TextSelection(state.tr.doc.resolve(targetPos + 2)),
            )

          dispatch(state.tr)
          return true
        } else {
          // No conversion needed, use TipTap's liftListItem
          const containerTypeToLift = isLiftingListContainer
            ? 'listContainer'
            : 'blockContainer'

          setTimeout(() => {
            editor.commands.liftListItem(containerTypeToLift)
          })
          return true
        }
      }
    }

    return true
  }
}

export function sinkListItem(
  itemType: NodeType,
  groupType: NodeType,
  listType: HMBlockChildrenType,
  listLevel: string,
) {
  return function ({state, dispatch}: {state: EditorState; dispatch: any}) {
    const {$from, $to} = state.selection
    const range = $from.blockRange(
      $to,
      (node) =>
        node.childCount > 0 &&
        (node.type.name === 'blockGroup' || node.type.name === 'listGroup'), // change necessary to not look at first item child type
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
      const nestedBefore =
        nodeBefore.lastChild && nodeBefore.lastChild.type === groupType // change necessary to check groupType instead of parent.type
      const inner = Fragment.from(nestedBefore ? itemType.create() : null)
      const slice = new Slice(
        Fragment.from(
          itemType.create(
            null,
            Fragment.from(
              groupType.create(
                {listType: listType, listLevel: listLevel},
                inner,
              ),
            ),
          ), // change necessary to create "groupType" instead of parent.type
        ),
        nestedBefore ? 3 : 1,
        0,
      )
      const before = range.start
      const after = range.end
      dispatch(
        state.tr
          .step(
            new ReplaceAroundStep(
              before - (nestedBefore ? 3 : 1),
              after,
              before,
              after,
              slice,
              1,
              true,
            ),
          )
          .scrollIntoView(),
      )
    }
    return true
  }
}

export function nestBlock(
  editor: BlockNoteEditor<any>,
  listType: HMBlockChildrenType,
  listLevel: string,
) {
  // Determine whether to use list nodes or block nodes based on listType
  const shouldUseListNodes =
    listType === 'Ordered' ||
    listType === 'Unordered' ||
    listType === 'Blockquote'

  const itemType = shouldUseListNodes
    ? editor._tiptapEditor.schema.nodes['listContainer']
    : editor._tiptapEditor.schema.nodes['blockContainer']

  const groupType = shouldUseListNodes
    ? editor._tiptapEditor.schema.nodes['listGroup']
    : editor._tiptapEditor.schema.nodes['blockGroup']

  return editor._tiptapEditor.commands.command(
    sinkListItem(itemType, groupType, listType, listLevel),
  )
}

export function unnestBlock(editor: Editor, posInBlock: number) {
  return editor.commands.command(liftListItem(editor, posInBlock))
}

export function canNestBlock(editor: BlockNoteEditor<any>) {
  const {block: blockContainer} = getBlockInfoFromSelection(
    editor._tiptapEditor.state,
  )

  return (
    editor._tiptapEditor.state.doc.resolve(blockContainer.beforePos)
      .nodeBefore !== null
  )
}

export function canUnnestBlock(editor: BlockNoteEditor<any>) {
  const {block: blockContainer} = getBlockInfoFromSelection(
    editor._tiptapEditor.state,
  )

  return (
    editor._tiptapEditor.state.doc.resolve(blockContainer.beforePos).depth > 1
  )
}
