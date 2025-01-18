import {Extension} from '@tiptap/core'
import {EditorView} from '@tiptap/pm/view'
import {Node} from 'prosemirror-model'
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from 'prosemirror-state'
import {findNextBlock, findPreviousBlock} from '../../../../block-utils'
import {getBlockInfoFromSelection} from '../Blocks/helpers/getBlockInfoFromPos'

export const selectableNodeTypes = [
  'image',
  'file',
  'embed',
  'video',
  'web-embed',
  'math',
  'button',
  'query',
]

export const BlockManipulationExtension = Extension.create({
  name: 'BlockManupulation',

  addKeyboardShortcuts() {
    return {
      // 'Shift-Enter': () => {
      //   const {view, state} = this.editor
      //   const {selection} = state
      //   if (selection instanceof NodeSelection) {
      //     const prevBlockInfo = findPreviousBlock(view, selection.from)
      //     if (prevBlockInfo) {
      //       const $pos = state.doc.resolve(prevBlockInfo.prevBlockPos)
      //       this.editor
      //         .chain()
      //         .BNCreateBlock($pos.end() + 1)
      //         .setTextSelection($pos.end() + 3)
      //         .run()
      //       return true
      //     }
      //   }
      //   return false
      // },
      Enter: () => {
        const {state} = this.editor
        const {selection} = state
        if (selection instanceof NodeSelection) {
          const $pos = state.doc.resolve(selection.from + 1)
          this.editor
            .chain()
            .BNCreateBlock($pos.end() + 2)
            .setTextSelection($pos.end() + 3)
            .run()
          return true
        }
        return false
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('CursorSelectPlugin'),
        props: {
          handleClickOn: (
            view: EditorView,
            _,
            node: Node,
            nodePos: number,
            event: MouseEvent,
          ) => {
            if (!view.editable) return false
            if (
              (node.type.name === 'image' &&
                // @ts-ignore
                event.target?.nodeName === 'IMG') ||
              [
                'file',
                'embed',
                'video',
                'web-embed',
                'math',
                'button',
                'query',
              ].includes(node.type.name)
            ) {
              let tr = view.state.tr
              const selection = NodeSelection.create(view.state.doc, nodePos)
              tr = tr.setSelection(selection)
              view.dispatch(tr)
              view.focus()
              return true
            }
            return false
          },
        },
      }),
      new Plugin({
        key: new PluginKey('KeyboardShortcutsSelectPlugin'),
        props: {
          handleKeyDown(view, event) {
            const {state} = view
            // if (event.key === 'Delete') {
            //   const {doc, selection, tr} = state
            //   if (selection.empty) {
            //     const $pos = selection.$anchor
            //     const isEnd = $pos.pos === $pos.end()
            //     if (isEnd) {
            //       const blockInfo = getBlockInfoFromPos(state, $pos.pos)
            //       if (blockInfo.blockContent.node.textContent.length === 0) {
            //         console.log('here????')
            //         tr.deleteRange($pos.start() - 1, $pos.end() + 1)
            //         view.dispatch(tr)
            //         return true
            //       }
            //       let $nextPos: ResolvedPos | undefined
            //       let nextNode
            //       if (blockInfo.childContainer?.node.childCount) {
            //         $nextPos = doc.resolve($pos.after() + 3)
            //         nextNode = $nextPos.parent
            //       } else {
            //         doc.descendants((testNode, testPos) => {
            //           if (
            //             testNode.type.name === 'blockContainer' &&
            //             testPos > $pos.pos
            //           )
            //             if (!$nextPos || $nextPos.pos < $pos.pos) {
            //               $nextPos = doc.firstChild!.resolve(testPos)
            //               nextNode = testNode.firstChild
            //             }
            //         })
            //       }
            //       if ($nextPos && nextNode) {
            //         if (selectableNodeTypes.includes(nextNode.type.name)) {
            //           return false
            //         }
            //         const mergedTextContent =
            //           blockInfo.blockContent.node.textContent +
            //           nextNode.textContent
            //         const newNode = view.state.schema.node(
            //           blockInfo.blockContentType,
            //           blockInfo.blockContent.node.attrs,
            //           view.state.schema.text(
            //             mergedTextContent,
            //             blockInfo.blockContent.node.lastChild?.marks,
            //           ),
            //           blockInfo.blockContent.node.marks,
            //         )
            //         tr.deleteRange(
            //           $nextPos.start() - 1,
            //           $nextPos.end() < $nextPos.start() + nextNode.nodeSize
            //             ? $nextPos.end() + 1
            //             : $nextPos.start() + nextNode.nodeSize + 1,
            //         )
            //         tr.replaceWith($pos.start() - 1, $pos.end() + 1, newNode)
            //         view.dispatch(tr)
            //         return true
            //       }
            //       return false
            //     }
            //   }
            // } else
            if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
              let hasHardBreak = false
              const blockInfo = getBlockInfoFromSelection(state)
              // Find if the selected node has break line and check if the selection's from position is before or after the hard break
              blockInfo.blockContent.node.content.descendants((node, pos) => {
                if (node.type.name === 'hardBreak') {
                  if (
                    blockInfo.block.beforePos + pos + 2 <
                    state.selection.from
                  ) {
                    hasHardBreak = true
                    return
                  }
                }
              })
              // Stop execution and let other handlers be called if the selection if after the hard break
              if (hasHardBreak) return false
              const prevBlockInfo = findPreviousBlock(
                view,
                state.selection.from,
              )
              if (prevBlockInfo) {
                const {prevBlock, prevBlockPos} = prevBlockInfo
                const prevNode = prevBlock.firstChild!
                const prevNodePos = prevBlockPos + 1
                if (event.shiftKey) {
                  const blockInfoAtSelectionStart =
                    getBlockInfoFromSelection(state)
                  if (event.key === 'ArrowLeft') {
                    if (
                      (state.selection.from - 1 !==
                        blockInfoAtSelectionStart.block.beforePos + 1 &&
                        !selectableNodeTypes.includes(
                          blockInfoAtSelectionStart.blockContentType,
                        )) ||
                      !selectableNodeTypes.includes(
                        prevBlock.firstChild!.type.name,
                      )
                    )
                      return false
                  }

                  const selection = TextSelection.create(
                    state.doc,
                    state.selection.to,
                    prevNodePos,
                  )
                  let tr = state.tr.setSelection(selection)
                  tr = tr.scrollIntoView()
                  view.dispatch(tr)
                  return true
                }
                if (event.key === 'ArrowLeft') {
                  const blockInfo = getBlockInfoFromSelection(state)

                  if (
                    state.selection.$anchor.parentOffset !== 0 &&
                    !selectableNodeTypes.includes(blockInfo.blockContentType)
                  ) {
                    return false
                  }
                }
                if (selectableNodeTypes.includes(prevNode.type.name)) {
                  const selection = NodeSelection.create(state.doc, prevNodePos)
                  let tr = state.tr.setSelection(selection)
                  tr = tr.scrollIntoView()
                  view.dispatch(tr)
                  return true
                }
              } else {
                if (event.shiftKey) return false
                const blockInfo = getBlockInfoFromSelection(state)

                if (selectableNodeTypes.includes(blockInfo.blockContentType)) {
                  const newBlock =
                    state.schema.nodes['blockContainer'].createAndFill()!
                  let tr = state.tr.insert(1, newBlock)
                  view.dispatch(tr)

                  tr = view.state.tr.setSelection(
                    TextSelection.create(view.state.doc, 1),
                  )
                  tr = tr.scrollIntoView()
                  view.dispatch(tr)
                  return true
                }
              }
              return false
            } else if (
              event.key === 'ArrowDown' ||
              event.key === 'ArrowRight'
            ) {
              let lastHardBreakPos: number | null = null
              const blockInfo = getBlockInfoFromSelection(state)
              // Find the position of last hard break in node content, if any
              blockInfo.blockContent.node.content.descendants((node, pos) => {
                if (node.type.name === 'hardBreak') {
                  lastHardBreakPos = blockInfo.block.beforePos + pos + 2
                }
              })
              // Stop execution and let other handlers be called if selection's to position is before the last hard break pos
              if (lastHardBreakPos && state.selection.to <= lastHardBreakPos)
                return false
              const nextBlockInfo = findNextBlock(view, state.selection.from)
              if (nextBlockInfo) {
                const blockInfo = getBlockInfoFromSelection(state)
                if (event.shiftKey) {
                  const blockInfoAfterSelection = findNextBlock(
                    view,
                    state.selection.to,
                  )
                  if (event.key === 'ArrowRight') {
                    const lastBlockInSelection =
                      getBlockInfoFromSelection(state)
                    if (
                      state.selection.to + 1 !==
                        lastBlockInSelection.block.beforePos +
                          1 +
                          lastBlockInSelection.blockContent.node.nodeSize &&
                      !selectableNodeTypes.includes(
                        lastBlockInSelection.blockContentType,
                      )
                    ) {
                      return false
                    }
                  }
                  if (blockInfoAfterSelection) {
                    const {nextBlock, nextBlockPos} = blockInfoAfterSelection
                    if (
                      selectableNodeTypes.includes(
                        nextBlock.firstChild!.type.name,
                      )
                    ) {
                      const selection = TextSelection.create(
                        state.doc,
                        state.selection.anchor,
                        nextBlockPos + 2,
                      )
                      let tr = state.tr.setSelection(selection)
                      tr = tr.scrollIntoView()
                      view.dispatch(tr)
                      return true
                    } else return false
                  }
                  return false
                }
                const {nextBlock, nextBlockPos} = nextBlockInfo
                const nextNode = nextBlock.firstChild!
                const nextNodePos = nextBlockPos + 1
                if (event.key === 'ArrowRight') {
                  if (
                    state.selection.$anchor.pos + 1 !==
                      blockInfo.block.beforePos +
                        1 +
                        blockInfo.blockContent.node.nodeSize &&
                    !selectableNodeTypes.includes(blockInfo.blockContentType)
                  ) {
                    return false
                  }
                }
                if (selectableNodeTypes.includes(nextNode.type.name)) {
                  const selection = NodeSelection.create(state.doc, nextNodePos)
                  let tr = state.tr.setSelection(selection)
                  tr = tr.scrollIntoView()
                  view.dispatch(tr)
                  return true
                }
              }
            }
            return false
          },
        },
      }),
    ]
  },
})
