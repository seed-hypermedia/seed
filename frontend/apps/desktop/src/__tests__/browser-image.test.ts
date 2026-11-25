// @vitest-environment node
import {afterEach, expect, it, vi} from 'vitest'
import {runInNewContext} from 'node:vm'
import type {WebContents} from 'electron'
import {loadBrowserFavicon, readBrowserFavicons} from '../app-browser-favicon'
import {fetchBrowserImage, readBrowserImageResponse} from '../browser-image'

afterEach(() => vi.useRealTimers())
const limit = 512 * 1024
it('streams up to the exact cap, cancelling oversized and non-image responses', async () => {
  const response = (size: number, headers = {}) =>
    new Response(new Uint8Array(size), {headers: {'content-type': 'image/png', ...headers}})
  expect((await readBrowserImageResponse(response(limit), limit))?.bytes.length).toBe(limit)
  const cancel = vi.fn()
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(limit))
      c.enqueue(new Uint8Array(1))
    },
    cancel,
  })
  expect(await readBrowserImageResponse(new Response(body, {headers: {'content-type': 'image/png'}}), limit)).toBeNull()
  expect(cancel).toHaveBeenCalledOnce()
  expect(await readBrowserImageResponse(response(1, {'content-length': String(limit + 1)}), limit)).toBeNull()
  expect(await readBrowserImageResponse(response(1, {'content-type': 'application/octet-stream'}), limit)).toBeNull()
})
it('uses the guest session and aborts after ten seconds', async () => {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  const fetch = vi.fn((_url, options) => {
    signal = options.signal
    return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new Error('aborted'))))
  })
  const guest = {session: {fetch}, getURL: () => 'https://example.com'} as unknown as WebContents
  const pending = fetchBrowserImage(guest, 'https://example.com/icon', limit)
  await vi.advanceTimersByTimeAsync(10000)
  expect(await pending).toBeNull()
  expect(signal?.aborted).toBe(true)
  expect(fetch).toHaveBeenCalledWith(
    'https://example.com/icon',
    expect.objectContaining({credentials: 'include', referrer: 'https://example.com'}),
  )
})
it('applies the same streaming cap and MIME checks inside the blob guest path', async () => {
  let response: Response
  const guest = {
    executeJavaScriptInIsolatedWorld: async (_world: number, scripts: {code: string}[]) =>
      runInNewContext(scripts[0]!.code, {
        fetch: async () => response,
        AbortController,
        setTimeout,
        clearTimeout,
        btoa,
        Uint8Array,
      }),
  } as unknown as WebContents
  response = new Response(new Uint8Array(limit + 1), {headers: {'content-type': 'image/png'}})
  expect(await loadBrowserFavicon(guest, 'blob:https://example.com/icon')).toBeNull()
  response = new Response('bad', {headers: {'content-type': 'text/html'}})
  expect(await loadBrowserFavicon(guest, 'blob:https://example.com/icon')).toBeNull()
  response = new Response('image', {headers: {'content-type': 'image/png'}})
  expect(await loadBrowserFavicon(guest, 'blob:https://example.com/icon')).toBe('data:image/png;base64,aW1hZ2U=')
})
it('bounds inline icons and candidate count', async () => {
  expect(
    await loadBrowserFavicon({} as WebContents, 'data:image/png;base64,' + Buffer.alloc(limit + 1).toString('base64')),
  ).toBeNull()
  const guest = {
    executeJavaScriptInIsolatedWorld: async (_world: number, scripts: {code: string}[]) =>
      runInNewContext(scripts[0]!.code, {
        devicePixelRatio: 1,
        document: {
          querySelectorAll: () =>
            Array.from({length: 20}, (_, i) => ({
              rel: 'icon',
              getAttribute: () => 'icon',
              href: `https://example.com/${i}`,
              sizes: ['any'],
            })),
        },
      }),
  } as unknown as WebContents
  expect(await readBrowserFavicons(guest)).toHaveLength(4)
})
