import {test, expect, _electron} from '@playwright/test'
import {build} from 'esbuild'
import {createServer} from 'node:http'
import {mkdtemp, writeFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {agentAppDocument} from '@seed-hypermedia/agents-protocol'

test('apps run in browser and chat sandboxes without inheriting Seed access or network', async () => {
  test.setTimeout(60000)
  const directory = await mkdtemp(path.join(tmpdir(), 'seed-agent-app-e2e-'))
  const requests: string[] = []
  const server = createServer((request, response) => {
    requests.push(request.url!)
    response.end('Unexpected network')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as {port: number}
  const target = `http://127.0.0.1:${address.port}`
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
    await writeFile(
      html,
      '<html><body><h1>Seed host</h1><webview id="browser" partition="persist:seed-web-browser" src="about:blank" style="width:900px;height:500px"></webview></body></html>',
    )
    electron = await _electron.launch({args: [main, '--fixture', html, preload, path.join(directory, 'profile')]})
    const page = await electron.firstWindow()
    const app = {
      version: 1 as const,
      title: 'Budget calculator',
      html: `<!doctype html><html><body>
      <h1>Budget calculator</h1><label>Amount <input id="amount" type="number" value="10"></label>
      <button id="calculate">Double</button><output id="result"></output>
      <button id="share">Share result</button><button id="navigate">Try network navigation</button>
      <img id="inline-image" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12'%3E%3Crect width='12' height='12' fill='green'/%3E%3C/svg%3E">
      <script>
        document.querySelector('#calculate').onclick = () => document.querySelector('#result').textContent = String(Number(document.querySelector('#amount').value) * 2);
        document.querySelector('#share').onclick = () => parent.postMessage({type:'seed-app-result',value:{amount: Number(document.querySelector('#amount').value)}}, '*');
        document.querySelector('#navigate').onclick = () => location.href = '${target}/navigation';
        window.checks = {node: typeof require, bridge: typeof browserTest};
        try { parent.document.body.textContent = 'escaped'; window.checks.parent = true } catch { window.checks.parent = false }
        try { localStorage.setItem('escape','1'); window.checks.storage = true } catch { window.checks.storage = false }
        try { top.location.href = '${target}/top' } catch {}
        fetch('${target}/fetch').catch(() => {});
        const image = new Image(); image.src = '${target}/image';
      </script></body></html>`,
    }
    const url = await page.evaluate((app) => (window as any).browserTest.openApp(app), app)
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]+\/[a-f0-9]+$/)
    await expect
      .poll(() =>
        page.evaluate(() => {
          try {
            return (document.querySelector('webview') as Electron.WebviewTag).getWebContentsId()
          } catch {
            return 0
          }
        }),
      )
      .toBeGreaterThan(0)
    const browserId = await page.evaluate(() =>
      (document.querySelector('webview') as Electron.WebviewTag).getWebContentsId(),
    )
    await page.evaluate(({url, browserId}) => (window as any).browserTest.navigate({url, browserId, requestId: 1}), {
      url,
      browserId,
    })
    await expect
      .poll(() => page.evaluate(() => (window as any).browserTest.events()))
      .toEqual(expect.arrayContaining([expect.objectContaining({type: 'browser-location', url})]))
    const guest = await electron.evaluateHandle(({webContents}, id) => webContents.fromId(id)!, browserId)
    const checks = () =>
      guest.evaluate(async (contents) => {
        const frame = contents.mainFrame.frames[0]
        return frame?.executeJavaScript('window.checks')
      })
    await expect.poll(checks).toEqual({node: 'undefined', bridge: 'undefined', parent: false, storage: false})
    expect(
      await guest.evaluate((contents) =>
        contents.mainFrame.frames[0].executeJavaScript(
          `document.querySelector('#amount').value='23'; document.querySelector('#calculate').click(); document.querySelector('#result').textContent`,
        ),
      ),
    ).toBe('46')
    expect(
      await guest.evaluate((contents) =>
        contents.mainFrame.frames[0].executeJavaScript(`document.querySelector('#inline-image').naturalWidth`),
      ),
    ).toBe(12)
    await test.info().attach('app-browser', {body: await page.screenshot(), contentType: 'image/png'})
    // A saved native history entry returns to the same app revision after visiting another app.
    const historyIndex = await guest.evaluate((contents) => contents.navigationHistory.getActiveIndex())
    const nextUrl = await page.evaluate(() =>
      (window as any).browserTest.openApp({version: 1, title: 'Second app', html: '<h1>Second app</h1>'}),
    )
    await page.evaluate(({url, browserId}) => (window as any).browserTest.navigate({url, browserId, requestId: 2}), {
      url: nextUrl,
      browserId,
    })
    await expect.poll(() => guest.evaluate((contents) => contents.getURL())).toBe(nextUrl)
    await page.evaluate(
      ({url, browserId, historyIndex}) =>
        (window as any).browserTest.navigate({url, browserId, historyIndex, requestId: 3}),
      {url, browserId, historyIndex},
    )
    await expect.poll(() => guest.evaluate((contents) => contents.getURL())).toBe(url)
    // Chat uses precisely the same wrapper, inside a sandboxed srcdoc frame.
    await page.evaluate((documentSource) => {
      const frame = document.createElement('iframe')
      frame.id = 'widget'
      frame.sandbox.add('allow-scripts')
      frame.srcdoc = documentSource
      document.body.append(frame)
      ;(window as any).widgetResults = []
      window.addEventListener('message', (event) => {
        if (event.source === frame.contentWindow) (window as any).widgetResults.push(event.data)
      })
    }, agentAppDocument(app))
    const widget = page.frameLocator('#widget').frameLocator('iframe')
    await widget.getByLabel('Amount').fill('42')
    await widget.getByRole('button', {name: 'Double', exact: true}).click()
    await expect(widget.locator('output')).toHaveText('84')
    await widget.getByRole('button', {name: 'Share result'}).click()
    await expect
      .poll(() => page.evaluate(() => (window as any).widgetResults))
      .toEqual([{type: 'seed-app-result', value: {amount: 42}}])
    await widget.getByRole('button', {name: 'Try network navigation'}).click()
    await expect(page.getByRole('heading', {name: 'Seed host'})).toBeVisible()
    expect(requests).toEqual([])
    // Ephemeral host exposes no directory, rejects guessed paths, and is not an API endpoint.
    expect((await fetch(new URL('/', url))).status).toBe(404)
    expect((await fetch(url, {method: 'POST'})).status).toBe(404)
    const response = await fetch(url)
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox allow-scripts')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await electron.close()
    electron = undefined
    await expect(fetch(url)).rejects.toThrow()
  } finally {
    await electron?.close()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, {recursive: true, force: true})
  }
})
