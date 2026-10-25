// @vitest-environment node
// DNS-rebinding regression coverage for #1259.
import * as http from 'http'
import {connect, type AddressInfo} from 'net'
import {networkInterfaces} from 'os'
import {afterAll, beforeAll, describe, expect, it, vi} from 'vitest'

vi.mock('@shm/shared/constants', () => ({API_HTTP_PORT: '0', DAEMON_HTTP_URL: ''}))
vi.mock('@shm/shared/api-server', () => ({
  handleApiRequest: async () => ({status: 200, headers: {}, body: 'local API'}),
  handleApiAction: async () => ({status: 200, headers: {}, body: 'local API'}),
}))
vi.mock('../grpc-client', () => ({grpcClient: {}}))
vi.mock('../logger', () => ({info: vi.fn()}))

import {startApiServer, stopApiServer} from '../app-http-server'

let port: number
let hostname: string
let server: http.Server

async function startServer() {
  const listen = vi.spyOn(http.Server.prototype, 'listen')
  await startApiServer()
  server = listen.mock.instances[0] as http.Server
  const address = server.address() as AddressInfo
  port = address.port
  hostname = '127.0.0.1'
  listen.mockRestore()
}

beforeAll(async () => {
  vi.stubEnv('SEED_API_ALLOWED_PEERS', '100.64.0.0/10, 2001:db8:1234::/48, ::ffff:192.0.2.10, ::ffff:198.51.100.0/120')
  vi.stubEnv('SEED_API_ALLOWED_HOSTS', 'seed.tail.example')
  vi.stubEnv('SEED_API_ALLOWED_ORIGINS', 'https://trusted.example')
  vi.stubGlobal('localServerPort', 17655)
  await startServer()
})

async function closeServer() {
  const closed = new Promise<void>((resolve) => server.once('close', resolve))
  stopApiServer()
  await closed
}

afterAll(async () => {
  await closeServer()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function request(host: string, headers: http.OutgoingHttpHeaders = {}, method = 'GET', peer = hostname) {
  return new Promise<{status: number; body: string; headers: http.IncomingHttpHeaders}>((resolve, reject) => {
    const req = http.request(
      {
        hostname: peer,
        port,
        path: '/api/test',
        method,
        setHost: false,
        headers: {Host: host, ...headers},
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (body += chunk))
        res.on('end', () => resolve({status: res.statusCode!, body, headers: res.headers}))
        res.on('error', reject)
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('SEC #1259 local API Host validation', () => {
  it.each([
    'localhost',
    'LOCALHOST:58004',
    '127.0.0.1',
    '127.23.45.67:56004',
    '[::1]',
    '[0:0:0:0:0:0:0:1]:58004',
    '[::ffff:127.0.0.1]:56004',
    '[::ffff:7f17:2d43]',
  ])('preserves local authority %s', async (host) => {
    expect(await request(host, {'Sec-Fetch-Site': 'same-origin'})).toMatchObject({
      status: 200,
      body: 'local API',
    })
  })

  it.each([
    'attacker.example:58004',
    'localhost.attacker.example',
    'app.localhost',
    '192.168.1.2:58004',
    '[::ffff:192.168.1.2]:58004',
    '[2001:db8::1]',
    'attacker.example@localhost',
    'localhost/attacker.example',
    'localhost?attacker.example',
    'localhost#attacker.example',
    'localhost:bad',
    'localhost:',
    '127.1',
    '2130706433',
    'seed.tail.example.attacker.example',
  ])('rejects nonlocal or malformed authority %s despite same-origin metadata', async (host) => {
    expect((await request(host, {'Sec-Fetch-Site': 'same-origin'})).status).toBe(403)
  })

  it.each(['GET', 'POST'])('rejects a rebinding Host for %s without fetch metadata', async (method) => {
    expect((await request('attacker.example', {}, method)).status).toBe(403)
  })

  it('rejects a same-origin browser POST through a rebinding Host', async () => {
    expect(
      (await request('attacker.example', {'Sec-Fetch-Site': 'same-origin', Origin: 'http://attacker.example'}, 'POST'))
        .status,
    ).toBe(403)
  })

  it.each(['GET', 'OPTIONS'])('requires Host for HTTP/1.0 %s requests', async (method) => {
    // HTTP/1.1 requires Host at the Node HTTP parser, so use HTTP/1.0.
    const response = await new Promise<string>((resolve, reject) => {
      const socket = connect({host: hostname, port}, () => {
        socket.end(`${method} /api/test HTTP/1.0\r\n\r\n`)
      })
      let data = ''
      socket.setEncoding('utf8')
      socket.on('data', (chunk) => (data += chunk))
      socket.on('end', () => resolve(data))
      socket.on('error', reject)
    })
    expect(response).toMatch(/^HTTP\/1\.1 403 /)
    expect(response).not.toContain('local API')
  })

  it('preserves local tooling with Host and no fetch metadata', async () => {
    expect(await request('localhost')).toMatchObject({status: 200, body: 'local API'})
  })

  it.each(['GET', 'POST', 'OPTIONS'])('preserves same-origin browser %s with its actual Host', async (method) => {
    const response = await request(
      `localhost:${port}`,
      {'Sec-Fetch-Site': 'same-origin', Origin: `http://localhost:${port}`},
      method,
    )
    expect(response.status).toBe(method === 'OPTIONS' ? 204 : 200)
    expect(response.headers['access-control-allow-origin']).toBe(`http://localhost:${port}`)
  })

  it.each(['same-site', 'cross-site', 'same-origin', 'none', undefined])(
    'rejects a foreign Origin with metadata %s before POST and preflight',
    async (site) => {
      const headers: http.OutgoingHttpHeaders = {Origin: 'https://attacker.example'}
      if (site) headers['Sec-Fetch-Site'] = site
      for (const method of ['POST', 'OPTIONS']) {
        const response = await request('localhost', headers, method)
        expect(response.status).toBe(403)
        expect(response.body).not.toContain('local API')
        expect(response.headers['access-control-allow-origin']).toBeUndefined()
      }
    },
  )

  it.each(['null', 'file://', 'not an origin', 'http://localhost/path', 'http://user@localhost', 'http://localhost/'])(
    'rejects invalid Origin %s',
    async (origin) => {
      expect((await request('localhost', {Origin: origin, 'Sec-Fetch-Site': 'same-origin'})).status).toBe(403)
    },
  )

  it.each(['https://trusted.example', 'http://localhost:17655'])(
    'admits exact configured or packaged app origin %s without metadata',
    async (origin) => {
      for (const method of ['POST', 'OPTIONS']) {
        const response = await request('localhost', {Origin: origin}, method)
        expect(response.status).toBe(method === 'OPTIONS' ? 204 : 200)
        expect(response.headers['access-control-allow-origin']).toBe(origin)
        expect(response.headers.vary).toBe('Origin')
      }
    },
  )

  it.each(['same-site', 'cross-site'])(
    'admits renderer subresources without Origin using the exact Referer origin (%s)',
    async (site) => {
      expect(
        (await request('localhost', {Referer: 'http://localhost:17655/document', 'Sec-Fetch-Site': site})).status,
      ).toBe(200)
    },
  )

  it.each(['https://attacker.example/', 'https://trusted.example.attacker.example/', 'not a URL'])(
    'rejects an untrusted Referer %s even without metadata',
    async (referer) => {
      expect((await request('localhost', {Referer: referer})).status).toBe(403)
    },
  )

  it('does not let a trusted Referer override an untrusted Origin', async () => {
    expect(
      (await request('localhost', {Origin: 'https://attacker.example', Referer: 'http://localhost:17655/'})).status,
    ).toBe(403)
  })

  it('admits the actual development renderer origin and retains configured origins', async () => {
    await closeServer()
    vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', 'http://localhost:5173/renderer')
    await startServer()
    try {
      for (const origin of ['http://localhost:5173', 'https://trusted.example']) {
        const response = await request('localhost', {Origin: origin, 'Sec-Fetch-Site': 'cross-site'}, 'POST')
        expect(response.status).toBe(200)
        expect(response.headers['access-control-allow-origin']).toBe(origin)
      }
      expect((await request('localhost', {Origin: 'http://localhost:5174'}, 'POST')).status).toBe(403)
    } finally {
      await closeServer()
      vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined)
      await startServer()
    }
  })

  it('allows direct navigation with no Origin but rejects same-site metadata alone', async () => {
    expect((await request('localhost', {'Sec-Fetch-Site': 'none'})).status).toBe(200)
    expect((await request('localhost', {'Sec-Fetch-Site': 'same-site'})).status).toBe(403)
    expect(
      (await request('localhost:58004', {Origin: 'http://localhost:58005', 'Sec-Fetch-Site': 'same-origin'})).status,
    ).toBe(403)
  })

  it('preserves independent browser admission with and without metadata', async () => {
    expect((await request('localhost', {'Sec-Fetch-Site': 'cross-site'})).status).toBe(403)
    expect((await request('localhost', {Origin: 'http://localhost'})).status).toBe(200)
    expect((await request('localhost', {Origin: 'http://localhost', 'Sec-Fetch-Site': 'none'})).status).toBe(200)
    expect((await request('localhost', {Origin: 'https://trusted.example', 'Sec-Fetch-Site': 'unknown'})).status).toBe(
      403,
    )
  })

  it('rejects a nonlocal Host before the OPTIONS shortcut', async () => {
    expect((await request('attacker.example', {}, 'OPTIONS')).status).toBe(403)
  })

  it('preserves OPTIONS handling', async () => {
    expect((await request('localhost', {}, 'OPTIONS')).status).toBe(204)
    expect((await request('localhost', {'Sec-Fetch-Site': 'cross-site'}, 'OPTIONS')).status).toBe(403)
  })

  it.each([
    '100.64.23.1:58004',
    '[::ffff:100.64.23.1]:58004',
    '[2001:db8:1234::1]',
    '192.0.2.10',
    '198.51.100.42',
    'seed.tail.example:58004',
  ])('admits explicitly configured Host %s', async (host) => {
    expect((await request(host)).status).toBe(200)
    expect(
      (await request(host, {Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'same-site'}, 'POST')).status,
    ).toBe(403)
  })

  const nonlocalAddress = Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === 'IPv4' && !address.internal)?.address
  it.skipIf(!nonlocalAddress)(
    'filters real nonloopback socket peers independently of Host and forwarded headers',
    async () => {
      const peer = nonlocalAddress!
      await closeServer()
      const originalPeers = process.env.SEED_API_ALLOWED_PEERS!
      vi.stubEnv('SEED_API_ALLOWED_PEERS', '')
      await startServer()
      try {
        expect(
          (await request('localhost', {'X-Forwarded-For': '127.0.0.1', Forwarded: 'for=127.0.0.1'}, 'GET', peer))
            .status,
        ).toBe(403)
        await closeServer()
        vi.stubEnv('SEED_API_ALLOWED_PEERS', `${peer}/32`)
        await startServer()
        expect((await request(peer, {}, 'POST', peer)).status).toBe(200)
        expect((await request('attacker.example', {}, 'POST', peer)).status).toBe(403)
        expect((await request(peer, {Origin: 'https://attacker.example'}, 'OPTIONS', peer)).status).toBe(403)
      } finally {
        await closeServer()
        vi.stubEnv('SEED_API_ALLOWED_PEERS', originalPeers)
        await startServer()
      }
    },
  )
})
