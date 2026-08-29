/**
 * Tools as documents: every tool an agent holds is a content-addressed document in its Space,
 * stored per agent in `tool_documents`. Builtins are documents whose implementation is a runtime
 * binding; lambdas carry TypeScript/Python source, run in the execute sandbox when called by name
 * through the `call` verb (see the ABI on {@link ToolDocument}); MCP documents are projections of
 * the tools a remote MCP server advertises, proxied to that server when called.
 * A document's CID is computed over its canonical DAG-CBOR encoding — the same encoding the
 * hypermedia network uses for blobs — so "what exactly can this agent run" is always answerable
 * and publishing a tool to the network later is publishing bytes that already exist.
 */
import type {Database} from 'bun:sqlite'
import * as blobs from '@shm/shared/blobs'
import * as dagCbor from '@shm/shared/cbor'
import {
  callableToolRegistry,
  seedVerbRegistry,
  type JsonSchema,
  type McpToolInfo,
  type SeedToolMetadata,
} from '@seed-hypermedia/agents-protocol'
import {validateJsonSchemaShape} from '@/json-schema'
import {mcpToolDocumentName} from '@/mcp'

/**
 * The lambda ABI — what an authored tool's source must look like, and how a call reaches it.
 *
 * A lambda runs in the same sandbox the `execute` tool uses: a fresh microVM per call, with the
 * agent's memory mounted at `/workspace` (the working directory), so a tool can read and write the
 * agent's own files. It receives ONE argument — the call input, already validated against the
 * document's `input` schema — and its RETURN VALUE is the tool's result, validated against the
 * `output` schema when the document declares one.
 *
 * TypeScript (`runtime: 'typescript'`), run with bun:
 *
 *     export default async function (input: {city: string}) {
 *       const res = await fetch(`https://api.example.com/weather?q=${input.city}`)
 *       return {tempC: (await res.json()).temp_c}
 *     }
 *
 * Python (`runtime: 'python'`), run with the python interpreter:
 *
 *     def main(input):
 *         return {"tempC": lookup(input["city"])}
 *
 * The value comes back on a marked stdout line (see LAMBDA_RESULT_PREFIX in code-exec.ts), which
 * leaves ordinary `console.log`/`print` free for logging — those lines return to the caller as
 * `logs`. Anything else is a failure the caller surfaces: a non-zero exit, no returned value, or a
 * value the tool's own output schema rejects.
 */
export type ToolDocument = {
  name: string
  kind: 'builtin' | 'lambda' | 'mcp'
  /** One line for the Space index and ~/tools listing. */
  summary: string
  /** Full model-facing instructions, shown on expansion. */
  description: string
  input: JsonSchema
  output?: JsonSchema
  /** Lambda source, shaped per the ABI above and run in the execute sandbox. */
  source?: string
  /** Lambda source language; defaults to typescript. */
  runtime?: 'typescript' | 'python'
  /** Builtin executor id bound at boot; survives a fork of the document. */
  binding?: string
  /** MCP tools: the account MCP server the call is proxied to. */
  server?: string
  /** MCP tools: the tool's name on that server. */
  remoteName?: string
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

/**
 * The input contract a remote schema becomes. Remote servers speak full JSON Schema (`$schema`,
 * `format`, `anyOf`, …); the local validator ignores keywords it does not model, so the schema is
 * kept whole — the provider sees the real contract on promotion, and local validation checks what
 * it can. Only a root that is not an object (which no provider accepts as tool parameters) falls
 * back to an open object, leaving validation to the server that owns the tool.
 */
function adoptRemoteInputSchema(schema: JsonSchema | undefined): JsonSchema {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return {type: 'object'}
  const {$schema: _schema, $id: _id, ...rest} = schema as JsonSchema & {$schema?: unknown; $id?: unknown}
  const types = rest.type === undefined ? ['object'] : Array.isArray(rest.type) ? rest.type : [rest.type]
  if (!types.includes('object')) return {type: 'object'}
  return {...rest, type: 'object'}
}

/** A remote tool as an agent-side document; see {@link adoptRemoteInputSchema} for the contract. */
function mcpToolDocument(serverName: string, tool: McpToolInfo): ToolDocument {
  const description = tool.description?.trim() || `Tool "${tool.name}" from the ${serverName} MCP server.`
  const input = adoptRemoteInputSchema(tool.inputSchema)
  return {
    name: tool.toolName,
    kind: 'mcp',
    summary: summaryFromDescription(description),
    description,
    input,
    server: serverName,
    remoteName: tool.name,
  }
}

/** The cached tool list of every MCP server on an account, keyed by server name. */
export function listMcpServerTools(db: Database, accountId: string): Map<string, McpToolInfo[]> {
  const rows = db
    .query<{name: string; tools_cbor: Uint8Array | null}, [string]>(
      `SELECT name, tools_cbor FROM mcp_servers WHERE account_id = ?`,
    )
    .all(accountId)
  const byServer = new Map<string, McpToolInfo[]>()
  for (const row of rows) {
    let tools: McpToolInfo[] = []
    if (row.tools_cbor) {
      try {
        const decoded = dagCbor.decode<unknown>(row.tools_cbor)
        if (Array.isArray(decoded)) tools = decoded as McpToolInfo[]
      } catch {}
    }
    byServer.set(row.name, tools)
  }
  return byServer
}

/** Projects the account's MCP server tool lists onto the `<server>__<tool>` document names an agent would hold. */
export function mcpToolInfoFromDescriptor(
  serverName: string,
  tool: {name: string; description?: string; inputSchema?: JsonSchema},
): McpToolInfo {
  return {
    name: tool.name,
    toolName: mcpToolDocumentName(serverName, tool.name),
    ...(tool.description ? {description: tool.description} : {}),
    ...(tool.inputSchema ? {inputSchema: tool.inputSchema} : {}),
  }
}

/**
 * Reconciles one agent's `mcp` tool documents with the servers it enables: every tool of every
 * enabled server gets a document (rewritten only when its CID changed, so a server changing a
 * contract is a visible version bump), and documents for servers no longer enabled — or deleted —
 * go away. A name already held by a lambda is left alone: the agent's own authored tool wins, and
 * the collision is reported so the owner can see why one remote tool is missing.
 *
 * Idempotent and DB-only, so it is cheap to run from every listing and at run start, on top of the
 * eager runs from the save/refresh/delete/UpdateAgent paths.
 */
export function syncMcpToolDocuments(
  db: Database,
  accountId: string,
  agentId: string,
  enabledServers: string[],
): {changed: boolean; conflicts: string[]} {
  const now = Date.now()
  const enabled = new Set(enabledServers)
  const serverTools = listMcpServerTools(db, accountId)
  const desired = new Map<string, ToolDocument>()
  for (const [serverName, tools] of serverTools) {
    if (!enabled.has(serverName)) continue
    for (const tool of tools) {
      const doc = mcpToolDocument(serverName, tool)
      // Two remote names can sanitize to one document name; first wins, deterministically by list order.
      if (!desired.has(doc.name)) desired.set(doc.name, doc)
    }
  }

  const existing = db
    .query<{name: string; kind: string; cid: string}, [string, string]>(
      `SELECT name, kind, cid FROM tool_documents WHERE account_id = ? AND agent_id = ?`,
    )
    .all(accountId, agentId)
  const existingByName = new Map(existing.map((row) => [row.name, row]))

  let changed = false
  const conflicts: string[] = []
  for (const [name, doc] of desired) {
    const current = existingByName.get(name)
    if (current && current.kind !== 'mcp') {
      conflicts.push(name)
      continue
    }
    const {cid, data} = encodeToolDocument(doc)
    if (current?.cid === cid) continue
    db.run(
      `INSERT INTO tool_documents (account_id, agent_id, name, kind, cid, doc_cbor, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(account_id, agent_id, name) DO UPDATE SET
         kind = excluded.kind, cid = excluded.cid, doc_cbor = excluded.doc_cbor, updated_at = excluded.updated_at`,
      [accountId, agentId, name, doc.kind, cid, data, now, now],
    )
    changed = true
  }
  for (const row of existing) {
    if (row.kind !== 'mcp' || desired.has(row.name)) continue
    db.run(`DELETE FROM tool_documents WHERE account_id = ? AND agent_id = ? AND name = ?`, [
      accountId,
      agentId,
      row.name,
    ])
    changed = true
  }
  return {changed, conflicts}
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
  const taken = getToolDocument(db, accountId, agentId, name)
  if (taken && taken.doc.kind === 'mcp') {
    throw new ToolDocumentError(
      400,
      `"${name}" is a tool from the ${taken.doc.server} MCP server and cannot be replaced; pick another name`,
    )
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
  if (existing.doc.kind === 'mcp') {
    throw new ToolDocumentError(
      400,
      `"${name}" comes from the ${existing.doc.server} MCP server; disable that server for this agent instead`,
    )
  }
  db.run(`DELETE FROM tool_documents WHERE account_id = ? AND agent_id = ? AND name = ?`, [accountId, agentId, name])
  return true
}

/** The full contract as markdown, for reads of ~/tools/<name> and touch-expand results. */
export function toolDocumentContractMarkdown(row: ToolDocumentRow): string {
  const {doc} = row
  const provenance =
    doc.kind === 'mcp'
      ? `> mcp tool · \`${doc.remoteName ?? doc.name}\` on the ${doc.server} MCP server · version \`${row.cid}\``
      : `> ${doc.kind} tool · version \`${row.cid}\`${doc.runtime ? ` · ${doc.runtime}` : ''}`
  const parts = [
    `# ${doc.name}`,
    '',
    provenance,
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
    parts.push(
      '',
      doc.runtime === 'python'
        ? '> Runs in the execute sandbox: `main(input)` receives the validated input and returns the result.'
        : '> Runs in the execute sandbox: the default export receives the validated input and returns the result.',
      '',
      '## Source',
      '```' + (doc.runtime === 'python' ? 'python' : 'ts'),
      doc.source,
      '```',
    )
  }
  return parts.join('\n')
}
