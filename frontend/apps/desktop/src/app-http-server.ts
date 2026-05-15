import * as http from 'http'
import {handleApiAction, handleApiRequest} from '@shm/shared/api-server'
import {API_HTTP_PORT, DAEMON_HTTP_URL} from '@shm/shared/constants'
import {grpcClient} from './grpc-client'
import * as logger from './logger'

let server: http.Server | null = null

async function queryDaemon<T>(pathAndQuery: string): Promise<T> {
  const response = await fetch(`${DAEMON_HTTP_URL}${pathAndQuery}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch ${pathAndQuery}: ${response.statusText}`)
  }
  return (await response.json()) as T
}

function readBody(req: http.IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))))
    req.on('error', reject)
  })
}

export function startApiServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve()
      return
    }

    server = http.createServer(async (req, res) => {
      // Leaving CORS broad on purpose.
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        })
        res.end()
        return
      }

      const forbid = () => {
        res.writeHead(403, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({error: 'Forbidden'}))
      }

      const site = req.headers['sec-fetch-site']

      // Missing fetch metadata headers in a browser request means some weird browser — so we reject it.
      if (req.headers.origin && !site) {
        return forbid()
      }

      // If fetch metadata is present and we detect that it's cross-site — we reject it.
      if (site && site !== 'same-origin' && site !== 'same-site' && site !== 'none') {
        return forbid()
      }

      const url = new URL(req.url || '/', `http://127.0.0.1:${API_HTTP_PORT}`)

      if (!url.pathname.startsWith('/api/')) {
        res.writeHead(404, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({error: 'Not found'}))
        return
      }

      let result
      if (req.method === 'GET') {
        result = await handleApiRequest(url, grpcClient, queryDaemon)
      } else if (req.method === 'POST') {
        const key = url.pathname.replace(/^\/api\//, '').split('/')[0]
        const body = await readBody(req)
        result = await handleApiAction(key, body, grpcClient, queryDaemon)
      } else {
        res.writeHead(405, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({error: 'Method not allowed'}))
        return
      }

      res.writeHead(result.status, result.headers)
      res.end(result.body)
    })

    // TODO(burdiyan): our app already has one HTTP server which serves our HTML entrypoints in production,
    // so in theory we could've reused the same server for the API. But that would need a bit of a refactor,
    // which we don't want to do at the moment.

    const port = Number(API_HTTP_PORT)
    server.listen(port, '127.0.0.1', () => {
      logger.info(`[API-SERVER]: Started on http://127.0.0.1:${port}`)
      resolve()
    })

    server.on('error', (err) => {
      reject(err)
    })
  })
}

export function stopApiServer() {
  if (server) {
    server.close()
    server = null
    logger.info('[API-SERVER]: Stopped')
  }
}
