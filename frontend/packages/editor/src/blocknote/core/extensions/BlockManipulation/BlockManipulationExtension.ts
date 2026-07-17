import {Extension} from '@tiptap/core'
import {EditorView} from '@tiptap/pm/view'
import {Node} from 'prosemirror-model'
import {NodeSelection, Plugin, PluginKey, TextSelection} from 'prosemirror-state'
import {findNextBlock, findPreviousBlock} from '../../../../block-utils'
import {mentionSuggestionPluginKey} from '../../../../mention-suggestion-plugin'
import {getBlockInfoFromPos, getBlockInfoFromSelection} from '../Blocks/helpers/getBlockInfoFromPos'
import {isInGridContainer} from '../Blocks/nodes/BlockChildren'

import {selectableNodeTypes} from '../Blocks/api/selectable-node-types'

export {selectableNodeTypes}

function isInteractiveEmbedClickTarget(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target?.closest) return false

  const interactiveEl = target.closest(
    'a[href], .link[href], button, input, textarea, select, [role="button"], [data-embed-interactive]',
  )

  return !!interactiveEl
}

function getClickedEmbed(node: Node, nodePos: number, view: EditorView): {url: string; blockId: string} | null {
  if (node.type.name === 'embed' && node.attrs.url) {
    const blockInfo = getBlockInfoFromPos(view.state, nodePos)
    return {
      url: node.attrs.url,
      blockId: blockInfo.block.node.attrs.id,
    }
  }

  if (
    node.type.name === 'blockNode' &&
    node.firstChild?.type.name === 'embed' &&
    node.firstChild.attrs.url &&
    node.attrs.id
  ) {
    return {
      url: node.firstChild.attrs.url,
      blockId: node.attrs.id,
    }
  }

  return null
}

/** Returns true when the current click should open an embed instead of selecting it. */
function shouldOpenSelectedEmbed(node: Node, nodePos: number, view: EditorView, event: MouseEvent) {
  const clickedEmbed = getClickedEmbed(node, nodePos, view)
  if (!clickedEmbed) return false

  if (event.detail > 1) return true
  if (!(view.state.selection instanceof NodeSelection)) return false

  const selectedBlock = getBlockInfoFromSelection(view.state)
  return selectedBlock.block.node.attrs.id === clickedEmbed.blockId
}

export const BlockManipulationExtension = Extension.create<{
  openUrl?: (url: string, newWindow?: boolean) => void
}>({
  name: 'BlockManupulation',

  addOptions() {
    return {
      openUrl: undefined,
    }
  },

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
    const openUrl = this.options.openUrl

    // Whether the most recent mousedown landed inside a media caption.
    let lastMousedownInCaption = false

    return [
      // Veto select caption transactions unless the user actually
      // clicked in the caption.
      new Plugin({
        key: new PluginKey('MediaCaptionSelectionGuard'),
        props: {
          handleDOMEvents: {
            mousedown(_view, event) {
              const target = event.target as Element | null
              lastMousedownInCaption = !!target?.closest?.('[data-media-container-ignore-select]')
              return false
            },
          },
        },
        filterTransaction(tr, state) {
          if (tr.docChanged || !tr.selectionSet) return true
          const prev = state.selection
          if (!(prev instanceof NodeSelection)) return true
          const next = tr.selection
          if (!(next instanceof TextSelection) || !next.empty) return true
          const insideSelectedNode = next.from > prev.from && next.from < prev.to
          if (insideSelectedNode && !lastMousedownInCaption) return false
          return true
        },
      }),
      new Plugin({
        key: new PluginKey('CursorSelectPlugin'),
        props: {
          handleDoubleClickOn: (view: EditorView, _, node: Node, nodePos: number, event: MouseEvent) => {
            if (!view.editable) return false
            if (isInteractiveEmbedClickTarget(event)) return false

            const clickedEmbed = getClickedEmbed(node, nodePos, view)
            if (!clickedEmbed || !openUrl) return false

            openUrl(clickedEmbed.url, event.metaKey || event.ctrlKey || event.shiftKey)
            return true
          },
          handleClickOn: (view: EditorView, _, node: Node, nodePos: number, event: MouseEvent) => {
            if (!view.editable) return false
            if (isInteractiveEmbedClickTarget(event)) return false
            if (
              (node.type.name === 'image' &&
                // @ts-ignore
                event.target?.nodeName === 'IMG') ||
              ['file', 'embed', 'video', 'web-embed', 'math', 'button', 'query'].includes(node.type.name)
            ) {
              const clickedEmbed = getClickedEmbed(node, nodePos, view)
              const shouldOpen = shouldOpenSelectedEmbed(node, nodePos, view, event)

              if (shouldOpen && openUrl && clickedEmbed) {
                openUrl(clickedEmbed.url, event.metaKey || event.ctrlKey || event.shiftKey)
                return true
              }

              if (isInGridContainer(view.state, nodePos)) {
                return false
              }

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
            const mentionState = mentionSuggestionPluginKey.getState(view.state)
            if (mentionState?.active) return false
            const {state} = view
            if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
              // When the current selection is a text cursor (not a whole-block
              // NodeSelection), only step out to the neighbor once the cursor is
              // on the first visual line of the block. endOfTextblock('up')
              // accounts for soft-wrapped lines and code-block '\n' lines, which
              // an explicit hardBreak scan would miss.
              if (event.key === 'ArrowUp' && !(state.selection instanceof NodeSelection)) {
                if (!view.endOfTextblock('up')) return false
              }
              const prevBlockInfo = findPreviousBlock(view, state.selection.head)
              if (prevBlockInfo) {
                const {prevBlock, prevBlockPos} = prevBlockInfo
                const prevNode = prevBlock.firstChild!
                const prevNodePos = prevBlockPos + 1
                // On the first block, findPreviousBlock's out-of-range clamp can
                // resolve back to the current block; don't re-select it.
                const currentBlockInfo = getBlockInfoFromSelection(state)
                if (prevBlockPos === currentBlockInfo.block.beforePos) return false
                if (event.shiftKey) {
                  if (event.key === 'ArrowLeft') return false

                  // If shift key, check if the previous node is media type and set selection to include it.
                  // Return false otherwise, to let tiptap handle shift selection.
                  if (selectableNodeTypes.includes(prevNode.type.name)) {
                    const selection = TextSelection.create(state.doc, state.selection.anchor, prevNodePos)
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
                    // @ts-ignore
                    state.schema.nodes['blockNode'].createAndFill()!
                  let tr = state.tr.insert(1, newBlock)
                  view.dispatch(tr)

                  tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, 1))
                  tr = tr.scrollIntoView()
                  view.dispatch(tr)
                  view.focus()
                  return true
                }
              }
              return false
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
              // When the current selection is a text cursor (not a whole-block
              // NodeSelection), only step out to the neighbor once the cursor is
              // on the last visual line of the block. endOfTextblock('down')
              // accounts for soft-wrapped lines and code-block '\n' lines, which
              // an explicit hardBreak scan would miss.
              if (event.key === 'ArrowDown' && !(state.selection instanceof NodeSelection)) {
                if (!view.endOfTextblock('down')) return false
              }
              const nextBlockInfo = findNextBlock(view, state.selection.from)
              if (nextBlockInfo) {
                const blockInfo = getBlockInfoFromSelection(state)
                // On the last block, findNextBlock's out-of-range clamp can
                // resolve back to the current block; don't re-select it and
                // swallow the keypress.
                if (nextBlockInfo.nextBlockPos === blockInfo.block.beforePos) return false
                if (event.shiftKey) {
                  if (blockInfo.block.beforePos + 1 === state.selection.from) return false
                  if (event.key === 'ArrowRight') return false
                  // If shift key, check if the next node is media type, and set the selection include it.
                  // Return false otherwise, to let tiptap handle shift selection.
                  const blockInfoAfterSelection = findNextBlock(view, state.selection.head)
                  if (blockInfoAfterSelection) {
                    const {nextBlock, nextBlockPos} = blockInfoAfterSelection
                    if (selectableNodeTypes.includes(nextBlock.firstChild!.type.name)) {
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
                      blockInfo.block.beforePos + 1 + blockInfo.blockContent.node.nodeSize &&
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
