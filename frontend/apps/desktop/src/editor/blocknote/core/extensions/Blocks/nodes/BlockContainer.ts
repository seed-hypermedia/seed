import {mergeAttributes, Node} from '@tiptap/core'
import {Fragment, Node as PMNode, Slice} from 'prosemirror-model'
import {EditorState, Plugin, PluginKey, TextSelection} from 'prosemirror-state'
import {Decoration, DecorationSet} from 'prosemirror-view'

import {HMBlockChildrenType} from '@shm/shared'
import {ResolvedPos} from '@tiptap/pm/model'
import {EditorView} from '@tiptap/pm/view'
import {splitBlockCommand} from '../../../api/blockManipulation/commands/splitBlock'
import {mergeCSSClasses} from '../../../shared/utils'
import {BlockNoteDOMAttributes} from '../api/blockTypes'
import {getBlockInfoFromPos} from '../helpers/getBlockInfoFromPos'
import {
  getGroupInfoFromPos,
  getParentGroupInfoFromPos,
} from '../helpers/getGroupInfoFromPos'
import styles from './Block.module.css'
import BlockAttributes from './BlockAttributes'

export const SelectionPluginKey = new PluginKey('selectionPluginKey')
const ClickSelectionPluginKey = new PluginKey('clickSelectionPluginKey')
const PastePluginKey = new PluginKey('pastePluginKey')
const headingLinePluginKey = new PluginKey('HeadingLinePlugin')

const SelectionPlugin = new Plugin({
  key: SelectionPluginKey,
  state: {
    init() {
      return DecorationSet.empty
    },
    apply(tr, oldState) {
      return tr.getMeta(SelectionPluginKey) || oldState
    },
  },
  props: {
    decorations(state) {
      return this.getState(state)
    },
  },
})

const ClickSelectionPlugin = new Plugin({
  key: ClickSelectionPluginKey,
  props: {
    handleDOMEvents: {
      mousedown(view, event) {
        if (event.shiftKey && event.button === 0) {
          const {state} = view
          const editorBoundingBox = (
            view.dom.firstChild! as HTMLElement
          ).getBoundingClientRect()
          const coords = {
            left: editorBoundingBox.left + editorBoundingBox.width / 2, // take middle of editor
            top: event.clientY,
          }
          let pos = view.posAtCoords(coords)
          if (!pos) {
            return undefined
          }
          const {selection} = state
          const selectedPos = state.doc.resolve(selection.from)
          const nodePos = state.doc.resolve(pos.pos)
          if (
            selectedPos.start() === selection.from &&
            pos.pos === nodePos.end()
          ) {
            const decoration = Decoration.widget(nodePos.pos, () => {
              const span = document.createElement('span')
              span.style.backgroundColor = 'blue'
              span.style.width = '10px'
              span.style.height = '10px'
              return span
            })
            const decorationSet = DecorationSet.create(state.doc, [decoration])
            view.dispatch(state.tr.setMeta(SelectionPluginKey, decorationSet))
          }
          return false
        }
        return false
      },
    },
  },
})

const PastePlugin = new Plugin({
  key: PastePluginKey,
  props: {
    handlePaste: (view, event) => {
      if (!event.clipboardData) {
        return false
      }

      const {state} = view
      let {tr} = state
      const {selection} = state
      const {$from, $to} = selection

      const targetNode = state.doc.resolve($from.pos).parent

      if (targetNode.type.name === 'image') {
        tr = tr.insertText(
          event.clipboardData.getData('text/plain'),
          $from.pos,
          $to.pos,
        )
        view.dispatch(tr)
        return true
      }

      return false
    },
  },
})

const headingLinePlugin = new Plugin({
  key: headingLinePluginKey,
  view(editorView) {
    return new HeadingLinePlugin(editorView)
  },
})

class HeadingLinePlugin {
  private line: HTMLElement
  constructor(view: EditorView) {
    this.line = document.createElement('div')
    this.line.style.transition = 'all 0.15s ease-in-out'
    this.line.style.pointerEvents = 'none'
    this.line.style.display = ''
    this.line.style.opacity = '0'
    view.dom.parentNode?.appendChild(this.line)

    this.update(view, null)
  }

  update(view: EditorView, lastState: EditorState | null) {
    let state = view.state
    // Don't do anything if the document/selection didn't change
    if (
      lastState &&
      lastState.doc.eq(state.doc) &&
      lastState.selection.eq(state.selection)
    )
      return

    let res = getNearestHeadingFromPos(state, state.selection.from)

    if (res && res.heading?.type.name == 'heading') {
      let {node} = view.domAtPos(res.groupStartPos)

      let rect = (node as HTMLElement).getBoundingClientRect()
      let editorRect = view.dom.getBoundingClientRect()
      let groupPadding = 10
      let editorPaddingTop = 40
      this.line.style.position = 'absolute'
      this.line.style.top = `${
        rect.top + editorPaddingTop + groupPadding - editorRect.top
      }px`
      this.line.style.left = `${rect.left - editorRect.left + groupPadding}px`
      this.line.style.width = `2.5px`
      this.line.style.height = `${rect.height - groupPadding * 2}px`
      this.line.style.backgroundColor = 'var(--brand5)'
      this.line.style.opacity = '0.4'
    } else {
      this.line.style.opacity = '0'
      return
    }
  }

  destroy() {
    this.line.remove()
  }
}

function getNearestHeadingFromPos(state: EditorState, pos: number) {
  const $pos = state.doc.resolve(pos)
  const maxDepth = $pos.depth
  let group = $pos.node(maxDepth)
  let heading = group.firstChild
  let depth = maxDepth

  if (maxDepth > 3) {
    while (true) {
      if (depth < 0) {
        break
      }

      if (
        group.type.name == 'blockContainer' &&
        heading?.type.name == 'heading'
      ) {
        break
      }

      depth -= 1
      group = $pos.node(depth)
      heading = group.firstChild
    }
    return {
      depth,
      groupStartPos: $pos.start(depth),
      heading,
      group,
      $pos,
    }
  }

  return
}

export function getParentBlockFromPos(state: EditorState, pos: number) {
  const $pos = state.doc.resolve(pos)
  const depth = $pos.depth

  // if (depth > 3 && container.type.name == 'blockContainer') {
  if (depth > 3) {
    let parent = $pos.node(depth - 3)
    let parentGroup = $pos.node(depth - 2)
    let parentPos = $pos.start(depth - 3)
    return {
      parentGroup,
      parentBlock: parent.firstChild,
      parentPos,
      depth,
      $pos,
    }
  }

  return
}
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    block: {
      BNCreateBlock: (pos: number) => ReturnType
      BNDeleteBlock: (posInBlock: number) => ReturnType
      // BNMergeBlocks: (posBetweenBlocks: number) => ReturnType
      // BNSplitBlock: (posInBlock: number, keepType: boolean) => ReturnType
      BNSplitHeadingBlock: (posInBlock: number) => ReturnType
      // BNUpdateBlock: <BSchema extends BlockSchema>(
      //   posInBlock: number,
      //   block: PartialBlock<BSchema>,
      // ) => ReturnType
      UpdateGroupChildren: (
        group: PMNode,
        container: PMNode,
        groupPos: ResolvedPos,
        groupLevel: number,
        listType: HMBlockChildrenType,
        indent: boolean,
      ) => ReturnType
      UpdateGroup: (
        posInBlock: number,
        listType: HMBlockChildrenType,
        tab: boolean,
        // start?: string,
        isSank?: boolean,
        turnInto?: boolean,
      ) => ReturnType
    }
  }
}

/**
 * The main "Block node" documents consist of
 */
export const BlockContainer = Node.create<{
  domAttributes?: BlockNoteDOMAttributes
}>({
  name: 'blockContainer',
  group: 'blockGroupChild block',
  // A block always contains content, and optionally a blockGroup which contains nested blocks
  content: 'blockContent blockGroup?',
  // Ensures content-specific keyboard handlers trigger first.
  priority: 50,
  defining: true,

  parseHTML() {
    return [
      {
        tag: 'div',
        getAttrs: (element) => {
          if (typeof element === 'string') {
            return false
          }

          const attrs: Record<string, string> = {}
          for (const [nodeAttr, HTMLAttr] of Object.entries(BlockAttributes)) {
            if (element.getAttribute(HTMLAttr)) {
              attrs[nodeAttr] = element.getAttribute(HTMLAttr)!
            }
          }

          if (element.getAttribute('data-node-type') === 'blockContainer') {
            return attrs
          }

          return false
        },
      },
    ]
  },

  renderHTML({HTMLAttributes}) {
    const domAttributes = this.options.domAttributes?.blockContainer || {}

    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: styles.blockOuter,
        'data-node-type': 'block-outer',
      }),
      [
        'div',
        mergeAttributes(
          {
            ...domAttributes,
            class: mergeCSSClasses(styles.block, domAttributes.class),
            'data-node-type': this.name,
          },
          HTMLAttributes,
        ),
        0,
      ],
    ]
  },

  addCommands() {
    return {
      // Creates a new text block at a given position.
      BNCreateBlock:
        (pos) =>
        ({state, dispatch}) => {
          const newBlock = state.schema.nodes['blockContainer'].createAndFill()!

          if (dispatch) {
            state.tr.insert(pos, newBlock)
          }

          return true
        },
      // Deletes a block at a given position.
      BNDeleteBlock:
        (posInBlock) =>
        ({state, dispatch}) => {
          const blockInfo = getBlockInfoFromPos(state, posInBlock)
          if (blockInfo === undefined) {
            return false
          }

          const {block} = blockInfo

          if (dispatch) {
            state.tr.deleteRange(block.beforePos + 1, block.afterPos - 1)
          }

          return true
        },
      // // Updates a block at a given position.
      // BNUpdateBlock:
      //   (posInBlock, block) =>
      //   ({state, dispatch}) => {
      //     const blockInfo = getBlockInfoFromPos(state, posInBlock)
      //     if (blockInfo === undefined) {
      //       return false
      //     }

      //     const {block: blockContainer, blockContent} = blockInfo

      //     if (dispatch) {
      //       // Adds blockGroup node with child blocks if necessary.
      //       if (block.children !== undefined && block.children.length > 0) {
      //         const childNodes = []

      //         // Creates ProseMirror nodes for each child block, including their descendants.
      //         for (const child of block.children) {
      //           childNodes.push(blockToNode(child, state.schema))
      //         }

      //         // Checks if a blockGroup node already exists.
      //         if (blockContainer.node.childCount === 2) {
      //           // Replaces all child nodes in the existing blockGroup with the ones created earlier.
      //           state.tr.replace(
      //             blockContainer.beforePos + blockContent.node.nodeSize + 2,
      //             blockContainer.afterPos - 2,
      //             new Slice(Fragment.from(childNodes), 0, 0),
      //           )
      //         } else {
      //           // Inserts a new blockGroup containing the child nodes created earlier.
      //           state.tr.insert(
      //             blockContainer.beforePos + blockContent.node.nodeSize + 1,
      //             state.schema.nodes['blockGroup'].create(
      //               {listType: 'Group'},
      //               childNodes,
      //             ),
      //           )
      //         }
      //       }

      //       // Replaces the blockContent node's content if necessary.
      //       if (block.content !== undefined) {
      //         let content: PMNode[] = []

      //         // Checks if the provided content is a string or InlineContent[] type.
      //         if (typeof block.content === 'string') {
      //           // Adds a single text node with no marks to the content.
      //           content.push(state.schema.text(block.content))
      //         } else {
      //           // Adds a text node with the provided styles converted into marks to the content, for each InlineContent
      //           // object.
      //           content = inlineContentToNodes(block.content, state.schema)
      //         }

      //         // Replaces the contents of the blockContent node with the previously created text node(s).
      //         state.tr.replace(
      //           blockContainer.beforePos + 2,
      //           blockContainer.beforePos + contentNode.nodeSize,
      //           new Slice(Fragment.from(content), 0, 0),
      //         )
      //       }

      //       // Changes the blockContent node type and adds the provided props as attributes. Also preserves all existing
      //       // attributes that are compatible with the new type.
      //       state.tr.setNodeMarkup(
      //         blockContainer.beforePos,
      //         block.type === undefined
      //           ? undefined
      //           : state.schema.nodes[block.type],
      //         {
      //           ...contentNode.attrs,
      //           ...block.props,
      //         },
      //       )

      //       // Adds all provided props as attributes to the parent blockContainer node too, and also preserves existing
      //       // attributes.
      //       let providedProps = {
      //         ...node.attrs,
      //         ...block.props,
      //       }
      //       state.tr.setNodeMarkup(startPos - 1, undefined, providedProps)
      //     }

      //     return true
      //   },
      // Appends the text contents of a block to the nearest previous block, given a position between them. Children of
      // the merged block are moved out of it first, rather than also being merged.
      //
      // In the example below, the position passed into the function is between Block1 and Block2.
      //
      // Block1
      //    Block2
      // Block3
      //    Block4
      //        Block5
      //
      // Becomes:
      //
      // Block1
      //    Block2Block3
      // Block4
      //     Block5
      // BNMergeBlocks:
      //   (posBetweenBlocks) =>
      //   ({state, dispatch}) => {
      //     const nextNodeIsBlock =
      //       state.doc.resolve(posBetweenBlocks + 1).node().type.name ===
      //       'blockContainer'
      //     const prevNodeIsBlock =
      //       state.doc.resolve(posBetweenBlocks - 1).node().type.name ===
      //       'blockContainer'

      //     if (!nextNodeIsBlock || !prevNodeIsBlock) {
      //       return false
      //     }

      //     const nextBlockInfo = getBlockInfoFromPos(
      //       state.doc,
      //       posBetweenBlocks + 1,
      //     )

      //     const {node, contentNode, startPos, endPos, depth} = nextBlockInfo!

      //     // Removes a level of nesting all children of the next block by 1 level, if it contains both content and block
      //     // group nodes.
      //     if (node.childCount === 2) {
      //       const childBlocksStart = state.doc.resolve(
      //         startPos + contentNode.nodeSize + 1,
      //       )
      //       const childBlocksEnd = state.doc.resolve(endPos - 1)
      //       const childBlocksRange = childBlocksStart.blockRange(childBlocksEnd)

      //       // Moves the block group node inside the block into the block group node that the current block is in.
      //       if (dispatch) {
      //         state.tr.lift(childBlocksRange!, depth - 1)
      //       }
      //     }

      //     let prevBlockEndPos = posBetweenBlocks - 1
      //     let prevBlockInfo = getBlockInfoFromPos(state.doc, prevBlockEndPos)

      //     // Finds the nearest previous block, regardless of nesting level.
      //     while (prevBlockInfo!.numChildBlocks > 0) {
      //       prevBlockEndPos--
      //       prevBlockInfo = getBlockInfoFromPos(state.doc, prevBlockEndPos)
      //       if (prevBlockInfo === undefined) {
      //         return false
      //       }
      //     }

      //     // Deletes next block and adds its text content to the nearest previous block.

      //     if (dispatch) {
      //       dispatch(
      //         state.tr
      //           .deleteRange(startPos, startPos + contentNode.nodeSize)
      //           .replace(
      //             prevBlockEndPos - 1,
      //             startPos,
      //             new Slice(contentNode.content, 0, 0),
      //           )
      //           .scrollIntoView(),
      //       )

      //       state.tr.setSelection(
      //         new TextSelection(state.doc.resolve(prevBlockEndPos - 1)),
      //       )
      //     }

      //     return true
      //   },
      // // Splits a block at a given position. Content after the position is moved to a new block below, at the same
      // // nesting level.
      // BNSplitBlock:
      //   (posInBlock, keepType) =>
      //   ({state, dispatch}) => {
      //     const blockInfo = getBlockInfoFromPos(state.doc, posInBlock)
      //     if (blockInfo === undefined) {
      //       return false
      //     }

      //     const {contentNode, contentType, startPos, endPos, depth} = blockInfo

      //     const originalBlockContent = state.doc.cut(startPos + 1, posInBlock)
      //     const newBlockContent = state.doc.cut(posInBlock, endPos - 1)

      //     const newBlock = state.schema.nodes['blockContainer'].createAndFill()!

      //     const newBlockInsertionPos = endPos + 1
      //     const newBlockContentPos = newBlockInsertionPos + 2

      //     if (dispatch) {
      //       // Creates a new block. Since the schema requires it to have a content node, a paragraph node is created
      //       // automatically, spanning newBlockContentPos to newBlockContentPos + 1.
      //       state.tr.insert(newBlockInsertionPos, newBlock)

      //       // Replaces the content of the newly created block's content node. Doesn't replace the whole content node so
      //       // its type doesn't change.
      //       state.tr.replace(
      //         newBlockContentPos,
      //         newBlockContentPos + 1,
      //         newBlockContent.content.size > 0
      //           ? new Slice(
      //               Fragment.from(newBlockContent),
      //               depth + 2,
      //               depth + 2,
      //             )
      //           : undefined,
      //       )

      //       // Changes the type of the content node. The range doesn't matter as long as both from and to positions are
      //       // within the content node.
      //       if (keepType) {
      //         state.tr.setBlockType(
      //           newBlockContentPos,
      //           newBlockContentPos,
      //           state.schema.node(contentType).type,
      //           contentNode.attrs,
      //         )
      //       }

      //       // Sets the selection to the start of the new block's content node.
      //       state.tr.setSelection(
      //         new TextSelection(state.doc.resolve(newBlockContentPos)),
      //       )

      //       // Replaces the content of the original block's content node. Doesn't replace the whole content node so its
      //       // type doesn't change.
      //       state.tr.replace(
      //         startPos + 1,
      //         endPos - 1,
      //         originalBlockContent.content.size > 0
      //           ? new Slice(
      //               Fragment.from(originalBlockContent),
      //               depth + 2,
      //               depth + 2,
      //             )
      //           : undefined,
      //       )
      //     }

      //     return true
      //   },
      // Splits a block at a given position. Content after the position is moved to a new block below, at the same
      // nesting level.
      BNSplitHeadingBlock:
        (posInBlock) =>
        ({state, dispatch}) => {
          const blockInfo = getBlockInfoFromPos(state, posInBlock)
          if (blockInfo === undefined) {
            return false
          }
          let {block, blockContent} = blockInfo
          if (block.node.childCount == 1) {
            setTimeout(() => {
              this.editor
                .chain()
                .deleteSelection()
                .command(splitBlockCommand(state.selection.from, false))
                .sinkListItem('blockContainer')
                .UpdateGroup(-1, blockInfo.block.node.attrs.listType, true)
                .run()
            })
          } else {
            const originalBlockContent = state.doc.cut(
              block.beforePos + 2,
              state.selection.from,
            )
            let newBlockContent = state.doc.cut(
              state.selection.from,
              block.beforePos + blockContent.node.nodeSize,
            )
            const newBlock =
              state.schema.nodes['blockContainer'].createAndFill()!
            const newBlockInsertionPos =
              block.beforePos + blockContent.node.nodeSize + 2
            const newBlockContentPos = newBlockInsertionPos + 2

            if (dispatch) {
              // Get the depth ?
              const depth = state.doc.resolve(posInBlock).depth

              // Creates a new block. Since the schema requires it to have a content node, a paragraph node is created
              // automatically, spanning newBlockContentPos to newBlockContentPos + 1.
              state.tr.insert(newBlockInsertionPos, newBlock)

              // // Replaces the content of the newly created block's content node. Doesn't replace the whole content node so
              // // its type doesn't change.
              state.tr.replace(
                newBlockContentPos,
                newBlockContentPos + 1,
                newBlockContent.content.size > 0
                  ? new Slice(
                      Fragment.from(newBlockContent),
                      depth + 1,
                      depth + 1,
                    )
                  : undefined,
              )

              // Sets the selection to the start of the new block's content node.
              state.tr.setSelection(
                new TextSelection(state.doc.resolve(newBlockContentPos)),
              )

              state.tr.replace(
                block.beforePos + 2,
                block.beforePos + blockContent.node.nodeSize,
                originalBlockContent.content.size > 0
                  ? new Slice(
                      Fragment.from(originalBlockContent),
                      depth + 1,
                      depth + 1,
                    )
                  : undefined,
              )
            }
          }
          return true
        },
      // Updates group's child groups.
      UpdateGroupChildren:
        (group, container, groupPos, groupLevel, listType, indent) =>
        ({state, dispatch}) => {
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
                childContainer.descendants(
                  (childGroup, pos, _parent, index) => {
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
                        newLevel =
                          numericLevel < 3 ? numericLevel.toString() : '3'
                      } else {
                        let numericLevel = $pos.depth / 2 + groupLevel
                        newLevel =
                          numericLevel < 3 ? numericLevel.toString() : '3'
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

                      if (group.attrs.listType !== listType)
                        posAddition += offset

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
                          state.doc.resolve(
                            groupPos.start() + pos + posAddition,
                          ).parent,
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
                  },
                )
              }
            })

            dispatch(tr)
            return true
          }
          return false
        },
      // Updates a block group at a given position.
      UpdateGroup:
        (posInBlock, listType, tab, isSank = false, turnInto = false) =>
        ({state, dispatch}) => {
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
          if (
            group.attrs.listType !== 'Group' &&
            listType === 'Group' &&
            container
          ) {
            setTimeout(() => {
              this.editor
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
              this.editor
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
              this.editor
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
                this.editor.commands.UpdateGroupChildren(
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
        },
    }
  },

  addProseMirrorPlugins() {
    return [
      // PreviousBlockTypePlugin(),
      SelectionPlugin,
      ClickSelectionPlugin,
      PastePlugin,
      headingLinePlugin,
    ]
  },
})
