import {mkdtempSync, writeFileSync} from 'fs'
import {tmpdir} from 'os'
import {join} from 'path'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

type Sub = {account: string; path: string; recursive: boolean}

// One daemon, shared by every "process" in a test.
const daemon = vi.hoisted(() => ({
  subs: [] as {account: string; path: string; recursive: boolean}[],
  failUnsubscribe: false,
  unsubscribed: [] as {account: string; path: string}[],
}))

vi.mock('@/client.server', () => ({
  grpcClient: {
    subscriptions: {
      listSubscriptions: async () => ({subscriptions: daemon.subs.map((sub) => ({...sub}))}),
      subscribe: async (req: Sub) => {
        daemon.subs = daemon.subs.filter((sub) => sub.account !== req.account || sub.path !== req.path)
        daemon.subs.push({account: req.account, path: req.path, recursive: req.recursive})
        return {}
      },
      unsubscribe: async (req: {account: string; path: string}) => {
        if (daemon.failUnsubscribe) throw new Error('daemon unavailable')
        daemon.unsubscribed.push({account: req.account, path: req.path})
        daemon.subs = daemon.subs.filter((sub) => sub.account !== req.account || sub.path !== req.path)
        return {}
      },
    },
  },
}))

type SiteConfigModule = typeof import('../site-config.server')

// Each fresh import is its own module instance: a stand-in for one web process.
// A real process applies its subscriptions once at startup (entry.server.tsx).
async function startProcess(): Promise<SiteConfigModule> {
  vi.resetModules()
  const mod = await import('../site-config.server')
  await mod.applyConfigSubscriptions()
  return mod
}

function rootAccounts() {
  return daemon.subs
    .filter((sub) => sub.path === '')
    .map((sub) => sub.account)
    .sort()
}

describe('daemon subscriptions follow the site config', () => {
  const originalDataDir = process.env.DATA_DIR
  let dataDir: string
  let now: number

  function writeServiceConfigFile(namedServices: Record<string, {registeredAccountUid?: string}>) {
    writeFileSync(
      join(dataDir, 'service-config.json'),
      JSON.stringify({rootHostname: 'hyper.media', rootConfig: {registeredAccountUid: 'z6Root'}, namedServices}),
    )
  }

  beforeEach(() => {
    daemon.subs = []
    daemon.failUnsubscribe = false
    daemon.unsubscribed = []
    dataDir = mkdtempSync(join(tmpdir(), 'seed-web-subs-'))
    process.env.DATA_DIR = dataDir
    writeServiceConfigFile({old: {registeredAccountUid: 'z6Old'}})
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
    process.env.DATA_DIR = originalDataDir
  })

  it('leaves subscriptions it did not make alone when a process starts', async () => {
    // A daemon shared with a desktop app: its subscriptions are not this server's.
    const foreign: Sub[] = Array.from({length: 82}, (_, i) => ({account: `z6Foreign${i}`, path: '', recursive: true}))
    foreign.push({account: 'z6Foreign0', path: '/notes', recursive: false})
    daemon.subs = foreign.map((sub) => ({...sub}))

    await startProcess()

    expect(daemon.unsubscribed).toEqual([])
    expect(daemon.subs).toEqual([
      ...foreign,
      {account: 'z6Old', path: '', recursive: true},
      {account: 'z6Root', path: '', recursive: true},
    ])
  })

  it('moves the subscription when a site changes account', async () => {
    const a = await startProcess()
    await a.writeConfig('old.hyper.media', {registeredAccountUid: 'z6Moved'})

    expect(rootAccounts()).toEqual(['z6Moved', 'z6Root'])
    expect(daemon.unsubscribed).toEqual([{account: 'z6Old', path: ''}])
  })

  it('unsubscribes a removed site', async () => {
    const a = await startProcess()
    await a.rmService('old')

    expect(rootAccounts()).toEqual(['z6Root'])
  })

  it('keeps the subscription of a removed site whose account another site still uses', async () => {
    writeServiceConfigFile({old: {registeredAccountUid: 'z6Old'}, twin: {registeredAccountUid: 'z6Old'}})
    const a = await startProcess()
    await a.rmService('old')

    expect(rootAccounts()).toEqual(['z6Old', 'z6Root'])
    expect(daemon.unsubscribed).toEqual([])
  })

  it('never touches path-level subscriptions, even of its own site accounts', async () => {
    daemon.subs = [{account: 'z6Old', path: '/blog', recursive: true}]
    const a = await startProcess()
    await a.rmService('old')

    expect(daemon.subs).toContainEqual({account: 'z6Old', path: '/blog', recursive: true})
    expect(rootAccounts()).toEqual(['z6Root'])
  })

  it('follows a change another process made to the config file', async () => {
    const a = await startProcess()
    const b = await startProcess()
    await a.rmService('old')
    // a already unsubscribed; put it back to see b act on its own reload.
    daemon.subs.push({account: 'z6Old', path: '', recursive: true})
    daemon.unsubscribed = []

    now += 1001
    expect(await b.getConfig('old.hyper.media')).toBeNull()
    await b.applyConfigSubscriptions() // queued behind the run the reload started

    expect(daemon.unsubscribed).toEqual([{account: 'z6Old', path: ''}])
    expect(rootAccounts()).toEqual(['z6Root'])
  })

  it('retries an unsubscribe that failed', async () => {
    const a = await startProcess()
    daemon.failUnsubscribe = true
    await a.rmService('old')
    expect(rootAccounts()).toEqual(['z6Old', 'z6Root'])

    daemon.failUnsubscribe = false
    await a.applyConfigSubscriptions()
    expect(rootAccounts()).toEqual(['z6Root'])
  })
})
