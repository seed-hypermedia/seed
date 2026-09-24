import {createHash, randomBytes} from 'node:crypto'
import {createServer} from 'node:http'
import {agentAppDocument, parseAgentApp} from '@seed-hypermedia/agents-protocol'

/** Window-owned loopback host for isolated app revisions, never an agent filesystem server. */
export class AgentAppHost {
  private readonly token = randomBytes(24).toString('hex')
  private readonly documents = new Map<string, string>()
  private bytes = 0
  private closed = false
  private readonly server = createServer((request, response) => {
    const address = this.server.address()
    const host = address && typeof address !== 'string' ? `127.0.0.1:${address.port}` : ''
    const body = request.url ? this.documents.get(request.url) : undefined
    if (request.method !== 'GET' || request.headers.host !== host || !body) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy':
        "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), clipboard-read=(), clipboard-write=()',
    })
    response.end(body)
  })
  private readonly listening = new Promise<void>((resolve, reject) => {
    this.server.once('error', reject)
    this.server.listen(0, '127.0.0.1', resolve)
  })

  /** Validates and serves one revision until its owning Seed window closes. */
  async open(input: unknown): Promise<string> {
    if (this.closed) throw new Error('App host is closed')
    const app = parseAgentApp(input)
    const id = createHash('sha256').update(JSON.stringify(app)).digest('hex')
    const path = `/${this.token}/${id}`
    if (!this.documents.has(path)) {
      const document = agentAppDocument(app)
      const bytes = Buffer.byteLength(document)
      if (this.documents.size >= 64 || this.bytes + bytes > 32 * 1024 * 1024)
        throw new Error('This window has reached its local app limit. Open a new Seed window to continue.')
      this.documents.set(path, document)
      this.bytes += bytes
    }
    await this.listening
    if (this.closed) throw new Error('App host is closed')
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('Local app host failed to start')
    return `http://127.0.0.1:${address.port}${path}`
  }

  /** Releases the listener and all in-memory revisions when the window is destroyed. */
  close() {
    this.closed = true
    this.documents.clear()
    void this.listening.then(
      () => {
        this.server.close()
        this.server.closeAllConnections()
      },
      () => {},
    )
  }
}
