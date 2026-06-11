import {HMBlockChildrenType} from '@seed-hypermedia/client/hm-types'
import {Editor} from '@tiptap/core'
import {ResolvedPos} from '@tiptap/pm/model'
import {Node as PMNode} from 'prosemirror-model'
import {EditorState, TextSelection} from 'prosemirror-state'
import {getBlockInfoFromSelection} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'
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
 * When the previous sibling is a table, wrap the current block in a new empty
 * paragraph blockNode so the list has a parent to be attached to.
 */
function wrapInEmptyParagraphUnderTable(
  state: EditorState,
  dispatch: ((args?: any) => any) | undefined,
  listType: HMBlockChildrenType,
  listLevel: string,
): boolean {
  let blockInfo
  try {
    blockInfo = getBlockInfoFromSelection(state)
  } catch {
    return false
  }
  if (!dispatch) return true

  const blockNodeType = state.schema.nodes['blockNode']
  const paragraphType = state.schema.nodes['paragraph']
  const blockChildrenType = state.schema.nodes['blockChildren']
  if (!blockNodeType || !paragraphType || !blockChildrenType) return false

  const emptyParagraph = paragraphType.create()
  const innerChildren = blockChildrenType.create({listType, listLevel}, blockInfo.block.node)
  const wrappingBlock = blockNodeType.create(null, [emptyParagraph, innerChildren])

  const tr = state.tr.replaceWith(blockInfo.block.beforePos, blockInfo.block.afterPos, wrappingBlock)
  // The original block now sits 2 structural levels deeper, which is 4 added positions.
  const newFrom = state.selection.from + 4
  tr.setSelection(TextSelection.near(tr.doc.resolve(newFrom))).scrollIntoView()
  dispatch(tr)
  return true
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

    // The root blockChildren is persisted on document metadata, not on a parent block.
    if ($pos.node(depth - 1).type.name === 'doc' && container && group.firstChild?.attrs.id === container.attrs.id) {
      if ((listType === 'Unordered' || listType === 'Ordered') && dispatch) {
        const tr = state.tr
        tr.setNodeMarkup($pos.before(depth), null, {
          ...group.attrs,
          listType,
          listLevel: '1',
        })
        dispatch(tr)
        ;(
          editor as unknown as {_onRootChildrenTypeChange?: (listType: HMBlockChildrenType) => void}
        )._onRootChildrenTypeChange?.(listType)
        return true
      }
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
        // Wrap in an empty paragraph blockNode before sinking,
        // if the previous sibling is a table block.
        setTimeout(() => {
          editor.commands.command(({state: s, dispatch: d}) => wrapInEmptyParagraphUnderTable(s, d, listType, '1'))
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
        // Wrap in an empty paragraph blockNode before sinking,
        // if the previous sibling is a table block.
        setTimeout(() => {
          editor.commands.command(({state: s, dispatch: d}) => wrapInEmptyParagraphUnderTable(s, d, listType, '1'))
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
