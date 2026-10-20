import {describe, expect, it, vi} from 'vitest'

vi.mock('electron', () => ({ipcMain: {handle: vi.fn()}, protocol: {registerSchemesAsPrivileged: vi.fn()}}))

import {documentAppHost, handleDocumentAppRequest, openDocumentApp} from '../app-document-apps'

const cid = 'bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e'
const docId = 'hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/apps/counter'

describe('document app origins', () => {
  it('derives one stable host per document and refuses bad registrations', () => {
    const apps = new Map()
    const url = openDocumentApp(apps, {id: docId, cid: `ipfs://${cid}`})
    expect(url).toBe(`seed-app://${documentAppHost(docId)}/`)
    expect(documentAppHost(docId)).toMatch(/^[0-9a-f]{40}$/)
    expect(documentAppHost(docId)).not.toBe(documentAppHost(docId + '-other'))
    // A new revision keeps the origin, so the app's storage survives an update.
    expect(openDocumentApp(apps, {id: docId, cid: 'bafybeiecq2irw4fl5vunnxo6cegoutv4de63h7n27tekkjtak3jrvrzzhe'})).toBe(
      url,
    )
    expect(() => openDocumentApp(apps, {id: 'https://x', cid})).toThrow()
    expect(() => openDocumentApp(apps, {id: docId, cid: 'ipfs://bafy/../etc'})).toThrow()
  })
})

describe('handleDocumentAppRequest', () => {
  function setup() {
    const apps = new Map()
    const url = openDocumentApp(apps, {id: docId, cid})
    const fetchFile = vi.fn(async (_cid: string, path: string) => {
      if (path === '' || path === 'index.html')
        return new Response('<h1>hi</h1>', {headers: {'content-type': 'text/html; charset=utf-8'}})
      if (path === 'assets/app.js') return new Response('1', {headers: {'content-type': 'text/javascript'}})
      return new Response('nope', {status: 404})
    })
    const options = {apps, frameAncestors: ['http://localhost:17654'], fetchFile}
    return {url, options, fetchFile}
  }

  it('serves the folder index, nested files and the bridge script with the app policy', async () => {
    const {url, options, fetchFile} = setup()
    const index = await handleDocumentAppRequest({method: 'GET', url}, options)
    expect(index.status).toBe(200)
    expect(await index.text()).toBe('<h1>hi</h1>')
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(index.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(index.headers.get('content-security-policy')).toContain('frame-ancestors http://localhost:17654')
    expect(fetchFile).toHaveBeenLastCalledWith(cid, '')

    const script = await handleDocumentAppRequest({method: 'GET', url: `${url}assets/app.js`}, options)
    expect(script.status).toBe(200)
    expect(fetchFile).toHaveBeenLastCalledWith(cid, 'assets/app.js')

    const client = await handleDocumentAppRequest({method: 'GET', url: `${url}.seed/client.js`}, options)
    expect(client.status).toBe(200)
    expect(await client.text()).toContain('window.seed')
    expect(client.headers.get('content-type')).toContain('javascript')
  })

  it('refuses unknown hosts, other methods, dot segments and the reserved prefix', async () => {
    const {url, options, fetchFile} = setup()
    expect(
      (await handleDocumentAppRequest({method: 'GET', url: `seed-app://${'b'.repeat(40)}/`}, options)).status,
    ).toBe(404)
    expect((await handleDocumentAppRequest({method: 'POST', url}, options)).status).toBe(405)
    expect((await handleDocumentAppRequest({method: 'GET', url: `${url}.seed/other.js`}, options)).status).toBe(404)
    expect((await handleDocumentAppRequest({method: 'GET', url: `${url}missing.txt`}, options)).status).toBe(404)
    // URL parsing collapses "..", encoded or not, before the handler sees the path.
    await handleDocumentAppRequest({method: 'GET', url: `${url}%2e%2e/x`}, options)
    expect(fetchFile).toHaveBeenLastCalledWith(cid, 'x')
    // An encoded slash would smuggle a separator into one segment; it is refused outright.
    expect((await handleDocumentAppRequest({method: 'GET', url: `${url}a%2f..%2fb`}, options)).status).toBe(400)
    expect(fetchFile).not.toHaveBeenCalledWith(cid, expect.stringContaining('..'))
  })

  it('reports a daemon failure without leaking it as success', async () => {
    const {url, options} = setup()
    options.fetchFile = vi.fn(async () => {
      throw new Error('daemon down')
    })
    const res = await handleDocumentAppRequest({method: 'GET', url}, options)
    expect(res.status).toBe(502)
  })
})
