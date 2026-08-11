/**
 * Tools as documents: every tool an agent holds is a content-addressed document in its Space,
 * stored per agent in `tool_documents`. Builtins are documents whose implementation is a runtime
 * binding; lambdas carry TypeScript/Python source (callable via the execute sandbox from M4).
 * A document's CID is computed over its canonical DAG-CBOR encoding — the same encoding the
 * hypermedia network uses for blobs — so "what exactly can this agent run" is always answerable
 * and publishing a tool to the network later is publishing bytes that already exist.
 */
import type {Database} from 'bun:sqlite'
import * as blobs from '@shm/shared/blobs'
import * as dagCbor from '@shm/shared/cbor'
import {callableToolRegistry, seedVerbRegistry, type JsonSchema, type SeedToolMetadata} from '@seed-hypermedia/agents-protocol'
import {validateJsonSchemaShape} from '@/json-schema'

export type ToolDocument = {
  name: string
  kind: 'builtin' | 'lambda'
  /** One line for the Space index and ~/tools listing. */
  summary: string
  /** Full model-facing instructions, shown on expansion. */
  description: string
  input: JsonSchema
  output?: JsonSchema
  /** Lambda source (TypeScript or Python), run in the execute sandbox. */
  source?: string
  /** Lambda source language; defaults to typescript. */
  runtime?: 'typescript' | 'python'
  /** Builtin executor id bound at boot; survives a fork of the document. */
  binding?: string
}

export type ToolDocumentRow = {
  doc: ToolDocument
  cid: string
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export class ToolDocumentError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const NAME_PATTERN = /^[a-z][a-z0-9_-]{1,63}$/
const MAX_SOURCE_BYTES = 256 * 1024
const MAX_TEXT_BYTES = 16 * 1024

/** Canonical encoding + CID. blobs.encode is typed for signed blobs but is structurally DAG-CBOR + CIDv1. */
export function encodeToolDocument(doc: ToolDocument): {cid: string; data: Uint8Array} {
  const {cid, data} = blobs.encode(doc as never)
  return {cid: cid.toString(), data}
}

/** One-line summary from a tool's description: its first sentence, bounded. */
function summaryFromDescription(description: string): string {
  const firstSentence = description.split(/(?<=\.)\s/, 1)[0] ?? description
  return firstSentence.length > 140 ? `${firstSentence.slice(0, 137)}…` : firstSentence
}

function builtinDocument(tool: SeedToolMetadata): ToolDocument {
  return {
    name: tool.name,
    kind: 'builtin',
    summary: summaryFromDescription(tool.description),
    description: tool.description,
    input: tool.inputSchema,
    ...(tool.outputSchema ? {output: tool.outputSchema} : {}),
    binding: tool.name,
  }
}

/**
 * Materializes/refreshes the builtin tool documents for one agent. Idempotent and cheap: rows are
 * rewritten only when the registry contract changed (CID differs). A forked builtin keeps its
 * binding but its divergence from the shipped contract is visible as a different CID.
 */
export function ensureBuiltinToolDocuments(db: Database, accountId: string, agentId: string): void {
  const now = Date.now()
  for (const tool of Object.values(callableToolRegistry as Record<string, SeedToolMetadata>)) {
    if (!tool.runtimes.includes('agent-service')) continue
    const doc = builtinDocument(tool)
    const {cid, data} = encodeToolDocument(doc)
    const existing = db
      .query<{cid: string}, [string, string, string]>(
        `SELECT cid FROM tool_documents WHERE account_id = ? AND agent_id = ? AND name = ?`,
      )
      .get(accountId, agentId, doc.name)
    if (existing?.cid === cid) continue
    db.run(
      `INSERT INTO tool_documents (account_id, agent_id, name, kind, cid, doc_cbor, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(account_id, agent_id, name) DO UPDATE SET
         kind = excluded.kind, cid = excluded.cid, doc_cbor = excluded.doc_cbor, updated_at = excluded.updated_at`,
      [accountId, agentId, doc.name, doc.kind, cid, data, now, now],
    )
  }
}

function rowToRecord(row: {
  doc_cbor: Uint8Array
  cid: string
  enabled: number
  created_at: number
  updated_at: number
}): ToolDocumentRow {
  return {
    doc: dagCbor.decode<ToolDocument>(row.doc_cbor),
    cid: row.cid,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listToolDocuments(db: Database, accountId: string, agentId: string): ToolDocumentRow[] {
  return db
    .query<
      {doc_cbor: Uint8Array; cid: string; enabled: number; created_at: number; updated_at: number},
      [string, string]
    >(
      `SELECT doc_cbor, cid, enabled, created_at, updated_at FROM tool_documents
       WHERE account_id = ? AND agent_id = ? ORDER BY name ASC`,
    )
    .all(accountId, agentId)
    .map(rowToRecord)
}

export function getToolDocument(
  db: Database,
  accountId: string,
  agentId: string,
  name: string,
): ToolDocumentRow | undefined {
  const row = db
    .query<
      {doc_cbor: Uint8Array; cid: string; enabled: number; created_at: number; updated_at: number},
      [string, string, string]
    >(
      `SELECT doc_cbor, cid, enabled, created_at, updated_at FROM tool_documents
       WHERE account_id = ? AND agent_id = ? AND name = ?`,
    )
    .get(accountId, agentId, name)
  return row ? rowToRecord(row) : undefined
}

/**
 * Validates and saves an authored (lambda) tool document. Builtins cannot be overwritten by name;
 * a lambda's contract must be sound before it is ever listed, because the index and the call verb
 * both trust stored documents.
 */
export function saveLambdaToolDocument(
  db: Database,
  accountId: string,
  agentId: string,
  raw: unknown,
): ToolDocumentRow {
  if (typeof raw !== 'object' || raw === null) throw new ToolDocumentError(400, 'Tool document must be an object')
  const input = raw as Record<string, unknown>
  const name = typeof input.name === 'string' ? input.name : ''
  if (!NAME_PATTERN.test(name)) {
    throw new ToolDocumentError(400, 'Tool name must be lowercase [a-z0-9_-], start with a letter, 2-64 chars')
  }
  if ((callableToolRegistry as Record<string, unknown>)[name] || (seedVerbRegistry as Record<string, unknown>)[name]) {
    throw new ToolDocumentError(400, `"${name}" is a builtin tool or verb and cannot be replaced`)
  }
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (!description) throw new ToolDocumentError(400, 'Tool document requires a description')
  if (new TextEncoder().encode(description).byteLength > MAX_TEXT_BYTES) {
    throw new ToolDocumentError(400, 'Tool description is too large')
  }
  const source = typeof input.source === 'string' ? input.source : ''
  if (!source.trim()) throw new ToolDocumentError(400, 'Lambda tool document requires source code')
  if (new TextEncoder().encode(source).byteLength > MAX_SOURCE_BYTES) {
    throw new ToolDocumentError(400, 'Lambda source is too large')
  }
  const runtime = input.runtime === 'python' ? 'python' : 'typescript'
  const schemaInput = input.input ?? {type: 'object'}
  for (const [label, value] of [
    ['input', schemaInput],
    ...(input.output !== undefined ? ([['output', input.output]] as const) : []),
  ] as Array<[string, unknown]>) {
    const errors = validateJsonSchemaShape(value)
    if (errors.length > 0) {
      throw new ToolDocumentError(
        400,
        `Tool ${label} schema is not supported: ${errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`,
      )
    }
  }
  const summary =
    typeof input.summary === 'string' && input.summary.trim()
      ? input.summary.trim().slice(0, 140)
      : summaryFromDescription(description)
  const doc: ToolDocument = {
    name,
    kind: 'lambda',
    summary,
    description,
    input: schemaInput as JsonSchema,
    ...(input.output !== undefined ? {output: input.output as JsonSchema} : {}),
    source,
    runtime,
  }
  const {cid, data} = encodeToolDocument(doc)
  const now = Date.now()
  db.run(
    `INSERT INTO tool_documents (account_id, agent_id, name, kind, cid, doc_cbor, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(account_id, agent_id, name) DO UPDATE SET
       kind = excluded.kind, cid = excluded.cid, doc_cbor = excluded.doc_cbor, updated_at = excluded.updated_at`,
    [accountId, agentId, name, doc.kind, cid, data, now, now],
  )
  return getToolDocument(db, accountId, agentId, name)!
}

/** Deletes an authored tool document. Builtins are bound at boot and cannot be deleted. */
export function deleteToolDocument(db: Database, accountId: string, agentId: string, name: string): boolean {
  const existing = getToolDocument(db, accountId, agentId, name)
  if (!existing) return false
  if (existing.doc.kind === 'builtin') {
    throw new ToolDocumentError(400, `"${name}" is a builtin tool; disable it via the agent's tool grants instead`)
  }
  db.run(`DELETE FROM tool_documents WHERE account_id = ? AND agent_id = ? AND name = ?`, [accountId, agentId, name])
  return true
}

/** The full contract as markdown, for reads of ~/tools/<name> and touch-expand results. */
export function toolDocumentContractMarkdown(row: ToolDocumentRow): string {
  const {doc} = row
  const parts = [
    `# ${doc.name}`,
    '',
    `> ${doc.kind} tool · version \`${row.cid}\`${doc.runtime ? ` · ${doc.runtime}` : ''}`,
    '',
    doc.description,
    '',
    '## Input schema',
    '```json',
    JSON.stringify(doc.input, null, 2),
    '```',
  ]
  if (doc.output) {
    parts.push('', '## Output schema', '```json', JSON.stringify(doc.output, null, 2), '```')
  }
  if (doc.source) {
    parts.push('', '## Source', '```' + (doc.runtime === 'python' ? 'python' : 'ts'), doc.source, '```')
  }
  return parts.join('\n')
}
