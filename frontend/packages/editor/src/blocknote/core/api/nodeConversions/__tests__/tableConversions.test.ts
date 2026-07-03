import {Node as PMNode, Schema} from 'prosemirror-model'
import {describe, expect, it} from 'vitest'
import type {BlockSchema, PartialBlock} from '../../../extensions/Blocks/api/blockTypes'
import {blockToNode, nodeToBlock} from '../nodeConversions'

// Tests for the conversions between editor-block and ProseMirror trees.
const CELL_ATTRS = {
  id: {default: null},
  columnId: {default: null},
  colspan: {default: 1},
  rowspan: {default: 1},
  colwidth: {default: null},
}

// Minimal schema for tests.
function createTableSchema(): Schema {
  return new Schema({
    nodes: {
      doc: {content: 'blockChildren'},
      blockChildren: {
        content: 'blockNode+',
        attrs: {
          listType: {default: 'Group'},
          listLevel: {default: '1'},
          start: {default: null},
          columnCount: {default: null},
        },
      },
      blockNode: {content: 'blockContent blockChildren?', attrs: {id: {default: ''}}},
      paragraph: {content: 'inline*', group: 'blockContent', attrs: {revision: {default: ''}}},
      table: {content: 'tableRow+', group: 'blockContent'},
      tableRow: {content: '(tableCell | tableHeader)+', attrs: {id: {default: null}}},
      tableCell: {content: 'paragraph+', attrs: CELL_ATTRS},
      tableHeader: {content: 'paragraph+', attrs: CELL_ATTRS},
      text: {group: 'inline'},
    },
  })
}

const BLOCK_SCHEMA = {table: {propSchema: {}}} as unknown as BlockSchema
type CellSpec = {header?: boolean; columnId?: string; colwidth?: number; text?: string; id?: string}

// Build a simple table PM tree.
function buildPMTable(schema: Schema, rows: CellSpec[][], opts: {tableId?: string; rowIds?: string[]} = {}): PMNode {
  const rowNodes = rows.map((cells, r) => {
    const cellNodes = cells.map((c) => {
      const para = c.text
        ? schema.nodes.paragraph!.create(null, schema.text(c.text))
        : schema.nodes.paragraph!.createAndFill()!
      const typeName = c.header ? 'tableHeader' : 'tableCell'
      return schema.nodes[typeName]!.create(
        {
          id: c.id ?? null,
          columnId: c.columnId ?? null,
          colspan: 1,
          rowspan: 1,
          colwidth: c.colwidth != null ? [c.colwidth] : null,
        },
        para,
      )
    })
    return schema.nodes.tableRow!.create({id: opts.rowIds?.[r] ?? null}, cellNodes)
  })
  const table = schema.nodes.table!.create(null, rowNodes)
  return schema.nodes.blockNode!.create({id: opts.tableId ?? 'table-1'}, table)
}

// Read a PM table blockNode's cells as a grid.
function pmGrid(blockNode: PMNode) {
  const table = blockNode.firstChild!
  const grid: Array<Array<{type: string; text: string; id: any; columnId: any}>> = []
  table.forEach((row) => {
    if (row.type.name !== 'tableRow') return
    const cells: Array<{type: string; text: string; id: any; columnId: any}> = []
    row.forEach((cell) => {
      if (cell.type.name === 'tableCell' || cell.type.name === 'tableHeader') {
        cells.push({
          type: cell.type.name,
          text: cell.firstChild?.textContent ?? '',
          id: cell.attrs.id,
          columnId: cell.attrs.columnId,
        })
      }
    })
    grid.push(cells)
  })
  return grid
}

// Editor block builders.
function col(id: string, isHeader = false): PartialBlock<any> {
  return {id, type: 'tableColumn', props: isHeader ? {isHeader: true} : {}, content: [], children: []} as any
}

function cell(id: string, columnId: string, text?: string): PartialBlock<any> {
  return {
    id,
    type: 'paragraph',
    props: {columnId},
    content: text ? [{type: 'text', text, styles: {}}] : [],
    children: [],
  } as any
}

function row(id: string, cells: PartialBlock<any>[], isHeader = false): PartialBlock<any> {
  return {id, type: 'tableRow', props: isHeader ? {isHeader: true} : {}, content: [], children: cells} as any
}

function editorTable(cols: PartialBlock<any>[], rows: PartialBlock<any>[]): PartialBlock<any> {
  return {id: 'table-1', type: 'table', props: {}, content: [], children: [...cols, ...rows] as any} as any
}

function blockCols(block: any) {
  return (block.children ?? []).filter((c: any) => c.type === 'tableColumn')
}

function blockRows(block: any) {
  return (block.children ?? []).filter((c: any) => c.type === 'tableRow')
}

function blockCells(rowBlock: any) {
  return (rowBlock.children ?? []).filter((c: any) => c.type === 'paragraph')
}

describe('tableNodeToBlock (PM to editor block)', () => {
  const schema = createTableSchema()

  it('a header row derives TableRow[0].isHeader', () => {
    const pm = buildPMTable(schema, [
      [
        {header: true, text: 'a'},
        {header: true, text: 'b'},
      ],
      [{text: 'c'}, {text: 'd'}],
    ])

    const block = nodeToBlock(pm, BLOCK_SCHEMA)
    const rows = blockRows(block)
    const cols = blockCols(block)

    expect(rows[0].props?.isHeader).toBe(true)
    expect(rows[1].props?.isHeader).toBeFalsy()
    expect(cols.every((c: any) => !c.props?.isHeader)).toBe(true)
  })

  it('a header column derives TableColumn[0].isHeader', () => {
    const pm = buildPMTable(schema, [
      [{header: true, text: 'a'}, {text: 'b'}],
      [{header: true, text: 'c'}, {text: 'd'}],
    ])

    const block = nodeToBlock(pm, BLOCK_SCHEMA)
    const rows = blockRows(block)
    const cols = blockCols(block)

    expect(cols[0].props?.isHeader).toBe(true)
    expect(cols[1].props?.isHeader).toBeFalsy()
    expect(rows.every((r: any) => !r.props?.isHeader)).toBe(true)
  })

  it('a stray tableHeader at a non-zero position does not leak isHeader', () => {
    // Only cell (1,1) is a header. Neither row 0 nor col 0 is fully header.
    const pm = buildPMTable(schema, [
      [{text: 'a'}, {text: 'b'}],
      [{text: 'c'}, {header: true, text: 'd'}],
    ])

    const block = nodeToBlock(pm, BLOCK_SCHEMA)
    expect(blockRows(block).every((r: any) => !r.props?.isHeader)).toBe(true)
    expect(blockCols(block).every((c: any) => !c.props?.isHeader)).toBe(true)
  })

  it('a cell colwidth is surfaced as the TableColumn width prop', () => {
    const pm = buildPMTable(schema, [
      [
        {columnId: 'col-0', colwidth: 120, text: 'a'},
        {columnId: 'col-1', text: 'b'},
      ],
      [
        {columnId: 'col-0', text: 'c'},
        {columnId: 'col-1', text: 'd'},
      ],
    ])

    const block = nodeToBlock(pm, BLOCK_SCHEMA)
    const cols = blockCols(block)
    expect(cols[0].props?.width).toBe('120')
    expect(cols[1].props?.width).toBeUndefined()
  })
})

describe('tableBlockToNode (editor block to PM)', () => {
  const schema = createTableSchema()

  it('a missing cell is synthesized as an empty tableCell and header row stays tableHeader', () => {
    const table = editorTable(
      [col('col-0'), col('col-1'), col('col-2')],
      [
        row('row-0', [cell('c00', 'col-0', 'h0'), cell('c01', 'col-1', 'h1'), cell('c02', 'col-2', 'h2')], true),
        // row 1 is missing the col-1 cell.
        row('row-1', [cell('c10', 'col-0', 'a'), cell('c12', 'col-2', 'c')]),
      ],
    )

    const pm = blockToNode(table, schema)
    const grid = pmGrid(pm)

    expect(grid[0]).toHaveLength(3)
    expect(grid[1]).toHaveLength(3)
    // Row 0 is the header row.
    expect(grid[0]!.map((c) => c.type)).toEqual(['tableHeader', 'tableHeader', 'tableHeader'])
    // Row 1's missing (1,1) is synthesized as an empty tableCell.
    expect(grid[1]!.map((c) => c.type)).toEqual(['tableCell', 'tableCell', 'tableCell'])
    expect(grid[1]!.map((c) => c.text)).toEqual(['a', '', 'c'])
  })

  it('an orphan cell (columnId matching no column) is dropped and replaced by an empty cell', () => {
    const table = editorTable(
      [col('col-0'), col('col-1'), col('col-2')],
      [
        // row 0 has col-0, an ORPHAN (col-X), and col-2 — col-1 has no cell.
        row('row-0', [cell('c00', 'col-0', 'a'), cell('orphan', 'col-X', 'ORPHAN'), cell('c02', 'col-2', 'c')]),
        row('row-1', [cell('c10', 'col-0', 'd'), cell('c11', 'col-1', 'e'), cell('c12', 'col-2', 'f')]),
      ],
    )

    const pm = blockToNode(table, schema)
    const grid = pmGrid(pm)

    // Still 3 columns. The orphan is gone and col-1's slot in row 0 is empty.
    expect(grid[0]).toHaveLength(3)
    expect(grid[0]!.map((c) => c.text)).toEqual(['a', '', 'c'])
    const allIds = grid.flat().map((c) => c.id)
    expect(allIds).not.toContain('orphan')
  })

  it('preserves paragraph props on table cells while keeping columnId on the cell node', () => {
    const table = editorTable(
      [col('col-0')],
      [
        row('row-0', [
          {
            ...cell('c00', 'col-0', 'a'),
            props: {columnId: 'col-0', revision: 'rev-cell-1'},
          } as any,
        ]),
      ],
    )

    const pm = blockToNode(table, schema)
    const tableNode = pm.firstChild!
    const cellNode = tableNode.firstChild!.firstChild!
    const paragraphNode = cellNode.firstChild!

    expect(cellNode.attrs.columnId).toBe('col-0')
    expect((cellNode.attrs as any).revision).toBeUndefined()
    expect(paragraphNode.attrs.revision).toBe('rev-cell-1')
  })
})

describe('round-trip', () => {
  const schema = createTableSchema()

  it('ids, columnId, text, and header flags survive the round-trip', () => {
    const original = editorTable(
      [col('col-0', true), col('col-1')],
      [
        row('row-0', [cell('c00', 'col-0', 'A'), cell('c01', 'col-1', 'B')], true),
        row('row-1', [cell('c10', 'col-0', 'C'), cell('c11', 'col-1', 'D')]),
      ],
    )

    const pm = blockToNode(original, schema)
    const back = nodeToBlock(pm, BLOCK_SCHEMA) as any

    const cols = blockCols(back)
    const rows = blockRows(back)

    // Column header flag survives.
    expect(cols.map((c: any) => c.id)).toEqual(['col-0', 'col-1'])
    expect(cols[0].props?.isHeader).toBe(true)
    expect(cols[1].props?.isHeader).toBeFalsy()

    // Row header flag survives.
    expect(rows.map((r: any) => r.id)).toEqual(['row-0', 'row-1'])
    expect(rows[0].props?.isHeader).toBe(true)
    expect(rows[1].props?.isHeader).toBeFalsy()

    // Cell ids, columnIds and text survive.
    const r0 = blockCells(rows[0])
    expect(r0.map((c: any) => c.id)).toEqual(['c00', 'c01'])
    expect(r0.map((c: any) => c.props?.columnId)).toEqual(['col-0', 'col-1'])
    expect(r0.map((c: any) => c.content?.[0]?.text)).toEqual(['A', 'B'])
    const r1 = blockCells(rows[1])
    expect(r1.map((c: any) => c.content?.[0]?.text)).toEqual(['C', 'D'])
  })
})
