import {HMBlockChildrenType} from '@shm/shared'
import {InputRule, mergeAttributes, Node} from '@tiptap/core'
import {Fragment, Slice} from '@tiptap/pm/model'
import {Plugin} from '@tiptap/pm/state'
import {updateGroupCommand} from '../../../api/blockManipulation/commands/updateGroup'
import {mergeCSSClasses} from '../../../shared/utils'
import {BlockNoteDOMAttributes} from '../api/blockTypes'
import styles from './Block.module.css'

/**
 * Wraps a block node in a blockNode.
 */
function wrapBlockContentInContainer(blockContentNode: any, schema: any): any {
  return schema.nodes['blockNode']!.create(null, blockContentNode)
}

/**
 * Wraps a blockChildren node in a blockNode with an empty paragraph.
 * If a previous blockNode exists and doesn't have a child blockChildren,
 * merges the blockChildren into it instead of creating a new container.
 */
function wrapBlockGroupInContainer(
  blockGroupNode: any,
  schema: any,
  previousNode: any,
): any {
  if (
    previousNode &&
    previousNode.type.name === 'blockNode' &&
    previousNode.childCount === 1 &&
    previousNode.firstChild?.type.spec?.group === 'block'
  ) {
    return schema.nodes['blockNode']!.create(previousNode.attrs, [
      previousNode.firstChild,
      blockGroupNode,
    ])
  }

  const placeholderParagraph = schema.nodes['paragraph']!.create()
  return schema.nodes['blockNode']!.create(null, [
    placeholderParagraph,
    blockGroupNode,
  ])
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
    const blockChildrenDOMAttributes =
      this.options.domAttributes?.blockChildren || {}

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

            const schema = view.state.schema
            let normalizedContent = normalizeFragment(slice.content, schema)

            // If all wrapper nodes are properly structured, close the slice boundaries to indicate it's a complete slice.
            let allTopLevelNodesAreStructured = true
            normalizedContent.forEach((node: any) => {
              if (
                node.type.name !== 'blockNode' &&
                node.type.name !== 'blockChildren'
              ) {
                allTopLevelNodesAreStructured = false
              }
            })

            const openStart =
              allTopLevelNodesAreStructured && normalizedContent.childCount > 0
                ? 0
                : slice.openStart
            const openEnd =
              allTopLevelNodesAreStructured && normalizedContent.childCount > 0
                ? 0
                : slice.openEnd

            const finalSlice = new Slice(normalizedContent, openStart, openEnd)

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

/**
 * This function fixes the blockNode in case it has multiple block node children after paste.
 * This is invalid structure
 */
function splitBlockContainerNode(node: any) {
  const blockContents: any[] = []
  let blockGroup: any = null

  // Traverse blockNode's children and retrieve all block nodes and the last blockChildren node
  node.forEach((child: any) => {
    if (child.type.spec.group === 'block') {
      blockContents.push(child)
    } else if (child.type.name === 'blockChildren') {
      blockGroup = child
    }
  })

  // If there is only one block node, return the blockNode
  if (blockContents.length <= 1) {
    return [node]
  }

  // If there are multiple block nodes, split the blockNode into multiple blockNodes and return them
  const containers: any[] = []
  blockContents.forEach((blockContent, index) => {
    const children = [blockContent]
    if (index === blockContents.length - 1 && blockGroup) {
      children.push(blockGroup)
    }

    const attrs = {...node.attrs}
    if (attrs.id) {
      attrs.id = undefined
    }

    containers.push(node.type.create(attrs, children))
  })

  return containers
}

function normalizeFragment(fragment: Fragment, schema?: any): Fragment {
  const nodes: any[] = []

  fragment.forEach((node: any) => {
    if (node.type.name === 'blockNode') {
      const containers = splitBlockContainerNode(node)
      containers.forEach((container: any) => {
        nodes.push(normalizeBlockContainer(container, schema))
      })
      return
    }

    if (node.type.name === 'blockChildren') {
      let groupNode = node
      let groupContent = normalizeFragment(node.content, schema)

      // Unwrap when the group has a blockNode child with a single blockChildren child
      // This is invalid structure and happens when copy pasting a nested blockChildren without a parent.
      if (groupContent.childCount === 1) {
        const firstChild = groupContent.firstChild

        if (
          firstChild &&
          firstChild.type?.name === 'blockNode' &&
          firstChild.firstChild &&
          firstChild.firstChild.type?.name === 'paragraph' &&
          firstChild.firstChild.content.content.length == 0 &&
          firstChild.lastChild &&
          firstChild.lastChild.type?.name === 'blockChildren'
        ) {
          const innerGroup = firstChild.lastChild

          // Make the inner group the root group
          groupNode = innerGroup
          groupContent = normalizeFragment(innerGroup.content, schema)
        }
      }

      if (groupNode.attrs?.listType === 'Group') {
        let hasNestedLists = false
        groupContent.forEach((child: any) => {
          if (
            child.type?.name === 'blockNode' &&
            child.lastChild?.type?.name === 'blockChildren'
          ) {
            hasNestedLists = true
          }
        })

        if (!hasNestedLists) {
          groupContent.forEach((childNode: any) => {
            nodes.push(childNode)
          })
          return
        }
      }

      const normalizedGroup = groupNode.type.create(
        groupNode.attrs,
        groupContent,
      )

      if (schema) {
        const prevNode = nodes[nodes.length - 1]
        const wrappedContainer = wrapBlockGroupInContainer(
          normalizedGroup,
          schema,
          prevNode,
        )
        if (prevNode && wrappedContainer !== normalizedGroup) {
          nodes[nodes.length - 1] = wrappedContainer
        } else {
          nodes.push(wrappedContainer)
        }
      } else {
        nodes.push(normalizedGroup)
      }
      return
    }

    // Wrap block nodes in blockNodes
    if (node.type.spec?.group === 'block') {
      if (!schema) {
        nodes.push(node)
        return
      }
      nodes.push(wrapBlockContentInContainer(node, schema))
      return
    }

    if (node.content && node.content.size > 0) {
      nodes.push(node.copy(normalizeFragment(node.content, schema)))
      return
    }

    nodes.push(node)
  })

  return Fragment.from(nodes)
}

function normalizeBlockContainer(node: any, schema?: any) {
  const children: any[] = []

  // Traverse blockNode's children
  node.forEach((child: any, index: number) => {
    // If the child is a blockChildren, normalize it and add it to the children array
    if (child.type?.name === 'blockChildren') {
      children.push(
        child.type.create(
          child.attrs,
          normalizeFragment(child.content, schema),
        ),
      )
    } else if (child.content && child.content.size > 0) {
      children.push(child.copy(normalizeFragment(child.content, schema)))
    } else {
      children.push(child)
    }
  })

  // Add an empty paragraph if the blockChildren is the only child (invalid structure)
  if (
    children.length === 1 &&
    children[0].type.name === 'blockChildren' &&
    schema
  ) {
    children.unshift(
      schema.nodes.paragraph.createAndFill() ?? schema.nodes.paragraph.create(),
    )
  }

  return node.type.create(node.attrs, children)
}
