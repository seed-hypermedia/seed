import {mkdtempSync, readFileSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

vi.mock('@/client.server', () => ({
  grpcClient: {
    subscriptions: {
      listSubscriptions: async () => ({subscriptions: []}),
      subscribe: async () => ({}),
      unsubscribe: async () => ({}),
    },
  },
}))

type SiteConfigModule = typeof import('../site-config.server')

// Each fresh import is its own module instance: a stand-in for one web process.
async function startProcess(): Promise<SiteConfigModule> {
  vi.resetModules()
  return await import('../site-config.server')
}

describe('site config shared by several web processes', () => {
  const originalDataDir = process.env.DATA_DIR
  let dataDir: string
  let now: number

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'seed-web-config-'))
    process.env.DATA_DIR = dataDir
    writeFileSync(
      join(dataDir, 'service-config.json'),
      JSON.stringify({
        rootHostname: 'hyper.media',
        rootConfig: {},
        namedServices: {old: {registeredAccountUid: 'z6Old'}},
      }),
    )
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env.DATA_DIR = originalDataDir
  })

  it('serves a site another process created, within a second', async () => {
    const a = await startProcess()
    const b = await startProcess()
    expect(await b.getConfig('new.hyper.media')).toBeNull()

    await a.writeConfig('new.hyper.media', {registeredAccountUid: 'z6New'})
    now += 1001
    expect(await b.getConfig('new.hyper.media')).toEqual({registeredAccountUid: 'z6New'})
  })

  it('serves a site another process created a moment ago', async () => {
    const a = await startProcess()
    const b = await startProcess()
    // b has just checked the file, so its throttle would skip the next check.
    expect(await b.getConfig('old.hyper.media')).toEqual({registeredAccountUid: 'z6Old'})

    await a.writeConfig('new.hyper.media', {availableRegistrationSecret: 'secret'})
    expect(await b.getConfig('new.hyper.media')).toEqual({availableRegistrationSecret: 'secret'})
    expect((await b.getServiceConfig({fresh: true}))?.namedServices.new).toEqual({
      availableRegistrationSecret: 'secret',
    })
  })

  it('reads a registration another process just completed when asked for a fresh copy', async () => {
    const a = await startProcess()
    const b = await startProcess()
    expect(await b.getConfig('old.hyper.media')).toEqual({registeredAccountUid: 'z6Old'})

    await a.writeConfig('old.hyper.media', {registeredAccountUid: 'z6Moved'})
    expect(await b.getConfig('old.hyper.media', {fresh: true})).toEqual({registeredAccountUid: 'z6Moved'})
  })

  it('does not drop a site another process wrote when it writes next', async () => {
    const a = await startProcess()
    const b = await startProcess()
    await a.writeConfig('first.hyper.media', {registeredAccountUid: 'z6First'})
    // No read in between: b's write must still start from what is on disk.
    await b.writeConfig('second.hyper.media', {registeredAccountUid: 'z6Second'})

    const onDisk = JSON.parse(readFileSync(join(dataDir, 'service-config.json'), 'utf-8'))
    expect(Object.keys(onDisk.namedServices).sort()).toEqual(['first', 'old', 'second'])
  })

  it('keeps serving the last good config when the file is unreadable', async () => {
    const a = await startProcess()
    writeFileSync(join(dataDir, 'service-config.json'), '{not json')
    now += 1001
    expect(await a.getConfig('old.hyper.media')).toEqual({registeredAccountUid: 'z6Old'})
  })
})
