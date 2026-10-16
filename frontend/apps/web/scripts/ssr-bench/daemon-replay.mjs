#!/usr/bin/env node
/**
 * Record/replay stand-in for the Seed daemon's HTTP port (gRPC-web + plain
 * HTTP), used by the SSR benchmark so renders are measured against fixed,
 * real daemon responses without a daemon's CPU or latency in the picture.
 *
 *   record:  node daemon-replay.mjs record --upstream http://localhost:56001 --fixtures <file.json> [--port 58999]
 *   replay:  node daemon-replay.mjs replay --fixtures <file.json> [--port 58999]
 *
 * Point the web server's DAEMON_HTTP_URL at http://localhost:<port>. In record
 * mode every request is forwarded upstream and the exchange is stored (keyed by
 * method + URL + sha256(body)); the fixture file is written on SIGINT/SIGTERM
 * and every few seconds. In replay mode exchanges are served byte-for-byte from
 * the fixture file; a request that was never recorded gets a gRPC NotFound and
 * is counted as a miss (reported on exit and at GET /__replay/stats).
 *
 * Recording only forwards reads (Get*, List*, Query*, Search*, BatchGet* RPCs and
 * plain GETs). Everything else is refused with PermissionDenied: the web server
 * reconciles daemon state at startup (it unsubscribes the daemon from every
 * account that is not in its site config), which must never reach a real node.
 */
import {createHash} from 'node:crypto'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import http from 'node:http'

const args = process.argv.slice(2)
const mode = args[0]
function opt(name, dflt) {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? dflt : args[i + 1]
}
const fixturesPath = opt('fixtures')
const port = Number(opt('port', '58999'))
const upstream = opt('upstream', 'http://localhost:56001')
if (!['record', 'replay'].includes(mode) || !fixturesPath) {
  console.error('usage: daemon-replay.mjs record|replay --fixtures <file.json> [--upstream URL] [--port N]')
  process.exit(2)
}

/** @type {Record<string, {status: number, headers: Record<string, string>, body: string}>} */
const fixtures = existsSync(fixturesPath) ? JSON.parse(readFileSync(fixturesPath, 'utf8')) : {}
const stats = {hits: 0, misses: 0, recorded: 0, missedKeys: new Set()}
const HOP_HEADERS = new Set(['connection', 'content-length', 'transfer-encoding', 'date', 'keep-alive'])

/** Only reads are forwarded to a real daemon while recording. */
function isReadOnly(req) {
  if (String(req.headers['content-type'] || '').startsWith('application/grpc')) {
    const method = req.url.split('?')[0].split('/').pop() || ''
    return /^(Get|List|Query|Search|BatchGet)/.test(method)
  }
  return req.method === 'GET' || req.method === 'HEAD'
}

function keyFor(method, url, body) {
  return `${method} ${url} ${createHash('sha256').update(body).digest('hex').slice(0, 32)}`
}

function save() {
  if (mode !== 'record') return
  writeFileSync(fixturesPath, JSON.stringify(fixtures))
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  return Buffer.concat(chunks)
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/__replay/stats') {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({...stats, missedKeys: [...stats.missedKeys], fixtures: Object.keys(fixtures).length}))
    return
  }
  const body = await readBody(req)
  const key = keyFor(req.method, req.url, body)
  if (mode === 'record' && !isReadOnly(req)) {
    // The web server's startup reconciles daemon state (e.g. applyConfigSubscriptions
    // unsubscribes every account not in the bench config). Never let that reach a
    // real daemon: refuse anything that is not a read, and record the refusal so
    // replay answers it the same way.
    console.error(`[daemon-replay] refused non-read call ${req.method} ${req.url}`)
    const refusal = {
      status: 200,
      headers: {
        'content-type': 'application/grpc-web+proto',
        'grpc-status': '7',
        'grpc-message': 'refused by recorder',
      },
      body: '',
    }
    fixtures[key] = refusal
    res.writeHead(refusal.status, refusal.headers)
    res.end()
    return
  }
  if (mode === 'replay') {
    const hit = fixtures[key]
    if (!hit) {
      stats.misses++
      stats.missedKeys.add(`${req.method} ${req.url}`)
      // A gRPC-web "trailers-only" NotFound, which connect surfaces as Code.NotFound.
      res.writeHead(200, {
        'content-type': 'application/grpc-web+proto',
        'grpc-status': '5',
        'grpc-message': 'not recorded',
      })
      res.end()
      return
    }
    stats.hits++
    const buf = Buffer.from(hit.body, 'base64')
    res.writeHead(hit.status, {...hit.headers, 'content-length': String(buf.length)})
    res.end(buf)
    return
  }
  try {
    const headers = {...req.headers}
    delete headers.host
    for (const h of HOP_HEADERS) delete headers[h]
    const up = await fetch(upstream + req.url, {
      method: req.method,
      headers,
      body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
    })
    const buf = Buffer.from(await up.arrayBuffer())
    const outHeaders = {}
    up.headers.forEach((v, k) => {
      if (!HOP_HEADERS.has(k) && k !== 'content-encoding') outHeaders[k] = v
    })
    fixtures[key] = {status: up.status, headers: outHeaders, body: buf.toString('base64')}
    stats.recorded++
    res.writeHead(up.status, {...outHeaders, 'content-length': String(buf.length)})
    res.end(buf)
  } catch (e) {
    console.error(`[daemon-replay] upstream error for ${key}:`, e)
    res.writeHead(502)
    res.end(String(e))
  }
})

const saveTimer = setInterval(save, 3000)
saveTimer.unref()
function shutdown() {
  save()
  if (mode === 'replay' && stats.misses) {
    console.error(`[daemon-replay] ${stats.misses} unrecorded requests:`, [...stats.missedKeys].slice(0, 20))
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
server.listen(port, () => {
  console.error(
    `[daemon-replay] ${mode} on http://localhost:${port} (${Object.keys(fixtures).length} fixtures)` +
      (mode === 'record' ? ` -> ${upstream}` : ''),
  )
})
