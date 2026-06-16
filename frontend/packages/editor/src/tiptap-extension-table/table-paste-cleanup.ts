import {Fragment, NodeType, Node as PMNode, Slice} from 'prosemirror-model'
import {Plugin, PluginKey} from 'prosemirror-state'

export const tablePasteCleanupPlugin = new Plugin({
  key: new PluginKey('table-paste-cleanup'),
  props: {
    transformPasted(slice, view) {
      const schema = view.state.schema
      const paragraphType = schema.nodes['paragraph']
      if (!paragraphType) return slice
      if (!sliceContainsTableCell(slice.content)) return slice
      const hardBreakType = schema.nodes['hardBreak']
      const newContent = cleanFragment(slice.content, paragraphType, hardBreakType)
      return new Slice(newContent, slice.openStart, slice.openEnd)
    },
  },
})

function sliceContainsTableCell(fragment: Fragment): boolean {
  let found = false
  fragment.descendants((node) => {
    if (found) return false
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      found = true
      return false
    }
    return true
  })
  return found
}

function cleanFragment(fragment: Fragment, paragraphType: NodeType, hardBreakType: NodeType | undefined): Fragment {
  const newNodes: PMNode[] = []
  fragment.forEach((node) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      newNodes.push(flattenCell(node, paragraphType, hardBreakType))
    } else if (node.content.size > 0) {
      newNodes.push(node.copy(cleanFragment(node.content, paragraphType, hardBreakType)))
    } else {
      newNodes.push(node)
    }
  })
  return Fragment.from(newNodes)
}

function flattenCell(cellNode: PMNode, paragraphType: NodeType, hardBreakType: NodeType | undefined): PMNode {
  const runs = extractInlineRuns(cellNode)
  const inline: PMNode[] = []
  runs.forEach((run, i) => {
    if (i > 0 && hardBreakType) inline.push(hardBreakType.create())
    inline.push(...run)
  })
  const paragraph = paragraphType.create(null, Fragment.from(inline))
  return cellNode.type.create(cellNode.attrs, Fragment.from([paragraph]))
}

// Pull inline content out of any descendants of the cell node. Returns one
// inline run per logical block.
function extractInlineRuns(node: PMNode): PMNode[][] {
  const runs: PMNode[][] = []
  node.content.forEach((child) => {
    if (child.isText || child.isInline) {
      let current = runs[runs.length - 1]
      if (!current) {
        current = []
        runs.push(current)
      }
      current.push(child)
      return
    }
    if (child.isAtom || child.content.size === 0) return
    if (child.type.name === 'table') return
    if (child.inlineContent) {
      const run: PMNode[] = []
      child.content.forEach((c) => {
        if (c.isText || c.isInline) run.push(c)
      })
      if (run.length > 0) runs.push(run)
      return
    }
    runs.push(...extractInlineRuns(child))
  })
  return runs
}
