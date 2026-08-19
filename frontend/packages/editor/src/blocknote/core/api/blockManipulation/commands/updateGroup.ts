import {HMBlockChildrenType} from '@seed-hypermedia/client/hm-types'
import {Editor} from '@tiptap/core'
import {ResolvedPos} from '@tiptap/pm/model'
import {Fragment, Node as PMNode} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {getBlockInfoFromPos, getBlockInfoFromSelection} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'
import {getGroupInfoFromPos, getParentGroupInfoFromPos} from '../../../extensions/Blocks/helpers/getGroupInfoFromPos'

// Returns true if the current block's previous sibling is a table block.
function isPreviousSiblingTable(state: EditorState): boolean {
  let blockInfo
  try {
    blockInfo = getBlockInfoFromSelection(state)
  } catch {
    return false
  }
  const prevSibling = state.doc.resolve(blockInfo.block.beforePos).nodeBefore
  return prevSibling?.firstChild?.type.name === 'table'
}

/**
 * Wrap a single block in an invisible Slot node
 * so it can carry a childrenType attr root level.
 */
function wrapBlockInSlot(
  state: EditorState,
  dispatch: ((args?: any) => any) | undefined,
  listType: HMBlockChildrenType,
  listLevel: string,
  posInBlock: number,
): boolean {
  let blockInfo
  try {
    blockInfo = getBlockInfoFromPos(state, posInBlock)
  } catch {
    return false
  }
  if (!dispatch) return true

  const slotType = state.schema.nodes['slot']
  const blockNodeType = state.schema.nodes['blockNode']
  const blockChildrenType = state.schema.nodes['blockChildren']
  if (!slotType || !blockNodeType || !blockChildrenType) return false

  const slotContent = slotType.create({childrenType: listType, listLevel})
  const innerChildren = blockChildrenType.create({listType, listLevel}, blockInfo.block.node)
  const wrappingBlock = blockNodeType.create(null, [slotContent, innerChildren])

  // Capture the cursor position before mutating the transaction.
  const originalFrom = posInBlock

  const tr = state.tr.replaceWith(blockInfo.block.beforePos, blockInfo.block.afterPos, wrappingBlock)
  const newFrom = originalFrom + 3
  tr.setSelection(TextSelection.near(tr.doc.resolve(newFrom))).scrollIntoView()
  dispatch(tr)
  return true
}

/**
 * Unwrap a root-level Slot: replace the slot wrapper blockNode with the list
 * items it holds, lifting them back to the root as plain blocks and discarding
 * the slot.
 * @param $pos    Resolved position inside the slot's item.
 * @param groupDepth Depth of the slot's inner blockChildren
 */
function unwrapSlot(
  state: EditorState,
  dispatch: ((args?: any) => any) | undefined,
  $pos: ResolvedPos,
  groupDepth: number,
): boolean {
  const slotWrapperDepth = groupDepth - 1
  if (slotWrapperDepth < 1) return false
  const slotWrapper = $pos.node(slotWrapperDepth)
  if (slotWrapper.type.name !== 'blockNode' || slotWrapper.firstChild?.type.name !== 'slot') return false
  if (!dispatch) return true

  const innerGroup = $pos.node(groupDepth)
  const items: PMNode[] = []
  innerGroup.forEach((child) => items.push(child))
  if (!items.length) return false

  const slotBefore = $pos.before(slotWrapperDepth)
  const slotAfter = slotBefore + slotWrapper.nodeSize

  const tr = state.tr.replaceWith(slotBefore, slotAfter, items)
  // Place the cursor at the start of the first lifted block's content.
  tr.setSelection(TextSelection.near(tr.doc.resolve(slotBefore + 2))).scrollIntoView()
  dispatch(tr)
  return true
}

/**
 * Nest the root level slot under the previous sibling. Used in tab handler.
 */
export const nestFirstSlotItemCommand = () => {
  return ({state, dispatch}: {state: EditorState; dispatch: ((args?: any) => any) | undefined}) => {
    const {group, container, depth, $pos} = getGroupInfoFromPos(state.selection.from, state)
    if (!container) return false

    const slotWrapper = depth - 1 >= 0 ? $pos.node(depth - 1) : null
    const isRootSlot =
      slotWrapper?.type.name === 'blockNode' &&
      slotWrapper.firstChild?.type.name === 'slot' &&
      depth - 3 >= 0 &&
      $pos.node(depth - 2).type.name === 'blockChildren' &&
      $pos.node(depth - 3).type.name === 'doc'
    if (!isRootSlot) return false

    if (group.firstChild?.attrs.id !== container.attrs.id) return false

    const slotWrapperPos = $pos.before(depth - 1)
    const prevSibling = state.doc.resolve(slotWrapperPos).nodeBefore
    if (!prevSibling || prevSibling.type.name !== 'blockNode') return false
    // Only nest under a previous block that has no children of its own.
    if (prevSibling.childCount !== 1) return false

    if (!dispatch) return true

    const innerGroup = slotWrapper!.lastChild!
    const prevContent = prevSibling.firstChild!
    const blockNodeType = state.schema.nodes['blockNode']
    if (!blockNodeType) return false

    const newPrev = blockNodeType.create(prevSibling.attrs, [prevContent, innerGroup])
    const prevStart = slotWrapperPos - prevSibling.nodeSize
    const slotWrapperEnd = slotWrapperPos + slotWrapper!.nodeSize

    const tr = state.tr.replaceWith(prevStart, slotWrapperEnd, newPrev)
    // Keep the cursor in the first item's content.
    tr.setSelection(TextSelection.near(tr.doc.resolve(prevStart + prevContent.nodeSize + 4))).scrollIntoView()
    dispatch(tr)
    return true
  }
}

/**
 * Lift the first item out of a root-level Slot list. It becomes a plain
 * block at the root, while the remaining items stay grouped in the Slot.
 * If the Slot held only one item, the whole Slot is unwrapped.
 *
 * @param opts.requireAtStart when true (Backspace), only fires if the cursor is
 * at the very start of the item's content.
 */
export const liftFirstSlotItemCommand = (opts: {requireAtStart?: boolean} = {}) => {
  return ({state, dispatch}: {state: EditorState; dispatch: ((args?: any) => any) | undefined}) => {
    const {group, container, depth, $pos} = getGroupInfoFromPos(state.selection.from, state)
    if (!container) return false

    const slotWrapper = depth - 1 >= 0 ? $pos.node(depth - 1) : null
    const isRootSlot =
      slotWrapper?.type.name === 'blockNode' &&
      slotWrapper.firstChild?.type.name === 'slot' &&
      depth - 3 >= 0 &&
      $pos.node(depth - 2).type.name === 'blockChildren' &&
      $pos.node(depth - 3).type.name === 'doc'
    if (!isRootSlot) return false

    // Only the first item lifts to root.
    if (group.firstChild?.attrs.id !== container.attrs.id) return false
    // For Backspace, only when the cursor is at the very start of the item.
    if (opts.requireAtStart && $pos.parentOffset !== 0) return false

    if (!dispatch) return true

    const innerGroup = slotWrapper!.lastChild! // the list blockChildren
    const firstItem = innerGroup.firstChild!
    const slotWrapperPos = $pos.before(depth - 1)
    const slotWrapperEnd = slotWrapperPos + slotWrapper!.nodeSize

    let replacement: PMNode[]
    if (innerGroup.childCount === 1) {
      // Only item. Unwrap the Slot entirely.
      replacement = [firstItem]
    } else {
      // Keep the remaining items grouped in a Slot after the lifted first item.
      const remaining: PMNode[] = []
      innerGroup.forEach((child, _offset, index) => {
        if (index > 0) remaining.push(child)
      })
      const newInnerGroup = innerGroup.copy(Fragment.fromArray(remaining))
      const newSlot = slotWrapper!.copy(Fragment.fromArray([slotWrapper!.firstChild!, newInnerGroup]))
      replacement = [firstItem, newSlot]
    }

    const tr = state.tr.replaceWith(slotWrapperPos, slotWrapperEnd, replacement)
    // The lifted first item now sits at slotWrapperPos.
    // Its content starts at +2. Preserve the cursor's offset.
    const newFrom = slotWrapperPos + 2 + $pos.parentOffset
    tr.setSelection(TextSelection.near(tr.doc.resolve(newFrom))).scrollIntoView()
    dispatch(tr)
    return true
  }
}

export const updateGroupCommand = (
  posInBlock: number,
  listType: HMBlockChildrenType,
  tab: boolean,
  // start?: string,
  isSank?: boolean,
  turnInto?: boolean,
) => {
  return ({
    editor,
    state,
    dispatch,
  }: {
    editor: Editor
    state: EditorState
    dispatch: ((args?: any) => any) | undefined
  }) => {
    // Find block group, block container and depth it is at
    const {
      group,
      container,
      depth,
      level: groupLevel,
      $pos,
    } = getGroupInfoFromPos(posInBlock < 0 ? state.selection.from : posInBlock, state)

    if (isSank && group.attrs.listType === listType) return true

    // Unwrap slot when it's turned back into a plain group.
    const parentBlockOfGroup = depth - 1 >= 0 ? $pos.node(depth - 1) : null
    const isInsideSlot =
      parentBlockOfGroup?.type.name === 'blockNode' && parentBlockOfGroup.firstChild?.type.name === 'slot'
    if (isInsideSlot && listType === 'Group' && container) {
      return unwrapSlot(state, dispatch, $pos, depth)
    }

    // Change group type to div
    if (group.attrs.listType !== 'Group' && listType === 'Group' && container) {
      if (dispatch) {
        const tr = state.tr
        tr.setNodeMarkup($pos.before(depth), null, {
          ...group.attrs,
          listType: 'Group',
          listLevel: '1',
        })
        dispatch(tr)
      }

      // Update children levels asynchronously
      setTimeout(() => {
        editor.commands.command(updateGroupChildrenCommand(group, container, $pos, 0, group.attrs.listType, false))
      })

      return true
    }

    if ($pos.node(depth - 1).type.name === 'doc' && container && !isSank) {
      if (listType === 'Group') return false

      if (!dispatch) return true

      // Wrap the block in an invisible Slot.
      setTimeout(() => {
        editor.commands.command(({state: s, dispatch: d}) => wrapBlockInSlot(s, d, listType, '1', s.selection.from))
      })
      return false
    }

    // If block is not the first in its' group, sink list item and then update group.
    if (
      group.firstChild &&
      container &&
      group.firstChild.attrs.id !== container.attrs.id &&
      !tab &&
      !(turnInto && group.attrs.listType === 'Grid')
    ) {
      if (isPreviousSiblingTable(state)) {
        // Can't sink under a table, so wrap the block in an invisible Slot that
        // carries the list instead.
        setTimeout(() => {
          editor.commands.command(({state: s, dispatch: d}) => wrapBlockInSlot(s, d, listType, '1', s.selection.from))
        })
        return false
      }
      setTimeout(() => {
        editor
          .chain()
          .sinkListItem('blockNode')
          .command(updateGroupCommand(-1, listType, tab, true))
          .run()

        return true
      })

      return false
    }

    // If inserting other list type in another list, sink list item and then update group.
    if (
      group.attrs.listType !== 'Group' &&
      group.attrs.listType !== listType &&
      container &&
      !tab &&
      !turnInto &&
      !isSank
    ) {
      if (isPreviousSiblingTable(state)) {
        // Can't sink under a table, so wrap the block in an invisible Slot that
        // carries the list instead.
        setTimeout(() => {
          editor.commands.command(({state: s, dispatch: d}) => wrapBlockInSlot(s, d, listType, '1', s.selection.from))
        })
        return false
      }
      setTimeout(() => {
        editor
          .chain()
          .sinkListItem('blockNode')
          .command(updateGroupCommand(-1, listType, tab, true))
          .run()

        return true
      })
      return false
    }

    if (dispatch && group.type.name === 'blockChildren') {
      let level = '1'
      // Set new level based on the level of the previous group, if any.
      if (depth >= 5) {
        const {node: parentGroup, pos: parentGroupPos} = getParentGroupInfoFromPos(group, $pos, depth)
        if (parentGroup && parentGroup.attrs.listType === listType) {
          level = `${parseInt(parentGroup.attrs.listLevel) + 1}`
        }
      }

      const tr = state.tr
      tr.setNodeMarkup($pos.before(depth), null, {
        ...group.attrs,
        listType: listType,
        listLevel: level,
      })
      dispatch(tr)

      // Update children levels asynchronously
      if (container) {
        setTimeout(() => {
          editor.commands.command(
            updateGroupChildrenCommand(
              group,
              container!,
              $pos,
              listType === 'Unordered' ? parseInt(level) : 0,
              listType,
              true,
            ),
          )
        })
      }
    }

    return true
  }
}

export const updateGroupChildrenCommand = (
  group: PMNode,
  container: PMNode,
  groupPos: ResolvedPos,
  groupLevel: number,
  listType: HMBlockChildrenType,
  indent: boolean,
) => {
  return ({state, dispatch}: {state: EditorState; dispatch: ((args?: any) => any) | undefined}) => {
    if (dispatch) {
      let beforeSelectedContainer = true
      let tr = state.tr
      // Update children level of each child of the group.
      group.content.forEach((childContainer, offset) => {
        if (childContainer.type.name === 'blockNode') {
          if (childContainer.attrs.id === container.attrs.id) {
            beforeSelectedContainer = false
          }
          if (beforeSelectedContainer) {
            return
          }
          childContainer.descendants((childGroup, pos, _parent, index) => {
            // If the child has a group, update group's list level attribute.
            if (childGroup.type.name === 'blockChildren' && childGroup.attrs.listType === 'Unordered') {
              const $pos = childContainer.resolve(pos)
              let newLevel: string
              // Set new level based on depth and indent.
              if (indent) {
                let numericLevel = $pos.depth / 2 + groupLevel + 1
                newLevel = numericLevel < 3 ? numericLevel.toString() : '3'
              } else {
                let numericLevel = $pos.depth / 2 + groupLevel
                newLevel = numericLevel < 3 ? numericLevel.toString() : '3'
              }
              const maybeContainer = state.doc.resolve(groupPos.start() + pos - 1).parent

              // Position adjustment based on where the node is in the group.
              let posAddition =
                maybeContainer.type.name === 'blockNode'
                  ? indent && group.attrs.listType === listType
                    ? -3
                    : -1
                  : group.lastChild && childContainer.eq(group.lastChild) && !childContainer.eq(group.firstChild!)
                    ? 1
                    : 0

              if (
                childContainer.eq(maybeContainer) &&
                indent
                // &&
                // childContainer.eq(group.firstChild!)
              )
                posAddition = -1

              // Add offset only when changing between list types.
              if (group.attrs.listType !== listType) posAddition += offset

              if (newLevel !== childGroup.attrs.listLevel) {
                tr = tr.setNodeAttribute(groupPos.start() + pos + posAddition, 'listLevel', newLevel)
              }
            }
          })
        }
      })

      dispatch(tr)
      return true
    }
    return false
  }
}
