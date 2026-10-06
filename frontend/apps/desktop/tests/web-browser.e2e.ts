import {test, expect, _electron} from '@playwright/test'
import {build} from 'esbuild'
import {FiltersEngine} from '@ghostery/adblocker'
import {createServer} from 'node:http'
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'

test('embedded Chromium preserves history, routes Seed links, and isolates website privileges', async () => {
  test.setTimeout(60000)
  const directory = await mkdtemp(path.join(tmpdir(), 'seed-web-browser-e2e-'))
  let blockedHostRequests = 0
  let trackerRequests = 0
  const server = createServer((request, response) => {
    if (request.headers.host?.startsWith('seed-blocked.test:')) blockedHostRequests++
    if (request.url === '/fixture-tracker.js') {
      trackerRequests++
      response.setHeader('Content-Type', 'application/javascript')
      response.end('window.trackerLoaded = true')
      return
    }
    if (request.url === '/tracking') {
      response.setHeader('Content-Type', 'text/html')
      response.end('<h1>Tracking fixture</h1><script src="/fixture-tracker.js"></script>')
      return
    }
    if (request.url === '/icons/site.svg') {
      if (!request.headers.cookie?.includes('icon-session=allowed')) {
        response.writeHead(401)
        response.end()
        return
      }
      response.writeHead(302, {Location: '/icons/final.svg'})
      response.end()
      return
    }
    if (request.url === '/favicon.ico') {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
        'base64',
      )
      const header = Buffer.alloc(22)
      header.writeUInt16LE(1, 2)
      header.writeUInt16LE(1, 4)
      header[6] = header[7] = 1
      header.writeUInt16LE(1, 10)
      header.writeUInt16LE(32, 12)
      header.writeUInt32LE(png.length, 14)
      header.writeUInt32LE(22, 18)
      response.setHeader('Content-Type', 'image/x-icon')
      response.end(Buffer.concat([header, png]))
      return
    }
    if (request.url?.startsWith('/icons/') || request.url === '/favicon.ico') {
      response.setHeader('Content-Type', 'image/svg+xml')
      response.end(
        '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="green"/></svg>',
      )
      return
    }
    if (request.url === '/redirect') {
      response.writeHead(302, {Location: '/second'})
      response.end()
      return
    }
    response.setHeader('Content-Type', 'text/html')
    response.setHeader('Set-Cookie', 'icon-session=allowed; Path=/; HttpOnly')
    response.end(`<title>${request.url}</title>
      ${
        request.url === '/first'
          ? '<base href="/icons/"><link rel="icon" href="site.svg" type="image/svg+xml" sizes="any">'
          : ''
      }
      <meta name="author" content="Fixture author">
      <meta name="description" content="Fixture description">
      <article><h1>Article heading</h1><p>Archive this <strong>content</strong>.</p><p style="display:none">hidden-secret</p></article>
      <input id="remember" aria-label="Remember" value="initial">
      <input type="password" aria-label="Password" value="password-secret">
      <p style="opacity:0">opacity-secret</p>
      <p style="position:absolute;left:-9999px">offscreen-secret</p>
      <p style="font-size:1px">tiny-secret</p>
      <p style="color:transparent">transparent-secret</p>
      <span style="position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)">clip-secret</span>
      <form action="https://collector.example/submit"><input aria-label="Leak"></form>
      <a id="next" href="/redirect">Next</a>
      <a id="seed" href="hm://alice/docs">Seed document</a>
      <a id="popup" href="/popup" target="_blank">Popup</a>`)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  const origin = `http://127.0.0.1:${address.port}`
  let electron: Awaited<ReturnType<typeof _electron.launch>> | undefined
  try {
    const main = path.join(directory, 'main.cjs')
    const preload = path.join(directory, 'preload.cjs')
    const html = path.join(directory, 'index.html')
    await build({
      entryPoints: ['tests/fixtures/web-browser-main.ts'],
      outfile: main,
      bundle: true,
      platform: 'node',
      external: ['electron'],
      tsconfig: 'tsconfig.json',
    })
    await build({
      entryPoints: ['tests/fixtures/web-browser-preload.ts'],
      outfile: preload,
      bundle: true,
      platform: 'node',
      external: ['electron'],
    })
    await writeFile(html, `<html><body><div id="browser" style="width:900px;height:600px"></div></body></html>`)
    await mkdir(path.join(directory, 'profile/browser'), {recursive: true})
    await writeFile(
      path.join(directory, 'profile/browser/blocklist.json'),
      JSON.stringify({checkedAt: Date.now(), hosts: ['seed-blocked.test']}),
    )
    const engine = FiltersEngine.parse('/fixture-tracker.js$script', {loadCosmeticFilters: false})
    await writeFile(
      path.join(directory, 'profile/browser/content-blocker.json'),
      JSON.stringify({checkedAt: Date.now(), engine: Buffer.from(engine.serialize()).toString('base64')}),
    )
    electron = await _electron.launch({
      args: [main, '--fixture', html, preload, path.join(directory, 'profile')],
      env: {...process.env, SEED_FIXTURE_DATA_DIR: path.join(directory, 'profile')},
    })
    const page = await electron.firstWindow()
    // Electron 44 hands Playwright the window before loadFile commits; wait for the fixture page.
    await page.waitForURL(/index\.html$/)
    await page.waitForFunction(() => typeof (window as any).browserTest !== 'undefined')
    // The app page never holds a web view: it asks the main process for a guest and places it.
    const browserId: number = await page.evaluate(async () => {
      const {browserId} = await (window as any).browserTest.create()
      ;(window as any).browserTest.bounds({browserId, visible: true, bounds: {x: 0, y: 0, width: 900, height: 600}})
      return browserId
    })
    expect(await page.evaluate(() => document.querySelector('webview'))).toBeNull()
    const navigate = async (url: string, requestId: number, historyIndex?: number) => {
      await page.evaluate((input) => (window as any).browserTest.navigate(input), {
        browserId,
        url,
        requestId,
        historyIndex,
      })
      await expect
        .poll(() => page.evaluate(() => (window as any).browserTest.events()), {timeout: 10000})
        .toEqual(expect.arrayContaining([expect.objectContaining({type: 'browser-location', requestId, url})]))
    }
    await navigate(`${origin}/first`, 1)
    await expect
      .poll(() => page.evaluate(() => (window as any).browserTest.events()))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'browser-favicons',
            url: `${origin}/first`,
            icons: [expect.stringMatching(/^data:image\/svg\+xml;base64,/)],
          }),
        ]),
      )
    const first = await page.evaluate(() =>
      (window as any).browserTest
        .events()
        .find((event: any) => event.type === 'browser-location' && event.requestId === 1),
    )
    const guest = await electron.evaluateHandle(({webContents}, id) => webContents.fromId(id)!, browserId)
    const connectionId = 'fixture-browser-connection'
    const command = (input: Record<string, unknown>) =>
      page.evaluate((input) => (window as any).browserTest.execute(input), {connectionId, command: input})
    await expect(command({action: 'snapshot'})).rejects.toThrow('Browser access is paused')
    const grant = {connectionId, browserId, accountUid: 'fixture-account', enabled: true}
    await page.evaluate((input) => (window as any).browserTest.access(input), grant)
    // A connection alone is not permission: the user has to allow this website.
    await expect(command({action: 'snapshot'})).rejects.toThrow('has not allowed browser access')
    await page.evaluate((input) => (window as any).browserTest.access(input), {...grant, origins: [origin]})
    const snapshot = await command({action: 'snapshot'})
    expect(snapshot.text).toContain('Article heading')
    for (const secret of [
      'password-secret',
      'hidden-secret',
      'opacity-secret',
      'offscreen-secret',
      'tiny-secret',
      'transparent-secret',
      'clip-secret',
    ])
      expect(JSON.stringify(snapshot)).not.toContain(secret)
    const ref = (name: string) => snapshot.elements.find((element: any) => element.name === name).ref
    await expect(
      command({action: 'type', document: snapshot.document, ref: ref('Password'), text: 'guess'}),
    ).rejects.toThrow('Password fields are for the user')
    await expect(
      command({action: 'type', document: snapshot.document, ref: ref('Leak'), text: 'secret'}),
    ).rejects.toThrow('submits to another website')
    const otherOrigin = origin.replace('127.0.0.1', 'localhost')
    await expect(
      command({action: 'navigate', document: snapshot.document, url: `${otherOrigin}/first`}),
    ).rejects.toThrow("needs the user's approval")
    expect(await guest.evaluate((contents) => contents.executeJavaScript('typeof window.__seedBrowser'))).toBe(
      'undefined',
    )
    expect(await guest.evaluate((contents) => contents.executeJavaScript('typeof window.browserAgent'))).toBe(
      'undefined',
    )
    const captured = await command({action: 'screenshot', document: snapshot.document})
    expect(captured.screenshot.mimeType).toBe('image/jpeg')
    expect(captured.screenshot.data).toMatch(/^\/9j/)
    const archive = await command({action: 'archive', document: snapshot.document})
    expect(archive.draftId).toBe('fixture-archive-draft')
    expect(archive.metadata.sourceAuthor).toBe('Fixture author')
    expect(archive.metadata.sourceUrl).toBe(`${origin}/first`)
    expect(archive.markdown).toContain('Archive this')
    expect(archive.markdown).not.toContain('hidden-secret')
    expect(archive.markdown).not.toContain('password-secret')
    expect(await guest.evaluate((contents) => contents.getURL())).toBe(`${origin}/first`)
    await command({
      action: 'type',
      document: snapshot.document,
      ref: snapshot.elements.find((element: any) => element.name === 'Remember').ref,
      text: 'saved',
    })
    const preferences = await guest.evaluate((contents) =>
      (contents as Electron.WebContents & {getLastWebPreferences(): Electron.WebPreferences}).getLastWebPreferences(),
    )
    expect(preferences).toMatchObject({
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    })
    expect(preferences.preload).toBeFalsy()
    expect(await guest.evaluate((contents) => contents.executeJavaScript('typeof require'))).toBe('undefined')
    expect(await guest.evaluate((contents) => contents.executeJavaScript('typeof window.ipc'))).toBe('undefined')
    const dynamicIcon =
      'data:image/svg+xml,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle r="8" cx="8" cy="8" fill="blue"/></svg>',
      )
    await guest.evaluate((contents) =>
      contents.executeJavaScript(`
      document.querySelector('link').rel = 'SHORTCUT ICON';
      const ignored = document.createElement('link');
      ignored.rel = 'icon'; ignored.href = '/icons/print.svg'; ignored.media = 'print';
      document.head.appendChild(ignored);
      const large = document.createElement('link');
      large.rel = 'icon'; large.href = '/icons/large.svg'; large.sizes = '256x256';
      document.head.appendChild(large);
    `),
    )
    await guest.evaluate(
      (contents, icon) => contents.executeJavaScript(`document.querySelector('link').href = ${JSON.stringify(icon)}`),
      dynamicIcon,
    )
    await expect
      .poll(() => page.evaluate(() => (window as any).browserTest.events()))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'browser-favicons',
            url: `${origin}/first`,
            icons: [dynamicIcon, expect.stringMatching(/^data:image\/svg\+xml;base64,/)],
          }),
        ]),
      )
    await command({
      action: 'click',
      document: snapshot.document,
      ref: snapshot.elements.find((element: any) => element.name === 'Next').ref,
    })
    await expect.poll(() => guest.evaluate((contents) => contents.getURL())).toBe(`${origin}/second`)
    await expect(command({action: 'type', document: snapshot.document, ref: 'e1', text: 'wrong page'})).rejects.toThrow(
      'Page changed',
    )
    await expect
      .poll(() => page.evaluate(() => (window as any).browserTest.events()))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'browser-favicons',
            url: `${origin}/second`,
            icons: [expect.stringMatching(/^data:image\/x-icon;base64,/)],
          }),
        ]),
      )
    const secondIndex = await guest.evaluate((contents) => contents.navigationHistory.getActiveIndex())
    await navigate(`${origin}/first`, 2, first.historyIndex)
    expect(
      await guest.evaluate((contents) => contents.executeJavaScript("document.querySelector('#remember').value")),
    ).toBe('saved')
    await navigate(`${origin}/second`, 3, secondIndex)
    await guest.evaluate((contents) =>
      contents.executeJavaScript("document.querySelector('#seed').click(); document.querySelector('#popup').click()"),
    )
    expect(await page.evaluate(() => (window as any).browserTest.events())).not.toEqual(
      expect.arrayContaining([expect.objectContaining({type: 'browser-open-url'})]),
    )
    const clickGuest = async (selector: string) => {
      await guest.evaluate(async (contents, target) => {
        const point = await contents.executeJavaScript(
          `(() => { const rect = document.querySelector(${JSON.stringify(
            target,
          )}).getBoundingClientRect(); return {x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2)} })()`,
        )
        contents.sendInputEvent({type: 'mouseDown', ...point, button: 'left', clickCount: 1})
        contents.sendInputEvent({type: 'mouseUp', ...point, button: 'left', clickCount: 1})
      }, selector)
    }
    await clickGuest('#seed')
    await expect
      .poll(() => page.evaluate(() => (window as any).browserTest.events()))
      .toEqual(expect.arrayContaining([expect.objectContaining({type: 'browser-open-url', url: 'hm://alice/docs'})]))
    expect(await guest.evaluate((contents) => contents.getURL())).toBe(`${origin}/second`)
    await clickGuest('#popup')
    await expect
      .poll(() => page.evaluate(() => (window as any).browserTest.events()))
      .toEqual(expect.arrayContaining([expect.objectContaining({type: 'browser-open-url', url: `${origin}/popup`})]))
    expect(await electron.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length)).toBe(1)
    await guest.evaluate((contents) => contents.executeJavaScript("history.pushState({}, '', '#section')"))
    await expect
      .poll(() => page.evaluate(() => (window as any).browserTest.events()))
      .toEqual(
        expect.arrayContaining([expect.objectContaining({type: 'browser-location', url: `${origin}/second#section`})]),
      )
    const reboundUrl = `http://seed-rebinding.test:${address.port}/first`
    // Even a website the user allowed is refused when its hostname resolves to a private address.
    await page.evaluate((input) => (window as any).browserTest.access(input), {
      ...grant,
      origins: [origin, new URL(reboundUrl).origin],
    })
    await navigate(reboundUrl, 4)
    await expect(command({action: 'snapshot'})).rejects.toThrow('private network')
    const reboundIndex = await guest.evaluate((contents) => contents.navigationHistory.getActiveIndex())
    await navigate(`${origin}/first`, 5)
    expect((await command({action: 'snapshot'})).url).toBe(`${origin}/first`)
    await navigate(reboundUrl, 6, reboundIndex)
    await expect(command({action: 'snapshot'})).rejects.toThrow('private network')
    const blockedUrl = `http://seed-blocked.test:${address.port}/first`
    await navigate(blockedUrl, 7)
    await expect
      .poll(() => guest.evaluate((contents) => contents.executeJavaScript('document.body.innerText')))
      .toContain('seed-blocked.test was flagged by OpenPhish')
    expect(await guest.evaluate((contents) => contents.executeJavaScript('document.body.innerText'))).not.toContain(
      'Article heading',
    )
    expect(blockedHostRequests).toBe(0)
    // A main-process load bypasses will-navigate and must still be stopped by webRequest.
    await navigate(`${origin}/first`, 8)
    await guest.evaluate((contents, url) => contents.loadURL(url).catch(() => {}), blockedUrl)
    await expect
      .poll(() => guest.evaluate((contents) => contents.executeJavaScript('document.body.innerText')))
      .toContain('seed-blocked.test was flagged by OpenPhish')
    expect(blockedHostRequests).toBe(0)
    await navigate(`${origin}/tracking`, 9)
    await expect
      .poll(() => page.evaluate(() => (window as any).browserTest.events()))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'browser-blocked-count',
            browserId,
            url: `${origin}/tracking`,
            count: 1,
            allowed: false,
          }),
        ]),
      )
    expect(trackerRequests).toBe(0)
    await page.evaluate((input) => (window as any).browserTest.allowTrackers(input), {browserId, origin, allowed: true})
    await expect
      .poll(() => guest.evaluate((contents) => contents.executeJavaScript('window.trackerLoaded === true')))
      .toBe(true)
    expect(trackerRequests).toBe(1)
    await expect
      .poll(() => page.evaluate(() => (window as any).browserTest.events()))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'browser-blocked-count',
            browserId,
            url: `${origin}/tracking`,
            count: 0,
            allowed: true,
          }),
        ]),
      )
    const beforeToggle = await page.evaluate(() => (window as any).browserTest.events().length)
    await page.evaluate((input) => (window as any).browserTest.allowTrackers(input), {
      browserId,
      origin,
      allowed: false,
    })
    await expect
      .poll(() => guest.evaluate((contents) => contents.executeJavaScript('document.readyState')))
      .toBe('complete')
    await expect
      .poll(() => page.evaluate((start) => (window as any).browserTest.events().slice(start), beforeToggle))
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({type: 'browser-blocked-count', browserId, count: 1, allowed: false}),
        ]),
      )
    expect(trackerRequests).toBe(1)
    await page.addScriptTag({url: `${origin}/fixture-tracker.js`})
    expect(await page.evaluate(() => (window as any).trackerLoaded)).toBe(true)
    expect(trackerRequests).toBe(2)
    await page.evaluate(() => (window as any).browserTest.hide())
    await expect(command({action: 'snapshot'})).rejects.toThrow('Browser access is paused')
  } finally {
    await electron?.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, {recursive: true, force: true})
  }
})
