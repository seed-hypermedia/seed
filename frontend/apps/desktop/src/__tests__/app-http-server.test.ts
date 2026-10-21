// @vitest-environment node
// DNS-rebinding regression coverage for #1259.
import * as http from 'http'
import {connect, type AddressInfo} from 'net'
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

beforeAll(async () => {
  const listen = vi.spyOn(http.Server.prototype, 'listen')
  await startApiServer()
  server = listen.mock.instances[0] as http.Server
  const address = server.address() as AddressInfo
  port = address.port
  // Connect to the bound address; localhost can resolve differently for clients on Linux.
  hostname = address.address
  listen.mockRestore()
})

afterAll(async () => {
  const closed = new Promise<void>((resolve) => server.once('close', resolve))
  stopApiServer()
  await closed
})

function request(host: string, headers: http.OutgoingHttpHeaders = {}, method = 'GET') {
  return new Promise<{status: number; body: string}>((resolve, reject) => {
    const req = http.request(
      {
        hostname,
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
        res.on('end', () => resolve({status: res.statusCode!, body}))
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
    expect(await request(host, {'Sec-Fetch-Site': 'same-origin'})).toEqual({
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
    expect(await request('localhost')).toEqual({status: 200, body: 'local API'})
  })

  it.each(['same-origin', 'same-site', 'none'])('preserves allowed fetch metadata %s', async (site) => {
    expect((await request('localhost', {'Sec-Fetch-Site': site, Origin: 'http://localhost'})).status).toBe(200)
  })

  it('preserves fetch metadata rejection', async () => {
    expect((await request('localhost', {'Sec-Fetch-Site': 'cross-site'})).status).toBe(403)
    expect((await request('localhost', {Origin: 'http://localhost'})).status).toBe(403)
  })

  it('rejects a nonlocal Host before the OPTIONS shortcut', async () => {
    expect((await request('attacker.example', {}, 'OPTIONS')).status).toBe(403)
  })

  it('preserves OPTIONS handling', async () => {
    expect((await request('localhost', {'Sec-Fetch-Site': 'cross-site'}, 'OPTIONS')).status).toBe(204)
  })
})
