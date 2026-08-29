/**
 * MCP (Model Context Protocol) client support for the Agents service.
 *
 * An account configures remote MCP servers the way it configures model providers; an agent enables
 * some of them by name. Every tool an enabled server advertises is projected into the agent's
 * `~/tools/` as an `mcp` tool document named `<server>__<tool>` (see tool-documents.ts), so it
 * rides the same rails as builtins and lambdas: the Space index lists it, `read ~/tools/<name>`
 * shows its contract, `call` runs it, and a contract that entered the transcript promotes it to a
 * first-class provider tool.
 *
 * Only remote transports exist — Streamable HTTP and the legacy HTTP+SSE. The hosted,
 * multi-tenant service never spawns local stdio processes.
 *
 * Connections are lazy and per run: nothing is opened at run start, the first `call` of a
 * server's tool connects (concurrent calls share the handshake), and the run's teardown closes
 * whatever it opened. Discovery — the tool list cached on the server record — happens on save and
 * on refresh, and is also refreshed opportunistically whenever a run connects.
 */

import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {SSEClientTransport} from '@modelcontextprotocol/sdk/client/sse.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type {JsonSchema, McpServerConfig, McpServerTransport} from '@seed-hypermedia/agents-protocol'

/** Separates the server segment from the remote tool segment in an MCP tool document's name. */
export const MCP_TOOL_SEPARATOR = '__'
/** Provider tool names are capped at 64 chars (OpenAI, Anthropic); document names honor the same cap. */
const MAX_TOOL_DOCUMENT_NAME = 64
/** Server names are slugs so the document name they prefix is provider-safe and unambiguous. */
export const MCP_SERVER_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/

const CONNECT_TIMEOUT_MS = 30_000
const CALL_TIMEOUT_MS = 120_000
/** Bounds the text of one MCP result so a runaway server cannot blow past the tool-result cap. */
const MAX_MCP_RESULT_BYTES = 256 * 1024
/** Inline image parts handed to a vision model are bounded like attachment images are. */
const MAX_MCP_IMAGE_BYTES = 4 * 1024 * 1024
const CLIENT_INFO = {name: 'seed-agents', version: '1.0.0'}

/** A single tool advertised by an MCP server. */
export type McpToolDescriptor = {
  name: string
  description?: string
  inputSchema?: JsonSchema
}

/** Outcome of proxying a tool call to an MCP server. */
export type McpToolCallResult = {
  /** Joined text content, bounded. */
  text: string
  /** `structuredContent` when the server provides it. */
  structured?: unknown
  /** Image parts, for vision models. Base64 data as the server sent it. */
  images: Array<{data: string; mimeType: string}>
  isError: boolean
}

/** A live connection to one MCP server. */
export type McpConnection = {
  serverName: string
  listTools(): Promise<McpToolDescriptor[]>
  callTool(toolName: string, args: unknown): Promise<McpToolCallResult>
  close(): Promise<void>
}

/** Resolves an account secret name to its plaintext value (secret-backed headers). */
export type McpSecretResolver = (secretName: string) => Promise<string>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Collapses anything outside `[a-zA-Z0-9_-]` — the charset every provider accepts in a tool name. */
function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'tool'
}

/**
 * The agent-side document name for a remote tool: `<server>__<tool>`, provider-safe and bounded.
 * The server name is already a slug (validated on save); the remote name is sanitized here.
 */
export function mcpToolDocumentName(serverName: string, remoteName: string): string {
  const prefix = `${sanitizeSegment(serverName)}${MCP_TOOL_SEPARATOR}`
  const room = Math.max(1, MAX_TOOL_DOCUMENT_NAME - prefix.length)
  return `${prefix}${sanitizeSegment(remoteName).slice(0, room)}`
}

/** Merges static headers with secret-backed ones; a secret wins over a static header of the same name. */
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
 * Connects to a remote MCP server. With no transport pinned, Streamable HTTP is tried first and
 * the legacy SSE transport second, per the MCP backwards-compatibility guidance; the first error is
 * the one reported, since it is the one a modern server would have produced.
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
      const tools: McpToolDescriptor[] = []
      let cursor: string | undefined
      // Servers may page their tool list; walk it to the end so the projection is complete.
      do {
        const result = await client.listTools(cursor ? {cursor} : undefined)
        for (const tool of Array.isArray(result?.tools) ? result.tools : []) {
          if (!isRecord(tool) || typeof tool.name !== 'string' || !tool.name) continue
          tools.push({
            name: tool.name,
            description: typeof tool.description === 'string' ? tool.description : undefined,
            inputSchema: isRecord(tool.inputSchema) ? (tool.inputSchema as JsonSchema) : undefined,
          })
        }
        cursor = typeof result?.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined
      } while (cursor && tools.length < 1000)
      return tools
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

/** Connect, list tools, disconnect — what a save or refresh does to learn what a server offers. */
export async function discoverMcpServerTools(
  serverName: string,
  config: McpServerConfig,
  resolveSecret: McpSecretResolver,
): Promise<McpToolDescriptor[]> {
  const connection = await connectMcpServer(serverName, config, resolveSecret)
  try {
    return await connection.listTools()
  } finally {
    await connection.close()
  }
}

/** Where a pool finds a server's config by name; undefined means the server no longer exists. */
export type McpServerResolver = (serverName: string) => Promise<McpServerConfig | undefined>

/**
 * One run's MCP connections: opened on first use, shared by concurrent calls, closed together.
 * A connection that fails to open is forgotten, so the next call retries rather than replaying
 * the same rejection for the rest of the run.
 */
export class McpConnectionPool {
  #connections = new Map<string, Promise<McpConnection>>()
  #closed = false

  constructor(
    private readonly resolveServer: McpServerResolver,
    private readonly resolveSecret: McpSecretResolver,
    /** Fired after a fresh connect lists its tools — the hook that keeps the cached discovery current. */
    private readonly onConnected?: (serverName: string, tools: McpToolDescriptor[]) => void,
  ) {}

  async connection(serverName: string): Promise<McpConnection> {
    if (this.#closed) throw new Error('MCP connections for this run are closed')
    let pending = this.#connections.get(serverName)
    if (!pending) {
      pending = (async () => {
        const config = await this.resolveServer(serverName)
        if (!config) throw new Error(`MCP server "${serverName}" is not configured on this account`)
        const connection = await connectMcpServer(serverName, config, this.resolveSecret)
        if (this.onConnected) {
          try {
            this.onConnected(serverName, await connection.listTools())
          } catch {
            // Discovery is a courtesy on this path; the call the model asked for still proceeds.
          }
        }
        return connection
      })()
      this.#connections.set(serverName, pending)
      pending.catch(() => this.#connections.delete(serverName))
    }
    return pending
  }

  async callTool(serverName: string, toolName: string, args: unknown): Promise<McpToolCallResult> {
    const connection = await this.connection(serverName)
    return connection.callTool(toolName, args)
  }

  async close(): Promise<void> {
    this.#closed = true
    const pending = [...this.#connections.values()]
    this.#connections.clear()
    await Promise.all(
      pending.map(async (promise) => {
        try {
          await (await promise).close()
        } catch {}
      }),
    )
  }
}

/** Flattens an MCP tool-call result into text + structured output + images, bounding sizes. */
export function normalizeToolResult(result: unknown): McpToolCallResult {
  const record = isRecord(result) ? result : {}
  const isError = record.isError === true
  const structured = 'structuredContent' in record ? record.structuredContent : undefined
  const contentParts = Array.isArray(record.content) ? record.content : []
  const textPieces: string[] = []
  const images: McpToolCallResult['images'] = []
  for (const part of contentParts) {
    if (!isRecord(part)) continue
    if (part.type === 'text' && typeof part.text === 'string') {
      textPieces.push(part.text)
    } else if (part.type === 'image' && typeof part.data === 'string' && typeof part.mimeType === 'string') {
      if (part.data.length <= MAX_MCP_IMAGE_BYTES) images.push({data: part.data, mimeType: part.mimeType})
      else textPieces.push(`[image ${part.mimeType} omitted: too large]`)
    } else if (part.type === 'resource' && isRecord(part.resource) && typeof part.resource.text === 'string') {
      textPieces.push(part.resource.text)
    } else {
      // Other content (audio, binary resources, links): a compact marker so the model knows it exists.
      textPieces.push(safeStringify(part))
    }
  }
  let text = textPieces.join('\n').trim()
  if (!text && structured !== undefined) text = safeStringify(structured)
  if (Buffer.byteLength(text, 'utf8') > MAX_MCP_RESULT_BYTES) {
    text = `${Buffer.from(text, 'utf8').subarray(0, MAX_MCP_RESULT_BYTES).toString('utf8')}\n\n_[MCP result truncated]_`
  }
  return {text, structured, images, isError}
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
