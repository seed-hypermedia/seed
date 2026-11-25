import {describe, expect, it, vi} from 'vitest'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {DOCUMENT_LOAD_RETRY_DELAYS_MS, loadDocumentRouteData} from './document-load'

const noWait = async () => {}

// Moving to another document fetches its loader data. When the proxy rejects that request (429,
// too many requests in flight) or the network drops it, Remix throws a plain Error, which used to
// replace the whole app with the root error page.
describe('loading a document route on client-side navigation', () => {
  it('tries again after the proxy rejects the request, and returns the data', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('max connections reached: 80'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue('payload')
    const waits: number[] = []

    const data = await loadDocumentRouteData(load, new AbortController().signal, {
      wait: async (ms) => {
        waits.push(ms)
      },
    })

    expect(data).toBe('payload')
    expect(load).toHaveBeenCalledTimes(3)
    expect(waits).toEqual(DOCUMENT_LOAD_RETRY_DELAYS_MS.slice(0, 2))
  })

  it('gives up with the last error once every attempt has failed', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('max connections reached: 80'))

    await expect(loadDocumentRouteData(load, new AbortController().signal, {wait: noWait})).rejects.toThrow(
      'max connections reached: 80',
    )
    expect(load).toHaveBeenCalledTimes(DOCUMENT_LOAD_RETRY_DELAYS_MS.length + 1)
  })

  it('passes a redirect or route response through without retrying', async () => {
    const redirect = new Response(null, {status: 302, headers: {Location: '/elsewhere'}})
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(redirect)

    await expect(loadDocumentRouteData(load, new AbortController().signal, {wait: noWait})).rejects.toBe(redirect)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('stops when the navigation is cancelled', async () => {
    const controller = new AbortController()
    const load = vi.fn<() => Promise<string>>().mockImplementation(async () => {
      controller.abort()
      throw new Error('aborted')
    })

    await expect(loadDocumentRouteData(load, controller.signal, {wait: noWait})).rejects.toThrow('aborted')
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('stops when the navigation is cancelled during a wait', async () => {
    const controller = new AbortController()
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('max connections reached: 80'))

    await expect(
      loadDocumentRouteData(load, controller.signal, {wait: async () => controller.abort()}),
    ).rejects.toThrow('max connections reached: 80')
    expect(load).toHaveBeenCalledTimes(1)
  })

  // Remix still calls `meta` when the route's error page is showing, with no data. Throwing there
  // takes down the whole document, error page included.
  it('still produces page metadata when the load failed and there is no data', () => {
    const source = readFileSync(join(import.meta.dirname, 'routes', '$.tsx'), 'utf8')

    expect(source).toMatch(/if \(!args\.data\) return loadFailedMeta\(\)/)
  })

  it('is wired into both document routes, with an error page of their own', () => {
    for (const file of ['$.tsx', '_index.tsx']) {
      const source = readFileSync(join(import.meta.dirname, 'routes', file), 'utf8')
      expect(source).toMatch(/export (function|const) clientLoader\b/)
      expect(source).toMatch(/export const ErrorBoundary = DocumentLoadErrorBoundary/)
    }
  })
})
