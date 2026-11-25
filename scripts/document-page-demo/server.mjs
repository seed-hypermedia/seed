import {createServer} from 'node:http'
import {randomBytes} from 'node:crypto'
import {mkdir, readFile, readdir, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath, pathToFileURL} from 'node:url'
import {generateApp} from './agent.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const commonHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
}

/** Start two loopback-only origins; the runner serves no page files, credentials, or mutable state. */
export async function startDemo({
  hostPort = 53110,
  runnerPort = 53111,
  stateDir = resolve('tmp/document-page-demo'),
} = {}) {
  const csrf = randomBytes(32).toString('hex')
  const sinkRequests = []
  const generationControllers = new Set()
  let hostOrigin
  let runnerOrigin
  let generating = false
  const runnerScript = await readFile(join(here, 'runner.js'), 'utf8')
  const runner = createServer((req, res) => {
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, {
        ...commonHeaders,
        'Content-Type': type,
        'Content-Security-Policy': [
          'sandbox allow-scripts',
          "default-src 'none'",
          "script-src 'unsafe-inline'",
          "style-src 'unsafe-inline'",
          'img-src data: blob:',
          'font-src data:',
          "connect-src 'none'",
          "worker-src 'none'",
          "frame-src 'none'",
          "object-src 'none'",
          "base-uri 'none'",
          "form-action 'none'",
          `frame-ancestors ${hostOrigin}`,
        ].join('; '),
      })
      res.end(body)
    }
    if (req.headers.host !== new URL(runnerOrigin).host) return send(421, 'Unexpected Host')
    if (req.method !== 'GET') return send(405, 'GET only')
    const url = new URL(req.url, runnerOrigin)
    if (url.pathname === '/sink') {
      sinkRequests.push(url.searchParams.get('signal'))
      return send(200, 'Local navigation probe received. No real data was sent.')
    }
    if (url.pathname !== '/runner') return send(404, 'Not found')
    send(
      200,
      `<!doctype html><html><head><meta charset="utf-8"><title>Seed sandbox</title></head><body><script>const HOST_ORIGIN = ${JSON.stringify(
        hostOrigin,
      )};\n${runnerScript}</script></body></html>`,
      'text/html; charset=utf-8',
    )
  })
  const assets = {
    '/': ['host.html', 'text/html; charset=utf-8'],
    '/host.js': ['host.js', 'text/javascript; charset=utf-8'],
    '/bridge.js': ['bridge.js', 'text/javascript; charset=utf-8'],
    '/checks.js': ['checks.js', 'text/javascript; charset=utf-8'],
    '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  }
  const host = createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, {
        ...commonHeaders,
        'Content-Type': type,
        'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; frame-src ${runnerOrigin}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      })
      res.end(type === 'application/json' ? JSON.stringify(body) : body)
    }
    try {
      if (req.headers.host !== new URL(hostOrigin).host) return send(421, {error: 'Unexpected Host'})
      const url = new URL(req.url, hostOrigin)
      if (req.method === 'GET' && assets[url.pathname]) {
        const [file, type] = assets[url.pathname]
        return send(200, await readFile(join(here, file), 'utf8'), type)
      }
      if (req.method === 'GET' && url.pathname === '/api/config') {
        return send(200, {runnerOrigin, csrf})
      }
      if (req.method === 'GET' && url.pathname === '/api/pages') {
        const files = await readdir(stateDir).catch(() => [])
        const saved = await Promise.all(
          files
            .filter((file) => /^[a-f0-9-]+\.json$/.test(file))
            .map(async (file) => JSON.parse(await readFile(join(stateDir, file), 'utf8'))),
        )
        const example = JSON.parse(await readFile(join(here, 'example.json'), 'utf8'))
        return send(200, [example, ...saved])
      }
      if (req.method === 'POST' && url.pathname === '/api/generate') {
        if (req.headers.origin !== hostOrigin || req.headers['x-seed-demo-token'] !== csrf) {
          return send(403, {error: 'Generation must be requested from this demo page.'})
        }
        if (req.headers['content-type'] !== 'application/json') return send(415, {error: 'JSON required'})
        let body = ''
        for await (const chunk of req) {
          body += chunk
          if (Buffer.byteLength(body) > 8192) return send(413, {error: 'Prompt too long'})
        }
        const {prompt} = JSON.parse(body)
        if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) {
          return send(400, {error: 'Enter a page request of 1–4000 characters.'})
        }
        if (generating) return send(409, {error: 'An agent is already creating a page.'})
        generating = true
        const controller = new AbortController()
        generationControllers.add(controller)
        // A deadline bounds an external agent job; this does not synchronize browser lifecycle.
        const deadline = setTimeout(() => controller.abort(), 5 * 60 * 1000)
        res.once('close', () => {
          if (!res.writableEnded) controller.abort()
        })
        try {
          const artifact = await generateApp(prompt.trim(), {signal: controller.signal})
          await mkdir(stateDir, {recursive: true})
          await writeFile(join(stateDir, `${artifact.id}.json`), JSON.stringify(artifact, null, 2))
          send(200, artifact)
        } finally {
          clearTimeout(deadline)
          generationControllers.delete(controller)
          generating = false
        }
        return
      }
      send(404, {error: 'Not found'})
    } catch (error) {
      send(error instanceof SyntaxError ? 400 : 500, {error: error.message})
    }
  })
  async function listen(server, port) {
    await new Promise((done, fail) => {
      server.once('error', fail)
      server.listen(port, '127.0.0.1', done)
    })
    return `http://127.0.0.1:${server.address().port}`
  }
  hostOrigin = await listen(host, hostPort)
  try {
    runnerOrigin = await listen(runner, runnerPort)
  } catch (error) {
    host.close()
    throw error
  }
  return {
    hostOrigin,
    runnerOrigin,
    sinkRequests,
    close: async () => {
      for (const controller of generationControllers) controller.abort()
      await Promise.all(
        [host, runner].map(
          (server) =>
            new Promise((done) => {
              server.close(done)
              server.closeAllConnections()
            }),
        ),
      )
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const demo = await startDemo({
    hostPort: Number(process.env.DEMO_PORT || 53110),
    runnerPort: Number(process.env.DEMO_RUNNER_PORT || 53111),
  })
  console.log(`Seed page workshop: ${demo.hostOrigin}\nIsolated runner: ${demo.runnerOrigin}\nCtrl-C to stop.`)
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, async () => {
      await demo.close()
      process.exit(0)
    })
}
