import {BlockNoteEditor} from '@shm/editor/blocknote/core'
import {MarkdownToBlocks} from '@shm/editor/blocknote/core/extensions/Markdown/MarkdownToBlocks'
import {describe, expect, it} from 'vitest'
import {hmBlockSchema} from '../editor/schema'

/**
 * Regression test for markdown file import dropping tables.
 *
 * This asserts the import path (desktop schema to MarkdownToBlocks) reconstructs
 * a real table, guarding against the schema drifting back out of sync.
 */
describe('markdown file import: tables', () => {
  function createImportEditor() {
    // Mirrors the editor the desktop importer constructs
    return new BlockNoteEditor({blockSchema: hmBlockSchema})
  }

  it('imports a GFM table as a table block', async () => {
    const markdown = `| Name | Age |
| ---- | --- |
| Bob | 30 |
| Ana | 27 |`

    const editor = createImportEditor()
    const blocks = await MarkdownToBlocks(markdown, editor)

    const table = blocks.find((b: any) => b.type === 'table')
    expect(table, 'a table block must survive markdown import').toBeDefined()

    const columns = (table!.children ?? []).filter((c: any) => c.type === 'tableColumn')
    const rows = (table!.children ?? []).filter((c: any) => c.type === 'tableRow')
    expect(columns.length).toBe(2)
    expect(rows.length).toBe(3) // header row and two data rows

    // The header row carries every cell as a header.
    const flatText = JSON.stringify(table)
    expect(flatText).toContain('Name')
    expect(flatText).toContain('Age')
    expect(flatText).toContain('Bob')
    expect(flatText).toContain('27')
  })

  it('imports a table with no outer pipes (loose GFM syntax)', async () => {
    const markdown = `First Header  | Second Header
------------- | -------------
Content Cell  | Content Cell`

    const editor = createImportEditor()
    const blocks = await MarkdownToBlocks(markdown, editor)

    const table = blocks.find((b: any) => b.type === 'table')
    expect(table, 'a loose-syntax table must import as a table block').toBeDefined()
  })

  it('registers the table node in the import editor schema', () => {
    const editor = createImportEditor()
    const nodes = editor._tiptapEditor.state.schema.nodes
    // The block node plus its GFM children must all be present for <table> HTML
    // to parse into structured content.
    expect(nodes.table, 'table node missing from import editor schema').toBeDefined()
    expect(nodes.tableRow).toBeDefined()
    expect(nodes.tableCell).toBeDefined()
    expect(nodes.tableHeader).toBeDefined()
    expect(nodes.slot, 'slot node missing from import editor schema').toBeDefined()
  })
})
