import {beforeEach, describe, expect, it, vi} from 'vitest'
import {loader} from './hm.api.page'
import {loader as runner} from './hm.page-runner'

const mocks = vi.hoisted(() => ({resource: vi.fn(), file: vi.fn(), gated: false, signedIn: false}))
vi.mock('@/loaders', () => ({fetchResource: mocks.resource}))
vi.mock('@/daemon-auth.server', () => ({
  getDaemonAuthToken: async () => null,
  withDaemonAuthToken: (_: unknown, fn: () => unknown) => fn(),
}))
vi.mock('@/require-sign-in.server', () => ({requireSignInEnabled: () => mocks.gated}))
vi.mock('@/web-session.server', () => ({isSignedInRequest: () => mocks.signedIn}))
vi.mock('./hm.api.file.$', () => ({loader: mocks.file}))
const cid = 'bafybeicivnxndl4q6j2upj7iqzghrukrecm5u5sgzj7v4hyblc4xffj5eu'
const id = 'hm://z6Mkv8m2KaNAReAZdEeunzMLMohJPUEC9yRmxWfK4z4st5B2/pages/hello-world'
const args = () => ({
  request: new Request(`https://seed.example/hm/api/page?${new URLSearchParams({id, cid, version: 'v1'})}`),
  params: {},
  context: {},
})
beforeEach(() => {
  mocks.resource.mockReset()
  mocks.file.mockReset()
  mocks.gated = false
  mocks.signedIn = false
})
describe('same-origin page routes', () => {
  it('keeps direct runner visits opaque and network restricted', async () => {
    const response = runner(args())
    const policy = response.headers.get('Content-Security-Policy')!
    expect(policy).toContain('sandbox allow-scripts')
    expect(policy).not.toContain('allow-same-origin')
    expect(policy).toContain("connect-src 'none'")
    expect(policy).toContain("frame-ancestors 'self'")
    expect(await response.text()).toContain('const HOST_ORIGIN = "https://seed.example"')
  })
  it('pins the runner to the public https origin when a proxy terminates TLS', async () => {
    const response = runner({
      ...args(),
      request: new Request('http://web:3000/hm/page-runner', {
        headers: {Host: 'web:3000', 'X-Forwarded-Host': 'staging.hyper.media', 'X-Forwarded-Proto': 'https'},
      }),
    })
    expect(await response.text()).toContain('const HOST_ORIGIN = "https://staging.hyper.media"')
  })
  it('requires the enterprise session before resolving private page content', async () => {
    mocks.gated = true
    expect((await loader(args())).status).toBe(401)
    expect(mocks.resource).not.toHaveBeenCalled()
    expect(mocks.file).not.toHaveBeenCalled()
  })
  it('rejects a CID that is not in the requested document', async () => {
    mocks.resource.mockResolvedValue({
      type: 'document',
      document: {metadata: {type: 'hm://hyper.media/page', html: 'ipfs://anothercid'}},
    })
    expect((await loader(args())).status).toBe(404)
    expect(mocks.file).not.toHaveBeenCalled()
  })
  it('returns matching revision HTML as inert, uncacheable data', async () => {
    mocks.resource.mockResolvedValue({
      type: 'document',
      document: {metadata: {type: 'hm://hyper.media/page', html: `ipfs://${cid}`}},
    })
    mocks.file.mockResolvedValue(new Response('<script>alert(1)</script>'))
    const response = await loader(args())
    expect(mocks.resource).toHaveBeenCalledWith(expect.objectContaining({version: 'v1', latest: false}))
    expect(mocks.file).toHaveBeenCalledWith(expect.objectContaining({params: {'*': `${cid}/index.html`}}))
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox;')
    expect(await response.text()).toContain('<script>')
  })
})
