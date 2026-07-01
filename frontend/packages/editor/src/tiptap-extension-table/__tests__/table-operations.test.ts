// @vitest-environment jsdom
import {describe, expect, it} from 'vitest'
import {BlockNoteEditor} from '../../blocknote/core/BlockNoteEditor'
import type {Block, PartialBlock} from '../../blocknote/core/extensions/Blocks/api/blockTypes'
import {hmBlockSchema} from '../../schema'

// ---------- helpers ----------
type TableOptions = {
  rows: number
  cols: number
  headerRow?: boolean
  headerCol?: boolean
  /** Optional text for a given cell. Defaults to empty. */
  text?: (r: number, c: number) => string
}

/** Build an editor block tree for a table with optional header row/column. */
function buildTestTable({rows, cols, headerRow = false, headerCol = false, text}: TableOptions): PartialBlock<any> {
  const colIds = Array.from({length: cols}, (_, i) => `col-${i}`)
  const columns = colIds.map((id, idx) => ({
    id,
    type: 'tableColumn' as const,
    props: idx === 0 && headerCol ? {isHeader: true} : {},
    content: [],
    children: [],
  }))
  const rowBlocks = Array.from({length: rows}, (_, rIdx) => ({
    id: `row-${rIdx}`,
    type: 'tableRow' as const,
    props: rIdx === 0 && headerRow ? {isHeader: true} : {},
    content: [],
    children: Array.from({length: cols}, (_, cIdx) => ({
      id: `cell-${rIdx}-${cIdx}`,
      type: 'paragraph' as const,
      props: {columnId: colIds[cIdx]},
      content: text ? [{type: 'text' as const, text: text(rIdx, cIdx), styles: {}}] : [],
      children: [],
    })),
  }))
  return {
    id: 'table',
    type: 'table',
    props: {},
    content: [],
    children: [...columns, ...rowBlocks] as any,
  } as PartialBlock<any>
}

function createEditor(initialContent: PartialBlock<any>[]) {
  return new BlockNoteEditor({
    initialContent,
    blockSchema: hmBlockSchema,
  })
}

/** Place the PM selection inside the paragraph of the cell with the given id. */
function positionCursor(editor: BlockNoteEditor<any>, cellId: string) {
  const ttEditor = editor._tiptapEditor
  let pos = -1
  ttEditor.state.doc.descendants((node, nodePos) => {
    if (pos >= 0) return false
    if ((node.type.name === 'tableCell' || node.type.name === 'tableHeader') && node.attrs.id === cellId) {
      // Pos + 2 lands inside the cell's child paragraph.
      pos = nodePos + 2
      return false
    }
    return true
  })
  if (pos < 0) throw new Error(`Cell "${cellId}" not found in PM doc`)
  ttEditor.commands.setTextSelection(pos)
}

function getTable(editor: BlockNoteEditor<any>): Block<any> {
  const block = editor.topLevelBlocks.find((b: any) => b.type === 'table')
  if (!block) throw new Error('No table block at top level')
  return block as Block<any>
}

function getColumns(table: Block<any>): any[] {
  return (table.children ?? []).filter((c: any) => c.type === 'tableColumn')
}

function getRows(table: Block<any>): any[] {
  return (table.children ?? []).filter((c: any) => c.type === 'tableRow')
}

/** Paragraph cells of a row, in column order. */
function cellsOf(row: any): any[] {
  return (row.children ?? []).filter((c: any) => c.type === 'paragraph')
}

/** Extract the table's text content as a `string[][]` grid.
 * Each cell's text is read from its first inline content leaf */
function gridOf(table: Block<any>): string[][] {
  return getRows(table).map((row) =>
    cellsOf(row).map((cell) => {
      const first = cell.content?.[0]
      return first && first.type === 'text' ? first.text : ''
    }),
  )
}

/** Read the PM node type of every cell as a `('tableHeader' | 'tableCell')[][]`
 * grid (row-major, column order). This is the source of truth for header-ness —
 * the editor-block `isHeader` flags are *derived* from these node types, so
 * asserting on them directly catches per-cell header bugs that the derived
 * flags would mask. */
function cellTypesOf(editor: BlockNoteEditor<any>): string[][] {
  const grid: string[][] = []
  editor._tiptapEditor.state.doc.descendants((node) => {
    if (node.type.name !== 'table') return true
    node.forEach((rowNode) => {
      if (rowNode.type.name !== 'tableRow') return
      const rowTypes: string[] = []
      rowNode.forEach((cellNode) => {
        if (cellNode.type.name === 'tableHeader' || cellNode.type.name === 'tableCell') {
          rowTypes.push(cellNode.type.name)
        }
      })
      grid.push(rowTypes)
    })
    return false
  })
  return grid
}

/** Default cell text generator used when content positions matter. */
const labels = (r: number, c: number) => `r${r}c${c}`

/** Assert table dimensions and header flags. Header is allowed only on first row/column. */
function assertShape(
  table: Block<any>,
  expected: {rows: number; cols: number; headerRow?: boolean; headerCol?: boolean},
) {
  const colBlocks = getColumns(table)
  const rowBlocks = getRows(table)
  expect(colBlocks, 'column count').toHaveLength(expected.cols)
  expect(rowBlocks, 'row count').toHaveLength(expected.rows)
  for (let i = 0; i < colBlocks.length; i++) {
    const want = i === 0 && expected.headerCol
    if (want) expect(colBlocks[i].props?.isHeader, `col ${i} isHeader`).toBe(true)
    else expect(colBlocks[i].props?.isHeader, `col ${i} isHeader`).toBeFalsy()
  }
  for (let i = 0; i < rowBlocks.length; i++) {
    const want = i === 0 && expected.headerRow
    if (want) expect(rowBlocks[i].props?.isHeader, `row ${i} isHeader`).toBe(true)
    else expect(rowBlocks[i].props?.isHeader, `row ${i} isHeader`).toBeFalsy()
    expect(cellsOf(rowBlocks[i]), `row ${i} cell count`).toHaveLength(expected.cols)
  }
}

// ---------- tests ----------
describe('table operations', () => {
  describe('insert column', () => {
    it('addColumnAfter on (0, 1) inserts an empty column at index 2 and shifts the old col 2 right', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      positionCursor(editor, 'cell-0-1')
      editor._tiptapEditor.commands.addColumnAfter()

      const table = getTable(editor)
      assertShape(table, {rows: 3, cols: 4})
      expect(gridOf(table)).toEqual([
        ['r0c0', 'r0c1', '', 'r0c2'],
        ['r1c0', 'r1c1', '', 'r1c2'],
        ['r2c0', 'r2c1', '', 'r2c2'],
      ])
      editor._tiptapEditor.destroy()
    })

    it('addColumnBefore on (0, 0) inserts an empty column at index 0 and shifts all columns right', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.addColumnBefore()

      const table = getTable(editor)
      assertShape(table, {rows: 3, cols: 4})
      expect(gridOf(table)).toEqual([
        ['', 'r0c0', 'r0c1', 'r0c2'],
        ['', 'r1c0', 'r1c1', 'r1c2'],
        ['', 'r2c0', 'r2c1', 'r2c2'],
      ])
      editor._tiptapEditor.destroy()
    })

    it('addColumnBeforeWithHeaderPromotion on (0, 0) when col 0 is a header column', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, headerCol: true, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.addColumnBeforeWithHeaderPromotion()

      const table = getTable(editor)
      assertShape(table, {rows: 3, cols: 4, headerCol: true})

      // Old col 0 (now at col 1) is no longer a header.
      const cols = getColumns(table)
      expect(cols[1].props?.isHeader, 'old header column demoted at new col 1').toBeFalsy()

      // Only the new col 0 is tableHeader.
      expect(cellTypesOf(editor)).toEqual([
        ['tableHeader', 'tableCell', 'tableCell', 'tableCell'],
        ['tableHeader', 'tableCell', 'tableCell', 'tableCell'],
        ['tableHeader', 'tableCell', 'tableCell', 'tableCell'],
      ])

      expect(gridOf(table)).toEqual([
        ['', 'r0c0', 'r0c1', 'r0c2'],
        ['', 'r1c0', 'r1c1', 'r1c2'],
        ['', 'r2c0', 'r2c1', 'r2c2'],
      ])

      // Demoted col 0 cells keep their IDs.
      const rows = getRows(table)
      for (let r = 0; r < 3; r++) {
        expect(cellsOf(rows[r])[1].id, `demoted col 1 row ${r} id`).toBe(`cell-${r}-0`)
      }
      editor._tiptapEditor.destroy()
    })

    it('addColumnBeforeWithHeaderPromotion preserves row 0 headers when row 0 is a header row', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, headerRow: true, headerCol: true, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.addColumnBeforeWithHeaderPromotion()

      const table = getTable(editor)
      assertShape(table, {rows: 3, cols: 4, headerRow: true, headerCol: true})

      // Table headers in the first row are preserved
      expect(cellTypesOf(editor)).toEqual([
        ['tableHeader', 'tableHeader', 'tableHeader', 'tableHeader'],
        ['tableHeader', 'tableCell', 'tableCell', 'tableCell'],
        ['tableHeader', 'tableCell', 'tableCell', 'tableCell'],
      ])

      expect(gridOf(table)).toEqual([
        ['', 'r0c0', 'r0c1', 'r0c2'],
        ['', 'r1c0', 'r1c1', 'r1c2'],
        ['', 'r2c0', 'r2c1', 'r2c2'],
      ])

      // Old (0, 0) corner cell preserved at new (0, 1).
      const rows = getRows(table)
      expect(cellsOf(rows[0])[1].id, 'old (0,0) preserved at (0,1)').toBe('cell-0-0')
      editor._tiptapEditor.destroy()
    })

    it('addColumnAfter on (0, 2) appends an empty column at index 3', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      positionCursor(editor, 'cell-0-2')
      editor._tiptapEditor.commands.addColumnAfter()

      const table = getTable(editor)
      assertShape(table, {rows: 3, cols: 4})
      expect(gridOf(table)).toEqual([
        ['r0c0', 'r0c1', 'r0c2', ''],
        ['r1c0', 'r1c1', 'r1c2', ''],
        ['r2c0', 'r2c1', 'r2c2', ''],
      ])
      editor._tiptapEditor.destroy()
    })
  })

  describe('insert row', () => {
    it('addRowAfter on (1, 0) inserts an empty row at index 2 and shifts the old row 2 down', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      positionCursor(editor, 'cell-1-0')
      editor._tiptapEditor.commands.addRowAfter()

      const table = getTable(editor)
      assertShape(table, {rows: 4, cols: 3})
      expect(gridOf(table)).toEqual([
        ['r0c0', 'r0c1', 'r0c2'],
        ['r1c0', 'r1c1', 'r1c2'],
        ['', '', ''],
        ['r2c0', 'r2c1', 'r2c2'],
      ])
      editor._tiptapEditor.destroy()
    })

    it('addRowBefore on (0, 0) inserts an empty row at index 0 and shifts all rows down', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.addRowBefore()

      const table = getTable(editor)
      assertShape(table, {rows: 4, cols: 3})
      expect(gridOf(table)).toEqual([
        ['', '', ''],
        ['r0c0', 'r0c1', 'r0c2'],
        ['r1c0', 'r1c1', 'r1c2'],
        ['r2c0', 'r2c1', 'r2c2'],
      ])
      editor._tiptapEditor.destroy()
    })

    it('addRowBeforeWithHeaderPromotion on (0, 0) when row 0 is a header row', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, headerRow: true, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.addRowBeforeWithHeaderPromotion()

      const table = getTable(editor)
      assertShape(table, {rows: 4, cols: 3, headerRow: true})

      // Old row 0 (now row 1) is no longer a header.
      const rows = getRows(table)
      expect(rows[1].props?.isHeader, 'old header row demoted at new row 1').toBeFalsy()

      // Only the new row 0 is tableHeader.
      expect(cellTypesOf(editor)).toEqual([
        ['tableHeader', 'tableHeader', 'tableHeader'],
        ['tableCell', 'tableCell', 'tableCell'],
        ['tableCell', 'tableCell', 'tableCell'],
        ['tableCell', 'tableCell', 'tableCell'],
      ])

      expect(gridOf(table)).toEqual([
        ['', '', ''],
        ['r0c0', 'r0c1', 'r0c2'],
        ['r1c0', 'r1c1', 'r1c2'],
        ['r2c0', 'r2c1', 'r2c2'],
      ])

      // Demoted row keeps its row id and cell ids.
      expect(rows[1].id, 'demoted row id').toBe('row-0')
      for (let c = 0; c < 3; c++) {
        expect(cellsOf(rows[1])[c].id, `demoted row cell ${c} id`).toBe(`cell-0-${c}`)
      }
      editor._tiptapEditor.destroy()
    })

    it('addRowBeforeWithHeaderPromotion preserves the column headers when col 0 is a header column', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, headerRow: true, headerCol: true, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.addRowBeforeWithHeaderPromotion()

      const table = getTable(editor)
      assertShape(table, {rows: 4, cols: 3, headerRow: true, headerCol: true})

      // Table headers in the first column are preserved
      expect(cellTypesOf(editor)).toEqual([
        ['tableHeader', 'tableHeader', 'tableHeader'],
        ['tableHeader', 'tableCell', 'tableCell'],
        ['tableHeader', 'tableCell', 'tableCell'],
        ['tableHeader', 'tableCell', 'tableCell'],
      ])

      expect(gridOf(table)).toEqual([
        ['', '', ''],
        ['r0c0', 'r0c1', 'r0c2'],
        ['r1c0', 'r1c1', 'r1c2'],
        ['r2c0', 'r2c1', 'r2c2'],
      ])

      // Old (0, 0) corner cell preserved at new (1, 0).
      const rows = getRows(table)
      expect(cellsOf(rows[1])[0].id, 'old (0,0) preserved at (1,0)').toBe('cell-0-0')
      editor._tiptapEditor.destroy()
    })

    it('addRowAfter on (2, 0) appends an empty row at index 3', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      positionCursor(editor, 'cell-2-0')
      editor._tiptapEditor.commands.addRowAfter()

      const table = getTable(editor)
      assertShape(table, {rows: 4, cols: 3})
      expect(gridOf(table)).toEqual([
        ['r0c0', 'r0c1', 'r0c2'],
        ['r1c0', 'r1c1', 'r1c2'],
        ['r2c0', 'r2c1', 'r2c2'],
        ['', '', ''],
      ])
      editor._tiptapEditor.destroy()
    })
  })

  describe('delete column', () => {
    it('deleteColumn on (0, 1) removes the middle column', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      positionCursor(editor, 'cell-0-1')
      editor._tiptapEditor.commands.deleteColumn()

      const table = getTable(editor)
      assertShape(table, {rows: 3, cols: 2})
      expect(gridOf(table)).toEqual([
        ['r0c0', 'r0c2'],
        ['r1c0', 'r1c2'],
        ['r2c0', 'r2c2'],
      ])
      editor._tiptapEditor.destroy()
    })

    it('deleteColumn on (0, 0) removes the header column', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, headerCol: true, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.deleteColumn()

      const table = getTable(editor)
      assertShape(table, {rows: 3, cols: 2, headerCol: false})

      // No table headers.
      expect(cellTypesOf(editor)).toEqual([
        ['tableCell', 'tableCell'],
        ['tableCell', 'tableCell'],
        ['tableCell', 'tableCell'],
      ])

      expect(gridOf(table)).toEqual([
        ['r0c1', 'r0c2'],
        ['r1c1', 'r1c2'],
        ['r2c1', 'r2c2'],
      ])
      editor._tiptapEditor.destroy()
    })
  })

  describe('delete row', () => {
    it('deleteRow on (1, 0) removes the middle row', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      positionCursor(editor, 'cell-1-0')
      editor._tiptapEditor.commands.deleteRow()

      const table = getTable(editor)
      assertShape(table, {rows: 2, cols: 3})
      expect(gridOf(table)).toEqual([
        ['r0c0', 'r0c1', 'r0c2'],
        ['r2c0', 'r2c1', 'r2c2'],
      ])
      editor._tiptapEditor.destroy()
    })

    it('deleteRow on (0, 0) removes the header row; new row 0 (formerly row 1) is NOT a header', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, headerRow: true, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.deleteRow()

      const table = getTable(editor)
      assertShape(table, {rows: 2, cols: 3, headerRow: false})

      // No table headers.
      expect(cellTypesOf(editor)).toEqual([
        ['tableCell', 'tableCell', 'tableCell'],
        ['tableCell', 'tableCell', 'tableCell'],
      ])

      expect(gridOf(table)).toEqual([
        ['r1c0', 'r1c1', 'r1c2'],
        ['r2c0', 'r2c1', 'r2c2'],
      ])
      editor._tiptapEditor.destroy()
    })
  })

  describe('toggle header', () => {
    // The expected table content.
    const labelGrid = Array.from({length: 3}, (_, r) => Array.from({length: 3}, (_, c) => labels(r, c)))

    it('toggleHeaderRow on (0, 0) turns row 0 into a header row', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.toggleHeaderRow()

      const table = getTable(editor)
      assertShape(table, {rows: 3, cols: 3, headerRow: true})
      // Row 0 all tableHeader, other rows all tableCell.
      expect(cellTypesOf(editor)).toEqual([
        ['tableHeader', 'tableHeader', 'tableHeader'],
        ['tableCell', 'tableCell', 'tableCell'],
        ['tableCell', 'tableCell', 'tableCell'],
      ])
      expect(gridOf(table)).toEqual(labelGrid)
      editor._tiptapEditor.destroy()
    })

    it('toggleHeaderRow on (0, 0) when row 0 is already a header turns it off', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, headerRow: true, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.toggleHeaderRow()

      const table = getTable(editor)
      assertShape(table, {rows: 3, cols: 3, headerRow: false})
      // Every cell is a tableCell.
      expect(cellTypesOf(editor)).toEqual([
        ['tableCell', 'tableCell', 'tableCell'],
        ['tableCell', 'tableCell', 'tableCell'],
        ['tableCell', 'tableCell', 'tableCell'],
      ])
      expect(gridOf(table)).toEqual(labelGrid)
      editor._tiptapEditor.destroy()
    })

    it('toggleHeaderColumn on (0, 0) turns col 0 into a header column', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.toggleHeaderColumn()

      const table = getTable(editor)
      assertShape(table, {rows: 3, cols: 3, headerCol: true})
      // Col 0 all tableHeader, other columns all tableCell.
      expect(cellTypesOf(editor)).toEqual([
        ['tableHeader', 'tableCell', 'tableCell'],
        ['tableHeader', 'tableCell', 'tableCell'],
        ['tableHeader', 'tableCell', 'tableCell'],
      ])
      expect(gridOf(table)).toEqual(labelGrid)
      editor._tiptapEditor.destroy()
    })

    it('toggleHeaderColumn on (0, 0) when col 0 is already a header turns it off', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, headerCol: true, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.toggleHeaderColumn()

      const table = getTable(editor)
      assertShape(table, {rows: 3, cols: 3, headerCol: false})
      // Every cell is a tableCell.
      expect(cellTypesOf(editor)).toEqual([
        ['tableCell', 'tableCell', 'tableCell'],
        ['tableCell', 'tableCell', 'tableCell'],
        ['tableCell', 'tableCell', 'tableCell'],
      ])
      expect(gridOf(table)).toEqual(labelGrid)
      editor._tiptapEditor.destroy()
    })
  })

  describe('cell ID preservation', () => {
    /** Read cell ids in row order. */
    function cellIdsOf(table: Block<any>): string[][] {
      return getRows(table).map((row) => cellsOf(row).map((cell) => cell.id))
    }
    /** Read each cell's columnId in row order. */
    function columnIdsOf(table: Block<any>): string[][] {
      return getRows(table).map((row) => cellsOf(row).map((cell) => (cell.props?.columnId as string) ?? ''))
    }
    /** Read row ids in order. */
    function rowIdsOf(table: Block<any>): string[] {
      return getRows(table).map((row) => row.id)
    }

    it('addColumnAfter preserves existing cell IDs and creates new IDs for the new column', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      positionCursor(editor, 'cell-1-1')
      editor._tiptapEditor.commands.addColumnAfter()

      const table = getTable(editor)
      const ids = cellIdsOf(table)
      // Each row now has 4 cells.
      ids.forEach((row, rIdx) => {
        expect(row[0], `(${rIdx},0) preserved`).toBe(`cell-${rIdx}-0`)
        expect(row[1], `(${rIdx},1) preserved`).toBe(`cell-${rIdx}-1`)
        expect(row[3], `(${rIdx},3) preserved`).toBe(`cell-${rIdx}-2`)
        // New cell at column 2 has a new id, not any of the originals.
        expect([`cell-${rIdx}-0`, `cell-${rIdx}-1`, `cell-${rIdx}-2`]).not.toContain(row[2])
        expect(row[2], `(${rIdx},2) has an id`).toBeTruthy()
      })
      editor._tiptapEditor.destroy()
    })

    it('addRowAfter preserves existing row and cell IDs and creates new IDs for the new row', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.addRowAfter()

      const table = getTable(editor)
      const rowIds = rowIdsOf(table)
      expect(rowIds[0], 'row 0 preserved').toBe('row-0')
      expect(rowIds[2], 'row 2 preserved (was row 1)').toBe('row-1')
      expect(rowIds[3], 'row 3 preserved (was row 2)').toBe('row-2')
      expect(rowIds[1], 'new row id is fresh').toBeTruthy()
      expect(['row-0', 'row-1', 'row-2']).not.toContain(rowIds[1])

      // Cells in surviving rows keep their original ids.
      const cellIds = cellIdsOf(table)
      for (let c = 0; c < 3; c++) {
        expect(cellIds[0]?.[c]).toBe(`cell-0-${c}`)
        expect(cellIds[2]?.[c]).toBe(`cell-1-${c}`)
        expect(cellIds[3]?.[c]).toBe(`cell-2-${c}`)
        expect(cellIds[1]?.[c]).toBeTruthy()
        expect(cellIds[1]?.[c]).not.toBe(`cell-0-${c}`)
      }
      editor._tiptapEditor.destroy()
    })

    it('addColumnBefore preserves columnId on existing cells and new column gets a new columnId', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.addColumnBefore()

      const table = getTable(editor)
      const colIds = columnIdsOf(table)
      colIds.forEach((row, rIdx) => {
        expect(row[1], `(${rIdx},1) columnId preserved`).toBe('col-0')
        expect(row[2], `(${rIdx},2) columnId preserved`).toBe('col-1')
        expect(row[3], `(${rIdx},3) columnId preserved`).toBe('col-2')
        expect(row[0], `(${rIdx},0) has a fresh columnId`).toBeTruthy()
        expect(['col-0', 'col-1', 'col-2']).not.toContain(row[0])
      })
      // All new column cells should share a single columnId.
      expect(colIds[0]?.[0]).toBe(colIds[1]?.[0])
      expect(colIds[1]?.[0]).toBe(colIds[2]?.[0])
      editor._tiptapEditor.destroy()
    })

    it('addColumnBeforeWithHeaderPromotion preserves columnIds, creates new columnId for new header col', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, headerCol: true, text: labels})])
      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.addColumnBeforeWithHeaderPromotion()

      const table = getTable(editor)
      const colIds = columnIdsOf(table)
      colIds.forEach((row, rIdx) => {
        expect(row[1], `(${rIdx},1) demoted col 0 columnId preserved`).toBe('col-0')
        expect(row[2], `(${rIdx},2) columnId preserved`).toBe('col-1')
        expect(row[3], `(${rIdx},3) columnId preserved`).toBe('col-2')
        expect(row[0], `(${rIdx},0) is a fresh columnId`).toBeTruthy()
        expect(['col-0', 'col-1', 'col-2']).not.toContain(row[0])
      })
      // All new header column cells share a single columnId.
      expect(colIds[0]?.[0]).toBe(colIds[1]?.[0])
      expect(colIds[1]?.[0]).toBe(colIds[2]?.[0])
      editor._tiptapEditor.destroy()
    })

    it('toggleHeaderRow preserves cell ids, columnId and row id', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      const before = getTable(editor)
      const cellIdsBefore = cellIdsOf(before)
      const colIdsBefore = columnIdsOf(before)
      const rowIdsBefore = rowIdsOf(before)

      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.toggleHeaderRow()

      const after = getTable(editor)
      expect(cellIdsOf(after)).toEqual(cellIdsBefore)
      expect(columnIdsOf(after)).toEqual(colIdsBefore)
      expect(rowIdsOf(after)).toEqual(rowIdsBefore)
      editor._tiptapEditor.destroy()
    })

    it('toggleHeaderColumn preserves cell ids, columnId and row id', () => {
      const editor = createEditor([buildTestTable({rows: 3, cols: 3, text: labels})])
      const before = getTable(editor)
      const cellIdsBefore = cellIdsOf(before)
      const colIdsBefore = columnIdsOf(before)
      const rowIdsBefore = rowIdsOf(before)

      positionCursor(editor, 'cell-0-0')
      editor._tiptapEditor.commands.toggleHeaderColumn()

      const after = getTable(editor)
      expect(cellIdsOf(after)).toEqual(cellIdsBefore)
      expect(columnIdsOf(after)).toEqual(colIdsBefore)
      expect(rowIdsOf(after)).toEqual(rowIdsBefore)
      editor._tiptapEditor.destroy()
    })
  })

  describe('conflict edge cases', () => {
    // Build a table where row 0 has explicit, possibly conflicting cell defs.
    function buildConflictTable(cols: number, row0Cells: any[]): PartialBlock<any> {
      const colIds = Array.from({length: cols}, (_, i) => `col-${i}`)
      const columns = colIds.map((id) => ({
        id,
        type: 'tableColumn' as const,
        props: {},
        content: [],
        children: [],
      }))
      const row0 = {
        id: 'row-0',
        type: 'tableRow' as const,
        props: {},
        content: [],
        children: row0Cells,
      }
      const row1 = {
        id: 'row-1',
        type: 'tableRow' as const,
        props: {},
        content: [],
        children: colIds.map((cid, cIdx) => ({
          id: `cell-1-${cIdx}`,
          type: 'paragraph' as const,
          props: {columnId: cid},
          content: [{type: 'text' as const, text: `r1c${cIdx}`, styles: {}}],
          children: [],
        })),
      }
      return {
        id: 'table',
        type: 'table',
        props: {},
        content: [],
        children: [...columns, row0, row1] as any,
      } as PartialBlock<any>
    }

    function cellWithColumnId(id: string, columnId: string, text: string) {
      return {
        id,
        type: 'paragraph' as const,
        props: {columnId},
        content: [{type: 'text' as const, text, styles: {}}],
        children: [],
      }
    }

    // Edge Case: Concurrent Cell Insertion
    it('two cells in the same (row, column)', () => {
      // Row 0 has TWO cells both pointing at col-0.
      const table = buildConflictTable(3, [
        cellWithColumnId('cell-A', 'col-0', 'AAA'),
        cellWithColumnId('cell-B', 'col-0', 'BBB'),
        cellWithColumnId('cell-0-1', 'col-1', 'r0c1'),
        cellWithColumnId('cell-0-2', 'col-2', 'r0c2'),
      ])
      const editor = createEditor([table])

      const out = getTable(editor)
      const rows = getRows(out)
      const row0 = cellsOf(rows[0])

      // Row 0 has exactly 3 cells.
      expect(row0).toHaveLength(3)

      // The second cell 'BBB' wins at column 0.
      expect(row0[0].content?.[0]?.text, 'col 0 text (last-wins)').toBe('BBB')
      expect(row0[0].id, 'col 0 id (last-wins)').toBe('cell-B')

      // The earlier cell 'AAA' is gone entirely.
      const allIds = rows.flatMap((r) => cellsOf(r).map((c) => c.id))
      expect(allIds, 'earlier conflicting cell is dropped').not.toContain('cell-A')

      editor._tiptapEditor.destroy()
    })

    it('reversing array order flips the winner', () => {
      // Same as previous test but with 'B' before 'A'.
      const table = buildConflictTable(3, [
        cellWithColumnId('cell-B', 'col-0', 'BBB'),
        cellWithColumnId('cell-A', 'col-0', 'AAA'),
        cellWithColumnId('cell-0-1', 'col-1', 'r0c1'),
        cellWithColumnId('cell-0-2', 'col-2', 'r0c2'),
      ])
      const editor = createEditor([table])

      const row0 = cellsOf(getRows(getTable(editor))[0])
      // Now cell 'AAA' wins, because it is last in the array.
      expect(row0[0].content?.[0]?.text, 'col 0 text (last-wins)').toBe('AAA')
      expect(row0[0].id, 'col 0 id (last-wins)').toBe('cell-A')

      editor._tiptapEditor.destroy()
    })

    // Edge Case: Orphan Cells
    // A cell whose columnId references a column that
    // no longer exists is an orphan and is ignored.
    it('a cell whose columnId matches no column is dropped', () => {
      // Row 0 has 3 valid cells plus a 4th cell pointing at a deleted column.
      const table = buildConflictTable(3, [
        cellWithColumnId('cell-0-0', 'col-0', 'r0c0'),
        cellWithColumnId('cell-0-1', 'col-1', 'r0c1'),
        cellWithColumnId('cell-0-2', 'col-2', 'r0c2'),
        cellWithColumnId('cell-orphan', 'col-DELETED', 'ORPHAN'),
      ])
      const editor = createEditor([table])

      const out = getTable(editor)
      const rows = getRows(out)

      // Both rows have exactly 3 cells.
      expect(cellsOf(rows[0])).toHaveLength(3)
      expect(cellsOf(rows[1])).toHaveLength(3)

      // The orphan cell is gone entirely.
      const allIds = rows.flatMap((r) => cellsOf(r).map((c) => c.id))
      expect(allIds, 'orphan cell dropped').not.toContain('cell-orphan')

      // The surviving cells are the three valid ones, in column order.
      expect(cellsOf(rows[0]).map((c) => c.content?.[0]?.text)).toEqual(['r0c0', 'r0c1', 'r0c2'])

      editor._tiptapEditor.destroy()
    })

    it('a cell with no columnId is also dropped', () => {
      // A cell missing its columnId entirely.
      const table = buildConflictTable(3, [
        cellWithColumnId('cell-0-0', 'col-0', 'r0c0'),
        cellWithColumnId('cell-0-1', 'col-1', 'r0c1'),
        cellWithColumnId('cell-0-2', 'col-2', 'r0c2'),
        {
          id: 'cell-no-colid',
          type: 'paragraph' as const,
          props: {}, // no columnId
          content: [{type: 'text' as const, text: 'NOCOL', styles: {}}],
          children: [],
        },
      ])
      const editor = createEditor([table])

      const rows = getRows(getTable(editor))
      expect(cellsOf(rows[0])).toHaveLength(3)
      const allIds = rows.flatMap((r) => cellsOf(r).map((c) => c.id))
      expect(allIds).not.toContain('cell-no-colid')

      editor._tiptapEditor.destroy()
    })
  })
})
