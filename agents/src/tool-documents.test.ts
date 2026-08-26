import {Database} from 'bun:sqlite'
import {afterEach, describe, expect, test} from 'bun:test'
import * as sqlite from '@/sqlite'
import * as toolDocs from '@/tool-documents'

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

function makeDb(): Database {
  const db = new Database(':memory:')
  sqlite.openWithDatabase(db)
  const now = Date.now()
  db.run(`INSERT INTO accounts (id, created_at, updated_at) VALUES (?, ?, ?)`, ['acct', now, now])
  db.run(
    `INSERT INTO agents (id, account_id, definition_cbor, state_dir, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['agent', 'acct', new Uint8Array([160]), 'x', 'ready', now, now],
  )
  cleanups.push(() => db.close())
  return db
}

describe('tool documents', () => {
  test('builtin upsert is idempotent with stable CIDs', () => {
    const db = makeDb()
    toolDocs.ensureBuiltinToolDocuments(db, 'acct', 'agent')
    const first = toolDocs.listToolDocuments(db, 'acct', 'agent')
    expect(first.map((row) => row.doc.name)).toEqual(['execute', 'search', 'web_search'])
    expect(first.every((row) => row.doc.kind === 'builtin' && row.cid.startsWith('b'))).toBe(true)

    toolDocs.ensureBuiltinToolDocuments(db, 'acct', 'agent')
    const second = toolDocs.listToolDocuments(db, 'acct', 'agent')
    expect(second.map((row) => [row.doc.name, row.cid, row.updatedAt])).toEqual(
      first.map((row) => [row.doc.name, row.cid, row.updatedAt]),
    )
  })

  test('a drifted builtin row is refreshed back to the registry contract', () => {
    const db = makeDb()
    toolDocs.ensureBuiltinToolDocuments(db, 'acct', 'agent')
    db.run(`UPDATE tool_documents SET cid = 'stale' WHERE name = 'search'`)
    toolDocs.ensureBuiltinToolDocuments(db, 'acct', 'agent')
    const row = toolDocs.getToolDocument(db, 'acct', 'agent', 'search')
    expect(row?.cid).not.toBe('stale')
  })

  test('lambda save validates name, source, and schemas; builtins are protected', () => {
    const db = makeDb()
    toolDocs.ensureBuiltinToolDocuments(db, 'acct', 'agent')
    const good = {
      name: 'csv_to_table',
      description: 'Convert CSV text into a markdown table.',
      input: {type: 'object', properties: {csv: {type: 'string'}}, required: ['csv']},
      source: 'export default async function (input) { return {ok: true} }',
    }
    const saved = toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', good)
    expect(saved.doc.kind).toBe('lambda')
    expect(saved.doc.runtime).toBe('typescript')
    expect(saved.doc.summary).toContain('Convert CSV')

    // Same content → same CID (content addressing), different content → different CID.
    const again = toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', good)
    expect(again.cid).toBe(saved.cid)
    const changed = toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {...good, source: good.source + ' '})
    expect(changed.cid).not.toBe(saved.cid)

    expect(() => toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {...good, name: 'Bad Name'})).toThrow('lowercase')
    expect(() => toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {...good, name: 'search'})).toThrow('builtin')
    expect(() => toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {...good, source: ''})).toThrow('source')
    expect(() => toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {...good, input: {type: 'wat'}})).toThrow(
      'schema',
    )
  })

  test('delete removes lambdas and refuses builtins', () => {
    const db = makeDb()
    toolDocs.ensureBuiltinToolDocuments(db, 'acct', 'agent')
    toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {
      name: 'tmp_tool',
      description: 'Temp.',
      input: {type: 'object'},
      source: 'export default async () => 1',
    })
    expect(toolDocs.deleteToolDocument(db, 'acct', 'agent', 'tmp_tool')).toBe(true)
    expect(toolDocs.deleteToolDocument(db, 'acct', 'agent', 'tmp_tool')).toBe(false)
    expect(() => toolDocs.deleteToolDocument(db, 'acct', 'agent', 'search')).toThrow('builtin')
  })

  test('contract markdown carries version, schemas, and lambda source', () => {
    const db = makeDb()
    const saved = toolDocs.saveLambdaToolDocument(db, 'acct', 'agent', {
      name: 'noop',
      description: 'Does nothing, reliably.',
      input: {type: 'object'},
      output: {type: 'object', properties: {ok: {type: 'boolean'}}},
      source: 'export default async () => ({ok: true})',
    })
    const markdown = toolDocs.toolDocumentContractMarkdown(saved)
    expect(markdown).toContain('# noop')
    expect(markdown).toContain(saved.cid)
    expect(markdown).toContain('## Input schema')
    expect(markdown).toContain('## Output schema')
    expect(markdown).toContain('## Source')
  })
})
