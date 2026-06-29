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
        this.editor.commands.addRowBeforeWithHeaderPromotion()
        return
      }
      if (!this.placeCursorInCell(targetRow, 0)) return
      ;(this.editor.chain().focus() as any)[cmd]().run()
    })
  }

  private runColCommand = (cmd: 'addColumnBefore' | 'addColumnAfter' | 'deleteColumn' | 'toggleHeaderColumn') => {
    if (this.menuCol == null) return
    const targetCol = this.menuCol
    queueMicrotask(() => {
      if (!this.editor) return
      if (cmd === 'addColumnBefore' && targetCol === 0 && this.isColHeader(0)) {
        if (!this.placeCursorInCell(0, 0)) return
        this.editor.commands.addColumnBeforeWithHeaderPromotion()
        return
      }
      if (!this.placeCursorInCell(0, targetCol)) return
      ;(this.editor.chain().focus() as any)[cmd]().run()
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
      // Hide "Delete row" when the table has only one row.
      if (this.node.childCount > 1) {
        items.push({
          key: 'delete-row',
          label: 'Delete row',
          icon: createElement(Trash2, {className: 'size-4'}),
          onClick: () => this.runRowCommand('deleteRow'),
        })
      }
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
    // Hide "Delete column" when the table has only one column.
    const colCount = this.node.firstChild ? this.node.firstChild.childCount : 0
    if (colCount > 1) {
      items.push({
        key: 'delete-col',
        label: 'Delete column',
        icon: createElement(Trash2, {className: 'size-4'}),
        onClick: () => this.runColCommand('deleteColumn'),
      })
    }
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
