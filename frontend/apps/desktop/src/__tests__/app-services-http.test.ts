import {beforeEach, describe, expect, it, vi} from 'vitest'

const manager = vi.hoisted(() => ({
  listServices: vi.fn(),
  getService: vi.fn(),
  createService: vi.fn(),
  updateService: vi.fn(),
  removeService: vi.fn(),
  startService: vi.fn(),
  stopService: vi.fn(),
  restartService: vi.fn(),
  getServiceLogs: vi.fn(),
}))

vi.mock('../app-services', () => manager)

import {handleServicesHttpRequest, isServicesHttpPath} from '../app-services-http'

const noBody = () => Promise.resolve(undefined)
const body = (value: unknown) => () => Promise.resolve(value)
const params = (query = '') => new URLSearchParams(query)

describe('services HTTP API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    manager.getService.mockImplementation((id: string) => {
      if (id === 'missing') throw new Error(`Unknown service: ${id}`)
      return {id, name: 'svc'}
    })
  })

  it('recognises its paths', () => {
    expect(isServicesHttpPath('/api/services')).toBe(true)
    expect(isServicesHttpPath('/api/services/abc/logs')).toBe(true)
    expect(isServicesHttpPath('/api/servicesx')).toBe(false)
    expect(isServicesHttpPath('/api/documents')).toBe(false)
  })

  it('lists services', async () => {
    manager.listServices.mockReturnValue([{id: '1'}])
    const result = await handleServicesHttpRequest('GET', '/api/services', params(), noBody)
    expect(result).toEqual({status: 200, body: {services: [{id: '1'}]}})
  })

  it('creates a service and optionally starts it', async () => {
    manager.createService.mockReturnValue({id: 'new'})
    manager.startService.mockReturnValue({id: 'new', runtime: {status: 'running'}})

    const created = await handleServicesHttpRequest('POST', '/api/services', params(), body({name: 'a', command: 'b'}))
    expect(created.status).toBe(201)
    expect(manager.createService).toHaveBeenCalledWith({name: 'a', command: 'b'})
    expect(manager.startService).not.toHaveBeenCalled()

    const started = await handleServicesHttpRequest(
      'POST',
      '/api/services',
      params(),
      body({name: 'a', command: 'b', start: true}),
    )
    expect(started).toEqual({status: 201, body: {service: {id: 'new', runtime: {status: 'running'}}}})
    expect(manager.startService).toHaveBeenCalledWith('new')
  })

  it('turns validation errors into 400 and unknown ids into 404', async () => {
    manager.createService.mockImplementation(() => {
      throw new Error('Service name is required')
    })
    expect(await handleServicesHttpRequest('POST', '/api/services', params(), body({}))).toEqual({
      status: 400,
      body: {error: 'Service name is required'},
    })
    expect(await handleServicesHttpRequest('GET', '/api/services/missing', params(), noBody)).toEqual({
      status: 404,
      body: {error: 'Unknown service: missing'},
    })
    expect((await handleServicesHttpRequest('POST', '/api/services', params(), body([1]))).status).toBe(400)
  })

  it('routes lifecycle actions', async () => {
    manager.startService.mockReturnValue({id: 'x', s: 'start'})
    manager.stopService.mockResolvedValue({id: 'x', s: 'stop'})
    manager.restartService.mockResolvedValue({id: 'x', s: 'restart'})

    expect(await handleServicesHttpRequest('POST', '/api/services/x/start', params(), noBody)).toEqual({
      status: 200,
      body: {service: {id: 'x', s: 'start'}},
    })
    expect(await handleServicesHttpRequest('POST', '/api/services/x/stop', params(), noBody)).toEqual({
      status: 200,
      body: {service: {id: 'x', s: 'stop'}},
    })
    expect(await handleServicesHttpRequest('POST', '/api/services/x/restart', params(), noBody)).toEqual({
      status: 200,
      body: {service: {id: 'x', s: 'restart'}},
    })
    expect((await handleServicesHttpRequest('GET', '/api/services/x/start', params(), noBody)).status).toBe(405)
    expect((await handleServicesHttpRequest('POST', '/api/services/x/explode', params(), noBody)).status).toBe(404)
    expect((await handleServicesHttpRequest('GET', '/api/services/x/logs/extra', params(), noBody)).status).toBe(404)
  })

  it('updates, deletes and reads logs', async () => {
    manager.updateService.mockReturnValue({id: 'x', name: 'renamed'})
    manager.removeService.mockResolvedValue(undefined)
    manager.getServiceLogs.mockReturnValue([{ts: 1, stream: 'stdout', text: 'hi'}])

    expect(await handleServicesHttpRequest('PATCH', '/api/services/x', params(), body({name: 'renamed'}))).toEqual({
      status: 200,
      body: {service: {id: 'x', name: 'renamed'}},
    })
    expect(manager.updateService).toHaveBeenCalledWith('x', {name: 'renamed'})

    expect(await handleServicesHttpRequest('DELETE', '/api/services/x', params(), noBody)).toEqual({
      status: 200,
      body: {ok: true},
    })
    expect(manager.removeService).toHaveBeenCalledWith('x')

    expect(await handleServicesHttpRequest('GET', '/api/services/x/logs', params('limit=50'), noBody)).toEqual({
      status: 200,
      body: {lines: [{ts: 1, stream: 'stdout', text: 'hi'}]},
    })
    expect(manager.getServiceLogs).toHaveBeenCalledWith('x', 50)
    await handleServicesHttpRequest('GET', '/api/services/x/logs', params(), noBody)
    expect(manager.getServiceLogs).toHaveBeenLastCalledWith('x', undefined)
  })
})
