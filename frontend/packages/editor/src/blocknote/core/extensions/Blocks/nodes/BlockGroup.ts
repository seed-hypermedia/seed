import {HMBlockChildrenType} from '@shm/shared'
import {InputRule, mergeAttributes, Node} from '@tiptap/core'
import {Fragment, Slice} from '@tiptap/pm/model'
import {Plugin} from '@tiptap/pm/state'
import {updateGroupCommand} from '../../../api/blockManipulation/commands/updateGroup'
import {mergeCSSClasses} from '../../../shared/utils'
import {BlockNoteDOMAttributes} from '../api/blockTypes'
import styles from './Block.module.css'

/**
 * Wraps a blockContent node in a blockContainer.
 */
function wrapBlockContentInContainer(blockContentNode: any, schema: any): any {
  return schema.nodes['blockContainer']!.create(null, blockContentNode)
}

/**
 * Wraps a blockGroup node in a blockContainer with an empty paragraph.
 * If a previous blockContainer exists and doesn't have a child blockGroup,
 * merges the blockGroup into it instead of creating a new container.
 */
function wrapBlockGroupInContainer(
  blockGroupNode: any,
  schema: any,
  previousNode: any,
): any {
  if (
    previousNode &&
    previousNode.type.name === 'blockContainer' &&
    previousNode.childCount === 1 &&
    previousNode.firstChild?.type.spec?.group === 'blockContent'
  ) {
    return schema.nodes['blockContainer']!.create(previousNode.attrs, [
      previousNode.firstChild,
      blockGroupNode,
    ])
  }

  const placeholderParagraph = schema.nodes['paragraph']!.create()
  return schema.nodes['blockContainer']!.create(null, [
    placeholderParagraph,
    blockGroupNode,
  ])
}

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
            let normalizedContent = normalizeFragment(slice.content, schema)

            // If all wrapper nodes are properly structured, close the slice boundaries to indicate it's a complete slice.
            let allTopLevelNodesAreStructured = true
            normalizedContent.forEach((node: any) => {
              if (
                node.type.name !== 'blockContainer' &&
                node.type.name !== 'blockGroup'
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

            return new Slice(normalizedContent, openStart, openEnd)
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
 * This function fixes the blockContainer node in case it has multiple blockContent node children after paste.
 * This is invalid structure
 */
function splitBlockContainerNode(node: any) {
  const blockContents: any[] = []
  let blockGroup: any = null

  // Traverse blockContainer's children and retrieve all blockContent nodes and the last blockGroup node
  node.forEach((child: any) => {
    if (child.type.spec.group === 'blockContent') {
      blockContents.push(child)
    } else if (child.type.name === 'blockGroup') {
      blockGroup = child
    }
  })

  // If there is only one blockContent node, return the blockContainer node
  if (blockContents.length <= 1) {
    return [node]
  }

  // If there are multiple blockContent nodes, split the blockContainer node into multiple blockContainer nodes and return them
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
    if (node.type.name === 'blockContainer') {
      const containers = splitBlockContainerNode(node)
      containers.forEach((container: any) => {
        nodes.push(normalizeBlockContainer(container, schema))
      })
      return
    }

    if (node.type.name === 'blockGroup') {
      let groupNode = node
      let groupContent = normalizeFragment(node.content, schema)

      // Unwrap when the group has a blockContainer child with a single blockGroup child
      // This is invalid structure and happens when copy pasting a nested blockGroup without a parent.
      if (
        groupNode.attrs?.listType === 'Group' && // outer is the dumb wrapper
        groupContent.childCount === 1
      ) {
        const onlyChild = groupContent.firstChild

        if (
          onlyChild &&
          onlyChild.type?.name === 'blockContainer' &&
          onlyChild.childCount === 1 &&
          onlyChild.firstChild &&
          onlyChild.firstChild.type?.name === 'blockGroup'
        ) {
          const innerGroup = onlyChild.firstChild

          // ✅ Treat outer "Group" as a wrapper and adopt the inner group instead
          groupNode = innerGroup
          groupContent = normalizeFragment(innerGroup.content, schema)
        }
      }

      if (groupNode.attrs?.listType === 'Group') {
        let hasNestedLists = false
        groupContent.forEach((child: any) => {
          if (
            child.type?.name === 'blockContainer' &&
            child.lastChild?.type?.name === 'blockGroup'
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

    // Wrap blockContent nodes in blockContainers
    if (node.type.spec?.group === 'blockContent') {
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

  // Traverse blockContainer's children
  node.forEach((child: any, index: number) => {
    // If the child is a blockGroup, normalize it and add it to the children array
    if (child.type?.name === 'blockGroup') {
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

  return node.type.create(node.attrs, children)
}
