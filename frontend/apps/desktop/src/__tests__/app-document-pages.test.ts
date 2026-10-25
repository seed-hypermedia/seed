import {EventEmitter} from 'node:events'
import {ipcMain, type Session} from 'electron'
import {describe, expect, it, vi} from 'vitest'

vi.mock('electron', () => ({ipcMain: {handle: vi.fn()}, protocol: {registerSchemesAsPrivileged: vi.fn()}}))

import {handleDocumentPageRequest, openDocumentPage, installDocumentPageProtocol} from '../app-document-pages'

const cid = 'bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e'
const docId = 'hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/pages/counter'

describe('custom HTML page origins', () => {
  it('pins bundle revisions and partitions native storage origins by viewer', async () => {
    const pages = new Map()
    const newer = 'bafybeiecq2irw4fl5vunnxo6cegoutv4de63h7n27tekkjtak3jrvrzzhe'
    const a = openDocumentPage(pages, {id: docId, cid, account: 'alice'})
    const b = openDocumentPage(pages, {id: docId, cid: newer, account: 'alice'})
    const otherViewer = openDocumentPage(pages, {id: docId, cid, account: 'bob'})
    expect(new Set([a, b, otherViewer]).size).toBe(3)
    expect(openDocumentPage(pages, {id: docId, cid, account: 'alice'})).not.toBe(a)
    expect(a).toMatch(/^seed-page:\/\/[a-f0-9]{40}\/$/)
    expect(openDocumentPage(pages, {id: docId, cid, account: null})).not.toBe(a)
    const fetchFile = vi.fn(async (bundle: string, path: string) => new Response(`${bundle}:${path}`))
    const options = {pages, frameAncestors: [], fetchFile}
    // Old views keep their code for late assets and reloads, even after another revision/viewer opens.
    for (const [url, expected] of [
      [a, cid],
      [b, newer],
      [otherViewer, cid],
      [a, cid],
    ]) {
      const response = await handleDocumentPageRequest({method: 'GET', url: `${url}assets/page.js`}, options)
      expect(await response.text()).toBe(`${expected}:assets/page.js`)
    }
    expect(() => openDocumentPage(pages, {id: 'https://x', cid, account: null})).toThrow()
    expect(() => openDocumentPage(pages, {id: docId, cid: 'ipfs://bafy/../etc', account: null})).toThrow()
    expect(() => openDocumentPage(pages, {id: docId, cid})).toThrow('viewer')
  })
})

describe('handleDocumentPageRequest', () => {
  function setup() {
    const pages = new Map()
    const url = openDocumentPage(pages, {id: docId, cid, account: null})
    const fetchFile = vi.fn(async (_cid: string, path: string) => {
      if (path === '' || path === 'index.html')
        return new Response('<h1>hi</h1>', {headers: {'content-type': 'text/html; charset=utf-8'}})
      if (path === 'assets/page.js') return new Response('1', {headers: {'content-type': 'text/javascript'}})
      return new Response('nope', {status: 404})
    })
    const options = {pages, frameAncestors: ['http://localhost:17654'], fetchFile}
    return {url, options, fetchFile}
  }

  it('serves the folder index, nested files and the bridge script with the page policy', async () => {
    const {url, options, fetchFile} = setup()
    const index = await handleDocumentPageRequest({method: 'GET', url}, options)
    expect(index.status).toBe(200)
    expect(await index.text()).toBe('<h1>hi</h1>')
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(index.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(index.headers.get('content-security-policy')).toContain('frame-ancestors http://localhost:17654')
    expect(fetchFile).toHaveBeenLastCalledWith(cid, '')

    const script = await handleDocumentPageRequest({method: 'GET', url: `${url}assets/page.js`}, options)
    expect(script.status).toBe(200)
    expect(fetchFile).toHaveBeenLastCalledWith(cid, 'assets/page.js')

    const client = await handleDocumentPageRequest({method: 'GET', url: `${url}.seed/client.js`}, options)
    expect(client.status).toBe(200)
    expect(await client.text()).toContain('window.seed')
    expect(client.headers.get('content-type')).toContain('javascript')
  })

  it('refuses unknown hosts, other methods, dot segments and the reserved prefix', async () => {
    const {url, options, fetchFile} = setup()
    expect(
      (await handleDocumentPageRequest({method: 'GET', url: `seed-page://${'b'.repeat(40)}/`}, options)).status,
    ).toBe(404)
    expect((await handleDocumentPageRequest({method: 'POST', url}, options)).status).toBe(405)
    expect((await handleDocumentPageRequest({method: 'GET', url: `${url}.seed/other.js`}, options)).status).toBe(404)
    expect((await handleDocumentPageRequest({method: 'GET', url: `${url}missing.txt`}, options)).status).toBe(404)
    // URL parsing collapses "..", encoded or not, before the handler sees the path.
    await handleDocumentPageRequest({method: 'GET', url: `${url}%2e%2e/x`}, options)
    expect(fetchFile).toHaveBeenLastCalledWith(cid, 'x')
    // An encoded slash would smuggle a separator into one segment; it is refused outright.
    expect((await handleDocumentPageRequest({method: 'GET', url: `${url}a%2f..%2fb`}, options)).status).toBe(400)
    expect(fetchFile).not.toHaveBeenCalledWith(cid, expect.stringContaining('..'))
  })

  it('reports a daemon failure without leaking it as success', async () => {
    const {url, options} = setup()
    options.fetchFile = vi.fn(async () => {
      throw new Error('daemon down')
    })
    const res = await handleDocumentPageRequest({method: 'GET', url}, options)
    expect(res.status).toBe(502)
  })
})

describe('desktop page launch cleanup', () => {
  it('only releases owned launches and clears every remaining origin when the owner closes', async () => {
    vi.mocked(ipcMain.handle).mockClear()
    const handle = vi.fn()
    const clearStorageData = vi.fn(async () => {})
    installDocumentPageProtocol({protocol: {handle}, clearStorageData} as unknown as Session, () => [])
    const handlers = new Map(vi.mocked(ipcMain.handle).mock.calls)
    const open = handlers.get('document-page-open')!
    const close = handlers.get('document-page-close')!
    const mainFrame = {}
    const sender = Object.assign(new EventEmitter(), {id: 1, mainFrame})
    const event = {sender, senderFrame: mainFrame} as unknown as Electron.IpcMainInvokeEvent
    const first = open(event, {id: docId, cid, account: 'alice'})
    const second = open(event, {id: docId, cid, account: 'alice'})
    expect(sender.listenerCount('destroyed')).toBe(1)
    expect(() => open({...event, senderFrame: {} as Electron.WebFrameMain}, {id: docId, cid, account: null})).toThrow(
      'Invalid page host',
    )
    const serve = handle.mock.calls[0]![1]
    expect((await serve({method: 'GET', url: `${first}.seed/client.js`})).status).toBe(200)
    close({...event, sender: {...sender, id: 2}} as unknown as Electron.IpcMainInvokeEvent, first)
    expect(clearStorageData).not.toHaveBeenCalled()
    close(event, first)
    expect((await serve({method: 'GET', url: `${first}.seed/client.js`})).status).toBe(404)
    expect(clearStorageData).toHaveBeenCalledWith({origin: first.slice(0, -1)})
    sender.emit('destroyed')
    expect((await serve({method: 'GET', url: `${second}.seed/client.js`})).status).toBe(404)
    expect(clearStorageData).toHaveBeenCalledTimes(2)
  })
})
