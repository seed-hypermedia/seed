/**
 * MCP (Model Context Protocol) client support for the Agents service.
 *
 * Lets account-scoped agents reach remote MCP servers over HTTP so their tools become
 * available to the model at runtime. Only remote (Streamable HTTP / SSE) transports are
 * supported — the hosted multi-tenant service never spawns local stdio processes.
 *
 * Each agent run connects to the MCP servers it has enabled, lists their tools, exposes them
 * to the model under a per-server namespace (`mcp__<server>__<tool>`), proxies tool calls
 * back to the MCP server, and disconnects when the run finishes.
 */

import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {JsonSchema, McpServerConfig, McpServerTransport} from '@seed-hypermedia/agents-protocol'

/** Prefix that marks a model-facing tool name as belonging to an MCP server. */
export const MCP_TOOL_PREFIX = 'mcp__'

const CONNECT_TIMEOUT_MS = 20_000
const CALL_TIMEOUT_MS = 120_000
/** Bound the textual tool result so a runaway MCP server cannot blow past the tool-result cap. */
const MAX_MCP_RESULT_BYTES = 256 * 1024
const CLIENT_INFO = {name: 'seed-agents', version: '1.0.0'}

/** A single tool advertised by an MCP server. */
export type McpToolDescriptor = {
  name: string
  description?: string
  inputSchema?: JsonSchema
}

/** Outcome of proxying a tool call to an MCP server. */
export type McpToolCallResult = {
  /** Joined text content for the model. */
  text: string
  /** Structured content when the server provides it. */
  structured?: unknown
  isError: boolean
}

/** A live connection to one MCP server for the duration of an agent run. */
export type McpConnection = {
  serverName: string
  listTools(): Promise<McpToolDescriptor[]>
  callTool(toolName: string, args: unknown): Promise<McpToolCallResult>
  close(): Promise<void>
}

/** Resolves an account secret name to its plaintext value (used for secret-backed headers). */
export type McpSecretResolver = (secretName: string) => Promise<string>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Sanitizes a name segment to the `[a-zA-Z0-9_-]` charset model providers accept for tool names. */
function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'mcp'
}

/** Builds the model-facing tool name for an MCP tool, namespaced by its server. */
export function qualifyMcpToolName(serverName: string, toolName: string): string {
  return `${MCP_TOOL_PREFIX}${sanitizeSegment(serverName)}__${sanitizeSegment(toolName)}`
}

/** Whether a model-facing tool name refers to an MCP tool. */
export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX)
}

/** Resolves the full header set for an MCP server, merging static headers with secret-backed ones. */
export async function resolveMcpHeaders(
  config: McpServerConfig,
  resolveSecret: McpSecretResolver,
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {}
  for (const [name, value] of Object.entries(config.headers ?? {})) {
    if (typeof name === 'string' && typeof value === 'string') headers[name] = value
  }
  for (const [headerName, secretName] of Object.entries(config.secretRefs ?? {})) {
    if (typeof headerName !== 'string' || typeof secretName !== 'string') continue
    headers[headerName] = await resolveSecret(secretName)
  }
  return headers
}

async function connectClient(
  url: URL,
  transport: McpServerTransport,
  headers: Record<string, string>,
): Promise<Client> {
  const client = new Client(CLIENT_INFO)
  const requestInit: RequestInit = Object.keys(headers).length ? {headers} : {}
  const conn =
    transport === 'sse'
      ? new SSEClientTransport(url, {requestInit})
      : new StreamableHTTPClientTransport(url, {requestInit})
  await client.connect(conn, {timeout: CONNECT_TIMEOUT_MS})
  return client
}

/**
 * Connects to a remote MCP server. When the transport is unspecified, tries Streamable HTTP first
 * and falls back to the legacy SSE transport, matching the MCP backwards-compatibility guidance.
 */
export async function connectMcpServer(
  serverName: string,
  config: McpServerConfig,
  resolveSecret: McpSecretResolver,
): Promise<McpConnection> {
  const url = new URL(config.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('MCP server URL must be http(s)')
  }
  const headers = await resolveMcpHeaders(config, resolveSecret)

  let client: Client
  if (config.transport === 'sse') {
    client = await connectClient(url, 'sse', headers)
  } else if (config.transport === 'http') {
    client = await connectClient(url, 'http', headers)
  } else {
    try {
      client = await connectClient(url, 'http', headers)
    } catch (httpError) {
      try {
        client = await connectClient(url, 'sse', headers)
      } catch {
        throw httpError instanceof Error ? httpError : new Error('MCP connection failed')
      }
    }
  }

  return {
    serverName,
    async listTools() {
      const result = await client.listTools()
      const tools = Array.isArray(result?.tools) ? result.tools : []
      return tools.flatMap((tool): McpToolDescriptor[] => {
        if (!isRecord(tool) || typeof tool.name !== 'string') return []
        return [
          {
            name: tool.name,
            description: typeof tool.description === 'string' ? tool.description : undefined,
            inputSchema: isRecord(tool.inputSchema) ? (tool.inputSchema as JsonSchema) : undefined,
          },
        ]
      })
    },
    async callTool(toolName, args) {
      const result = await client.callTool({name: toolName, arguments: isRecord(args) ? args : {}}, undefined, {
        timeout: CALL_TIMEOUT_MS,
      })
      return normalizeToolResult(result)
    },
    async close() {
      await client.close().catch(() => {})
    },
  }
}

/** Flattens an MCP tool-call result into text + structured output, bounding the text size. */
function normalizeToolResult(result: unknown): McpToolCallResult {
  const record = isRecord(result) ? result : {}
  const isError = record.isError === true
  const structured = 'structuredContent' in record ? record.structuredContent : undefined
  const contentParts = Array.isArray(record.content) ? record.content : []
  const textPieces: string[] = []
  for (const part of contentParts) {
    if (!isRecord(part)) continue
    if (part.type === 'text' && typeof part.text === 'string') {
      textPieces.push(part.text)
    } else {
      // Non-text content (images, resources, etc.): keep a compact JSON marker so the model sees it exists.
      textPieces.push(safeStringify(part))
    }
  }
  let text = textPieces.join('\n').trim()
  if (!text && structured !== undefined) text = safeStringify(structured)
  if (Buffer.byteLength(text, 'utf8') > MAX_MCP_RESULT_BYTES) {
    text = `${Buffer.from(text, 'utf8').subarray(0, MAX_MCP_RESULT_BYTES).toString('utf8')}\n\n_[MCP result truncated]_`
  }
  return {text, structured, isError}
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
