import {HMBlockChildrenType} from '@shm/shared'
import {InputRule, mergeAttributes, Node} from '@tiptap/core'
import {Slice} from '@tiptap/pm/model'
import {Plugin} from '@tiptap/pm/state'
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
            console.log('original slice', slice)
            const {state} = view
            const {selection} = state
            const isSelectionInText =
              selection.$from.parent.isTextblock &&
              selection.$from.parent.type.spec.group === 'block' &&
              selection.$from.parent.content.content.length > 0

            // Let default PM paste handling if pasting in a node with text content
            if (isSelectionInText) {
              return slice
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
