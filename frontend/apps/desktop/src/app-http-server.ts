import * as http from 'http'
import {BlockList, isIP} from 'net'
import {handleApiAction, handleApiRequest} from '@shm/shared/api-server'
import {API_HTTP_PORT, DAEMON_HTTP_URL} from '@shm/shared/constants'
import * as path from 'path'
import {userDataPath} from './app-paths'
import {grpcClient} from './grpc-client'
import * as logger from './logger'
import {
  PLAYGROUND_PAGE_PATH,
  PlaygroundHandler,
  createFilePlaygroundStorage,
  createPlaygroundHandler,
  isPlaygroundPath,
} from './playground/api'

let server: http.Server | null = null
let playground: PlaygroundHandler | null = null

/** The HM26 playground (`/hm/playground`, `/api/playground`) lives on this server. Its world is one JSON file in userData. */
function getPlayground(): PlaygroundHandler {
  if (!playground) {
    playground = createPlaygroundHandler({storage: createFilePlaygroundStorage(path.join(userDataPath, 'playground'))})
  }
  return playground
}

/** Returns the local playground address served by the desktop API bridge. */
export function playgroundUrl(): string {
  return `http://localhost:${API_HTTP_PORT}${PLAYGROUND_PAGE_PATH}/`
}

const loopbackAddresses = new BlockList()
loopbackAddresses.addSubnet('127.0.0.0', 8, 'ipv4')
loopbackAddresses.addAddress('::1', 'ipv6')

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

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
      for (const [key, value] of Object.entries(CORS_HEADERS)) {
        res.setHeader(key, value)
      }

      const forbid = () => {
        res.writeHead(403, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({error: 'Forbidden'}))
      }

      // DNS rebinding can point an attacker's hostname at loopback while the browser
      // still reports same-origin. Require localhost or a literal loopback IP without
      // resolving DNS; checking the socket peer and Fetch Metadata alone is insufficient.
      // Require Host so every request undergoes the loopback-host check, including HTTP/1.0.
      // Treat Host as an authority, never as a URL with userinfo or a path.
      const authority = req.headers.host
      if (!authority || /[\s/\\@?#]/.test(authority)) return forbid()
      let hostname: string
      try {
        // The synthetic "http://" scheme lets URL parse a host, optional port, and
        // bracketed IPv6 address. This only parses text; it makes no request.
        hostname = new URL(`http://${authority}`).hostname
      } catch {
        return forbid()
      }
      if (hostname.startsWith('[')) hostname = hostname.slice(1, -1)
      const ipVersion = isIP(hostname)
      if (
        hostname !== 'localhost' &&
        (!ipVersion || !loopbackAddresses.check(hostname, ipVersion === 4 ? 'ipv4' : 'ipv6'))
      ) {
        return forbid()
      }

      // Leaving CORS broad on purpose.
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
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

      const url = new URL(req.url || '/', `http://localhost:${API_HTTP_PORT}`)

      if (isPlaygroundPath(url.pathname)) {
        const body = req.method === 'POST' ? Buffer.from(await readBody(req)).toString('utf8') : undefined
        const result = getPlayground().handle({method: req.method || 'GET', pathname: url.pathname, body})
        res.writeHead(result.status, result.headers)
        res.end(result.body)
        return
      }

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
    server.listen(port, 'localhost', () => {
      logger.info(`[API-SERVER]: Started on http://localhost:${port}`)
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
