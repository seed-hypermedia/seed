import {HMBlockChildrenType} from '@seed-hypermedia/client/hm-types'
import {InputRule, mergeAttributes, Node} from '@tiptap/core'
import {Fragment, Slice} from '@tiptap/pm/model'
import {EditorState, Plugin} from '@tiptap/pm/state'
import {EditorView} from '@tiptap/pm/view'
import {updateGroupCommand} from '../../../api/blockManipulation/commands/updateGroup'
import {mergeCSSClasses} from '../../../shared/utils'
import {BlockNoteDOMAttributes} from '../api/blockTypes'
import styles from './Block.module.css'
import {normalizeFragment} from './normalizeFragment'

/**
 * Custom drop handler for Grid containers. This handler finds
 * the nearest grid cell from the mouse coordinates and inserts the dragged
 * block at the correct position.
 */
function handleGridDrop(view: EditorView, event: DragEvent, _slice: Slice, moved: boolean): boolean {
  if (!event.dataTransfer) return false

  // Use ProseMirror's own spatial lookup to find what's under the cursor.
  const resolved = view.posAtCoords({left: event.clientX, top: event.clientY})
  if (!resolved) return false

  const $pos = view.state.doc.resolve(resolved.pos)

  // Walk up to find a blockNode whose parent is a Grid blockChildren
  let blockNodeDepth = -1
  for (let d = $pos.depth; d >= 1; d--) {
    if ($pos.node(d).type.name === 'blockNode') {
      const parent = $pos.node(d - 1)
      if (parent?.type.name === 'blockChildren' && parent.attrs.listType === 'Grid') {
        blockNodeDepth = d
        break
      }
    }
  }
  if (blockNodeDepth === -1) return false

  const cellStart = $pos.before(blockNodeDepth)

  // Use drag direction to decide if to insert before or after node
  const sourcePos = view.state.selection.from
  const insertAfter = sourcePos < cellStart
  const insertPos = insertAfter ? $pos.after(blockNodeDepth) : $pos.before(blockNodeDepth)
  const sourceSlice: Slice = moved && (view as any).dragging?.slice ? (view as any).dragging.slice : _slice

  const blockNodes: any[] = []
  sourceSlice.content.forEach((node: any) => {
    if (node.type.name === 'blockNode') {
      blockNodes.push(node)
    } else if (node.type.name === 'blockChildren') {
      node.forEach((child: any) => {
        if (child.type.name === 'blockNode') blockNodes.push(child)
      })
    }
  })

  if (blockNodes.length === 0) return false

  const tr = view.state.tr

  // Delete source block
  if (moved) {
    const {from, to} = view.state.selection
    tr.delete(from, to)
  }

  tr.insert(tr.mapping.map(insertPos), Fragment.from(blockNodes))
  view.dispatch(tr)
  view.focus()

  return true
}

export const BlockChildren = Node.create<{
  domAttributes?: BlockNoteDOMAttributes
}>({
  name: 'blockChildren',
  group: 'childContainer',
  content: 'blockNodeChild+',

  addAttributes() {
    return {
      listLevel: {
        default: '1',
        parseHTML: (element) => element.getAttribute('data-list-level'),
        renderHTML: (attributes) => {
          return {
            'data-list-level': attributes.listLevel,
          }
        },
      },
      listType: {
        default: 'Group',
        parseHTML: (element) => element.getAttribute('data-list-type'),
        renderHTML: (attributes) => {
          return {
            'data-list-type': attributes.listType,
          }
        },
      },
      columnCount: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-column-count'),
        renderHTML: (attributes) => {
          if (attributes.columnCount) {
            return {
              'data-column-count': attributes.columnCount,
            }
          }
          return {}
        },
      },
      // start: {
      //   default: '1',
      //   renderHTML: (attributes) => {
      //     if (attributes.listType === 'Ordered' && attributes.start) {
      //       return {
      //         start: attributes.start,
      //         // style: `margin-left: calc(1em + ${offset}em);`,
      //       }
      //     }
      //   },
      // },
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: new RegExp(`^>\\s$`),
        handler: ({state, chain, range}) => {
          if (isInGridContainer(state, range.from)) return
          chain()
            .command(updateGroupCommand(state.selection.from, 'Blockquote', false))
            // Removes the ">" character used to set the list.
            .deleteRange({from: range.from, to: range.to})
        },
      }),
      // Creates an unordered list when starting with "-", "+", or "*".
      new InputRule({
        find: new RegExp(`^[-+*]\\s$`),
        handler: ({state, chain, range}) => {
          if (state.doc.resolve(range.from).parent.type.name === 'heading') {
            return
          }
          if (isInGridContainer(state, range.from)) return
          chain()
            .command(updateGroupCommand(state.selection.from, 'Unordered', false))
            // Removes the "-", "+", or "*" character used to set the list.
            .deleteRange({from: range.from, to: range.to})
        },
      }),
      new InputRule({
        // find: new RegExp(/^\d+\.\s/),
        find: new RegExp(/^[1]+\.\s/),
        handler: ({state, chain, range}) => {
          if (state.doc.resolve(range.from).parent.type.name === 'heading') {
            return
          }
          if (isInGridContainer(state, range.from)) return
          chain()
            .command(
              updateGroupCommand(
                state.selection.from,
                'Ordered',
                false,
                // this.editor.state.doc.textBetween(range.from, range.to - 1),
              ),
            )
            // Removes the "1." characters used to set the list.
            .deleteRange({from: range.from, to: range.to})
        },
      }),
    ]
  },
  parseHTML() {
    return [
      {
        tag: 'ul',
        attrs: {listType: 'Unordered'},
        getAttrs: (element) => {
          if (typeof element == 'string') {
            return false
          }
          return {
            listType: 'Unordered',
          }
          // return false
        },
        priority: 200,
      },
      {
        tag: 'ol',
        attrs: {listType: 'Ordered'},
        getAttrs: (element) => {
          if (typeof element == 'string') {
            return false
          }

          return {
            listType: 'Ordered',
            // start: element.getAttribute('start'),
          }
          // return false
        },
        priority: 200,
      },
      {
        tag: 'blockquote',
        attrs: {listType: 'Blockquote'},
        getAttrs: (element) => {
          if (typeof element == 'string') {
            return false
          }
          return {
            listType: 'Blockquote',
          }
        },
        priority: 200,
      },
      {
        tag: 'div',
        attrs: {listType: 'Group'},
        getAttrs: (element) => {
          if (typeof element == 'string') {
            return false
          }

          if (
            element.getAttribute('data-node-type') === 'blockChildren' ||
            element.getAttribute('data-node-type') === 'blockGroup'
          ) {
            // Null means the element matches, but we don't want to add any attributes to the node.
            return null
          }

          return false
        },
        priority: 100,
      },
    ]
  },

  renderHTML({node, HTMLAttributes}) {
    const blockChildrenDOMAttributes = this.options.domAttributes?.blockChildren || {}

    const isGrid = node.attrs.listType === 'Grid'
    const gridStyles = isGrid
      ? {
          style: `display: grid; grid-template-columns: repeat(${node.attrs.columnCount || 3}, 1fr); gap: 8px;`,
        }
      : {}

    return [
      listNode(node.attrs.listType),
      mergeAttributes(
        {
          ...blockChildrenDOMAttributes,
          class: mergeCSSClasses(
            // @ts-ignore
            styles.blockChildren,
            blockChildrenDOMAttributes.class,
          ),
          'data-node-type': 'blockChildren',
          ...gridStyles,
        },
        HTMLAttributes,
      ),
      0,
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDrop: handleGridDrop,
          transformPasted: (slice, view) => {
            console.log('original slice', slice)
            const {state} = view
            const {selection} = state
            const isSelectionInText =
              selection.$from.parent.isTextblock &&
              selection.$from.parent.type.spec.group === 'block' &&
              selection.$from.parent.content.content.length > 0

            // Let default PM paste handling if pasting inline content in a node with text.
            // Block-level structures (blockNode/blockChildren) must go through normalization
            // because PM's default fitting silently drops nested content when blockNode
            // is not in the 'block' group.
            if (isSelectionInText) {
              let hasBlockStructure = false
              slice.content.forEach((node: any) => {
                if (node.type.name === 'blockNode' || node.type.name === 'blockChildren') {
                  hasBlockStructure = true
                }
              })
              if (!hasBlockStructure) {
                return slice
              }
            }

            // Check if all top-level nodes are blockNode (internal copy/paste).
            let allBlockNodes = slice.content.childCount > 0
            slice.content.forEach((node: any) => {
              if (node.type.name !== 'blockNode') {
                allBlockNodes = false
              }
            })

            console.log('allBlockNodes', allBlockNodes)

            if (allBlockNodes) {
              return slice
            }

            // Internal list copy: single blockChildren with listType group wrapping
            // deeper structure with high openStart. Strip outer Group wrappers
            // until inside the actual content.
            if (
              slice.content.childCount === 1 &&
              slice.content.firstChild?.type.name === 'blockChildren' &&
              slice.content.firstChild.attrs?.listType === 'Group'
            ) {
              let content = slice.content
              let openStart = slice.openStart
              let openEnd = slice.openEnd

              // Remove blockChildren->blockNode layers until we reach actual content
              while (
                content.childCount === 1 &&
                content.firstChild?.type.name === 'blockChildren' &&
                content.firstChild.attrs?.listType === 'Group' &&
                openStart >= 2
              ) {
                const group = content.firstChild
                // If the group has a single blockNode child, unwrap one level
                if (group.childCount === 1 && group.firstChild?.type.name === 'blockNode') {
                  content = group.firstChild.content
                  openStart -= 2
                  openEnd -= 2
                } else {
                  break
                }
              }

              if (content !== slice.content) {
                console.log('unwrapped internal list copy', openStart, openEnd)
                // Continue to normalizeFragment with the unwrapped content
                // so it wraps the list in a blockNode (1 level of nesting),
                // preserving the list type.
                const schema = view.state.schema
                const normalizedContent = normalizeFragment(content, schema)
                const finalSlice = new Slice(normalizedContent, 0, 0)
                console.log('final slice', finalSlice)
                return finalSlice
              }
            }

            // External paste: normalize orphan nodes into blockNode/blockChildren structure
            const schema = view.state.schema
            const normalizedContent = normalizeFragment(slice.content, schema)
            const finalSlice = new Slice(normalizedContent, 0, 0)
            console.log('final slice', finalSlice)
            return finalSlice
          },
        },
      }),
    ]
  },
})

function listNode(listType: HMBlockChildrenType) {
  if (listType == 'Unordered') {
    return 'ul'
  }
  if (listType == 'Ordered') {
    return 'ol'
  }
  if (listType == 'Blockquote') {
    return 'blockquote'
  }
  return 'div'
}

export function isInGridContainer(state: EditorState, pos: number): boolean {
  const $pos = state.doc.resolve(pos)
  for (let depth = $pos.depth; depth >= 0; depth--) {
    const node = $pos.node(depth)
    if (node.type.name === 'blockChildren' && node.attrs.listType === 'Grid') {
      return true
    }
  }
  return false
}
