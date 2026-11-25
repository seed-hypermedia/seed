import {describe, expect, test} from 'bun:test'
import {startTestMcpServer} from '@/mcp-test-server'
import {
  connectMcpServer,
  discoverMcpServerTools,
  McpConnectionPool,
  mcpToolDocumentName,
  MCP_SERVER_NAME_PATTERN,
  normalizeToolResult,
  resolveMcpHeaders,
} from '@/mcp'

describe('mcp helpers', () => {
  test('projects a remote tool onto a provider-safe <server>__<tool> document name', () => {
    expect(mcpToolDocumentName('github', 'create_issue')).toBe('github__create_issue')
    // Characters no provider accepts in a tool name collapse to underscores; case is kept because
    // the remote name is the one the server knows.
    expect(mcpToolDocumentName('my-server', 'do.thing/now')).toBe('my-server__do_thing_now')
    expect(mcpToolDocumentName('s', 'x'.repeat(100)).length).toBeLessThanOrEqual(64)
  })

  test('server names are slugs', () => {
    expect(MCP_SERVER_NAME_PATTERN.test('github')).toBe(true)
    expect(MCP_SERVER_NAME_PATTERN.test('my-server_2')).toBe(true)
    expect(MCP_SERVER_NAME_PATTERN.test('My Server')).toBe(false)
    expect(MCP_SERVER_NAME_PATTERN.test('')).toBe(false)
  })

  test('merges static headers with resolved secret headers', async () => {
    const headers = await resolveMcpHeaders(
      {url: 'https://example.com', headers: {'X-Env': 'prod'}, secretRefs: {Authorization: 'tok-secret'}},
      async (name) => (name === 'tok-secret' ? 'Bearer abc' : ''),
    )
    expect(headers).toEqual({'X-Env': 'prod', Authorization: 'Bearer abc'})
  })

  test('flattens results: text joins, structured content is kept, images are separated, size is bounded', () => {
    const result = normalizeToolResult({
      content: [
        {type: 'text', text: 'one'},
        {type: 'image', data: 'AAAA', mimeType: 'image/png'},
        {type: 'text', text: 'two'},
      ],
      structuredContent: {count: 2},
    })
    expect(result.text).toBe('one\ntwo')
    expect(result.structured).toEqual({count: 2})
    expect(result.images).toEqual([{data: 'AAAA', mimeType: 'image/png'}])
    expect(result.isError).toBe(false)

    const big = normalizeToolResult({content: [{type: 'text', text: 'x'.repeat(300 * 1024)}]})
    expect(big.text.length).toBeLessThan(300 * 1024)
    expect(big.text).toEndWith('_[MCP result truncated]_')

    expect(normalizeToolResult({isError: true, content: [{type: 'text', text: 'nope'}]})).toMatchObject({
      isError: true,
      text: 'nope',
    })
  })

  test('connects to a real MCP server, lists tools, and proxies a tool call with the auth header', async () => {
    let seenAuth: string | undefined
    const server = await startTestMcpServer({
      onRequest: (req) => {
        seenAuth = req.headers['authorization'] as string | undefined
      },
    })
    const connection = await connectMcpServer(
      'tester',
      {url: server.url, transport: 'http', secretRefs: {Authorization: 'tok'}},
      async () => 'Bearer secret-token',
    )
    try {
      const tools = await connection.listTools()
      expect(tools.map((tool) => tool.name)).toContain('echo')
      expect(tools[0]?.inputSchema).toMatchObject({type: 'object'})
      const result = await connection.callTool('echo', {text: 'hi'})
      expect(result.isError).toBe(false)
      expect(result.text).toBe('echo: hi')
      expect(seenAuth).toBe('Bearer secret-token')
    } finally {
      await connection.close()
      await server.close()
    }
  })

  test('discovery connects, lists, and disconnects; an unreachable server throws', async () => {
    const server = await startTestMcpServer({})
    try {
      const tools = await discoverMcpServerTools('tester', {url: server.url}, async () => '')
      expect(tools.map((tool) => tool.name)).toEqual(['echo'])
    } finally {
      await server.close()
    }
    await expect(
      discoverMcpServerTools('gone', {url: 'http://127.0.0.1:1/mcp', transport: 'http'}, async () => ''),
    ).rejects.toThrow()
  })

  test('a pool connects once per server, shares the handshake across concurrent calls, and closes together', async () => {
    const server = await startTestMcpServer({})
    const discovered: string[] = []
    const pool = new McpConnectionPool(
      async (name) => (name === 'tester' ? {url: server.url, transport: 'http'} : undefined),
      async () => '',
      (name, tools) => discovered.push(`${name}:${tools.map((tool) => tool.name).join(',')}`),
    )
    try {
      const [a, b] = await Promise.all([
        pool.callTool('tester', 'echo', {text: 'a'}),
        pool.callTool('tester', 'echo', {text: 'b'}),
      ])
      expect(a.text).toBe('echo: a')
      expect(b.text).toBe('echo: b')
      // One initialize handshake for two concurrent calls; discovery ran on that connect.
      expect(server.connects()).toBe(1)
      expect(discovered).toEqual(['tester:echo'])
      await expect(pool.callTool('missing', 'echo', {})).rejects.toThrow(/not configured/)
    } finally {
      await pool.close()
      await server.close()
    }
    await expect(pool.callTool('tester', 'echo', {text: 'late'})).rejects.toThrow(/closed/)
  })
})
