import * as fs from 'node:fs'
import * as os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const storeData: Record<string, any> = {}
const appStoreMock = {
  get: vi.fn((key: string) => storeData[key]),
  set: vi.fn((key: string, value: any) => {
    storeData[key] = value
  }),
}

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-services-test-'))

vi.mock('../app-store.mts', () => ({appStore: appStoreMock}))
vi.mock('../app-paths', () => ({userDataPath: tmpUserData}))
vi.mock('../logger', () => ({
  info: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  rawMessage: vi.fn(),
}))

type Services = typeof import('../app-services')

async function loadServices(): Promise<Services> {
  const mod = await import('../app-services')
  mod._resetServicesForTests()
  return mod
}

function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting for condition'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

const posixOnly = process.platform === 'win32' ? describe.skip : describe

describe('service manager definitions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    for (const key of Object.keys(storeData)) delete storeData[key]
  })

  it('creates, updates, persists and reloads services', async () => {
    let services = await loadServices()
    const created = services.createService({name: ' web ', command: ' pnpm dev ', autoStart: true})
    expect(created.name).toBe('web')
    expect(created.command).toBe('pnpm dev')
    expect(created.runtime.status).toBe('stopped')
    expect(storeData['Services-v001'].services).toHaveLength(1)

    services.updateService(created.id, {name: 'site', cwd: '/tmp', env: {PORT: '3000'}})

    vi.resetModules()
    services = await loadServices()
    const [reloaded] = services.listServices()
    expect(reloaded).toMatchObject({id: created.id, name: 'site', cwd: '/tmp', env: {PORT: '3000'}, autoStart: true})
    expect(reloaded!.runtime.status).toBe('stopped')
  })

  it('rejects empty names and commands', async () => {
    const services = await loadServices()
    expect(() => services.createService({name: '', command: 'ls'})).toThrow(/name/)
    expect(() => services.createService({name: 'x', command: '   '})).toThrow(/command/)
    expect(() => services.getService('missing')).toThrow(/Unknown service/)
  })

  it('notifies subscribers on definition changes', async () => {
    const services = await loadServices()
    const listener = vi.fn()
    services.subscribeServices(listener)
    const created = services.createService({name: 'a', command: 'true'})
    await services.removeService(created.id)
    expect(listener).toHaveBeenCalledWith({type: 'services'})
    expect(listener).toHaveBeenCalledTimes(2)
    expect(services.listServices()).toEqual([])
  })
})

posixOnly('service manager processes', () => {
  let services: Services

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    for (const key of Object.keys(storeData)) delete storeData[key]
    services = await loadServices()
  })

  afterEach(async () => {
    await services.stopAllServices()
  })

  it('runs a command to completion and captures its output', async () => {
    const service = services.createService({name: 'echo', command: 'echo hello; echo oops 1>&2'})
    const started = services.startService(service.id)
    expect(started.runtime.status).toBe('running')
    expect(started.runtime.pid).toBeTypeOf('number')

    await waitFor(() => services.getService(service.id).runtime.status !== 'running')

    const done = services.getService(service.id)
    expect(done.runtime.status).toBe('exited')
    expect(done.runtime.exitCode).toBe(0)
    const lines = services.getServiceLogs(service.id)
    expect(lines.some((line) => line.stream === 'stdout' && line.text === 'hello')).toBe(true)
    expect(lines.some((line) => line.stream === 'stderr' && line.text === 'oops')).toBe(true)
    expect(fs.readFileSync(services.getServiceLogPath(service.id), 'utf8')).toContain('hello')
  })

  it('reports a non-zero exit as failed', async () => {
    const service = services.createService({name: 'fail', command: 'exit 3'})
    services.startService(service.id)
    await waitFor(() => services.getService(service.id).runtime.status !== 'running')
    const done = services.getService(service.id)
    expect(done.runtime.status).toBe('failed')
    expect(done.runtime.exitCode).toBe(3)
    expect(done.runtime.error).toContain('code 3')
  })

  it('stops a long-running service and its process group', async () => {
    const service = services.createService({name: 'sleeper', command: 'sleep 60'})
    services.startService(service.id)
    expect(services.countActiveServices()).toBe(1)

    const stopped = await services.stopService(service.id)
    expect(stopped.runtime.status).toBe('stopped')
    expect(stopped.runtime.pid).toBeNull()
    expect(services.countActiveServices()).toBe(0)
    // stop on an idle service is a no-op
    expect((await services.stopService(service.id)).runtime.status).toBe('stopped')
  })

  it('restart yields a fresh pid', async () => {
    const service = services.createService({name: 'sleeper', command: 'sleep 60'})
    const first = services.startService(service.id).runtime.pid
    const restarted = await services.restartService(service.id)
    expect(restarted.runtime.status).toBe('running')
    expect(restarted.runtime.pid).not.toBe(first)
  })

  it('removing a running service stops it first', async () => {
    const service = services.createService({name: 'sleeper', command: 'sleep 60'})
    services.startService(service.id)
    await services.removeService(service.id)
    expect(services.listServices()).toEqual([])
    expect(services.countActiveServices()).toBe(0)
  })

  it('starts only autoStart services at launch', async () => {
    const auto = services.createService({name: 'auto', command: 'sleep 60', autoStart: true})
    const manual = services.createService({name: 'manual', command: 'sleep 60'})
    services.startAutoStartServices()
    expect(services.getService(auto.id).runtime.status).toBe('running')
    expect(services.getService(manual.id).runtime.status).toBe('stopped')
  })

  it('fails to start when the working directory is missing', async () => {
    const service = services.createService({name: 'nowhere', command: 'true', cwd: '/definitely/not/here'})
    expect(() => services.startService(service.id)).toThrow(/Working directory/)
  })
})
