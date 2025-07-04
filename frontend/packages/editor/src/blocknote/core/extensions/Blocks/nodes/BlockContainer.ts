import {mergeAttributes, Node} from '@tiptap/core'
import {Fragment, Slice} from 'prosemirror-model'
import {EditorState, Plugin, PluginKey, TextSelection} from 'prosemirror-state'
import {Decoration, DecorationSet} from 'prosemirror-view'

import {EditorView} from '@tiptap/pm/view'
import {splitBlockCommand} from '../../../api/blockManipulation/commands/splitBlock'
import {updateGroupCommand} from '../../../api/blockManipulation/commands/updateGroup'
import {mergeCSSClasses} from '../../../shared/utils'
import {BlockNoteDOMAttributes} from '../api/blockTypes'
import {getBlockInfoFromPos} from '../helpers/getBlockInfoFromPos'
import styles from './Block.module.css'
import BlockAttributes from './BlockAttributes'

export const SelectionPluginKey = new PluginKey('selectionPluginKey')
const ClickSelectionPluginKey = new PluginKey('clickSelectionPluginKey')
const PastePluginKey = new PluginKey('pastePluginKey')
const headingBoxPluginKey = new PluginKey('headingBoxPluginKey')

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

// Set selection to content between current selection and shift + left mouse click location.
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

      if ($from.parent.type.name === 'image') {
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

const headingBoxPlugin = new Plugin({
  key: headingBoxPluginKey,
  view(editorView) {
    return new HeadingBoxPlugin(editorView)
  },
})

class HeadingBoxPlugin {
  private box: HTMLElement
  constructor(view: EditorView) {
    this.box = document.createElement('div')
    this.box.style.transition = 'all 0.15s ease-in-out'
    this.box.style.pointerEvents = 'none'
    this.box.style.display = ''
    this.box.style.opacity = '0'
    // view.dom.parentNode?.appendChild(this.box)

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

      console.log(`== ~ update ~ node:`, node)
      let rect = (node as HTMLElement).getBoundingClientRect()

      console.log(`== ~ update ~ rect:`, rect)

      let editorRect = view.dom.getBoundingClientRect()
      let groupPadding = 10
      let editorPaddingTop = 32
      this.box.style.position = 'absolute'
      this.box.classList.add('rounded-md')
      // this.box.style.padding = '16px'
      this.box.style.top = `${rect.top + editorPaddingTop - editorRect.top}px`
      console.log('rect.left', rect, node)
      this.box.style.left = `${rect.left - groupPadding}px`
      this.box.style.width = `${rect.width}px`
      this.box.style.height = `${rect.height}px`
      this.box.style.backgroundColor = 'var(--color-primary)'
      this.box.style.opacity = '0.05'
    } else {
      this.box.style.opacity = '0'
      return
    }
  }

  destroy() {
    this.box.remove()
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

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    block: {
      BNCreateBlock: (pos: number) => ReturnType
      BNDeleteBlock: (posInBlock: number) => ReturnType
      BNSplitHeadingBlock: (posInBlock: number) => ReturnType
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
        class: `${styles.blockOuter}`,
        'data-node-type': 'block-outer',
      }),
      [
        'div',
        mergeAttributes(
          {
            ...domAttributes,
            class: mergeCSSClasses(styles.block, domAttributes.class, 'p-2'),
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
                .command(
                  updateGroupCommand(
                    -1,
                    blockInfo.block.node.attrs.listType,
                    true,
                  ),
                )
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
              const depth = state.doc.resolve(posInBlock).depth

              // Create a new block. Since the schema requires it to have a content node, a paragraph node is created
              // automatically, spanning newBlockContentPos to newBlockContentPos + 1.
              state.tr.insert(newBlockInsertionPos, newBlock)

              // Replace the content of the newly created block's content node. Doesn't replace the whole content node so
              // its type doesn't change.
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

              // Set the selection to the start of the new block's content node.
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
    }
  },

  addProseMirrorPlugins() {
    return [
      // PreviousBlockTypePlugin(),
      SelectionPlugin,
      ClickSelectionPlugin,
      PastePlugin,
      headingBoxPlugin,
      // Replace two short hyphen with a long dash
      new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            if (text === '-') {
              const {state} = view
              // Check if the previous character is also a hyphen
              const previousChar = state.doc.textBetween(from - 1, from, null)
              if (previousChar === '-') {
                // Replace the two hyphens with a long dash
                const tr = state.tr.replaceRangeWith(
                  from - 1,
                  to,
                  state.schema.text('—'),
                )
                view.dispatch(tr)
                return true
              }
            }

            return false
          },
        },
      }),
    ]
  },
})
