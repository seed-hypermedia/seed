import * as http from 'http'
import {BlockList, isIP} from 'net'
import {handleApiAction, handleApiRequest} from '@shm/shared/api-server'
import {API_HTTP_PORT, DAEMON_HTTP_URL} from '@shm/shared/constants'
import {grpcClient} from './grpc-client'
import * as logger from './logger'

let server: http.Server | null = null

function normalizeAddress(address: string): string {
  if (isIP(address) !== 6) return address
  const mapped = new URL(`http://[${address}]`).hostname.match(/^\[::ffff:([\da-f]+):([\da-f]+)\]$/)
  if (!mapped) return address
  const high = parseInt(mapped[1]!, 16)
  const low = parseInt(mapped[2]!, 16)
  return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
}

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

/**
 * Starts the desktop API, trusting admitted local processes with full API access.
 * Loopback is a network boundary, not isolation between OS users; local tools
 * need no per-launch app secret. Host and browser-origin checks independently
 * protect against hostile websites reaching loopback, including DNS rebinding.
 * Keep this policy aligned with the daemon's default-mode ingress policy. The
 * desktop bridge always enforces it; the daemon's server-mode bypass is separate.
 */
export function startApiServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (server) {
      resolve()
      return
    }

    const allowedPeers = new BlockList()
    allowedPeers.addSubnet('127.0.0.0', 8, 'ipv4')
    allowedPeers.addAddress('::1', 'ipv6')
    const allowedOrigins = new Set(
      (process.env.SEED_API_ALLOWED_ORIGINS || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    )
    const serverPort = (global as typeof globalThis & {localServerPort?: number}).localServerPort
    const appURL = typeof MAIN_WINDOW_VITE_DEV_SERVER_URL !== 'undefined' && MAIN_WINDOW_VITE_DEV_SERVER_URL
    if (appURL) allowedOrigins.add(new URL(appURL).origin)
    else if (serverPort) allowedOrigins.add(`http://localhost:${serverPort}`)

    server = http.createServer(async (req, res) => {
      const forbid = () => {
        res.writeHead(403, {'Content-Type': 'application/json'})
        res.end(JSON.stringify({error: 'Forbidden'}))
      }

      // Trust the socket peer, never forwarded headers. Normalize IPv4-mapped IPv6
      // so dual-stack listeners apply the same policy to IPv4 clients.
      const peer = normalizeAddress(req.socket.remoteAddress || '')
      const peerVersion = isIP(peer)
      if (!peerVersion || !allowedPeers.check(peer, peerVersion === 4 ? 'ipv4' : 'ipv6')) return forbid()

      // DNS rebinding can preserve same-origin metadata. Validate Host independently
      // as an authority, without DNS lookups or URL userinfo/path interpretation.
      const authority = req.headers.host
      if (!authority || /[\s/\\@?#%]/.test(authority)) return forbid()
      const hostParts = authority.match(/^(\[[\da-fA-F:.]+\]|[^:]+)(?::\d+)?$/)
      if (!hostParts) return forbid()
      let hostname: string
      let requestOrigin: string
      try {
        // The synthetic "http://" scheme lets URL parse a host, optional port, and
        // bracketed IPv6 address. This only parses text; it makes no request.
        const hostURL = new URL(`http://${authority}`)
        hostname = hostURL.hostname
        requestOrigin = hostURL.origin
      } catch {
        return forbid()
      }
      if (hostname.startsWith('[')) hostname = hostname.slice(1, -1)
      const literalHost = hostParts[1]!.replace(/^\[|\]$/g, '')
      // URL accepts legacy numeric IPv4 spellings; admission requires literal IPs.
      if (isIP(hostname) && !isIP(literalHost)) return forbid()
      hostname = normalizeAddress(hostname)
      const ipVersion = isIP(hostname)
      if (
        hostname !== 'localhost' &&
        (!ipVersion || !allowedPeers.check(hostname, ipVersion === 4 ? 'ipv4' : 'ipv6'))
      ) {
        return forbid()
      }

      const site = req.headers['sec-fetch-site']
      const origin = req.headers.origin
      if (origin !== undefined) {
        try {
          const parsed = new URL(origin)
          if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) return forbid()
        } catch {
          return forbid()
        }
      }
      // Browser admission is independent of peer/Host admission. Exact trusted
      // origins also work when Fetch Metadata is absent (including the renderer).
      let sourceOrigin = origin
      if (origin === undefined && req.headers.referer !== undefined) {
        // Media and frames can omit Origin; compare the exact Referer origin.
        try {
          const referrer = new URL(req.headers.referer)
          if (!['http:', 'https:'].includes(referrer.protocol) || referrer.username || referrer.password)
            return forbid()
          sourceOrigin = referrer.origin
        } catch {
          return forbid()
        }
      }
      const trustedOrigin = !!sourceOrigin && (sourceOrigin === requestOrigin || allowedOrigins.has(sourceOrigin))
      if (sourceOrigin !== undefined && !trustedOrigin) return forbid()
      switch (site) {
        case undefined:
        case 'none':
        case 'same-origin':
          // Headerless tools still pass peer/Host admission; any supplied browser
          // source was checked above. Same-site alone never establishes trust.
          break
        case 'same-site':
        case 'cross-site':
          if (!trustedOrigin) return forbid()
          break
        default:
          return forbid()
      }

      for (const [key, value] of Object.entries(CORS_HEADERS)) res.setHeader(key, value)
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin)
        res.setHeader('Vary', 'Origin')
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return
      }

      const url = new URL(req.url || '/', `http://localhost:${API_HTTP_PORT}`)

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
    // Keep admission at the request boundary instead of coupling policy to the
    // bind address. The peer gate above restricts this wildcard listener to loopback.
    server.listen(port, () => {
      logger.info(`[API-SERVER]: Started on http://localhost:${port}`)
      resolve()
    })

    server.on('error', (err) => {
      reject(err)
    })
  })
}

/** Stops the desktop API listener. */
export function stopApiServer() {
  if (server) {
    server.close()
    server = null
    logger.info('[API-SERVER]: Stopped')
  }
}
