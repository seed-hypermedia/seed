import {NodeType, Node as PMNode, Schema} from 'prosemirror-model'

/**
 * Helper utilities for working with both blockContainer and listContainer nodes.
 * These helpers abstract away the differences between the two container types.
 */

/**
 * Check if a node is a container
 */
export function isContainer(node: PMNode): boolean {
  return (
    node.type.name === 'blockContainer' || node.type.name === 'listContainer'
  )
}

/**
 * Check if a node is a list container
 */
export function isListContainer(node: PMNode): boolean {
  return node.type.name === 'listContainer'
}

/**
 * Check if a node is a block container
 */
export function isBlockContainer(node: PMNode): boolean {
  return node.type.name === 'blockContainer'
}

/**
 * Check if a node is a group
 */
export function isGroup(node: PMNode): boolean {
  return node.type.name === 'blockGroup' || node.type.name === 'listGroup'
}

/**
 * Check if a node is a list group
 */
export function isListGroup(node: PMNode): boolean {
  return node.type.name === 'listGroup'
}

/**
 * Check if a node is a block group
 */
export function isBlockGroup(node: PMNode): boolean {
  return node.type.name === 'blockGroup'
}

/**
 * Get the appropriate container type based on context
 * @param schema The ProseMirror schema
 * @param isInList Whether the container should be a list container
 */
export function getContainerType(schema: Schema, isInList: boolean): NodeType {
  return isInList
    ? schema.nodes['listContainer']!
    : schema.nodes['blockContainer']!
}

/**
 * Get the appropriate group type based on context
 * @param schema The ProseMirror schema
 * @param isInList Whether the group should be a list group
 */
export function getGroupType(schema: Schema, isInList: boolean): NodeType {
  return isInList ? schema.nodes['listGroup']! : schema.nodes['blockGroup']!
}

/**
 * Get the container type name as a string
 */
export function getContainerTypeName(
  node: PMNode,
): 'blockContainer' | 'listContainer' {
  if (isListContainer(node)) return 'listContainer'
  if (isBlockContainer(node)) return 'blockContainer'
  throw new Error(`Node ${node.type.name} is not a container`)
}

/**
 * Get the group type name as a string
 */
export function getGroupTypeName(node: PMNode): 'blockGroup' | 'listGroup' {
  if (isListGroup(node)) return 'listGroup'
  if (isBlockGroup(node)) return 'blockGroup'
  throw new Error(`Node ${node.type.name} is not a group`)
}

/**
 * Check if we're in a list context by checking parent nodes
 * @param node The node to check
 * @param parentNode Optional parent node (group)
 */
export function isInListContext(node: PMNode, parentNode?: PMNode): boolean {
  // If the node itself is a list container, we're in a list
  if (isListContainer(node)) return true

  // If the parent is a list group, we're in a list
  if (parentNode && isListGroup(parentNode)) return true

  return false
}
