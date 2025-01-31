import {Node, ResolvedPos} from '@tiptap/pm/model'
import {EditorState} from 'prosemirror-state'

export type GroupInfo = {
  group: Node
  container?: Node
  depth: number
  level: number
  $pos: ResolvedPos
}

export function getGroupInfoFromPos(
  pos: number,
  state: EditorState,
): GroupInfo {
  const $pos = state.doc.resolve(pos)
  const maxDepth = $pos.depth
  // Set group to first node found at position
  let group = $pos.node(maxDepth)
  let container
  let depth = maxDepth

  // Find block group, block container and depth it is at
  while (true) {
    if (depth < 0) {
      break
    }

    if (group.type.name === 'blockGroup') {
      break
    }

    if (group.type.name === 'blockContainer') {
      container = group
    }

    depth -= 1
    group = $pos.node(depth)
  }

  return {
    group,
    container,
    depth,
    level: Math.ceil((maxDepth - 1) / 2),
    $pos,
  }
}

export function getParentGroupInfoFromPos(
  group: Node,
  $pos: ResolvedPos,
  depth: number,
) {
  for (let parentDepth = depth; parentDepth > 0; parentDepth--) {
    const node = $pos.node(parentDepth)
    if (node.type.name === 'blockGroup' && !node.eq(group)) {
      return {node, pos: $pos.before(depth)}
    }
  }
  return {node: null, pos: 0}
}
