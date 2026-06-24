import {Node as ProseMirrorNode} from '@tiptap/pm/model'
import {NodeView, ViewMutationRecord} from '@tiptap/pm/view'
import {ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Heading, Trash2} from 'lucide-react'
import {createElement} from 'react'
import {createRoot, type Root} from 'react-dom/client'

import styles from '../blocknote/core/extensions/Blocks/nodes/Block.module.css'
import {TableActionsMenu, type TableMenuItem} from './TableActionsMenu'

// Syncs the table's column widths from the PM nodes' colwidth attrs.
export function updateColumns(
  node: ProseMirrorNode,
  colgroup: HTMLElement,
  table: HTMLElement,
  cellMinWidth: number,
  overrideCol?: number,
  overrideValue?: any,
) {
  let totalWidth = 0
  let fixedWidth = true
  let nextCol = colgroup.firstChild as HTMLElement | null
  const row = node.firstChild!

  for (let i = 0, col = 0; i < row.childCount; i += 1) {
    const {colspan, colwidth} = row.child(i).attrs

    for (let j = 0; j < colspan; j += 1, col += 1) {
      const hasWidth = overrideCol === col ? overrideValue : colwidth && colwidth[j]
      const cssWidth = hasWidth ? `${hasWidth}px` : ''

      totalWidth += hasWidth || cellMinWidth

      if (!hasWidth) {
        fixedWidth = false
      }

      if (!nextCol) {
        colgroup.appendChild(document.createElement('col')).style.width = cssWidth
      } else {
        if (nextCol.style.width !== cssWidth) {
          nextCol.style.width = cssWidth
        }

        nextCol = nextCol.nextSibling as HTMLElement | null
      }
    }
  }

  while (nextCol) {
    const after = nextCol.nextSibling as HTMLElement | null

    nextCol.parentNode!.removeChild(nextCol)
    nextCol = after
  }

  if (fixedWidth) {
    table.style.width = `${totalWidth}px`
    table.style.minWidth = ''
  } else {
    // Set width to 100% explicitly because stylesheet rules can lose to inheritance,
    // leaving the table sized to content.
    table.style.width = '100%'
    table.style.minWidth = `${totalWidth}px`
  }
}

// NodeView for the table block.
export class TableView implements NodeView {
  node: ProseMirrorNode
  cellMinWidth: number
  editor: any
  dom: HTMLElement
  table: HTMLElement
  colgroup: HTMLElement
  contentDOM: HTMLElement

  private rowStrip: HTMLElement
  private colStrip: HTMLElement
  private menu: HTMLElement
  private menuRoot: Root | null = null
  // Hover state tracked by row / column index.
  private hoveredRow: number | null = null
  private hoveredCol: number | null = null
  // Menu state.
  private menuKind: 'row' | 'col' | null = null
  private menuRow: number | null = null
  private menuCol: number | null = null
  private resizeObserver: ResizeObserver | null = null

  constructor(node: ProseMirrorNode, cellMinWidth: number, editor: any) {
    this.node = node
    this.cellMinWidth = cellMinWidth
    this.editor = editor

    this.dom = document.createElement('div')
    this.dom.className = 'tableWrapper'
    this.dom.style.position = 'relative'

    this.table = this.dom.appendChild(document.createElement('table'))
    if (styles.blockContent) this.table.className = styles.blockContent
    this.table.setAttribute('data-content-type', 'table')

    this.colgroup = this.table.appendChild(document.createElement('colgroup'))
    updateColumns(node, this.colgroup, this.table, cellMinWidth)
    this.contentDOM = this.table.appendChild(document.createElement('tbody'))

    this.rowStrip = document.createElement('div')
    this.rowStrip.className = 'hm-table-row-strip'
    this.rowStrip.style.display = 'none'
    this.rowStrip.addEventListener('click', this.handleRowStripClick)
    this.rowStrip.addEventListener('mousedown', this.preventDefault)
    this.dom.appendChild(this.rowStrip)

    this.colStrip = document.createElement('div')
    this.colStrip.className = 'hm-table-col-strip'
    this.colStrip.style.display = 'none'
    this.colStrip.addEventListener('click', this.handleColStripClick)
    this.colStrip.addEventListener('mousedown', this.preventDefault)
    this.dom.appendChild(this.colStrip)

    // Container for the action menu.
    // Positioned where the strip was clicked.
    this.menu = document.createElement('div')
    this.menu.className = 'hm-table-menu-anchor'
    this.menu.style.position = 'absolute'
    this.menu.style.display = 'none'
    this.menu.style.zIndex = '10'
    this.dom.appendChild(this.menu)
    this.menuRoot = createRoot(this.menu)
    // Defer the initial React render because the NodeView may be constructed as
    // part of a React commit, and calling root.render() synchronously inside a
    // render warns about triggering nested component updates from render.
    queueMicrotask(() => this.renderReactMenu())

    this.table.addEventListener('mousemove', this.handleMouseMove)
    this.table.addEventListener('mouseleave', this.handleMouseLeave)

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.updateStrips())
      this.resizeObserver.observe(this.table)
    }
  }

  private handleMouseMove = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    const cell = target?.closest('td, th') as HTMLElement | null
    if (!cell || !this.table.contains(cell)) return
    const pos = this.findRowCol(cell)
    if (!pos) return
    if (pos.row === this.hoveredRow && pos.col === this.hoveredCol) return
    this.hoveredRow = pos.row
    this.hoveredCol = pos.col
    this.updateStrips()
  }

  private handleMouseLeave = (event: MouseEvent) => {
    // If the mouse is moving onto a strip or the menu anchor, keep strips visible.
    const related = event.relatedTarget as Node | null
    if (related) {
      if (
        related === this.rowStrip ||
        related === this.colStrip ||
        related === this.menu ||
        this.rowStrip.contains(related) ||
        this.colStrip.contains(related) ||
        this.menu.contains(related)
      ) {
        return
      }
    }
    this.clearHover()
  }

  // Prevent strip and menu mousedown events from blurring the editor or moving the caret.
  private preventDefault = (event: MouseEvent) => {
    event.preventDefault()
  }

  private clearHover() {
    if (this.hoveredRow === null && this.hoveredCol === null) return
    this.hoveredRow = null
    this.hoveredCol = null
    this.rowStrip.style.display = 'none'
    this.colStrip.style.display = 'none'
  }

  // Find row and col indices for a cell in the DOM.
  private findRowCol(cell: HTMLElement): {row: number; col: number} | null {
    const tr = cell.parentElement as HTMLTableRowElement
    if (!tr || tr.tagName !== 'TR') return null
    const allRows = Array.from(this.table.querySelectorAll('tr'))
    const row = allRows.indexOf(tr)
    const col = Array.from(tr.children).indexOf(cell)
    if (row < 0 || col < 0) return null
    return {row, col}
  }

  // Resolve the cell DOM at the cached row / column indices.
  private cellAt(row: number, col: number): HTMLElement | null {
    const allRows = this.table.querySelectorAll('tr')
    const tr = allRows[row] as HTMLElement | undefined
    if (!tr) return null
    return (tr.children[col] as HTMLElement | undefined) ?? null
  }

  private updateStrips() {
    if (this.hoveredRow === null || this.hoveredCol === null) return
    const cell = this.cellAt(this.hoveredRow, this.hoveredCol)
    if (!cell) {
      this.clearHover()
      return
    }
    const cellRect = cell.getBoundingClientRect()
    const tableRect = this.table.getBoundingClientRect()
    const wrapperRect = this.dom.getBoundingClientRect()

    const top = cellRect.top - wrapperRect.top
    const left = cellRect.left - wrapperRect.left
    const tableTop = tableRect.top - wrapperRect.top
    const tableLeft = tableRect.left - wrapperRect.left

    // Small centered marker, positioned just inside the table edge so the
    // mouse can reach it without leaving the table area.
    const MARKER_LEN = 16

    this.rowStrip.style.display = 'block'
    this.rowStrip.style.top = `${top + cellRect.height / 2 - MARKER_LEN / 2}px`
    this.rowStrip.style.left = `${tableLeft}px`
    this.rowStrip.style.height = `${MARKER_LEN}px`

    this.colStrip.style.display = 'block'
    this.colStrip.style.top = `${tableTop}px`
    this.colStrip.style.left = `${left + cellRect.width / 2 - MARKER_LEN / 2}px`
    this.colStrip.style.width = `${MARKER_LEN}px`
  }

  private handleRowStripClick = (event: MouseEvent) => {
    event.stopPropagation()
    if (this.hoveredRow === null) return
    this.openMenu('row', this.hoveredRow, null)
  }

  private handleColStripClick = (event: MouseEvent) => {
    event.stopPropagation()
    if (this.hoveredCol === null) return
    this.openMenu('col', null, this.hoveredCol)
  }

  private openMenu(kind: 'row' | 'col', row: number | null, col: number | null) {
    this.menuKind = kind
    this.menuRow = row
    this.menuCol = col
    this.positionMenu()
    this.menu.style.display = 'block'
    this.renderReactMenu()
  }

  private closeMenu() {
    if (this.menuKind === null) return
    this.menuKind = null
    this.menuRow = null
    this.menuCol = null
    this.menu.style.display = 'none'
    this.renderReactMenu()
  }

  private positionMenu() {
    const wrapperRect = this.dom.getBoundingClientRect()
    if (this.menuKind === 'row' && this.menuRow !== null) {
      const cell = this.cellAt(this.menuRow, 0)
      if (!cell) return
      const cellRect = cell.getBoundingClientRect()
      this.menu.style.top = `${cellRect.bottom - wrapperRect.top}px`
      this.menu.style.left = `${cellRect.left - wrapperRect.left}px`
    } else if (this.menuKind === 'col' && this.menuCol !== null) {
      const cell = this.cellAt(0, this.menuCol)
      if (!cell) return
      const cellRect = cell.getBoundingClientRect()
      this.menu.style.top = `${cellRect.bottom - wrapperRect.top}px`
      this.menu.style.left = `${cellRect.left - wrapperRect.left}px`
    }
  }

  // Move the editor selection into the cell at (row, col) so subsequent
  // table commands operate on that cell's row / column.
  private placeCursorInCell(row: number, col: number): boolean {
    if (!this.editor) return false
    const cellEl = this.cellAt(row, col)
    if (!cellEl) return false
    try {
      const view = this.editor.view
      const pos = view.posAtDOM(cellEl, 0)
      if (pos == null || pos < 0) return false

      this.editor
        .chain()
        .focus()
        .setTextSelection(pos + 1)
        .run()
      return true
    } catch {
      return false
    }
  }

  private isRowHeader(rowIdx: number): boolean {
    const trs = this.table.querySelectorAll('tr')
    const tr = trs[rowIdx]
    if (!tr || tr.children.length === 0) return false
    for (const cell of Array.from(tr.children)) {
      if (cell.tagName !== 'TH') return false
    }
    return true
  }

  private isColHeader(colIdx: number): boolean {
    const trs = this.table.querySelectorAll('tr')
    if (trs.length === 0) return false
    for (const tr of Array.from(trs)) {
      const cell = tr.children[colIdx] as HTMLElement | undefined
      if (!cell || cell.tagName !== 'TH') return false
    }
    return true
  }

  private runRowCommand = (cmd: 'addRowBefore' | 'addRowAfter' | 'deleteRow' | 'toggleHeaderRow') => {
    if (this.menuRow == null) return
    const targetRow = this.menuRow
    queueMicrotask(() => {
      if (!this.editor) return
      if (cmd === 'addRowBefore' && targetRow === 0 && this.isRowHeader(0)) {
        if (!this.placeCursorInCell(0, 0)) return
        this.addRowBeforeWithHeaderPromotion()
        return
      }
      if (!this.placeCursorInCell(targetRow, 0)) return
      ;(this.editor.chain().focus() as any)[cmd]().run()
    })
  }

  // When inserting a row above the existing header row, promote the new row
  // to be the header and demote the old header to a regular row in ONE transaction.
  private addRowBeforeWithHeaderPromotion(): boolean {
    if (!this.editor) return false
    return this.editor.commands.command(({state, tr, dispatch}: any) => {
      // Find the table node containing the current selection.
      const $from = state.selection.$from
      let tablePos = -1
      let tableNode: any = null
      for (let d = $from.depth; d >= 0; d--) {
        const ancestor = $from.node(d)
        if (ancestor.type.name === 'table') {
          tablePos = $from.before(d)
          tableNode = ancestor
          break
        }
      }
      if (!tableNode || tablePos < 0) return false

      const oldHeaderRow = tableNode.firstChild
      if (!oldHeaderRow || oldHeaderRow.type.name !== 'tableRow') return false

      // Confirm old row 0 is a header.
      let isHeader = oldHeaderRow.childCount > 0
      oldHeaderRow.content.forEach((cell: any) => {
        if (cell.type.name !== 'tableHeader') isHeader = false
      })
      if (!isHeader) return false

      // Build new empty header row.
      const newCells: any[] = []
      oldHeaderRow.content.forEach((oldCell: any) => {
        const cellAttrs = {
          colspan: oldCell.attrs.colspan,
          rowspan: oldCell.attrs.rowspan,
          colwidth: oldCell.attrs.colwidth,
          columnId: oldCell.attrs.columnId,
        }
        const emptyPara = state.schema.nodes['paragraph'].createAndFill()
        newCells.push(state.schema.nodes['tableHeader'].create(cellAttrs, emptyPara))
      })
      const newRow = state.schema.nodes['tableRow'].create(null, newCells)

      // Check whether col 0 is a header column. If so, keep col 0's cell in
      // the demoted row as tableHeader.
      let firstColIsHeader = true
      let anyRow = false
      tableNode.content.forEach((row: any) => {
        if (row.type.name !== 'tableRow') return
        anyRow = true
        const firstCell = row.firstChild
        if (!firstCell || firstCell.type.name !== 'tableHeader') firstColIsHeader = false
      })
      if (!anyRow) firstColIsHeader = false

      // Build demoted old row 0.
      const demotedCells: any[] = []
      oldHeaderRow.content.forEach((oldCell: any, _: number, cellIdx: number) => {
        if (cellIdx === 0 && firstColIsHeader) {
          demotedCells.push(oldCell)
        } else {
          const demoted = state.schema.nodes['tableCell'].create(oldCell.attrs, oldCell.content)
          demotedCells.push(demoted)
        }
      })
      const demotedRow = state.schema.nodes['tableRow'].create(oldHeaderRow.attrs, demotedCells)

      if (dispatch) {
        // Replace old row 0 with new row and demoted row.
        const rowStart = tablePos + 1
        const rowEnd = rowStart + oldHeaderRow.nodeSize
        tr.replaceWith(rowStart, rowEnd, [newRow, demotedRow])
        dispatch(tr)
      }
      return true
    })
  }

  private runColCommand = (cmd: 'addColumnBefore' | 'addColumnAfter' | 'deleteColumn' | 'toggleHeaderColumn') => {
    if (this.menuCol == null) return
    const targetCol = this.menuCol
    queueMicrotask(() => {
      if (!this.editor) return
      if (cmd === 'addColumnBefore' && targetCol === 0 && this.isColHeader(0)) {
        if (!this.placeCursorInCell(0, 0)) return
        this.addColumnBeforeWithHeaderPromotion()
        return
      }
      if (!this.placeCursorInCell(0, targetCol)) return
      ;(this.editor.chain().focus() as any)[cmd]().run()
    })
  }

  // When inserting a column to the left of the existing header column, promote the
  // new column to be the header and demote the old header to a regular column in ONE transaction.
  private addColumnBeforeWithHeaderPromotion(): boolean {
    if (!this.editor) return false
    return this.editor.commands.command(({state, tr, dispatch}: any) => {
      const $from = state.selection.$from
      let tablePos = -1
      let tableNode: any = null
      for (let d = $from.depth; d >= 0; d--) {
        const ancestor = $from.node(d)
        if (ancestor.type.name === 'table') {
          tablePos = $from.before(d)
          tableNode = ancestor
          break
        }
      }
      if (!tableNode || tablePos < 0) return false

      // Confirm col 0 is a header column.
      let isHeader = true
      let anyRow = false
      tableNode.content.forEach((rowNode: any) => {
        if (rowNode.type.name !== 'tableRow') return
        anyRow = true
        const firstCell = rowNode.firstChild
        if (!firstCell || firstCell.type.name !== 'tableHeader') isHeader = false
      })
      if (!anyRow || !isHeader) return false

      // Add empty cells to all the rows.
      const newRows: any[] = []
      tableNode.content.forEach((rowNode: any) => {
        if (rowNode.type.name !== 'tableRow') {
          newRows.push(rowNode)
          return
        }
        // Determine if this row is a header row.
        let thisRowIsHeader = rowNode.childCount > 0
        rowNode.content.forEach((c: any) => {
          if (c.type.name !== 'tableHeader') thisRowIsHeader = false
        })

        const newCells: any[] = []
        // New tableHeader cell at column 0.
        const emptyPara = state.schema.nodes['paragraph'].createAndFill()
        newCells.push(state.schema.nodes['tableHeader'].create({colspan: 1, rowspan: 1, colwidth: null}, emptyPara))
        // Demote old col 0, except when the row is a header row.
        rowNode.content.forEach((oldCell: any, _: number, idx: number) => {
          if (idx === 0 && !thisRowIsHeader) {
            const demoted = state.schema.nodes['tableCell'].create(oldCell.attrs, oldCell.content)
            newCells.push(demoted)
          } else {
            newCells.push(oldCell)
          }
        })
        newRows.push(state.schema.nodes['tableRow'].create(rowNode.attrs, newCells))
      })

      if (dispatch) {
        // Replace the table's full content with the new rows in one step.
        const tableContentStart = tablePos + 1
        const tableContentEnd = tableContentStart + tableNode.content.size
        tr.replaceWith(tableContentStart, tableContentEnd, newRows)
        dispatch(tr)
      }
      return true
    })
  }

  private buildMenuItems(): TableMenuItem[] {
    if (this.menuKind === 'row') {
      const items: TableMenuItem[] = [
        {
          key: 'insert-row-above',
          label: 'Insert row above',
          icon: createElement(ArrowUp, {className: 'size-4'}),
          onClick: () => this.runRowCommand('addRowBefore'),
        },
        {
          key: 'insert-row-below',
          label: 'Insert row below',
          icon: createElement(ArrowDown, {className: 'size-4'}),
          onClick: () => this.runRowCommand('addRowAfter'),
        },
      ]
      // Hide header toggle for non-first rows
      if (this.menuRow === 0) {
        items.push({
          key: 'toggle-header-row',
          label: 'Toggle header row',
          icon: createElement(Heading, {className: 'size-4'}),
          onClick: () => this.runRowCommand('toggleHeaderRow'),
        })
      }
      items.push({
        key: 'delete-row',
        label: 'Delete row',
        icon: createElement(Trash2, {className: 'size-4'}),
        onClick: () => this.runRowCommand('deleteRow'),
      })
      return items
    }
    const items: TableMenuItem[] = [
      {
        key: 'insert-col-left',
        label: 'Insert column left',
        icon: createElement(ArrowLeft, {className: 'size-4'}),
        onClick: () => this.runColCommand('addColumnBefore'),
      },
      {
        key: 'insert-col-right',
        label: 'Insert column right',
        icon: createElement(ArrowRight, {className: 'size-4'}),
        onClick: () => this.runColCommand('addColumnAfter'),
      },
    ]
    if (this.menuCol === 0) {
      items.push({
        key: 'toggle-header-col',
        label: 'Toggle header column',
        icon: createElement(Heading, {className: 'size-4'}),
        onClick: () => this.runColCommand('toggleHeaderColumn'),
      })
    }
    items.push({
      key: 'delete-col',
      label: 'Delete column',
      icon: createElement(Trash2, {className: 'size-4'}),
      onClick: () => this.runColCommand('deleteColumn'),
    })
    return items
  }

  private renderReactMenu() {
    if (!this.menuRoot) return
    const open = this.menuKind !== null
    const items: TableMenuItem[] = open ? this.buildMenuItems() : []
    this.menuRoot.render(
      createElement(TableActionsMenu, {
        open,
        onOpenChange: (next: boolean) => {
          if (!next) this.closeMenu()
        },
        items,
      }),
    )
  }

  update(node: ProseMirrorNode) {
    if (node.type !== this.node.type) {
      return false
    }

    this.node = node
    updateColumns(node, this.colgroup, this.table, this.cellMinWidth)
    this.updateStrips()

    return true
  }

  ignoreMutation(mutation: ViewMutationRecord) {
    const target = mutation.target as Node
    // Ignore all mutations on table strips and menu anchor. Without this,
    // PM tears down and rebuilds the NodeView on every event.
    if (
      target === this.rowStrip ||
      target === this.colStrip ||
      target === this.menu ||
      this.rowStrip.contains(target) ||
      this.colStrip.contains(target) ||
      this.menu.contains(target)
    ) {
      return true
    }
    if (mutation.type === 'attributes' && (mutation.target === this.table || this.colgroup.contains(mutation.target))) {
      return true
    }
    return false
  }

  destroy() {
    this.table.removeEventListener('mousemove', this.handleMouseMove)
    this.table.removeEventListener('mouseleave', this.handleMouseLeave)
    this.rowStrip.removeEventListener('click', this.handleRowStripClick)
    this.rowStrip.removeEventListener('mousedown', this.preventDefault)
    this.colStrip.removeEventListener('click', this.handleColStripClick)
    this.colStrip.removeEventListener('mousedown', this.preventDefault)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    const root = this.menuRoot
    this.menuRoot = null
    if (root) queueMicrotask(() => root.unmount())
  }
}
