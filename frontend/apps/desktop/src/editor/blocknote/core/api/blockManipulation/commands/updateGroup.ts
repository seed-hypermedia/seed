import {HMBlockChildrenType} from '@shm/shared'
import {Editor} from '@tiptap/core'
import {ResolvedPos} from '@tiptap/pm/model'
import {Node as PMNode} from 'prosemirror-model'
import {EditorState} from 'prosemirror-state'
import {
  getGroupInfoFromPos,
  getParentGroupInfoFromPos,
} from '../../../extensions/Blocks/helpers/getGroupInfoFromPos'

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

    if (isSank && group.attrs.listType === listType) return true

    // Change group type to div
    if (group.attrs.listType !== 'Group' && listType === 'Group' && container) {
      setTimeout(() => {
        editor
          .chain()
          .command(({state, dispatch}) => {
            if (dispatch) {
              // setTimeout(() => {
              state.tr.setNodeMarkup($pos.before(depth), null, {
                ...group.attrs,
                listType: 'Group',
                listLevel: '1',
              })
              // })
              return true
            }
            return false
          })
          .UpdateGroupChildren(
            group,
            container,
            $pos,
            0,
            group.attrs.listType,
            false,
          )
          .run()
      })

      return true
    }

    // If block is first block in the document do nothing
    if (
      $pos.node(depth - 1).type.name === 'doc' &&
      container &&
      group.firstChild?.attrs.id === container.attrs.id
    )
      return false

    // If block is not the first in its' group, sink list item and then update group
    if (
      group.firstChild &&
      container &&
      group.firstChild.attrs.id !== container.attrs.id &&
      !tab
    ) {
      setTimeout(() => {
        editor
          .chain()
          .sinkListItem('blockContainer')
          .UpdateGroup(-1, listType, tab, true)
          .run()

        return true
      })

      return false
    }

    // If inserting other list type in another list, sink list item and then update group
    if (
      group.attrs.listType !== 'Group' &&
      group.attrs.listType !== listType &&
      container &&
      !tab &&
      !turnInto &&
      !isSank
    ) {
      setTimeout(() => {
        editor
          .chain()
          .sinkListItem('blockContainer')
          .UpdateGroup(-1, listType, tab, true)
          .run()

        return true
      })
      return false
    }

    if (dispatch && group.type.name === 'blockGroup') {
      let level = '1'
      // if (depth > 7) level = '3'
      // else {
      //   switch (depth) {
      //     case 7:
      //       level = '3'
      //       break
      //     case 5:
      //       level = '2'
      //     default:
      //       break
      //   }
      // }
      if (depth >= 5) {
        const {node: parentGroup, pos: parentGroupPos} =
          getParentGroupInfoFromPos(group, $pos, depth)
        if (parentGroup && parentGroup.attrs.listType === listType) {
          level = `${parseInt(parentGroup.attrs.listLevel) + 1}`
        }
      }

      // start
      //   ? state.tr.setNodeMarkup($pos.before(depth), null, {
      //       ...group.attrs,
      //       listType: listType,
      //       listLevel: level,
      //       start: parseInt(start),
      //     })
      //   :
      state.tr.setNodeMarkup($pos.before(depth), null, {
        ...group.attrs,
        listType: listType,
        listLevel: level,
      })

      if (container) {
        console.log(
          'IN UPDATE GROUP BEFORE UPDATING CHILDREN. PRINTING LEVEL, GROUP and LIST TYPE',
          level,
          group,
          listType,
        )
        setTimeout(() => {
          editor.commands.UpdateGroupChildren(
            group,
            container!,
            $pos,
            listType === 'Unordered' ? parseInt(level) : 0,
            listType,
            true,
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
      group.content.forEach((childContainer, offset) => {
        if (childContainer.type.name === 'blockContainer') {
          if (childContainer.attrs.id === container.attrs.id) {
            beforeSelectedContainer = false
          }
          if (beforeSelectedContainer) {
            console.log('NOT RIGHT CONTAINER')
            return
          }
          // console.log('PRINTING GROUP', group)
          console.log(
            "PRINTING GROUP, GROUP'S CHILD CONTAINER AND POS",
            group,
            childContainer,
            offset,
          )
          childContainer.descendants((childGroup, pos, _parent, index) => {
            // If child is a group, update it's list level attribute
            if (
              childGroup.type.name === 'blockGroup' &&
              childGroup.attrs.listType === 'Unordered'
            ) {
              // console.log('PRINTING CHILD AND POS', child, pos)
              const $pos = childContainer.resolve(pos)
              let newLevel: string
              // const {node: parentGroup, pos: parentGroupPos} =
              //   getParentGroupInfoFromPos(group, groupPos, groupPos.depth)
              // console.log(parentGroup, parentGroupPos)
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

              console.log(
                'PRINTING MAYBE CONTAINER???',
                maybeContainer,
                childContainer,
                group.lastChild,
                group.firstChild,
              )

              // childContainer.eq(maybeContainer) && indent
              //       ? -1
              //       : -3

              // Position adjustment based on where in the group the node is
              let posAddition =
                maybeContainer.type.name === 'blockContainer'
                  ? indent && group.attrs.listType === listType
                    ? -3
                    : -1
                  : group.lastChild &&
                    childContainer.eq(group.lastChild) &&
                    !childContainer.eq(group.firstChild!)
                  ? 1
                  : 0

              // console.log(
              //   'PRINTING GROUP LIST TYPE AND NEW LIST TYPE',
              //   group.attrs.listType,
              //   listType,
              // )

              if (
                childContainer.eq(maybeContainer) &&
                indent
                // &&
                // childContainer.eq(group.firstChild!)
              )
                posAddition = -1

              if (group.attrs.listType !== listType) posAddition += offset

              // console.log(
              //   'IN UPDATE CHILDREN BEFORE NODE ATTRS SET. PRINTING NEW LEVEL AND GROUP ATTRS LEVEL',
              //   newLevel,
              //   child.attrs.listLevel,
              // )
              if (newLevel !== childGroup.attrs.listLevel) {
                // console.log(
                //   state.doc.resolve(groupPos.start() + pos - 5).parent,
                //   newLevel,
                // )
                // console.log(
                //   state.doc.resolve(groupPos.start() + pos + posAddition)
                //     .parent,
                //   newLevel,
                // )
                console.log(pos, offset)
                console.log(
                  // groupPos.start(),
                  // state.doc.resolve(groupPos.start()).parent,
                  state.doc.resolve(groupPos.start() + pos + posAddition)
                    .parent,
                  newLevel,
                  posAddition,
                )
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
