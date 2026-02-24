import {Fragment} from '@tiptap/pm/model'

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
function wrapBlockGroupInContainer(blockGroupNode: any, schema: any, previousNode: any): any {
  if (
    previousNode &&
    previousNode.type.name === 'blockNode' &&
    previousNode.childCount === 1 &&
    previousNode.firstChild?.type.spec?.group === 'block'
  ) {
    return schema.nodes['blockNode']!.create(previousNode.attrs, [previousNode.firstChild, blockGroupNode])
  }

  const placeholderParagraph = schema.nodes['paragraph']!.create()
  return schema.nodes['blockNode']!.create(null, [placeholderParagraph, blockGroupNode])
}

/**
 * This function fixes the blockNode in case it has multiple block node children after paste.
 * This is invalid structure
 */
export function splitBlockContainerNode(node: any) {
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

export function normalizeFragment(fragment: Fragment, schema?: any): Fragment {
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
          if (child.type?.name === 'blockNode' && child.lastChild?.type?.name === 'blockChildren') {
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

      const normalizedGroup = groupNode.type.create(groupNode.attrs, groupContent)

      if (schema) {
        const prevNode = nodes[nodes.length - 1]
        const wrappedContainer = wrapBlockGroupInContainer(normalizedGroup, schema, prevNode)
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

export function normalizeBlockContainer(node: any, schema?: any) {
  const children: any[] = []

  // Traverse blockNode's children
  node.forEach((child: any, index: number) => {
    // If the child is a blockChildren, normalize it and add it to the children array
    if (child.type?.name === 'blockChildren') {
      children.push(child.type.create(child.attrs, normalizeFragment(child.content, schema)))
    } else if (child.content && child.content.size > 0) {
      children.push(child.copy(normalizeFragment(child.content, schema)))
    } else {
      children.push(child)
    }
  })

  // Add an empty paragraph if the blockChildren is the only child (invalid structure)
  if (children.length === 1 && children[0].type.name === 'blockChildren' && schema) {
    children.unshift(schema.nodes.paragraph.createAndFill() ?? schema.nodes.paragraph.create())
  }

  return node.type.create(node.attrs, children)
}
