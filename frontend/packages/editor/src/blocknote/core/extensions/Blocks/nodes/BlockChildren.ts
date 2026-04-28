import {HMBlockChildrenType} from '@seed-hypermedia/client/hm-types'
import {InputRule, mergeAttributes, Node} from '@tiptap/core'
import {Slice} from '@tiptap/pm/model'
import {EditorState, Plugin} from '@tiptap/pm/state'
import {updateGroupCommand} from '../../../api/blockManipulation/commands/updateGroup'
import {mergeCSSClasses} from '../../../shared/utils'
import {BlockNoteDOMAttributes} from '../api/blockTypes'
import styles from './Block.module.css'
import {normalizeFragment} from './normalizeFragment'

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
          style: `display: grid; grid-template-columns: repeat(${
            node.attrs.columnCount || 3
          }, 1fr); gap: 8px; align-items: start;`,
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
          transformPasted: (slice, view) => {
            const {selection} = view.state
            const isSelectionInText =
              selection.$from.parent.isTextblock &&
              selection.$from.parent.type.spec.group === 'block' &&
              selection.$from.parent.content.content.length > 0

            // Pasting into a non-empty textblock with an open slice.
            // ProseMirror intends the leading inline content to merge with the cursor's
            // paragraph. Run normalizeFragment to make the structure schema-valid,
            // but recompute openStart/openEnd so the first block merge is correct.
            if (isSelectionInText && slice.openStart >= 1) {
              const schema = view.state.schema
              const normalizedContent = normalizeFragment(slice.content, schema)
              // Each boundary's depth shifts by what normalize did to it
              const depthDelta = (n: any | null | undefined) =>
                n?.type.name === 'blockChildren' ? -1 : n?.type.spec?.group === 'block' ? +1 : 0
              const newOpenStart = Math.max(slice.openStart + depthDelta(slice.content.firstChild), 0)
              const newOpenEnd = Math.max(slice.openEnd + depthDelta(slice.content.lastChild), 0)
              return new Slice(normalizedContent, newOpenStart, newOpenEnd)
            }

            // Pasting plain inline content into text, merge as is.
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
            if (allBlockNodes) {
              return slice
            }

            // Internal list copy: peel off outer blockChildren(Group) and
            // blockNode wrappers until we reach the actual list contents.
            if (
              slice.content.childCount === 1 &&
              slice.content.firstChild?.type.name === 'blockChildren' &&
              slice.content.firstChild.attrs?.listType === 'Group'
            ) {
              let content = slice.content
              let openStart = slice.openStart
              while (
                content.childCount === 1 &&
                content.firstChild?.type.name === 'blockChildren' &&
                content.firstChild.attrs?.listType === 'Group' &&
                openStart >= 2
              ) {
                const group = content.firstChild
                if (group.childCount === 1 && group.firstChild?.type.name === 'blockNode') {
                  content = group.firstChild.content
                  openStart -= 2
                } else {
                  break
                }
              }
              if (content !== slice.content) {
                const schema = view.state.schema
                return new Slice(normalizeFragment(content, schema), 0, 0)
              }
            }

            // External paste: normalize into the blockNode/blockChildren shape the
            // schema expects, then close the slice so it's inserted as new blocks.
            const schema = view.state.schema
            return new Slice(normalizeFragment(slice.content, schema), 0, 0)
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
