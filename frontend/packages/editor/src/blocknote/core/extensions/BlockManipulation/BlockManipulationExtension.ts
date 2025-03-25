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
                state.selection.head,
              )
              if (prevBlockInfo) {
                const {prevBlock, prevBlockPos} = prevBlockInfo
                const prevNode = prevBlock.firstChild!
                const prevNodePos = prevBlockPos + 1
                if (event.shiftKey) {
                  if (event.key === 'ArrowLeft') return false

                  // If shift key, check if the previous node is media type and set selection to include it.
                  // Return false otherwise, to let tiptap handle shift selection.
                  if (selectableNodeTypes.includes(prevNode.type.name)) {
                    const selection = TextSelection.create(
                      state.doc,
                      state.selection.anchor,
                      prevNodePos,
                    )
                    let tr = state.tr.setSelection(selection)
                    tr = tr.scrollIntoView()
                    view.dispatch(tr)
                    view.focus()
                    return true
                  }

                  return false
                }
                if (event.key === 'ArrowLeft') {
                  // Return false if triggered by arrow left and the selection is not at block start,
                  // to let tiptap set the selection to the previous character.
                  const blockInfo = getBlockInfoFromSelection(state)

                  if (
                    state.selection.$anchor.parentOffset !== 0 &&
                    !selectableNodeTypes.includes(blockInfo.blockContentType)
                  ) {
                    return false
                  }
                }
                // If previous block is media type, set node selection to it.
                if (selectableNodeTypes.includes(prevNode.type.name)) {
                  const selection = NodeSelection.create(state.doc, prevNodePos)
                  let tr = state.tr.setSelection(selection)
                  tr = tr.scrollIntoView()
                  view.dispatch(tr)
                  view.focus()
                  return true
                }
              } else {
                // If media block is the first block in the document, create an empty block
                // before it, and set the selection to the newly created block.
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
                  view.focus()
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
                  if (blockInfo.block.beforePos + 1 === state.selection.from)
                    return false
                  if (event.key === 'ArrowRight') return false
                  // If shift key, check if the next node is media type, and set the selection include it.
                  // Return false otherwise, to let tiptap handle shift selection.
                  const blockInfoAfterSelection = findNextBlock(
                    view,
                    state.selection.head,
                  )
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
                        state.doc.resolve(nextBlockPos + 2).end() + 1,
                      )
                      let tr = state.tr.setSelection(selection)
                      tr = tr.scrollIntoView()
                      view.dispatch(tr)
                      view.focus()
                      return true
                    }
                  }
                  return false
                }
                const {nextBlock, nextBlockPos} = nextBlockInfo
                const nextNode = nextBlock.firstChild!
                const nextNodePos = nextBlockPos + 1
                if (event.key === 'ArrowRight') {
                  // Return false if triggered by arrow right and the selection is not at the end of the block,
                  // to let tiptap set the selection to the next character.
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
                // If the next block is media type, set node selection to it.
                if (selectableNodeTypes.includes(nextNode.type.name)) {
                  const selection = NodeSelection.create(state.doc, nextNodePos)
                  let tr = state.tr.setSelection(selection)
                  tr = tr.scrollIntoView()
                  view.dispatch(tr)
                  view.focus()
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
