import {test, expect, _electron as electron, type ElectronApplication} from '@playwright/test'
import {spawn, type ChildProcess} from 'node:child_process'
import {once} from 'node:events'
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createInterface} from 'node:readline'

// Build the Go test server from this checkout. It starts the full daemon through
// makeTestApp/initHTTP, including real gRPC-web and file handlers, not a CORS stub.
test('a public browser page cannot operate the desktop daemon', async () => {
  test.setTimeout(240_000)
  const scratch = await mkdtemp(path.join(tmpdir(), 'seed-daemon-browser-'))
  const repo = path.resolve(__dirname, '../../../..')
  let daemon: ChildProcess | undefined
  let app: ElectronApplication | undefined
  const pageServer = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><title>Untrusted page</title>Untrusted page')
  })
  try {
    const binary = path.join(scratch, process.platform === 'win32' ? 'daemon.test.exe' : 'daemon.test')
    const build = spawn('go', ['test', '-c', '-o', binary, './backend/daemon'], {cwd: repo, stdio: 'inherit'})
    expect((await once(build, 'exit'))[0], 'Go daemon test server must build').toBe(0)
    daemon = spawn(binary, ['-test.run=^TestHTTPBrowserServer$', '-test.v', '-test.timeout=120s'], {
      cwd: repo,
      env: {...process.env, SEED_HTTP_BROWSER_TEST_SERVER: '1'},
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let output = ''
    daemon.stderr!.on('data', (data) => (output += String(data)))
    const lines = createInterface({input: daemon.stdout!})
    const [address, cid] = await new Promise<[string, string]>((resolve, reject) => {
      lines.on('line', (line) => {
        output += line + '\n'
        const match = /^SEED_BROWSER_SERVER (\S+) (\S+)$/.exec(line)
        if (match) resolve([match[1], match[2]])
      })
      daemon!.once('error', reject)
      daemon!.once('exit', (code) => reject(new Error(`Daemon exited (${code}): ${output}`)))
    })
    const daemonURL = `http://${address}`
    pageServer.listen(0, '127.0.0.1')
    await once(pageServer, 'listening')
    const port = (pageServer.address() as {port: number}).port
    const pageURL = `http://127.0.0.1:${port}`
    const main = path.join(scratch, 'main.cjs')
    await mkdir(path.join(scratch, 'electron'))
    await writeFile(
      main,
      `const {app, BrowserWindow, session} = require('electron');
app.commandLine.appendSwitch('ip-address-space-overrides', '127.0.0.1:${port}=public');
app.setPath('userData', ${JSON.stringify(path.join(scratch, 'electron'))});
globalThis.daemonResponses = [];
app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived({urls: [${JSON.stringify(daemonURL + '/*')}]}, (d, callback) => {
    globalThis.daemonResponses.push({url: d.url, method: d.method, status: d.statusCode, headers: d.responseHeaders});
    callback({});
  });
  const win = new BrowserWindow({show: false, webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true}});
  win.loadURL(${JSON.stringify(pageURL)});
});`,
    )
    app = await electron.launch({args: [main]})
    const page = await app.firstWindow()
    await page.waitForURL(pageURL + '/')
    // Simple no-cors POSTs reach the actual handlers rather than stopping at a
    // preflight. Even when JS cannot read an opaque response, Electron can verify
    // that the daemon itself rejected it (and emitted no CORS allow headers).
    const rpc = '/com.seed.daemon.v1alpha.Daemon/ListKeys'
    await page.evaluate(
      async ({daemonURL, rpc, cid}) => {
        for (const route of [rpc, '/ipfs/file-upload']) {
          await fetch(daemonURL + route, {method: 'POST', mode: 'no-cors', body: 'untrusted'}).catch(() => {})
        }
        // Also exercise the grpc-web content-type and its real browser preflight.
        await fetch(daemonURL + rpc, {
          method: 'POST',
          headers: {'Content-Type': 'application/grpc-web+proto', 'X-Grpc-Web': '1'},
          body: new Uint8Array([0, 0, 0, 0, 0]),
        }).catch(() => {})
        await fetch(`${daemonURL}/ipfs/${cid}`, {mode: 'no-cors'}).catch(() => {})
      },
      {daemonURL, rpc, cid},
    )
    const responses = () =>
      app!.evaluate(
        () =>
          (globalThis as any).daemonResponses as {
            url: string
            method: string
            status: number
            headers: Record<string, string[]>
          }[],
      )
    await expect.poll(async () => (await responses()).length).toBeGreaterThanOrEqual(4)
    const observed = await responses()
    for (const route of [rpc, '/ipfs/file-upload']) {
      const response = observed.find((r) => r.url === daemonURL + route && r.method === 'POST')
      expect(response?.status).toBe(403)
      expect(Object.keys(response!.headers).some((key) => key.toLowerCase().startsWith('access-control-allow-'))).toBe(
        false,
      )
    }
    expect(observed.find((r) => r.url === daemonURL + rpc && r.method === 'OPTIONS')?.status).toBe(403)
    expect(observed.find((r) => r.url === `${daemonURL}/ipfs/${cid}` && r.method === 'GET')?.status).toBe(200)
    expect(await (await fetch(`${daemonURL}/ipfs/${cid}`)).text()).toBe('public browser regression content')
  } finally {
    await app?.close()
    if (daemon && daemon.exitCode === null) {
      const exited = once(daemon, 'exit')
      daemon.stdin!.end()
      await exited
    }
    pageServer.closeAllConnections()
    await new Promise<void>((resolve) => pageServer.close(() => resolve()))
    await rm(scratch, {recursive: true, force: true})
  }
})
