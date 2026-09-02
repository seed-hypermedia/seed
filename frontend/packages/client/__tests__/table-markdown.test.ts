import {describe, it, expect} from 'vitest'
import {blocksToMarkdown} from '../src/blocks-to-markdown'
import {parseMarkdown, markdownBlockNodesToHMBlockNodes, flattenToOperations} from '../src/markdown-to-blocks'
import type {BlockNode} from '../src/markdown-to-blocks'
import {
  createBlocksMap,
  computeReplaceOps,
  rebindTableIdentities,
  toAPIBlockNode,
  hmBlockNodeToBlockNode,
  type APIBlockNode,
} from '../src/block-diff'
import type {HMBlockNode, HMDocument} from '../src/hm-types'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function doc(content: HMBlockNode[]): HMDocument {
  return {
    account: 'test',
    path: '',
    version: 'v1',
    metadata: {},
    authors: [],
    content,
    createTime: {seconds: 0n, nanos: 0},
    updateTime: {seconds: 0n, nanos: 0},
    genesis: 'g1',
  } as unknown as HMDocument
}

function para(id: string, text: string, attributes: Record<string, unknown> = {}): HMBlockNode {
  return {
    block: {type: 'Paragraph', id, text, annotations: [], attributes, link: '', revision: ''},
    children: [],
  } as unknown as HMBlockNode
}

function cell(id: string, text: string, columnId: string): HMBlockNode {
  return para(id, text, {columnId})
}

/** A 2-column table: header row (Name, Age) + rows (Alice 30, Bob 25). */
function sampleTable(): HMBlockNode {
  return {
    block: {type: 'Table', id: 'TBL00001', text: '', annotations: [], attributes: {}, link: '', revision: ''},
    children: [
      {
        block: {
          type: 'TableColumn',
          id: 'COL00001',
          text: '',
          annotations: [],
          attributes: {width: 120},
          link: '',
          revision: '',
        },
        children: [],
      },
      {
        block: {type: 'TableColumn', id: 'COL00002', text: '', annotations: [], attributes: {}, link: '', revision: ''},
        children: [],
      },
      {
        block: {
          type: 'TableRow',
          id: 'ROW00001',
          text: '',
          annotations: [],
          attributes: {isHeader: true},
          link: '',
          revision: '',
        },
        children: [cell('CELL0001', 'Name', 'COL00001'), cell('CELL0002', 'Age', 'COL00002')],
      },
      {
        block: {type: 'TableRow', id: 'ROW00002', text: '', annotations: [], attributes: {}, link: '', revision: ''},
        children: [cell('CELL0003', 'Alice', 'COL00001'), cell('CELL0004', '30', 'COL00002')],
      },
      {
        block: {type: 'TableRow', id: 'ROW00003', text: '', annotations: [], attributes: {}, link: '', revision: ''},
        children: [cell('CELL0005', 'Bob', 'COL00001'), cell('CELL0006', '25', 'COL00002')],
      },
    ],
  } as unknown as HMBlockNode
}

function findByType(nodes: HMBlockNode[], type: string): HMBlockNode[] {
  const out: HMBlockNode[] = []
  for (const node of nodes) {
    if (node.block.type === type) out.push(node)
    out.push(...findByType(node.children || [], type))
  }
  return out
}

function opsOfType(ops: ReturnType<typeof computeReplaceOps>, type: string) {
  return ops.filter((op) => op.type === type)
}

// ─── Emission ────────────────────────────────────────────────────────────────

describe('table emission', () => {
  it('emits the identity-carrying GFM dialect with row ids inside the last cell', () => {
    const md = blocksToMarkdown(doc([sampleTable()]))
    expect(md).toContain('<!-- id:TBL00001 -->')
    expect(md).toContain(
      '| Name <!-- col:COL00001 attrs:{"width":120} --> | Age <!-- col:COL00002 --> <!-- id:ROW00001 --> |',
    )
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| Alice | 30 <!-- id:ROW00002 --> |')
    expect(md).toContain('| Bob | 25 <!-- id:ROW00003 --> |')
    // Cell block ids never appear in markdown
    expect(md).not.toContain('CELL')
  })

  it('every emitted table line has the same strict-GFM cell count as the delimiter row', () => {
    // Strict GFM refuses the whole table when the header row's cell count
    // differs from the delimiter row's — ids must never add cells.
    const md = blocksToMarkdown(doc([sampleTable()]))
    const tableLines = md.split('\n').filter((line) => line.trim().startsWith('|'))
    const cellCount = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length
    const counts = tableLines.map(cellCount)
    expect(counts).toEqual([2, 2, 2, 2])
  })

  it('emits an all-empty header row for headerless tables', () => {
    const table = sampleTable()
    // Remove isHeader from the first row → headerless table
    const header = table.children![2]!
    ;(header.block as {attributes?: Record<string, unknown>}).attributes = {}
    const md = blocksToMarkdown(doc([table]))
    expect(md).toContain('| <!-- col:COL00001 attrs:{"width":120} --> | <!-- col:COL00002 --> |')
    // The previously-header row now emits as a body row with its id
    expect(md).toContain('| Name | Age <!-- id:ROW00001 --> |')
  })

  it('orders cells by column order regardless of child order, drops orphans, renders missing cells empty', () => {
    const table = sampleTable()
    const rowTwo = table.children![3]!
    // Reverse cell order and add an orphan cell; remove the Age cell
    rowTwo.children = [cell('CELL0099', 'orphan', 'COLNOPE'), cell('CELL0004', '30', 'COL00002')]
    const md = blocksToMarkdown(doc([table]))
    expect(md).toContain('|  | 30 <!-- id:ROW00002 --> |')
    expect(md).not.toContain('orphan')
  })

  it('escapes pipes and newlines in cell text', () => {
    const table = sampleTable()
    const rowTwo = table.children![3]!
    rowTwo.children = [cell('CELL0003', 'a|b', 'COL00001'), cell('CELL0004', 'line1\nline2', 'COL00002')]
    const md = blocksToMarkdown(doc([table]))
    expect(md).toContain('| a\\|b | line1<br>line2 <!-- id:ROW00002 --> |')
  })

  it('keeps a table with no columns as a typed comment line', () => {
    const table: HMBlockNode = {
      block: {type: 'Table', id: 'TBLEMPTY', text: '', annotations: [], attributes: {}, link: '', revision: ''},
      children: [],
    } as unknown as HMBlockNode
    const md = blocksToMarkdown(doc([table, para('AFTER001', 'after')]))
    expect(md).toContain('<!-- id:TBLEMPTY type:Table -->')
    expect(md).toContain('after <!-- id:AFTER001 -->')
  })
})

// ─── Parsing ─────────────────────────────────────────────────────────────────

describe('table parsing', () => {
  it('parses a plain GFM table into the HM table encoding', () => {
    const md = `| Name | Age |\n| --- | --- |\n| Alice | 30 |\n| Bob | 25 |`
    const {tree} = parseMarkdown(md)
    const nodes = markdownBlockNodesToHMBlockNodes(tree)

    expect(nodes).toHaveLength(1)
    const table = nodes[0]!
    expect(table.block.type).toBe('Table')

    const cols = findByType([table], 'TableColumn')
    const rows = findByType([table], 'TableRow')
    expect(cols).toHaveLength(2)
    expect(rows).toHaveLength(3)

    // Columns come before rows in child order
    expect(table.children!.slice(0, 2).map((c) => c.block.type)).toEqual(['TableColumn', 'TableColumn'])

    // Header row is row 0 with isHeader
    expect((rows[0]!.block as {attributes?: Record<string, unknown>}).attributes?.isHeader).toBe(true)
    expect((rows[1]!.block as {attributes?: Record<string, unknown>}).attributes?.isHeader).toBeUndefined()

    // Every cell references a real column id
    const colIds = new Set(cols.map((c) => c.block.id))
    for (const row of rows) {
      expect(row.children).toHaveLength(2)
      for (const cellNode of row.children!) {
        expect(cellNode.block.type).toBe('Paragraph')
        const columnId = (cellNode.block as {attributes?: Record<string, unknown>}).attributes?.columnId
        expect(colIds.has(columnId as string)).toBe(true)
      }
    }

    expect(rows[1]!.children![0]!.block.text).toBe('Alice')
    expect(rows[2]!.children![1]!.block.text).toBe('25')
  })

  it('preserves table, column, and row ids from dialect comments', () => {
    const md = [
      '<!-- id:TBL00001 -->',
      '| Name <!-- col:COL00001 --> | Age <!-- col:COL00002 --> | <!-- id:ROW00001 -->',
      '| --- | --- |',
      '| Alice | 30 | <!-- id:ROW00002 -->',
    ].join('\n')
    const {tree} = parseMarkdown(md)
    const nodes = markdownBlockNodesToHMBlockNodes(tree)
    const table = nodes[0]!
    expect(table.block.id).toBe('TBL00001')
    expect(findByType([table], 'TableColumn').map((c) => c.block.id)).toEqual(['COL00001', 'COL00002'])
    expect(findByType([table], 'TableRow').map((r) => r.block.id)).toEqual(['ROW00001', 'ROW00002'])
  })

  it('reads row ids from inside the last cell (v2) and after the final pipe (v1)', () => {
    const md = [
      '<!-- id:TBL00001 -->',
      '| Name <!-- col:COL00001 --> | Age <!-- col:COL00002 --> <!-- id:ROW00001 --> |',
      '| --- | --- |',
      '| Alice | 30 <!-- id:ROW00002 --> |',
      '| Bob | 25 | <!-- id:ROW00003 -->',
    ].join('\n')
    const {tree} = parseMarkdown(md)
    const nodes = markdownBlockNodesToHMBlockNodes(tree)
    const rows = findByType(nodes, 'TableRow')
    expect(rows.map((r) => r.block.id)).toEqual(['ROW00001', 'ROW00002', 'ROW00003'])
    // Comments never leak into cell text
    expect(rows[1]!.children!.map((c) => c.block.text)).toEqual(['Alice', '30'])
    expect(rows[0]!.children!.map((c) => c.block.text)).toEqual(['Name', 'Age'])
  })

  it('treats an all-empty header row as headerless', () => {
    const md = ['| <!-- col:COL00001 --> | <!-- col:COL00002 --> |', '| --- | --- |', '| Alice | 30 |'].join('\n')
    const {tree} = parseMarkdown(md)
    const nodes = markdownBlockNodesToHMBlockNodes(tree)
    const rows = findByType(nodes, 'TableRow')
    expect(rows).toHaveLength(1)
    expect((rows[0]!.block as {attributes?: Record<string, unknown>}).attributes?.isHeader).toBeUndefined()
    expect(rows[0]!.children![0]!.block.text).toBe('Alice')
  })

  it('handles ragged rows by expanding to the widest row', () => {
    const md = `| A | B |\n| --- | --- |\n| 1 | 2 | 3 |\n| 4 |`
    const {tree} = parseMarkdown(md)
    const nodes = markdownBlockNodesToHMBlockNodes(tree)
    const cols = findByType(nodes, 'TableColumn')
    expect(cols).toHaveLength(3)
    const rows = findByType(nodes, 'TableRow')
    // Every row is dense: one cell per column
    for (const row of rows) expect(row.children).toHaveLength(3)
    expect(rows[2]!.children!.map((c) => c.block.text)).toEqual(['4', '', ''])
  })

  it('unescapes pipes and <br> in cells', () => {
    const md = `| A |\n| --- |\n| a\\|b<br>c |`
    const {tree} = parseMarkdown(md)
    const nodes = markdownBlockNodesToHMBlockNodes(tree)
    const rows = findByType(nodes, 'TableRow')
    expect(rows[1]!.children![0]!.block.text).toBe('a|b\nc')
  })

  it('parses inline formatting inside cells', () => {
    const md = `| A |\n| --- |\n| **bold** move |`
    const {tree} = parseMarkdown(md)
    const nodes = markdownBlockNodesToHMBlockNodes(tree)
    const rows = findByType(nodes, 'TableRow')
    const cellBlock = rows[1]!.children![0]!.block as {text: string; annotations: {type: string}[]}
    expect(cellBlock.text).toBe('bold move')
    expect(cellBlock.annotations[0]!.type).toBe('Bold')
  })

  it('flattenToOperations inlines table attributes at the top level', () => {
    const md = `| A |\n| --- |\n| 1 |`
    const {tree} = parseMarkdown(md)
    const ops = flattenToOperations(tree)
    const replaceOps = ops.filter((op) => op.type === 'ReplaceBlock') as {block: Record<string, unknown>}[]
    const cellOp = replaceOps.find((op) => op.block.type === 'Paragraph' && op.block.columnId)
    expect(cellOp).toBeDefined()
    const rowOp = replaceOps.find((op) => op.block.type === 'TableRow' && op.block.isHeader === true)
    expect(rowOp).toBeDefined()
  })
})

// ─── Round trip ──────────────────────────────────────────────────────────────

describe('table round trip', () => {
  it('markdown → blocks → markdown is stable', () => {
    const md1 = blocksToMarkdown(doc([sampleTable()]))
    const {tree} = parseMarkdown(md1)
    const nodes = markdownBlockNodesToHMBlockNodes(tree)
    const table = nodes.find((n) => n.block.type === 'Table')!
    expect(table.block.id).toBe('TBL00001')
    expect(findByType([table], 'TableColumn').map((c) => c.block.id)).toEqual(['COL00001', 'COL00002'])
    expect(findByType([table], 'TableRow').map((r) => r.block.id)).toEqual(['ROW00001', 'ROW00002', 'ROW00003'])
    // Cell contents survive
    const rows = findByType([table], 'TableRow')
    expect(rows[1]!.children!.map((c) => c.block.text)).toEqual(['Alice', '30'])
  })
})

// ─── Diffing / updates ──────────────────────────────────────────────────────

/** Run the full update pipeline: old doc + edited markdown → ops. */
function diffAgainst(oldContent: HMBlockNode[], newMarkdown: string) {
  const oldNodes: APIBlockNode[] = oldContent.map((node) => toAPIBlockNode(node))
  const oldMap = createBlocksMap(oldNodes)
  const {tree} = parseMarkdown(newMarkdown)
  const rebound = rebindTableIdentities(oldNodes, tree as BlockNode[])
  return {ops: computeReplaceOps(oldMap, rebound), rebound}
}

describe('table update diffing', () => {
  it('a single cell edit produces exactly one ReplaceBlock reusing the old cell id', () => {
    const oldDoc = [sampleTable()]
    const md = blocksToMarkdown(doc(oldDoc)).replace('| Alice | 30 <', '| Alice | 31 <')
    const {ops} = diffAgainst(oldDoc, md)

    const replaces = opsOfType(ops, 'ReplaceBlock') as {block: {id: string; text: string}}[]
    expect(replaces).toHaveLength(1)
    expect(replaces[0]!.block.id).toBe('CELL0004')
    expect(replaces[0]!.block.text).toBe('31')
    expect(opsOfType(ops, 'DeleteBlocks')).toHaveLength(0)
  })

  it('editing an unrelated paragraph leaves the table untouched', () => {
    const oldDoc = [sampleTable(), para('PARA0001', 'hello world')]
    const md = blocksToMarkdown(doc(oldDoc)).replace('hello world', 'goodbye world')
    const {ops} = diffAgainst(oldDoc, md)

    const replaces = opsOfType(ops, 'ReplaceBlock') as {block: {id: string}}[]
    expect(replaces).toHaveLength(1)
    expect(replaces[0]!.block.id).toBe('PARA0001')
    expect(opsOfType(ops, 'DeleteBlocks')).toHaveLength(0)
  })

  it('preserves column width and header-column attributes markdown cannot express', () => {
    const oldDoc = [sampleTable()]
    const md = blocksToMarkdown(doc(oldDoc)).replace('| Alice | 30 <', '| Alice | 31 <')
    const {rebound} = diffAgainst(oldDoc, md)
    const tables = rebound.filter((n) => n.block.type === 'Table')
    const col = tables[0]!.children.find((c) => c.block.id === 'COL00001')!
    expect(col.block.attributes?.width).toBe(120)
  })

  it('deleting a column deletes the TableColumn and every cell referencing it', () => {
    const oldDoc = [sampleTable()]
    // Rewrite the table with only the Name column
    const md = [
      '<!-- id:TBL00001 -->',
      '| Name <!-- col:COL00001 --> | <!-- id:ROW00001 -->',
      '| --- |',
      '| Alice | <!-- id:ROW00002 -->',
      '| Bob | <!-- id:ROW00003 -->',
    ].join('\n')
    const {ops} = diffAgainst(oldDoc, md)

    const deletes = opsOfType(ops, 'DeleteBlocks') as {blocks: string[]}[]
    const deleted = new Set(deletes.flatMap((d) => d.blocks))
    expect(deleted.has('COL00002')).toBe(true)
    expect(deleted.has('CELL0002')).toBe(true)
    expect(deleted.has('CELL0004')).toBe(true)
    expect(deleted.has('CELL0006')).toBe(true)
    // Nothing else deleted
    expect(deleted.size).toBe(4)
  })

  it('deleting a row cascades to its cells', () => {
    const oldDoc = [sampleTable()]
    const md = blocksToMarkdown(doc(oldDoc))
      .split('\n')
      .filter((line) => !line.includes('ROW00003'))
      .join('\n')
    const {ops} = diffAgainst(oldDoc, md)

    const deletes = opsOfType(ops, 'DeleteBlocks') as {blocks: string[]}[]
    const deleted = new Set(deletes.flatMap((d) => d.blocks))
    expect(deleted.has('ROW00003')).toBe(true)
    expect(deleted.has('CELL0005')).toBe(true)
    expect(deleted.has('CELL0006')).toBe(true)
    expect(deleted.size).toBe(3)
  })

  it('inserting a row keeps surrounding row ids and only creates the new blocks', () => {
    const oldDoc = [sampleTable()]
    const md = blocksToMarkdown(doc(oldDoc)).replace(
      '| Bob | 25 <!-- id:ROW00003 --> |',
      '| Carol | 41 |\n| Bob | 25 <!-- id:ROW00003 --> |',
    )
    const {ops} = diffAgainst(oldDoc, md)

    expect(opsOfType(ops, 'DeleteBlocks')).toHaveLength(0)
    const replaces = opsOfType(ops, 'ReplaceBlock') as {block: {type: string; id: string}}[]
    // New TableRow + 2 new cells, nothing else
    expect(replaces.filter((op) => op.block.type === 'TableRow')).toHaveLength(1)
    expect(replaces.filter((op) => op.block.type === 'Paragraph')).toHaveLength(2)
    expect(replaces.some((op) => op.block.id === 'ROW00002' || op.block.id === 'ROW00003')).toBe(false)
  })

  it('reordering columns via col: comments moves identity with the header cells', () => {
    const oldDoc = [sampleTable()]
    const md = [
      '<!-- id:TBL00001 -->',
      '| Age <!-- col:COL00002 --> | Name <!-- col:COL00001 --> | <!-- id:ROW00001 -->',
      '| --- | --- |',
      '| 30 | Alice | <!-- id:ROW00002 -->',
      '| 25 | Bob | <!-- id:ROW00003 -->',
    ].join('\n')
    const {ops, rebound} = diffAgainst(oldDoc, md)

    // Column order flipped in the rebound tree
    const table = rebound.find((n) => n.block.type === 'Table')!
    const colOrder = table.children.filter((c) => c.block.type === 'TableColumn').map((c) => c.block.id)
    expect(colOrder).toEqual(['COL00002', 'COL00001'])

    // Cells keep their ids: no deletes, no cell replaces (contents unchanged)
    expect(opsOfType(ops, 'DeleteBlocks')).toHaveLength(0)
    const replaces = opsOfType(ops, 'ReplaceBlock') as {block: {id: string}}[]
    expect(replaces).toHaveLength(0)
  })

  it('matches columns by header text when col: comments were dropped', () => {
    const oldDoc = [sampleTable()]
    // Agent rewrote the table as plain GFM but kept the table id comment
    const md = ['<!-- id:TBL00001 -->', '| Name | Age |', '| --- | --- |', '| Alice | 31 |', '| Bob | 25 |'].join('\n')
    const {ops} = diffAgainst(oldDoc, md)

    expect(opsOfType(ops, 'DeleteBlocks')).toHaveLength(0)
    const replaces = opsOfType(ops, 'ReplaceBlock') as {block: {id: string; text: string}}[]
    expect(replaces).toHaveLength(1)
    expect(replaces[0]!.block.id).toBe('CELL0004')
    expect(replaces[0]!.block.text).toBe('31')
  })

  it('a fresh table with no old counterpart passes through with generated identity', () => {
    const oldDoc = [para('PARA0001', 'intro')]
    const md = ['intro <!-- id:PARA0001 -->', '', '| X | Y |', '| --- | --- |', '| 1 | 2 |'].join('\n')
    const {ops} = diffAgainst(oldDoc, md)

    expect(opsOfType(ops, 'DeleteBlocks')).toHaveLength(0)
    const replaces = opsOfType(ops, 'ReplaceBlock') as {block: {type: string}}[]
    const types = replaces.map((op) => op.block.type).sort()
    // 1 Table + 2 TableColumn + 2 TableRow + 4 cells
    expect(types.filter((t) => t === 'Table')).toHaveLength(1)
    expect(types.filter((t) => t === 'TableColumn')).toHaveLength(2)
    expect(types.filter((t) => t === 'TableRow')).toHaveLength(2)
    expect(types.filter((t) => t === 'Paragraph')).toHaveLength(4)
  })

  it('the agents write-verb chain (md → HMBlockNode → BlockNode → rebind → ops) edits one cell cleanly', () => {
    // Mirrors agents writeDocumentUpdate: parsed markdown goes through
    // markdownBlockNodesToHMBlockNodes then hmBlockNodeToBlockNode before
    // rebinding, unlike the CLI which feeds the parse tree directly.
    const oldDoc = [sampleTable()]
    const oldNodes = oldDoc.map((node) => toAPIBlockNode(node))
    const oldMap = createBlocksMap(oldNodes)

    const md = blocksToMarkdown(doc(oldDoc)).replace('| Bob | 25 <', '| Bob | 26 <')
    const {tree} = parseMarkdown(md)
    const hmNodes = markdownBlockNodesToHMBlockNodes(tree)
    const newTree = rebindTableIdentities(
      oldNodes,
      hmNodes.map((node) => hmBlockNodeToBlockNode(node)),
    )
    const ops = computeReplaceOps(oldMap, newTree)

    const replaces = opsOfType(ops, 'ReplaceBlock') as {block: {id: string; text: string; columnId?: string}}[]
    expect(replaces).toHaveLength(1)
    expect(replaces[0]!.block.id).toBe('CELL0006')
    expect(replaces[0]!.block.text).toBe('26')
    // columnId is inlined at the top level of the wire block
    expect(replaces[0]!.block.columnId).toBe('COL00002')
    expect(opsOfType(ops, 'DeleteBlocks')).toHaveLength(0)
  })

  it('hmBlockNodeToBlockNode preserves table attributes for the JSON update path', () => {
    const node = hmBlockNodeToBlockNode(sampleTable())
    const col = node.children.find((c) => c.block.id === 'COL00001')!
    expect(col.block.attributes?.width).toBe(120)
    const row = node.children.find((c) => c.block.id === 'ROW00001')!
    expect(row.block.attributes?.isHeader).toBe(true)
    expect(row.children[0]!.block.attributes?.columnId).toBe('COL00001')
  })
})
