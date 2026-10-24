import {afterEach, expect, it, vi} from 'vitest'
import {loader} from './hm.api.file.$'
vi.mock('@/daemon-auth.server', () => ({
  getDaemonAuthToken: async () => null,
  withDaemonAuthToken: (_: unknown, fn: () => unknown) => fn(),
}))
vi.mock('@/upstream-reads.server', () => ({fetchUpstreamFile: vi.fn()}))
afterEach(() => vi.unstubAllGlobals())
it('keeps raw uploaded HTML inert on the Seed origin', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('<script>parent.document.body.remove()</script>', {headers: {'Content-Type': 'text/html'}}),
    ),
  )
  const response = (await loader({
    request: new Request('https://seed.example/hm/api/file/bafy/index.html'),
    params: {'*': 'bafy/index.html'},
    context: {},
  })) as Response
  expect(response.headers.get('Content-Security-Policy')).toContain('sandbox;')
  expect(response.headers.get('Content-Security-Policy')).not.toContain('allow-scripts')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
})
