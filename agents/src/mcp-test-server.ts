/**
 * A throwaway Streamable HTTP MCP server for tests: a fresh server + transport per request (the
 * documented stateless pattern), on a random loopback port, so each test sees exactly the calls it
 * makes. Not part of the service build — only test files import it.
 */
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import * as http from 'node:http'
import {z} from 'zod'

/** `onRequest` lets a test inspect headers; `connects()` counts initialize handshakes. */
export async function startTestMcpServer(options: {
  tools?: (server: McpServer) => void
  onRequest?: (req: http.IncomingMessage) => void
}): Promise<{url: string; connects: () => number; close: () => Promise<void>}> {
  let initializeCount = 0
  const httpServer = http.createServer(async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405).end()
      return
    }
    options.onRequest?.(req)
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
    if (body?.method === 'initialize') initializeCount += 1
    const server = new McpServer({name: 'test-mcp', version: '1.0.0'})
    if (options.tools) options.tools(server)
    else {
      server.tool('echo', 'Echoes back text', {text: z.string()}, async ({text}) => ({
        content: [{type: 'text', text: `echo: ${text}`}],
      }))
    }
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
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    connects: () => initializeCount,
    close: () => new Promise<void>((resolve) => httpServer.close(() => resolve())),
  }
}
