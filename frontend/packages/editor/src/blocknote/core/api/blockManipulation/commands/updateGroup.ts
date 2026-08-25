import {HMBlockChildrenType} from '@seed-hypermedia/client/hm-types'
import {Editor} from '@tiptap/core'
import {ResolvedPos} from '@tiptap/pm/model'
import {Fragment, Node as PMNode} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {getBlockInfoFromPos, getBlockInfoFromSelection} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'
import {getGroupInfoFromPos} from '../../../extensions/Blocks/helpers/getGroupInfoFromPos'

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

  const slotContent = slotType.create({childrenType: listType})
  const innerChildren = blockChildrenType.create({listType}, blockInfo.block.node)
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
 * Nest the whole Slot list under the previous sibling block.
 */
export const nestSlotItem = () => {
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
 * Unnest a single root Slot item by one level. It leaves the Slot to
 * become a plain root block, keeping its entire subtree nested under it.
 *
 * @param opts.requireAtStart when true (Backspace), only fires if the cursor is
 * at the very start of the item's content.
 */
export const liftSlotItem = (opts: {requireAtStart?: boolean} = {}) => {
  return ({state, dispatch}: {state: EditorState; dispatch: ((args?: any) => any) | undefined}) => {
    const {$from} = state.selection

    // Locate the root Slot's inner list group.
    let groupDepth = -1
    for (let d = $from.depth; d >= 3; d--) {
      if ($from.node(d).type.name !== 'blockChildren') continue
      const parent = $from.node(d - 1)
      const grand = $from.node(d - 2)
      const great = $from.node(d - 3)
      if (
        parent.type.name === 'blockNode' &&
        parent.firstChild?.type.name === 'slot' &&
        grand.type.name === 'blockChildren' &&
        great.type.name === 'doc'
      ) {
        groupDepth = d
        break
      }
    }
    if (groupDepth === -1) return false
    // Must be a cursor directly in a top-level item (content block at +2).
    if ($from.depth !== groupDepth + 2) return false
    if (opts.requireAtStart && $from.parentOffset !== 0) return false

    const innerGroup = $from.node(groupDepth)
    const slotWrapper = $from.node(groupDepth - 1)
    const slotNode = slotWrapper.firstChild
    const blockNodeType = state.schema.nodes['blockNode']
    if (!slotNode || !blockNodeType) return false

    const itemIndex = $from.index(groupDepth)
    if (!dispatch) return true

    const items: PMNode[] = []
    innerGroup.forEach((child) => items.push(child))
    const item = items[itemIndex]!
    const before = items.slice(0, itemIndex)
    const after = items.slice(itemIndex + 1)

    let idUsed = false
    const makeSlot = (groupItems: PMNode[]): PMNode => {
      const attrs = idUsed ? {...slotWrapper.attrs, id: null} : slotWrapper.attrs
      idUsed = true
      return blockNodeType.create(attrs, [slotNode, innerGroup.copy(Fragment.fromArray(groupItems))])
    }

    const replacement: PMNode[] = []
    if (before.length) replacement.push(makeSlot(before))
    replacement.push(item)
    if (after.length) replacement.push(makeSlot(after))

    const slotWrapperPos = $from.before(groupDepth - 1)
    const slotWrapperEnd = slotWrapperPos + slotWrapper.nodeSize
    const tr = state.tr.replaceWith(slotWrapperPos, slotWrapperEnd, replacement)

    // Keep the cursor in the lifted item at the same offset.
    const liftedStart = slotWrapperPos + (before.length ? replacement[0]!.nodeSize : 0)
    tr.setSelection(TextSelection.near(tr.doc.resolve(liftedStart + 2 + $from.parentOffset))).scrollIntoView()
    dispatch(tr)
    return true
  }
}

// Check if a list item carries a nested sublist.
function itemSublist(item: PMNode): PMNode | null {
  return item.childCount === 2 && item.lastChild?.type.name === 'blockChildren' ? item.lastChild : null
}

/**
 * Outdent every selected list item inside a root Slot by exactly one level.
 */
export const liftSlotSelection = () => {
  return ({state, dispatch}: {state: EditorState; dispatch: ((args?: any) => any) | undefined}) => {
    const selection = state.selection
    const {$from} = selection

    // Locate the root Slot's inner list group, if any.
    let groupDepth = -1
    for (let d = $from.depth; d >= 3; d--) {
      if ($from.node(d).type.name !== 'blockChildren') continue
      const parent = $from.node(d - 1)
      const grand = $from.node(d - 2)
      const great = $from.node(d - 3)
      if (
        parent.type.name === 'blockNode' &&
        parent.firstChild?.type.name === 'slot' &&
        grand.type.name === 'blockChildren' &&
        great.type.name === 'doc'
      ) {
        groupDepth = d
        break
      }
    }
    if (groupDepth === -1) return false

    const innerGroup = $from.node(groupDepth)
    const slotWrapper = $from.node(groupDepth - 1)
    const slotNode = slotWrapper.firstChild
    const blockNodeType = state.schema.nodes['blockNode']
    const blockChildrenType = state.schema.nodes['blockChildren']
    if (!slotNode || !blockNodeType || !blockChildrenType) return false

    const slotWrapperPos = $from.before(groupDepth - 1)
    const slotWrapperEnd = slotWrapperPos + slotWrapper.nodeSize

    // Determine selected items.
    const {from, to} = selection
    const selectedIds = new Set<string>()
    state.doc.nodesBetween(slotWrapperPos, slotWrapperEnd, (node, pos) => {
      if (node.type.name === 'blockNode' && typeof node.attrs.id === 'string' && node.firstChild) {
        const cStart = pos + 1
        const cEnd = cStart + node.firstChild.nodeSize
        const overlaps = from === to ? cStart <= from && from <= cEnd : cStart < to && cEnd > from
        if (overlaps) selectedIds.add(node.attrs.id)
      }
      return true
    })
    if (!selectedIds.size) return false
    if (!dispatch) return true

    // Remember both selection endpoints by (block id, offset)
    // so we can restore the same range after the rebuild.
    const captureEndpoint = ($pos: typeof $from): {id: string | null; offset: number} => {
      for (let d = $pos.depth; d >= 1; d--) {
        const node = $pos.node(d)
        if (node.type.name === 'blockNode' && typeof node.attrs.id === 'string') {
          return {id: node.attrs.id, offset: $pos.parentOffset}
        }
      }
      return {id: null, offset: $pos.parentOffset}
    }
    const anchorEnd = captureEndpoint($from)
    const headEnd = captureEndpoint(selection.$to)

    // Flatten to (content item, target depth, original list attrs).
    // A Slot item starts at depth 1 and each nesting adds one.
    // The depth drops by one when the item, or any ancestor is selected.
    type Flat = {item: PMNode; depth: number; listAttrs: PMNode['attrs']}
    const flat: Flat[] = []
    const flatten = (list: PMNode, depth: number, ancestorSelected: boolean) => {
      list.forEach((item) => {
        const selected = ancestorSelected || (typeof item.attrs.id === 'string' && selectedIds.has(item.attrs.id))
        const sublist = itemSublist(item)
        flat.push({
          item: blockNodeType.create(item.attrs, [item.firstChild!]),
          depth: selected ? depth - 1 : depth,
          listAttrs: list.attrs,
        })
        if (sublist) flatten(sublist, depth + 1, selected)
      })
    }
    flatten(innerGroup, 1, false)

    // Rebuild the nested list items for a run of same or deeper entries.
    // Each entry becomes a blockNode. Deeper entries become its nested list.
    const buildNested = (entries: Flat[], depth: number): PMNode[] => {
      const result: PMNode[] = []
      let i = 0
      while (i < entries.length) {
        const cur = entries[i]!
        let j = i + 1
        while (j < entries.length && entries[j]!.depth > depth) j++
        const descendants = entries.slice(i + 1, j)
        let node = cur.item
        if (descendants.length) {
          const childList = blockChildrenType.create(
            descendants[0]!.listAttrs,
            Fragment.fromArray(buildNested(descendants, depth + 1)),
          )
          node = blockNodeType.create(cur.item.attrs, [cur.item.firstChild!, childList])
        }
        result.push(node)
        i = j
      }
      return result
    }

    // Walk the flattened items. Depth 0 entries are plain root blocks.
    // Each run of depth 1+ entries becomes one Slot-wrapped list.
    let idUsed = false
    const replacement: PMNode[] = []
    let i = 0
    while (i < flat.length) {
      if (flat[i]!.depth <= 0) {
        replacement.push(flat[i]!.item)
        i++
        continue
      }
      let j = i
      while (j < flat.length && flat[j]!.depth >= 1) j++
      const run = flat.slice(i, j)
      const list = blockChildrenType.create(run[0]!.listAttrs, Fragment.fromArray(buildNested(run, 1)))
      const attrs = idUsed ? {...slotWrapper.attrs, id: null} : slotWrapper.attrs
      idUsed = true
      replacement.push(blockNodeType.create(attrs, [slotNode, list]))
      i = j
    }

    const tr = state.tr.replaceWith(slotWrapperPos, slotWrapperEnd, replacement)

    // Restore the selection over the same blocks.
    const locate = (end: {id: string | null; offset: number}): number | null => {
      if (!end.id) return null
      let result: number | null = null
      tr.doc.descendants((node, pos) => {
        if (result !== null) return false
        if (node.type.name === 'blockNode' && node.attrs.id === end.id) {
          const content = node.firstChild
          const maxOffset = content ? content.content.size : 0
          result = pos + 2 + Math.min(end.offset, maxOffset)
          return false
        }
        return true
      })
      return result
    }
    const anchorPos = locate(anchorEnd)
    const headPos = locate(headEnd)
    const clamp = (p: number) => Math.max(0, Math.min(p, tr.doc.content.size))
    if (anchorPos !== null && headPos !== null) {
      tr.setSelection(TextSelection.between(tr.doc.resolve(clamp(anchorPos)), tr.doc.resolve(clamp(headPos))))
    } else if (anchorPos !== null) {
      tr.setSelection(TextSelection.near(tr.doc.resolve(clamp(anchorPos))))
    }
    tr.scrollIntoView()
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
    const {group, container, depth, $pos} = getGroupInfoFromPos(
      posInBlock < 0 ? state.selection.from : posInBlock,
      state,
    )

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
        })
        dispatch(tr)
      }

      return true
    }

    if ($pos.node(depth - 1).type.name === 'doc' && container && !isSank) {
      if (listType === 'Group') return false

      if (!dispatch) return true

      // Wrap the block in an invisible Slot.
      setTimeout(() => {
        editor.commands.command(({state: s, dispatch: d}) => wrapBlockInSlot(s, d, listType, s.selection.from))
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
          editor.commands.command(({state: s, dispatch: d}) => wrapBlockInSlot(s, d, listType, s.selection.from))
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
          editor.commands.command(({state: s, dispatch: d}) => wrapBlockInSlot(s, d, listType, s.selection.from))
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
      const tr = state.tr
      tr.setNodeMarkup($pos.before(depth), null, {
        ...group.attrs,
        listType: listType,
      })
      dispatch(tr)
    }

    return true
  }
}
