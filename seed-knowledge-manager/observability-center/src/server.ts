import {importKmArtifacts} from './importer.js'
import {parseEnvelope} from './schema.js'
import type {Store} from './store.js'
import {renderDashboard} from './dashboard.js'

export type ServerConfig = {
  hostname: string
  port: number
  ingestToken?: string | null
  importLogsDir?: string | null
  importStateDir?: string | null
  importFullPayload: boolean
  importIntervalMs: number
}

export function serve(store: Store, config: ServerConfig): ReturnType<typeof Bun.serve> {
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>()
  const encoder = new TextEncoder()
  const sendSse = (event: string, data: unknown) => {
    const payload = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    for (const stream of streams) {
      try {
        stream.enqueue(payload)
      } catch {
        streams.delete(stream)
      }
    }
  }

  if (config.importIntervalMs > 0 && (config.importLogsDir || config.importStateDir)) {
    setInterval(() => {
      try {
        const result = importKmArtifacts(store, {logsDir: config.importLogsDir, stateDir: config.importStateDir, fullPayload: config.importFullPayload})
        if (result.events > 0) sendSse('import', result)
      } catch (err) {
        console.error('import failed', err)
      }
    }, config.importIntervalMs).unref?.()
  }

  return Bun.serve({
    hostname: config.hostname,
    port: config.port,
    async fetch(req) {
      const url = new URL(req.url)
      try {
        if (req.method === 'GET' && url.pathname === '/') {
          return html(renderDashboard())
        }
        if (req.method === 'GET' && url.pathname === '/api/live') {
          return json(store.liveSummary())
        }
        if (req.method === 'GET' && url.pathname === '/api/runs') {
          return json({runs: store.listRuns(parseLimit(url.searchParams.get('limit'), 50))})
        }
        if (req.method === 'GET' && url.pathname === '/api/events') {
          return json({
            events: store.listEvents({
              limit: parseLimit(url.searchParams.get('limit'), 200),
              commentId: stringParam(url.searchParams.get('commentId')),
              runId: stringParam(url.searchParams.get('runId')),
              actorId: stringParam(url.searchParams.get('actorId')),
            }),
          })
        }
        if (req.method === 'GET' && url.pathname.startsWith('/api/comments/') && url.pathname.endsWith('/timeline')) {
          const encoded = url.pathname.slice('/api/comments/'.length, -'/timeline'.length)
          return json({events: store.commentTimeline(decodeURIComponent(encoded))})
        }
        if (req.method === 'GET' && url.pathname === '/api/stream') {
          let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              streamController = controller
              streams.add(controller)
              controller.enqueue(encoder.encode(`event: summary\ndata: ${JSON.stringify(store.liveSummary())}\n\n`))
            },
            cancel() {
              if (streamController) streams.delete(streamController)
            },
          })
          return new Response(stream, {
            headers: {
              'content-type': 'text/event-stream; charset=utf-8',
              'cache-control': 'no-cache, no-transform',
              connection: 'keep-alive',
            },
          })
        }
        if (req.method === 'POST' && url.pathname === '/api/ingest') {
          const auth = authorize(req, config.ingestToken)
          if (auth) return auth
          const body = await req.json().catch(() => null)
          const events = parseEnvelope(body)
          const normalized = events.map((event) => store.record(event))
          for (const event of normalized) sendSse('event', event)
          sendSse('summary', store.liveSummary())
          return json({ok: true, events: normalized.length})
        }
        if (req.method === 'POST' && url.pathname === '/api/import') {
          const auth = authorize(req, config.ingestToken)
          if (auth) return auth
          const result = importKmArtifacts(store, {logsDir: config.importLogsDir, stateDir: config.importStateDir, fullPayload: config.importFullPayload})
          if (result.events > 0) sendSse('import', result)
          return json({ok: true, ...result})
        }
        return json({error: 'not found'}, 404)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return json({error: message}, 400)
      }
    },
  })
}

function authorize(req: Request, token?: string | null): Response | null {
  if (!token) return null
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  const header = req.headers.get('x-oc-token')
  if (bearer === token || header === token) return null
  return json({error: 'unauthorized'}, 401)
}

function parseLimit(raw: string | null, fallback: number): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.min(Math.floor(value), 1000)
}

function stringParam(value: string | null): string | undefined {
  return value && value.length > 0 ? value : undefined
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {'content-type': 'application/json; charset=utf-8'},
  })
}

function html(value: string): Response {
  return new Response(value, {headers: {'content-type': 'text/html; charset=utf-8'}})
}
