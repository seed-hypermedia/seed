import {HMBlockChildrenType} from '@shm/shared'
import {Editor} from '@tiptap/core'
import {ResolvedPos} from '@tiptap/pm/model'
import {Node as PMNode} from 'prosemirror-model'
import {EditorState} from 'prosemirror-state'
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
    } = getGroupInfoFromPos(
      posInBlock < 0 ? state.selection.from : posInBlock,
      state,
    )

    // Check if the group is already the correct type
    if (isSank) {
      const isCorrectType =
        (listType === 'Group' && isBlockGroup(group)) ||
        ((listType === 'Ordered' || listType === 'Unordered') &&
          isListGroup(group))
      if (isCorrectType) return true
    }

    // Change group type to div (convert from list to regular group)
    if (isListGroup(group) && listType === 'Group' && container) {
      if (dispatch) {
        const tr = state.tr
        const groupPos = $pos.start(depth) - 1

        // Convert ALL listContainers to blockContainers
        const blockContainers: PMNode[] = []
        group.forEach((child) => {
          if (isListContainer(child)) {
            blockContainers.push(
              state.schema.nodes['blockContainer']!.create(
                {id: child.attrs.id},
                child.content,
              ),
            )
          }
        })

        const newBlockGroup = state.schema.nodes['blockGroup']!.create(
          null,
          blockContainers,
        )
        tr.replaceWith(groupPos, groupPos + group.nodeSize, newBlockGroup)
        dispatch(tr)
      }

      return true
    }

    // If block is first block in the document do nothing
    if (
      $pos.node(depth - 1).type.name === 'doc' &&
      container &&
      group.firstChild?.attrs.id === container.attrs.id
    )
      return false

    // If block is not the first in its' group, sink into previous sibling
    if (
      group.firstChild &&
      container &&
      group.firstChild.attrs.id !== container.attrs.id &&
      !tab &&
      !isSank
    ) {
      if (dispatch) {
        const tr = state.tr
        const groupStart = $pos.start(depth)
        const shouldUseListGroup =
          listType === 'Ordered' ||
          listType === 'Unordered' ||
          listType === 'Blockquote'

        // Find previous sibling and current container positions
        // Use position-based matching (not id-based) to handle null/duplicate ids
        const containerGroupOffset = $pos.before(depth + 1) - groupStart
        let prevChild: PMNode | null = null
        let prevChildOffset = -1
        let containerOffset = -1

        group.forEach((child, offset) => {
          if (offset === containerGroupOffset) {
            containerOffset = offset
          } else if (containerOffset === -1) {
            prevChild = child
            prevChildOffset = offset
          }
        })

        if (prevChild && containerOffset !== -1) {
          const prevAbsPos = groupStart + prevChildOffset
          const containerAbsPos = groupStart + containerOffset

          // Convert container to target type
          const targetContainerType = shouldUseListGroup
            ? 'listContainer'
            : 'blockContainer'
          const newContainer = state.schema.nodes[targetContainerType]!.create(
            {id: container.attrs.id},
            container.content,
          )

          // Create child group wrapping the container
          const targetGroupType = shouldUseListGroup ? 'listGroup' : 'blockGroup'
          const groupAttrs = shouldUseListGroup
            ? {listType: listType, listLevel: '1'}
            : null
          const newChildGroup = state.schema.nodes[targetGroupType]!.create(
            groupAttrs,
            [newContainer],
          )

          // Build new previous sibling with child group appended
          const prevContent: PMNode[] = []
          ;(prevChild as PMNode).forEach((child) => {
            prevContent.push(child)
          })
          prevContent.push(newChildGroup)

          const newPrevSibling = state.schema.nodes[
            (prevChild as PMNode).type.name
          ]!.create((prevChild as PMNode).attrs, prevContent)

          // Replace both prev sibling and container with augmented prev sibling
          tr.replaceWith(
            prevAbsPos,
            containerAbsPos + container.nodeSize,
            newPrevSibling,
          )
          dispatch(tr)
        }
      }

      return true
    }

    // If inserting a different list type into an existing listGroup, sink the item first
    if (
      isListGroup(group) &&
      group.attrs.listType !== listType &&
      listType !== 'Group' &&
      container &&
      !tab &&
      !turnInto &&
      !isSank
    ) {
      setTimeout(() => {
        // Always sink using blockContainer/blockGroup first
        // (because that's what the current siblings are)
        // Then convert to listContainer/listGroup if needed
        editor
          .chain()
          .sinkListItem('blockContainer')
          .command(updateGroupCommand(-1, listType, tab, true))
          .run()

        return true
      })
      return false
    }

    if (dispatch && (isBlockGroup(group) || isListGroup(group))) {
      // Determine if we should be using listGroup or blockGroup
      const shouldUseListGroup =
        listType === 'Ordered' ||
        listType === 'Unordered' ||
        listType === 'Blockquote'

      let level = '1'
      // Set new level based on the level of the previous group, if any.
      if (depth >= 5) {
        const {node: parentGroup, pos: parentGroupPos} =
          getParentGroupInfoFromPos(group, $pos, depth)
        if (
          parentGroup &&
          isListGroup(parentGroup) &&
          parentGroup.attrs.listType === listType
        ) {
          level = `${parseInt(parentGroup.attrs.listLevel) + 1}`
        }
      }

      if (shouldUseListGroup && isBlockGroup(group)) {
        // blockGroup → listGroup: full replacement converting all children
        const tr = state.tr
        const groupPos = $pos.start(depth) - 1

        const listContainers: PMNode[] = []
        group.forEach((child) => {
          if (isBlockContainer(child)) {
            listContainers.push(
              state.schema.nodes['listContainer']!.create(
                {id: child.attrs.id},
                child.content,
              ),
            )
          }
        })

        const newListGroup = state.schema.nodes['listGroup']!.create(
          {listType: listType, listLevel: level},
          listContainers,
        )
        tr.replaceWith(groupPos, groupPos + group.nodeSize, newListGroup)
        dispatch(tr)
      } else if (shouldUseListGroup && isSank) {
        // After sinking: blockGroup (nested) → listGroup with listContainers
        const tr = state.tr
        const groupPos = $pos.start(depth) - 1

        const listContainers: PMNode[] = []
        group.forEach((child) => {
          if (isBlockContainer(child)) {
            listContainers.push(
              state.schema.nodes['listContainer']!.create(
                {id: child.attrs.id},
                child.content,
              ),
            )
          }
        })

        const newListGroup = state.schema.nodes['listGroup']!.create(
          {listType: listType, listLevel: level},
          listContainers,
        )
        tr.replaceWith(groupPos, groupPos + group.nodeSize, newListGroup)
        dispatch(tr)
      } else if (isListGroup(group)) {
        // List type switching (e.g. Unordered → Ordered): update attribute
        const tr = state.tr
        tr.setNodeMarkup($pos.before(depth), null, {
          ...group.attrs,
          listType: listType,
          listLevel: level,
        })
        dispatch(tr)
      } else {
        // Standard blockGroup attr handling (fallback)
        const tr = state.tr
        tr.setNodeMarkup($pos.before(depth), null, {
          ...group.attrs,
          listType: listType,
          listLevel: level,
        })
        dispatch(tr)

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
  return ({
    state,
    dispatch,
  }: {
    state: EditorState
    dispatch: ((args?: any) => any) | undefined
  }) => {
    if (dispatch) {
      let beforeSelectedContainer = true
      let tr = state.tr
      // Update children level of each child of the group.
      group.content.forEach((childContainer, offset) => {
        if (isBlockContainer(childContainer)) {
          if (childContainer.attrs.id === container.attrs.id) {
            beforeSelectedContainer = false
          }
          if (beforeSelectedContainer) {
            return
          }
          childContainer.descendants((childGroup, pos, _parent, index) => {
            // If the child has a listGroup with Unordered type, update its listLevel
            // Note: blockGroup doesn't have listType/listLevel attributes
            if (
              isListGroup(childGroup) &&
              childGroup.attrs.listType === 'Unordered'
            ) {
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
              const maybeContainer = state.doc.resolve(
                groupPos.start() + pos - 1,
              ).parent

              // Position adjustment based on where the node is in the group.
              // Check if we're inserting the same type as the current group
              const isSameGroupType =
                (isListGroup(group) && group.attrs.listType === listType) ||
                (isBlockGroup(group) && listType === 'Group')
              let posAddition = isBlockContainer(maybeContainer)
                ? indent && isSameGroupType
                  ? -3
                  : -1
                : group.lastChild &&
                  childContainer.eq(group.lastChild) &&
                  !childContainer.eq(group.firstChild!)
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
              if (!isSameGroupType) posAddition += offset

              if (newLevel !== childGroup.attrs.listLevel) {
                tr = tr.setNodeAttribute(
                  groupPos.start() + pos + posAddition,
                  'listLevel',
                  newLevel,
                )
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
