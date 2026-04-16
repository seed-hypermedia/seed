/**
 * Hitbox strategy — decides between tree-item and closest-edge
 * based on the block's container type (tree vs grid).
 */
import {attachClosestEdge, extractClosestEdge} from '@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge'
import {
  attachInstruction,
  extractInstruction,
  type Instruction,
  type ItemMode,
} from '@atlaskit/pragmatic-drag-and-drop-hitbox/tree-item'
import type {Input} from '@atlaskit/pragmatic-drag-and-drop/types'
import type {DropInstruction} from './drag-state'

export type ContainerType = 'tree' | 'grid'

const INDENT_PER_LEVEL = 24

/**
 * Reads `data-list-type` from the nearest blockChildren ancestor
 * to determine if the block is in a grid or tree container.
 */
export function getContainerType(blockElement: HTMLElement): ContainerType {
  const parent = blockElement.parentElement
  if (parent?.getAttribute('data-list-type') === 'Grid') {
    return 'grid'
  }
  return 'tree'
}

/**
 * Computes the nesting level of a block by counting ancestor
 * blockChildren elements.
 */
export function getBlockLevel(blockElement: HTMLElement): number {
  let level = 0
  let el: HTMLElement | null = blockElement.parentElement
  while (el) {
    if (el.getAttribute('data-node-type') === 'blockChildren') {
      level++
    }
    el = el.parentElement
  }
  return level
}

/**
 * Determines the tree-item mode based on the block's children state.
 */
export function getItemMode(blockElement: HTMLElement): ItemMode {
  // Check if this block has visible children (a nested blockChildren)
  const childrenContainer = blockElement.querySelector(':scope > [data-node-type="blockChildren"]')
  const hasChildren = childrenContainer && childrenContainer.children.length > 0

  // Check if this is the last sibling in its parent container
  const parent = blockElement.parentElement
  const isLastInGroup = parent ? blockElement === parent.lastElementChild : false

  if (isLastInGroup) return 'last-in-group'
  if (hasChildren) return 'expanded'
  return 'standard'
}

/**
 * Attaches hitbox data to the drop target's `getData` return value.
 * Tree containers use tree-item instructions; grid containers use closest-edge.
 */
export function attachHitboxData(
  data: Record<string | symbol, unknown>,
  element: Element,
  input: Input,
  containerType: ContainerType,
  level: number,
  mode: ItemMode,
  blockedInstructions?: Instruction['type'][],
): Record<string | symbol, unknown> {
  if (containerType === 'grid') {
    return attachClosestEdge(data, {
      element,
      input,
      allowedEdges: ['left', 'right'],
    })
  }

  return attachInstruction(data, {
    element,
    input,
    currentLevel: level,
    indentPerLevel: INDENT_PER_LEVEL,
    mode,
    block: blockedInstructions,
  })
}

/**
 * Extracts a DropInstruction from the drop target data.
 */
export function extractDropInstruction(
  data: Record<string | symbol, unknown>,
  containerType: ContainerType,
  targetBlockId: string,
): DropInstruction | null {
  if (containerType === 'grid') {
    const edge = extractClosestEdge(data)
    if (!edge) return null
    if (edge === 'left') return {type: 'grid-before', targetBlockId}
    if (edge === 'right') return {type: 'grid-after', targetBlockId}
    return null
  }

  const instruction = extractInstruction(data)
  if (!instruction) return null

  switch (instruction.type) {
    case 'reorder-above':
      return {type: 'reorder-above', targetBlockId, level: instruction.currentLevel}
    case 'reorder-below':
      return {type: 'reorder-below', targetBlockId, level: instruction.currentLevel}
    case 'make-child':
      return {type: 'make-child', targetBlockId}
    case 'reparent':
      return {type: 'reparent', targetBlockId, desiredLevel: instruction.desiredLevel}
    case 'instruction-blocked':
      return null
  }
}
