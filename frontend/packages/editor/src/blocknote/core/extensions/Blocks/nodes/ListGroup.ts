import {InputRule, mergeAttributes, Node} from '@tiptap/core'
import {Fragment, Slice} from '@tiptap/pm/model'
import {Plugin} from '@tiptap/pm/state'
import {updateGroupCommand} from '../../../api/blockManipulation/commands/updateGroup'
import {BlockNoteDOMAttributes} from '../api/blockTypes'

export type ListType = 'Ordered' | 'Unordered'

/**
 * Wraps a blockContent node in a listContainer.
 */
function wrapBlockContentInListContainer(
  blockContentNode: any,
  schema: any,
): any {
  return schema.nodes['listContainer']!.create(null, blockContentNode)
}

/**
 * Wraps a listGroup node in a listContainer with an empty paragraph.
 * If a previous listContainer exists and doesn't have a child listGroup,
 * merges the listGroup into it instead of creating a new container.
 */
function wrapListGroupInContainer(
  listGroupNode: any,
  schema: any,
  previousNode: any,
): any {
  if (
    previousNode &&
    previousNode.type.name === 'listContainer' &&
    previousNode.childCount === 1 &&
    previousNode.firstChild?.type.spec?.group === 'blockContent'
  ) {
    return schema.nodes['listContainer']!.create(previousNode.attrs, [
      previousNode.firstChild,
      listGroupNode,
    ])
  }

  const placeholderParagraph = schema.nodes['paragraph']!.create()
  return schema.nodes['listContainer']!.create(null, [
    placeholderParagraph,
    listGroupNode,
  ])
}

/**
 * Splits a listContainer node if it has multiple blockContent node children after paste.
 * This is invalid structure.
 */
function splitListContainerNode(node: any) {
  const blockContents: any[] = []
  let childGroup: any = null

  // Traverse listContainer's children and retrieve all blockContent nodes and the last group node
  node.forEach((child: any) => {
    if (child.type.spec.group === 'blockContent') {
      blockContents.push(child)
    } else if (
      child.type.name === 'listGroup' ||
      child.type.name === 'blockGroup'
    ) {
      childGroup = child
    }
  })

  // If there is only one blockContent node, return the listContainer node
  if (blockContents.length <= 1) {
    return [node]
  }

  // If there are multiple blockContent nodes, split the listContainer node into multiple listContainer nodes
  const containers: any[] = []
  blockContents.forEach((blockContent, index) => {
    const children = [blockContent]
    if (index === blockContents.length - 1 && childGroup) {
      children.push(childGroup)
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
    if (node.type.name === 'listContainer') {
      const containers = splitListContainerNode(node)
      containers.forEach((container: any) => {
        nodes.push(normalizeListContainer(container, schema))
      })
      return
    }

    if (node.type.name === 'listGroup') {
      let groupNode = node
      let groupContent = normalizeFragment(node.content, schema)

      // Unwrap when the group has a listContainer child with a single listGroup child
      // This is invalid structure and happens when copy pasting a nested listGroup without a parent.
      if (groupContent.childCount === 1) {
        const firstChild = groupContent.firstChild

        if (
          firstChild &&
          firstChild.type?.name === 'listContainer' &&
          firstChild.firstChild &&
          firstChild.firstChild.type?.name === 'paragraph' &&
          firstChild.firstChild.content.content.length == 0 &&
          firstChild.lastChild &&
          firstChild.lastChild.type?.name === 'listGroup'
        ) {
          const innerGroup = firstChild.lastChild

          // Make the inner group the root group
          groupNode = innerGroup
          groupContent = normalizeFragment(innerGroup.content, schema)
        }
      }

      const normalizedGroup = groupNode.type.create(
        groupNode.attrs,
        groupContent,
      )

      if (schema) {
        const prevNode = nodes[nodes.length - 1]
        const wrappedContainer = wrapListGroupInContainer(
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

    // Wrap blockContent nodes in listContainers
    if (node.type.spec?.group === 'blockContent') {
      if (!schema) {
        nodes.push(node)
        return
      }
      nodes.push(wrapBlockContentInListContainer(node, schema))
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

function normalizeListContainer(node: any, schema?: any) {
  const children: any[] = []

  // Traverse listContainer's children
  node.forEach((child: any, index: number) => {
    // If the child is a listGroup, normalize it and add it to the children array
    if (child.type?.name === 'listGroup') {
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

  // Add an empty paragraph if the listGroup is the only child (invalid structure)
  if (
    children.length === 1 &&
    children[0].type.name === 'listGroup' &&
    schema
  ) {
    children.unshift(
      schema.nodes.paragraph.createAndFill() ?? schema.nodes.paragraph.create(),
    )
  }

  return node.type.create(node.attrs, children)
}

export const ListGroup = Node.create<{
  domAttributes?: BlockNoteDOMAttributes
}>({
  name: 'listGroup',
  group: 'listOrBlockGroup',
  content: 'listContainer+',
  defining: true,

  addAttributes() {
    return {
      listType: {
        default: 'Unordered',
        parseHTML: (element) => {
          if (element.tagName === 'OL') return 'Ordered'
          if (element.tagName === 'UL') return 'Unordered'
          return element.getAttribute('data-list-type') || 'Unordered'
        },
        renderHTML: (attributes) => {
          return {
            'data-list-type': attributes.listType,
          }
        },
      },
    }
  },

  addInputRules() {
    return [
      // new InputRule({
      //   find: new RegExp(`^>\\s$`),
      //   handler: ({state, chain, range}) => {
      //     chain()
      //       .command(
      //         updateGroupCommand(state.selection.from, 'Blockquote', false),
      //       )
      //       // Removes the ">" character used to set the list.
      //       .deleteRange({from: range.from, to: range.to})
      //   },
      // }),
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
        priority: 300,
      },
      {
        tag: 'ol',
        priority: 300,
      },
      {
        tag: 'div[data-node-type="listGroup"]',
        priority: 200,
      },
    ]
  },

  renderHTML({node, HTMLAttributes}) {
    const listGroupDOMAttributes = this.options.domAttributes?.listGroup || {}

    const tag = node.attrs.listType === 'Ordered' ? 'ol' : 'ul'

    return [
      tag,
      mergeAttributes(
        {
          ...listGroupDOMAttributes,
          'data-node-type': 'listGroup',
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
              selection.$from.parent.type.spec.group === 'blockContent' &&
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
                node.type.name !== 'listContainer' &&
                node.type.name !== 'listGroup'
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
