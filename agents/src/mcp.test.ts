import {describe, expect, test} from 'bun:test'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import * as http from 'node:http'
import {z} from 'zod'
import {connectMcpServer, isMcpToolName, MCP_TOOL_PREFIX, qualifyMcpToolName, resolveMcpHeaders} from '@/mcp'

describe('mcp helpers', () => {
  test('qualifies tool names with a sanitized per-server namespace', () => {
    expect(qualifyMcpToolName('github', 'create_issue')).toBe(`${MCP_TOOL_PREFIX}github__create_issue`)
    // Disallowed characters collapse to underscores so the name stays model/provider safe.
    expect(qualifyMcpToolName('My Server!', 'do.thing')).toBe(`${MCP_TOOL_PREFIX}My_Server__do_thing`)
  })

  test('recognizes MCP tool names', () => {
    expect(isMcpToolName(qualifyMcpToolName('s', 't'))).toBe(true)
    expect(isMcpToolName('read')).toBe(false)
  })

  test('merges static headers with resolved secret headers', async () => {
    const headers = await resolveMcpHeaders(
      {url: 'https://example.com', headers: {'X-Env': 'prod'}, secretRefs: {Authorization: 'tok-secret'}},
      async (name) => (name === 'tok-secret' ? 'Bearer abc' : ''),
    )
    expect(headers).toEqual({'X-Env': 'prod', Authorization: 'Bearer abc'})
  })

  test('connects to a real MCP server, lists tools, and proxies a tool call', async () => {
    let seenAuth: string | undefined
    // Stateless Streamable HTTP MCP server: a fresh server+transport per request (the documented pattern).
    const httpServer = http.createServer(async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      seenAuth = req.headers['authorization'] as string | undefined
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
      const server = new McpServer({name: 'test-mcp', version: '1.0.0'})
      server.tool('echo', 'Echoes back text', {text: z.string()}, async ({text}) => ({
        content: [{type: 'text', text: `echo: ${text}`}],
      }))
      const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined, enableJsonResponse: true})
      res.on('close', () => {
        void transport.close()
        void server.close()
      })
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    })
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve))
    const address = httpServer.address()
    if (!address || typeof address === 'string') throw new Error('no server address')
    const url = `http://127.0.0.1:${address.port}/mcp`

    const connection = await connectMcpServer(
      'tester',
      {url, transport: 'http', secretRefs: {Authorization: 'tok'}},
      async () => 'Bearer secret-token',
    )
    try {
      const tools = await connection.listTools()
      expect(tools.map((tool) => tool.name)).toContain('echo')
      const result = await connection.callTool('echo', {text: 'hi'})
      expect(result.isError).toBe(false)
      expect(result.text).toBe('echo: hi')
      expect(seenAuth).toBe('Bearer secret-token')
    } finally {
      await connection.close()
      await new Promise<void>((resolve) => httpServer.close(() => resolve()))
    }
  })
})
