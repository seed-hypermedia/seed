import {HMBlockChildrenType} from '@shm/shared'
import {Fragment, NodeRange, NodeType, Slice} from '@tiptap/pm/model'
import {canJoin, liftTarget, ReplaceAroundStep} from '@tiptap/pm/transform'
import {EditorState, Transaction} from 'prosemirror-state'
import {BlockNoteEditor} from '../../../BlockNoteEditor'
import {getBlockInfoFromSelection} from '../../../extensions/Blocks/helpers/getBlockInfoFromPos'

function sinkListItem(
  itemType: NodeType,
  groupType: NodeType,
  listType: HMBlockChildrenType,
  listLevel: string,
) {
  return function ({state, dispatch}: {state: EditorState; dispatch: any}) {
    const {$from, $to} = state.selection
    const range = $from.blockRange(
      $to,
      (node) => node.childCount > 0 && node.type.name === 'blockGroup', // change necessary to not look at first item child type
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

      console.log(slice)

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

/// Create a command to lift the list item around the selection up into
/// a wrapping list.
function liftListItem(itemType: NodeType) {
  return function ({state, dispatch}: {state: EditorState; dispatch: any}) {
    let {$from, $to} = state.selection
    let range = $from.blockRange(
      $to,
      (node) => node.childCount > 0 && node.firstChild!.type == itemType,
    )
    // console.log(range, dispatch)
    if (!range) return false
    if (!dispatch) return true
    console.log($from.node(range.depth - 1))
    if ($from.node(range.depth - 1).type == itemType)
      // Inside a parent list
      return liftToOuterList(state, dispatch, itemType, range)
    // Outer list node
    else return liftOutOfList(state, dispatch, range)
  }
}

// function liftToOuterList(
//   state: EditorState,
//   dispatch: (tr: Transaction) => void,
//   itemType: NodeType,
//   range: NodeRange,
// ) {
//   console.log('here 1')
//   let tr = state.tr,
//     end = range.end,
//     endOfList = range.$to.end(range.depth)
//   console.log(end, endOfList)
//   if (end < endOfList) {
//     // There are siblings after the lifted items, which must become
//     // children of the last item
//     const step = new ReplaceAroundStep(
//       end - 1,
//       endOfList,
//       end,
//       endOfList,
//       new Slice(
//         Fragment.from(itemType.create(null, range.parent.copy())),
//         1,
//         0,
//       ),
//       1,
//       true,
//     )
//     console.log(
//       // step,
//       Fragment.from(itemType.create(null, range.parent.copy())),
//       state.doc.resolve(end).parent,
//       state.doc.resolve(endOfList).parent,
//     )
//     tr.step(
//       new ReplaceAroundStep(
//         end - 1,
//         endOfList,
//         end,
//         endOfList,
//         new Slice(
//           Fragment.from(itemType.create(null, range.parent.copy())),
//           1,
//           0,
//         ),
//         1,
//         true,
//       ),
//     )
//     console.log('here 1.5')
//     range = new NodeRange(
//       tr.doc.resolve(range.$from.pos),
//       tr.doc.resolve(endOfList),
//       range.depth,
//     )
//   }
//   console.log('here 2')
//   const target = liftTarget(range)
//   if (target == null) return false
//   tr.lift(range, target)
//   let after = tr.mapping.map(end, -1) - 1
//   if (canJoin(tr.doc, after)) tr.join(after)
//   console.log('here 3')
//   dispatch(tr.scrollIntoView())
//   return true
// }

function liftToOuterList(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  itemType: NodeType,
  range: NodeRange,
) {
  let tr = state.tr
  console.log('Before lift:', range.parent.content.toString())
  let end = range.end
  let endOfList = range.$to.end(range.depth)

  if (end < endOfList) {
    // Adjust content to ensure valid schema
    const content = range.parent.content
    // const blockGroup = content.find((node) => node.type.name === 'blockGroup')
    let blockGroup = null
    content.forEach((node) => {
      if (node.type.name === 'blockGroup') {
        blockGroup = node
      }
    })

    if (blockGroup) {
      // Wrap the child blockGroup to ensure it remains nested correctly
      const wrappedGroup = itemType.create(null, blockGroup.copy())
      tr.step(
        new ReplaceAroundStep(
          end - 1,
          endOfList,
          end,
          endOfList,
          new Slice(Fragment.from(wrappedGroup), 1, 0),
          1,
          true,
        ),
      )
    }
  }

  // Check the new range and lift
  range = new NodeRange(
    tr.doc.resolve(range.$from.pos),
    tr.doc.resolve(endOfList),
    range.depth,
  )

  const target = liftTarget(range)
  if (target == null) return false
  tr.lift(range, target)

  // Merge nodes if necessary
  let after = tr.mapping.map(end, -1) - 1
  if (canJoin(tr.doc, after)) tr.join(after)

  console.log('After lift:', tr.doc.content.toString())

  dispatch(tr.scrollIntoView())
  return true
}

function liftOutOfList(
  state: EditorState,
  dispatch: (tr: Transaction) => void,
  range: NodeRange,
) {
  console.log('here 2')
  let tr = state.tr,
    list = range.parent
  // Merge the list items into a single big item
  for (
    let pos = range.end, i = range.endIndex - 1, e = range.startIndex;
    i > e;
    i--
  ) {
    pos -= list.child(i).nodeSize
    tr.delete(pos - 1, pos + 1)
  }
  let $start = tr.doc.resolve(range.start),
    item = $start.nodeAfter!
  if (tr.mapping.map(range.end) != range.start + $start.nodeAfter!.nodeSize)
    return false
  let atStart = range.startIndex == 0,
    atEnd = range.endIndex == list.childCount
  let parent = $start.node(-1),
    indexBefore = $start.index(-1)
  if (
    !parent.canReplace(
      indexBefore + (atStart ? 0 : 1),
      indexBefore + 1,
      item.content.append(atEnd ? Fragment.empty : Fragment.from(list)),
    )
  )
    return false
  let start = $start.pos,
    end = start + item.nodeSize
  // Strip off the surrounding list. At the sides where we're not at
  // the end of the list, the existing list is closed. At sides where
  // this is the end, it is overwritten to its end.
  tr.step(
    new ReplaceAroundStep(
      start - (atStart ? 1 : 0),
      end + (atEnd ? 1 : 0),
      start + 1,
      end - 1,
      new Slice(
        (atStart
          ? Fragment.empty
          : Fragment.from(list.copy(Fragment.empty))
        ).append(
          atEnd ? Fragment.empty : Fragment.from(list.copy(Fragment.empty)),
        ),
        atStart ? 0 : 1,
        atEnd ? 0 : 1,
      ),
      atStart ? 0 : 1,
    ),
  )
  dispatch(tr.scrollIntoView())
  return true
}

export function nestBlock(
  editor: BlockNoteEditor<any>,
  listType: HMBlockChildrenType,
  listLevel: string,
) {
  return editor._tiptapEditor.commands.command(
    sinkListItem(
      editor._tiptapEditor.schema.nodes['blockContainer'],
      editor._tiptapEditor.schema.nodes['blockGroup'],
      listType,
      listLevel,
    ),
  )
  // editor._tiptapEditor.commands.UpdateGroupChildren()
  // editor._tiptapEditor.chain().(editor._tiptapEditor.commands.command(
  //   sinkListItem(
  //     editor._tiptapEditor.schema.nodes['blockContainer'],
  //     editor._tiptapEditor.schema.nodes['blockGroup'],
  //     listType,
  //     listLevel,
  //   )
  // ))
  // return true
}

export function unnestBlock(editor: BlockNoteEditor<any>) {
  console.log('here')
  // editor._tiptapEditor.commands.liftListItem('blockContainer')
  return editor._tiptapEditor.commands.command(
    liftListItem(editor._tiptapEditor.schema.nodes['blockContainer']),
  )
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
