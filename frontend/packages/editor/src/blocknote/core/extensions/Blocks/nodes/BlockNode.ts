import {mergeAttributes, Node} from '@tiptap/core'
import {Fragment, Slice} from 'prosemirror-model'
import {EditorState, Plugin, PluginKey, TextSelection} from 'prosemirror-state'
import {Decoration, DecorationSet} from 'prosemirror-view'

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
  state: {
    init(_, state) {
      return getHeadingDecorations(state)
    },
    apply(tr, decorations, oldState, newState) {
      // Only recalculate if selection or document changed
      if (
        !oldState.selection.eq(newState.selection) ||
        !oldState.doc.eq(newState.doc)
      ) {
        return getHeadingDecorations(newState)
      }
      return decorations
    },
  },
  props: {
    decorations(state) {
      return this.getState(state)
    },
  },
})

function getHeadingDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = []
  const res = getNearestHeadingFromPos(state, state.selection.from)

  if (res && res.heading?.type.name === 'heading') {
    const from = res.groupStartPos
    const to = from + res.group.nodeSize

    decorations.push(
      Decoration.node(from - 1, to - 1, {
        class: 'selection-in-section',
      }),
    )
  }

  return DecorationSet.create(state.doc, decorations)
}

function getNearestHeadingFromPos(state: EditorState, pos: number) {
  const $pos = state.doc.resolve(pos)
  const maxDepth = $pos.depth

  // Walk up the tree from current position
  for (let depth = maxDepth; depth >= 0; depth--) {
    const node = $pos.node(depth)

    // Check if current node is a blockContainer with heading as first child
    if (
      node.type.name === 'blockNode' &&
      node.firstChild?.type.name === 'heading'
    ) {
      return {
        depth,
        groupStartPos: $pos.start(depth),
        heading: node.firstChild,
        group: node,
        $pos,
      }
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
 * The main "blockNode" documents consist of
 */
export const BlockNode = Node.create<{
  domAttributes?: BlockNoteDOMAttributes
}>({
  name: 'blockNode',
  group: 'blockNodeChild block',
  // A block always contains content, and optionally a blockChildren which contains nested blocks
  content: 'block blockChildren?',
  // Ensures content-specific keyboard handlers trigger first.
  priority: 50,
  defining: true,

  parseHTML() {
    return [
      {
        tag: 'li',
        priority: 300,
        getAttrs: (element) => {
          return null
        },
      },
      {
        tag: 'div',
        getAttrs: (element) => {
          if (typeof element === 'string') return false

          const attrs: Record<string, string> = {}
          for (const [nodeAttr, HTMLAttr] of Object.entries(BlockAttributes)) {
            if (element.getAttribute(HTMLAttr)) {
              attrs[nodeAttr] = element.getAttribute(HTMLAttr)!
            }
          }

          return element.getAttribute('data-node-type') === 'blockNode' ||
            element.getAttribute('data-node-type') === 'blockContainer'
            ? attrs
            : false
        },
        priority: 200,
      },
    ]
  },

  renderHTML({HTMLAttributes}) {
    const domAttributes = this.options.domAttributes?.blockNode || {}

    return [
      'div',
      mergeAttributes(
        {
          ...domAttributes,
          // @ts-ignore
          class: mergeCSSClasses(styles.blockNode, domAttributes.class),
          'data-node-type': this.name,
        },
        HTMLAttributes,
      ),
      0,
    ]
  },

  addCommands() {
    return {
      // Creates a new text block at a given position.
      BNCreateBlock:
        (pos) =>
        ({state, dispatch}) => {
          // @ts-ignore
          const newBlock = state.schema.nodes['blockNode'].createAndFill()!

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
                .sinkListItem('blockNode')
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
              // @ts-ignore
              state.schema.nodes['blockNode'].createAndFill()!
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

  addNodeView() {
    const domAttributes = this.options.domAttributes?.blockNode || {}
    return ({node, HTMLAttributes, getPos, editor, decorations}) => {
      // Determine if this blockNode is inside a list by checking the PM doc structure
      let tag: 'li' | 'div' = 'div'
      if (typeof getPos === 'function') {
        const pos = getPos()
        if (pos != null) {
          const $pos = editor.state.doc.resolve(pos)
          // Parent is the blockChildren node
          if ($pos.parent.type.name === 'blockChildren') {
            const listType = $pos.parent.attrs.listType
            if (listType === 'Ordered' || listType === 'Unordered') {
              tag = 'li'
            }
          }
        }
      }

      const baseAttrs = mergeAttributes(
        {
          ...domAttributes,
          // @ts-ignore
          class: mergeCSSClasses(styles.blockNode, domAttributes.class),
          'data-node-type': this.name,
        },
        HTMLAttributes,
      )

      const dom = document.createElement(tag)
      for (const [key, value] of Object.entries(baseAttrs)) {
        if (typeof value === 'string') {
          dom.setAttribute(key, value)
        }
      }

      // Apply node decoration attributes (e.g. selection-in-section class)
      const applyDecorations = (decos: readonly Decoration[]) => {
        for (const deco of decos) {
          const spec = (deco as any).type?.attrs
          if (spec) {
            if (spec.class) {
              dom.classList.add(...spec.class.split(' '))
            }
            for (const [k, v] of Object.entries(spec)) {
              if (k !== 'class' && typeof v === 'string') {
                dom.setAttribute(k, v)
              }
            }
          }
        }
      }

      const removeDecorations = (decos: readonly Decoration[]) => {
        for (const deco of decos) {
          const spec = (deco as any).type?.attrs
          if (spec?.class) {
            dom.classList.remove(...spec.class.split(' '))
          }
        }
      }

      applyDecorations(decorations)

      let currentDecorations: readonly Decoration[] = decorations

      return {
        dom,
        contentDOM: dom,
        update: (updatedNode, updatedDecorations) => {
          if (updatedNode.type.name !== 'blockNode') return false

          // Check if the tag needs to change based on current parent
          const parent = dom.parentElement
          if (parent) {
            const parentTag = parent.tagName.toLowerCase()
            const needsLi = parentTag === 'ol' || parentTag === 'ul'
            const isLi = dom.tagName.toLowerCase() === 'li'
            if (needsLi !== isLi) {
              return false // Force re-creation with correct tag
            }
          }

          // Update node attributes
          for (const [key, value] of Object.entries(updatedNode.attrs)) {
            if (typeof value === 'string') {
              dom.setAttribute(
                BlockAttributes[key as keyof typeof BlockAttributes] || key,
                value,
              )
            }
          }

          // Update decorations
          removeDecorations(currentDecorations)
          applyDecorations(updatedDecorations)
          currentDecorations = updatedDecorations

          return true
        },
      }
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
