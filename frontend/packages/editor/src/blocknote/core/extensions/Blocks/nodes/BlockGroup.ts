import {HMBlockChildrenType} from '@shm/shared'
import {InputRule, mergeAttributes, Node} from '@tiptap/core'
import {Fragment, Slice} from '@tiptap/pm/model'
import {Plugin} from '@tiptap/pm/state'
import {updateGroupCommand} from '../../../api/blockManipulation/commands/updateGroup'
import {mergeCSSClasses} from '../../../shared/utils'
import {BlockNoteDOMAttributes} from '../api/blockTypes'
import styles from './Block.module.css'

export const BlockGroup = Node.create<{
  domAttributes?: BlockNoteDOMAttributes
}>({
  name: 'blockGroup',
  group: 'childContainer',
  content: 'blockGroupChild+',

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
            .command(
              updateGroupCommand(state.selection.from, 'Blockquote', false),
            )
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
            .command(
              updateGroupCommand(state.selection.from, 'Unordered', false),
            )
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

          if (element.getAttribute('data-node-type') === 'blockGroup') {
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
    const blockGroupDOMAttributes = this.options.domAttributes?.blockGroup || {}

    return [
      listNode(node.attrs.listType),
      mergeAttributes(
        {
          ...blockGroupDOMAttributes,
          class: mergeCSSClasses(
            // @ts-ignore
            styles.blockGroup,
            blockGroupDOMAttributes.class,
          ),
          'data-node-type': 'blockGroup',
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
            const schema = view.state.schema

            // Check if the slice already has valid structure
            // A valid internal slice will have blockGroup or blockContainer as top-level nodes
            let needsTransformation = false
            slice.content.forEach((node: any) => {
              if (node.type.name === 'blockGroup') {
                // Check if this blockGroup is from our editor
                if (node.content && node.content.childCount > 0) {
                  const firstChild = node.firstChild
                  // If blockGroup contains blockContainers, it's from our editor
                  if (
                    !(firstChild && firstChild.type.name === 'blockContainer')
                  ) {
                    needsTransformation = true
                  }
                }
              } else if (node.type.name !== 'blockContainer') {
                // Top-level nodes that aren't blockContainer or blockGroup need wrapping
                needsTransformation = true
              }
            })

            if (
              !needsTransformation &&
              (slice.openStart > 0 || slice.openEnd > 0)
            ) {
              return slice
            }

            // Transform pasted content to ensure all nodes are properly wrapped
            const transformFragment = (fragment: any, schema: any): any => {
              const nodes: any[] = []

              fragment.forEach((node: any, index: number) => {
                if (node.type.name === 'blockGroup') {
                  const prevNode = nodes[nodes.length - 1]

                  if (prevNode && prevNode.type.name === 'blockContainer') {
                    // Merge blockGroup into previous blockContainer as 2nd child
                    const mergedContainer = schema.nodes[
                      'blockContainer'
                    ]!.create(prevNode.attrs, [prevNode.firstChild, node])
                    nodes[nodes.length - 1] = mergedContainer
                  } else {
                    // First node is blockGroup or no previous blockContainer
                    // Mark with special attribute so handlePaste can detect it
                    const dummyParagraph = schema.nodes['paragraph']!.create()
                    const blockContainer = schema.nodes[
                      'blockContainer'
                    ]!.create({__isListPaste: true}, [dummyParagraph, node])
                    nodes.push(blockContainer)
                  }
                } else if (node.type.name === 'blockContainer') {
                  nodes.push(node)
                } else {
                  // Wrap content nodes in blockContainer
                  const blockContainer = schema.nodes['blockContainer']!.create(
                    null,
                    node,
                  )
                  nodes.push(blockContainer)
                }
              })

              return Fragment.from(nodes)
            }

            const transformedContent = transformFragment(slice.content, schema)

            // Adjust openStart and openEnd for the transformed structure
            // When we wrap nodes in new containers, we create closed boundaries
            let newOpenStart = slice.openStart
            let newOpenEnd = slice.openEnd

            // Check if the first node in original slice was a blockGroup that we wrapped in blockContainer
            if (
              slice.content.firstChild?.type.name === 'blockGroup' &&
              transformedContent.firstChild?.type.name === 'blockContainer' &&
              transformedContent.firstChild?.attrs?.__isListPaste
            ) {
              newOpenStart = 0
            }

            if (
              slice.content.lastChild?.type.name === 'blockGroup' &&
              transformedContent.lastChild?.type.name === 'blockContainer' &&
              transformedContent.lastChild?.attrs?.__isListPaste
            ) {
              newOpenEnd = 0
            }

            return new Slice(transformedContent, newOpenStart, newOpenEnd)
          },

          handlePaste: (view, event, slice) => {
            // Check if first node is a blockContainer with dummy paragraph
            const firstNode = slice.content.firstChild

            if (
              firstNode &&
              firstNode.type.name === 'blockContainer' &&
              firstNode.attrs.__isListPaste &&
              firstNode.content.childCount === 2 &&
              firstNode.firstChild?.type.name === 'paragraph' &&
              firstNode.firstChild?.content.size === 0 &&
              firstNode.lastChild?.type.name === 'blockGroup'
            ) {
              const {state} = view
              const {selection} = state
              const {$from} = selection

              // Get the previous blockContainer
              const currentDepth = $from.depth
              let blockContainerDepth = -1

              for (let d = currentDepth; d > 0; d--) {
                if ($from.node(d).type.name === 'blockContainer') {
                  blockContainerDepth = d
                  break
                }
              }

              if (blockContainerDepth > 0) {
                const blockContainer = $from.node(blockContainerDepth)
                const blockContainerPos = $from.start(blockContainerDepth) - 1
                const blockGroup = firstNode.lastChild!

                // Ensure blockContainer has content
                if (!blockContainer.firstChild) {
                  return false
                }

                // Create new blockContainer with current content + pasted blockGroup
                const newBlockContainer = state.schema.nodes[
                  'blockContainer'
                ]!.create(blockContainer.attrs, [
                  blockContainer.firstChild,
                  blockGroup,
                ])

                // Create transaction to replace current block with merged version
                let tr = state.tr
                tr.replaceRangeWith(
                  blockContainerPos,
                  blockContainerPos + blockContainer.nodeSize,
                  newBlockContainer,
                )

                // Insert remaining pasted content (if any)
                if (slice.content.childCount > 1) {
                  const remainingContent = slice.content.cut(firstNode.nodeSize)
                  tr.insert(
                    blockContainerPos + newBlockContainer.nodeSize,
                    remainingContent,
                  )
                }

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
