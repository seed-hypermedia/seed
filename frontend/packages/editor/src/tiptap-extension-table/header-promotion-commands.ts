import {Node as ProseMirrorNode} from '@tiptap/pm/model'
import {EditorState, Transaction} from '@tiptap/pm/state'

type Dispatch = ((args?: any) => any) | undefined

// Find the table node containing the current selection. Returns the table's
// PM node and its position.
function findEnclosingTable(state: EditorState): {tableNode: ProseMirrorNode; tablePos: number} | null {
  const $from = state.selection.$from
  for (let d = $from.depth; d >= 0; d--) {
    const ancestor = $from.node(d)
    if (ancestor.type.name === 'table') {
      return {tableNode: ancestor, tablePos: $from.before(d)}
    }
  }
  return null
}

// True when every cell of the row is a tableHeader.
function isHeaderRow(row: ProseMirrorNode): boolean {
  if (row.childCount === 0) return false
  let allHeader = true
  row.content.forEach((cell) => {
    if (cell.type.name !== 'tableHeader') allHeader = false
  })
  return allHeader
}

// True when every row's first cell is a tableHeader.
function isHeaderColumn(table: ProseMirrorNode): boolean {
  let allHeader = true
  let anyRow = false
  table.content.forEach((row) => {
    if (row.type.name !== 'tableRow') return
    anyRow = true
    const firstCell = row.firstChild
    if (!firstCell || firstCell.type.name !== 'tableHeader') allHeader = false
  })
  return anyRow && allHeader
}

// Insert a new header row above row 0 and demote the existing
// row 0 to a regular row in a single transaction.
export function addRowBeforeWithHeaderPromotion(state: EditorState, tr: Transaction, dispatch: Dispatch): boolean {
  const located = findEnclosingTable(state)
  if (!located) return false
  const {tableNode, tablePos} = located

  const oldHeaderRow = tableNode.firstChild
  if (!oldHeaderRow || oldHeaderRow.type.name !== 'tableRow') return false
  if (!isHeaderRow(oldHeaderRow)) return false

  const schema = state.schema

  // New empty header row.
  const newCells: ProseMirrorNode[] = []
  oldHeaderRow.content.forEach((oldCell) => {
    const cellAttrs = {
      colspan: oldCell.attrs.colspan,
      rowspan: oldCell.attrs.rowspan,
      colwidth: oldCell.attrs.colwidth,
      columnId: oldCell.attrs.columnId,
    }
    const emptyPara = schema.nodes['paragraph']!.createAndFill()
    newCells.push(schema.nodes['tableHeader']!.create(cellAttrs, emptyPara))
  })
  const newRow = schema.nodes['tableRow']!.create(null, newCells)

  // Demoted old row 0
  const col0IsHeader = isHeaderColumn(tableNode)
  const demotedCells: ProseMirrorNode[] = []
  oldHeaderRow.content.forEach((oldCell, _offset: number, cellIdx: number) => {
    if (cellIdx === 0 && col0IsHeader) {
      demotedCells.push(oldCell)
    } else {
      demotedCells.push(schema.nodes['tableCell']!.create(oldCell.attrs, oldCell.content))
    }
  })
  const demotedRow = schema.nodes['tableRow']!.create(oldHeaderRow.attrs, demotedCells)

  if (dispatch) {
    const rowStart = tablePos + 1
    const rowEnd = rowStart + oldHeaderRow.nodeSize
    tr.replaceWith(rowStart, rowEnd, [newRow, demotedRow])
    dispatch(tr)
  }
  return true
}

// Insert a new header column to the left of column 0 and demote the existing
// column 0 to a regular column, in a single transaction.
export function addColumnBeforeWithHeaderPromotion(state: EditorState, tr: Transaction, dispatch: Dispatch): boolean {
  const located = findEnclosingTable(state)
  if (!located) return false
  const {tableNode, tablePos} = located

  if (!isHeaderColumn(tableNode)) return false

  const schema = state.schema
  const newRows: ProseMirrorNode[] = []

  tableNode.content.forEach((rowNode) => {
    if (rowNode.type.name !== 'tableRow') {
      newRows.push(rowNode)
      return
    }

    const thisRowIsHeader = isHeaderRow(rowNode)

    const newCells: ProseMirrorNode[] = []
    // New tableHeader cell at column 0.
    const emptyPara = schema.nodes['paragraph']!.createAndFill()
    newCells.push(schema.nodes['tableHeader']!.create({colspan: 1, rowspan: 1, colwidth: null}, emptyPara))

    rowNode.content.forEach((oldCell, _offset: number, cellIdx: number) => {
      if (cellIdx === 0 && !thisRowIsHeader) {
        // Demote old col 0.
        newCells.push(schema.nodes['tableCell']!.create(oldCell.attrs, oldCell.content))
      } else {
        // Keep as is
        newCells.push(oldCell)
      }
    })

    newRows.push(schema.nodes['tableRow']!.create(rowNode.attrs, newCells))
  })

  if (dispatch) {
    const tableContentStart = tablePos + 1
    const tableContentEnd = tableContentStart + tableNode.content.size
    tr.replaceWith(tableContentStart, tableContentEnd, newRows)
    dispatch(tr)
  }
  return true
}
