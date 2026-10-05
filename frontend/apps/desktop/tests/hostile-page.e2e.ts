import {_electron as electron, expect, test, type ElectronApplication} from '@playwright/test'
import {build} from 'esbuild'
import {mkdtemp, rm} from 'node:fs/promises'
import {createServer} from 'node:http'
import {tmpdir} from 'node:os'
import path from 'node:path'

test('app guards contain a hostile page on the default session', async () => {
  test.setTimeout(30_000)
  const directory = await mkdtemp(path.join(tmpdir(), 'seed-hostile-page-'))
  const server = createServer((req, res) => {
    res.setHeader('X-Frame-Options', 'DENY')
    if (req.url === '/safe.js') {
      res.setHeader('Content-Type', 'text/javascript')
      res.end(`
        window.violations = [];
        document.addEventListener('securitypolicyviolation', e => window.violations.push(e.effectiveDirective));
        window.externalScriptRan = true;
      `)
      return
    }
    res.setHeader('Content-Type', 'text/html')
    res.end(`<!doctype html><html><head><script src="/safe.js"></script></head><body>
      <button id="paste">Paste</button>
      <script>window.inlineScriptRan = true</script>
    </body></html>`)
  })
  let app: ElectronApplication | undefined
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, resolve)
    })
    const port = (server.address() as {port: number}).port
    const appOrigin = `http://127.0.0.1:${port}`
    const hostileOrigin = `http://localhost:${port}`
    const desktop = path.resolve(__dirname, '..')
    const mainPath = path.join(directory, 'main.cjs')
    const preloadPath = path.join(directory, 'preload.cjs')
    await build({
      stdin: {
        contents: `
          import {contextBridge, ipcRenderer} from 'electron';
          import {createRendererIPC} from './src/preload-ipc';
          contextBridge.exposeInMainWorld('ipc', createRendererIPC(ipcRenderer));
        `,
        resolveDir: desktop,
        loader: 'ts',
      },
      outfile: preloadPath,
      platform: 'node',
      format: 'cjs',
      bundle: true,
      external: ['electron'],
    })
    await build({
      stdin: {
        contents: `
          import {app, BrowserWindow, session, shell, ipcMain} from 'electron';
          import {installWindowGuards, installAppSessionGuards, openAppExternalLink} from './src/app-window-security';
          app.setPath('userData', ${JSON.stringify(path.join(directory, 'profile'))});
          const state = globalThis.hostileSuite = {opens: [], frames: [], ipc: []};
          shell.openExternal = async url => { state.opens.push(url); };
          ipcMain.on('arbitrary-command', () => state.ipc.push('arbitrary-command'));
          ipcMain.on('windowNavState', () => state.ipc.push('windowNavState'));
          app.whenReady().then(async () => {
            const policy = {
              appOrigin: ${JSON.stringify(appOrigin)},
              daemonOrigin: ${JSON.stringify(appOrigin)},
              fileOrigin: ${JSON.stringify(appOrigin)},
              connectOrigins: [], development: false,
            };
            installAppSessionGuards(session.defaultSession, policy);
            ipcMain.on('open-external-link', (event, url) => {
              if (event.senderFrame === event.sender.mainFrame) {
                void openAppExternalLink(event.sender, url, policy);
              }
            });
            const window = new BrowserWindow({
              show: true,
              webPreferences: {preload: ${JSON.stringify(preloadPath)}, contextIsolation: true, sandbox: true},
            });
            installWindowGuards(window, policy);
            window.webContents.on('will-frame-navigate', event => {
              state.frames.push({url: event.url, cancelled: event.defaultPrevented});
            });
            await window.loadURL(${JSON.stringify(hostileOrigin)});
          });
        `,
        resolveDir: desktop,
        loader: 'ts',
      },
      outfile: mainPath,
      platform: 'node',
      format: 'cjs',
      bundle: true,
      external: ['electron'],
    })
    app = await electron.launch({args: [mainPath, '--use-fake-device-for-media-stream']})
    const page = await app.firstWindow()
    await page.waitForURL(`${hostileOrigin}/`)
    await page.waitForLoadState('load')
    expect(
      await app.evaluate(
        ({session, BrowserWindow}) => BrowserWindow.getAllWindows()[0]!.webContents.session === session.defaultSession,
      ),
    ).toBe(true)

    await test.step('cancel foreign and deceptive frames without opening the OS browser', async () => {
      for (const url of ['https://evil.example/frame', 'https://evil.example/youtube.com']) {
        await page.evaluate((src) => {
          const frame = document.createElement('iframe')
          frame.src = src
          document.body.append(frame)
        }, url)
        await expect
          .poll(() => app!.evaluate(() => (globalThis as any).hostileSuite.frames))
          .toContainEqual({url, cancelled: true})
      }
      expect(await app!.evaluate(() => (globalThis as any).hostileSuite.opens)).toEqual([])
    })

    await test.step('deny popup schemes, scripted HTTPS popups and unknown IPC', async () => {
      await page.evaluate(() => {
        const urls = ['javascript:alert(1)', 'file:///tmp/seed-hostile', 'seed-hostile:launch', 'https://example.com']
        for (const url of urls) {
          window.open(url, '_blank')
        }
        ;(window as any).ipc.send('arbitrary-command')
        ;(window as any).ipc.send('windowNavState', {})
      })
      await expect.poll(() => app!.evaluate(() => (globalThis as any).hostileSuite.ipc)).toEqual(['windowNavState'])
      expect(await app!.evaluate(() => (globalThis as any).hostileSuite.opens)).toEqual([])
      expect(app!.windows()).toHaveLength(1)
    })

    await test.step('deny hostile notification, location, camera, microphone and clipboard requests', async () => {
      const permissions = await page.evaluate(async () => {
        const results = await Promise.all([
          Notification.requestPermission(),
          new Promise<string>((resolve) =>
            navigator.geolocation.getCurrentPosition(
              () => resolve('allowed'),
              (error) => resolve(error.code === 1 ? 'denied' : `error:${error.code}`),
            ),
          ),
          navigator.mediaDevices.getUserMedia({audio: true, video: true}).then(
            (stream) => {
              stream.getTracks().forEach((track) => track.stop())
              return 'allowed'
            },
            (error) => error.name,
          ),
          navigator.clipboard.readText().then(
            () => 'allowed',
            (error) => error.name,
          ),
        ])
        return results
      })
      expect(permissions).toEqual(['denied', 'denied', 'NotAllowedError', 'NotAllowedError'])
    })

    await test.step('strip frame protection only at the exact app origin', async () => {
      const headers = await app!.evaluate(
        async ({session}, urls) => {
          return Promise.all(
            urls.map(async (url) => {
              const response = await session.defaultSession.fetch(url)
              return response.headers.get('x-frame-options')
            }),
          )
        },
        [`${appOrigin}/`, `${hostileOrigin}/localhost/127.0.0.1`],
      )
      expect(headers).toEqual([null, 'DENY'])
    })

    await test.step('enforce the production app CSP while allowing an external self script', async () => {
      await page.goto(appOrigin)
      // Playwright page.evaluate manufactures user activation. Read through
      // Electron without its userGesture flag for these negative gesture checks.
      const scripts = await app!.evaluate(({BrowserWindow}) => {
        return BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(
          '({external: window.externalScriptRan, inline: window.inlineScriptRan})',
        )
      })
      expect(scripts.external).toBe(true)
      expect(scripts.inline).toBeUndefined()
      await expect
        .poll(() =>
          app!.evaluate(({BrowserWindow}) => {
            return BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript('window.violations')
          }),
        )
        .toContain('script-src-elem')
      const read = await app!.evaluate(async ({BrowserWindow}) => {
        return BrowserWindow.getAllWindows()[0]!.webContents.executeJavaScript(
          `Object.defineProperty(navigator, 'userActivation', {value: {isActive: true}, configurable: true});
           navigator.clipboard.readText().then(() => 'allowed', error => error.name)`,
        )
      })
      expect(read).toBe('NotAllowedError')
      await app!.evaluate(async ({BrowserWindow}) => {
        const contents = BrowserWindow.getAllWindows()[0]!.webContents
        await contents.executeJavaScript("window.open('https://example.com/scripted', '_blank')")
        await contents.executeJavaScriptInIsolatedWorld(1001, [{code: 'void 0'}])
      })
      expect(await app!.evaluate(() => (globalThis as any).hostileSuite.opens)).toEqual([])
    })

    await test.step('preserve app paste and external links on a real click', async () => {
      await page.evaluate(() => {
        document.getElementById('paste')!.addEventListener('click', async () => {
          ;(window as any).ipc.send('open-external-link', 'https://example.com/clicked')
          document.body.dataset.paste = await navigator.clipboard.readText().then(
            () => 'allowed',
            (error) => error.name,
          )
        })
      })
      await page.locator('#paste').click()
      await expect(page.locator('body')).toHaveAttribute('data-paste', 'allowed')
      await expect
        .poll(() => app!.evaluate(() => (globalThis as any).hostileSuite.opens))
        .toEqual(['https://example.com/clicked'])
    })
  } finally {
    try {
      await app?.close()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(directory, {recursive: true, force: true})
    }
  }
})
