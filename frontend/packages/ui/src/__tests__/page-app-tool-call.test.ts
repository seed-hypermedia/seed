import {describe, expect, it, vi} from 'vitest'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {createDocumentPageAccess, type PagePermissionDecision} from '@shm/shared/document-page-permissions'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(async () => 'http://apps.test'),
  call: vi.fn(),
}))
vi.mock('../apps/running', () => ({resolveAppServerUrl: mocks.resolve, callAppToolAs: mocks.call}))

const {callPageAppTool, pageAppContext} = await import('../document-page')

const app = {
  id: hmId('alice', {path: ['weather']}),
  document: {
    metadata: {type: 'hm://hyper.media/app', appEnvironmentUrl: 'http://apps.test', publicConfig: {units: 'metric'}},
  } as unknown as HMDocument,
}
const signal = () => new AbortController().signal
const run = (params: unknown, approve: () => Promise<PagePermissionDecision> = async () => 'once', account = 'alice') =>
  callPageAppTool({
    app,
    account,
    client: {request: vi.fn()} as never,
    access: createDocumentPageAccess(approve),
    params,
    signal: signal(),
  })

describe('seed.app.call', () => {
  it('asks, then runs the named tool of the page’s app as the viewer and returns its output', async () => {
    mocks.call.mockResolvedValueOnce({id: 'c1', output: {temp: 21}})
    const approve = vi.fn(async (): Promise<PagePermissionDecision> => 'once')
    await expect(run({tool: 'forecast', input: {city: 'Lisbon'}}, approve)).resolves.toEqual({temp: 21})
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({kind: 'call', site: 'hm://alice/weather', resource: 'hm://alice/weather/forecast'}),
      expect.anything(),
    )
    expect(mocks.call).toHaveBeenCalledWith('http://apps.test', 'alice', {
      appId: 'hm://alice/weather',
      toolId: 'hm://alice/weather/forecast',
      input: {city: 'Lisbon'},
    })
  })

  it('rejects with the tool’s error, a denial, a tool of another app, or a page outside an app', async () => {
    mocks.call.mockResolvedValueOnce({id: 'c2', error: 'City not found'})
    await expect(run({tool: 'forecast', input: {}})).rejects.toThrow('City not found')
    await expect(run({tool: 'forecast'}, async () => 'deny')).rejects.toThrow('denied')
    await expect(run({tool: 'hm://bob/other/tool'})).rejects.toThrow('not a tool of this app')
    await expect(
      callPageAppTool({
        app: null,
        account: 'alice',
        client: {} as never,
        access: createDocumentPageAccess(async () => 'once'),
        params: {tool: 'x'},
        signal: signal(),
      }),
    ).rejects.toThrow('not part of an app')
  })
})

describe('seed.app.context', () => {
  it('gives a page the app and its public config, the context tools get without private config', () => {
    expect(pageAppContext(app)).toEqual({app: 'hm://alice/weather', publicConfig: {units: 'metric'}})
    expect(() => pageAppContext(null)).toThrow('not part of an app')
  })
})
