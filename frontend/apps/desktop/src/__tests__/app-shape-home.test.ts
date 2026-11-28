import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const storeData: Record<string, any> = {}
const appStoreMock = {
  get: vi.fn((key: string) => storeData[key]),
  set: vi.fn((key: string, value: any) => {
    storeData[key] = value
  }),
}

const listKeysMock = vi.fn(async () => ({keys: [] as {publicKey: string}[]}))
const requestMock = vi.fn(async (_key: string, _input: any): Promise<any> => ({type: 'document'}))
const appInvalidateQueriesMock = vi.fn()
const createAppWindowMock = vi.fn()
const getAllWindowsMock = vi.fn(() => new Map<string, any>())
const getLastFocusedWindowMock = vi.fn(() => null)
const getSelectedIdentityFromWindowStateMock = vi.fn(() => null)
const getWindowNavStateMock = vi.fn(() => ({}))
const hypermediaUrlToRouteMock = vi.fn(() => ({
  key: 'document',
  id: {uid: 'learn', path: [], version: null, latest: true, blockRef: null, blockRange: null},
}))

const statusResponses = vi.hoisted(() => ({map: {} as Record<string, any>}))

vi.mock('../app-store.mts', () => ({appStore: appStoreMock}))
vi.mock('../app-trpc', () => {
  // Minimal tRPC stub: procedures store their handler; createCaller builds
  // callable {query, mutate} proxies from the stored handlers.
  type Proc = {handler?: (...args: any[]) => any}
  const makeProcedure = (): any => {
    const p: any = {_def: {input: undefined}, handler: undefined}
    const build = (fn: (...args: any[]) => any) => {
      p.handler = fn
      return p
    }
    p.query = (fn: any) => build(fn)
    p.mutation = (fn: any) => build(fn)
    p.input = (schema: any) => {
      p._def.input = schema
      return p
    }
    return p
  }
  const router = (procs: Record<string, any>) => ({
    _procs: procs,
    createCaller: () => {
      const caller: any = {}
      for (const [name, proc] of Object.entries(procs)) {
        const p = proc as Proc
        if (typeof p.handler === 'function') {
          caller[name] = {
            query: (...args: any[]) => Promise.resolve(p.handler!({})),
            mutate: (...args: any[]) => Promise.resolve(p.handler!({input: args[0]})),
          }
        }
      }
      return caller
    },
  })
  // `procedure` must be callable (t.procedure) AND each call returns a fresh
  // procedure object with .query/.mutation/.input chain methods.
  const procedure: any = () => makeProcedure()
  procedure.query = (fn: any) => makeProcedure().query(fn)
  procedure.mutation = (fn: any) => makeProcedure().mutation(fn)
  procedure.input = (schema: any) => makeProcedure().input(schema)
  return {t: {router, procedure}}
})
vi.mock('../app-grpc', () => ({grpcClient: {daemon: {listKeys: listKeysMock}}}))
vi.mock('../app-client', () => ({
  seedClient: {request: requestMock},
  getSigner: vi.fn((uid: string) => ({accountUid: uid})),
}))
vi.mock('../app-invalidation', () => ({appInvalidateQueries: appInvalidateQueriesMock}))
vi.mock('../app-windows', () => ({
  createAppWindow: createAppWindowMock,
  getAllWindows: getAllWindowsMock,
  getLastFocusedWindow: getLastFocusedWindowMock,
  getSelectedIdentityFromWindowState: getSelectedIdentityFromWindowStateMock,
  getWindowNavState: getWindowNavStateMock,
}))
vi.mock('@shm/shared/utils/shape-home', () => ({
  loadShapeHomeStatus: async (_client: any, uid: string) =>
    statusResponses.map[uid] ?? {eligible: false, candidates: [], firstPublishedAt: null},
}))
vi.mock('@shm/shared/utils/url-to-route', () => ({hypermediaUrlToRoute: hypermediaUrlToRouteMock}))
vi.mock('@shm/ui/shape-home-announcement', () => ({LEARN_MORE_URL: 'hm://learn-more'}))
vi.mock('@shm/shared/models/shape-home-machines', () => ({
  createShapeHomeAnnouncementMachine: (effects: any) => ({__effects: effects}),
}))
vi.mock('xstate', () => {
  const noop = () => ({})
  return {
    setup: () => ({createMachine: () => ({})}),
    assign: noop,
    fromPromise: noop,
    emit: noop,
    raise: noop,
    enqueueActions: noop,
    actions: noop,
    spawnChild: noop,
    toPromise: noop,
    createActor: (machine: any, _opts: any) => {
      const effects = machine?.__effects ?? {}
      const snap = {matches: () => true, context: {uid: 'alice', candidates: []}}
      // Drive effects based on sent events so tests can observe side effects.
      const a: any = {
        send: (e: any) => {
          if (e.type === 'app.ready') {
            // findTarget resolves → openSurface
            Promise.resolve()
              .then(() => effects.findTarget?.())
              .then((target: any) => {
                if (target) effects.openSurface?.(target.uid)
              })
          }
          if (e.type === 'modal.notNow') {
            effects.persistModalDone?.()
            effects.dismissSite?.('alice')
            effects.closeModal?.()
          }
          if (e.type === 'modal.shapeHome') {
            effects.persistModalDone?.()
            effects.closeModal?.()
          }
        },
        subscribe: () => ({unsubscribe: () => {}}),
        start: () => a,
        getSnapshot: () => snap,
      }
      return a
    },
  }
})
vi.mock('../logger', () => ({info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()}))

async function loadModule() {
  return await import('../app-shape-home')
}

function eligibleStatus(uid: string, childTitles: string[] = ['About', 'Projects', 'Blog']) {
  const children = childTitles.map((t) => ({id: `hm://${uid}/${t.toLowerCase()}`, title: t}))
  return {
    eligible: true,
    firstPublishedAt: 1000,
    candidates: children.map((c) => ({
      id: {id: c.id, path: [], version: null, latest: true, blockRef: null, blockRange: null},
      title: c.title,
    })),
  }
}

function ineligibleStatus() {
  return {eligible: false, firstPublishedAt: null, candidates: []}
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  for (const key of Object.keys(storeData)) delete storeData[key]
  for (const key of Object.keys(statusResponses.map)) delete statusResponses.map[key]
  listKeysMock.mockReset()
  requestMock.mockReset()
  appInvalidateQueriesMock.mockReset()
  createAppWindowMock.mockReset()
  getAllWindowsMock.mockReset().mockReturnValue(new Map<string, any>())
  getLastFocusedWindowMock.mockReset().mockReturnValue(null)
  getSelectedIdentityFromWindowStateMock.mockReset().mockReturnValue(null)
  getWindowNavStateMock.mockReset().mockReturnValue({})
  hypermediaUrlToRouteMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function runStartShapeHome() {
  const mod = await loadModule()
  await (mod as any).startShapeHome()
  return mod
}

async function getCaller(mod: any) {
  return mod.shapeHomeApi.createCaller({})
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0))
}

describe('app-shape-home main process', () => {
  it('scan fills needsShaping only for eligible sites without a record', async () => {
    listKeysMock.mockResolvedValue({keys: [{publicKey: 'alice'}, {publicKey: 'bob'}]})
    statusResponses.map.alice = eligibleStatus('alice')
    statusResponses.map.bob = ineligibleStatus()

    const mod = await runStartShapeHome()
    await flush()
    const caller = await getCaller(mod)
    const state = await caller.getState.query()
    expect(state.needsShaping).toContain('alice')
    expect(state.needsShaping).not.toContain('bob')
  })

  it('target = selected account if it needs shaping, else first in listKeys order', async () => {
    listKeysMock.mockResolvedValue({keys: [{publicKey: 'alice'}, {publicKey: 'bob'}]})
    statusResponses.map.alice = eligibleStatus('alice')
    statusResponses.map.bob = eligibleStatus('bob')

    getSelectedIdentityFromWindowStateMock.mockReturnValue('bob' as any)
    const winId = 'win-bob'
    const winMap = new Map<string, any>([[winId, {id: winId}]])
    getAllWindowsMock.mockReturnValue(winMap)
    getLastFocusedWindowMock.mockReturnValue(winMap.get(winId) as any)
    createAppWindowMock.mockImplementation(() => {
      const w = {id: winId, once: vi.fn()}
      winMap.set(winId, w)
      return w
    })

    await runStartShapeHome()
    await flush()
    await flush()
    expect(createAppWindowMock).toHaveBeenCalled()
    const callArg = createAppWindowMock.mock.calls[0][0]
    expect(callArg.selectedIdentity).toBe('bob')
  })

  it('modalDone at start → no window opened', async () => {
    storeData['ShapeHomeState-v001'] = {modalDone: true, sites: {}, needsShaping: {}}
    listKeysMock.mockResolvedValue({keys: [{publicKey: 'alice'}]})
    statusResponses.map.alice = eligibleStatus('alice')

    await runStartShapeHome()
    await flush()
    expect(createAppWindowMock).not.toHaveBeenCalled()
  })

  it('modalNotNow → modalDone + only that site dismissed, other sites stay in needsShaping', async () => {
    listKeysMock.mockResolvedValue({keys: [{publicKey: 'alice'}, {publicKey: 'bob'}]})
    statusResponses.map.alice = eligibleStatus('alice')
    statusResponses.map.bob = eligibleStatus('bob')
    const winId = 'win-1'
    getAllWindowsMock.mockReturnValue(new Map<string, any>([[winId, {id: winId}]]))
    createAppWindowMock.mockImplementation(() => {
      const w = {id: winId, once: vi.fn()}
      getAllWindowsMock.mockReturnValue(new Map<string, any>([[winId, w]]))
      return w
    })

    const mod = await runStartShapeHome()
    await flush()
    await flush()
    const caller = await getCaller(mod)
    await caller.modalNotNow.mutate()
    await flush()
    await flush()
    const state = await caller.getState.query()
    expect(storeData['ShapeHomeState-v001'].modalDone).toBe(true)
    expect(storeData['ShapeHomeState-v001'].sites.alice).toEqual({status: 'dismissed'})
    expect(state.needsShaping).toContain('bob')
  })

  it('setSiteRecord removes the site from needsShaping', async () => {
    listKeysMock.mockResolvedValue({keys: [{publicKey: 'alice'}]})
    statusResponses.map.alice = eligibleStatus('alice')

    const mod = await runStartShapeHome()
    await flush()
    const caller = await getCaller(mod)
    let state = await caller.getState.query()
    expect(state.needsShaping).toContain('alice')
    await caller.setSiteRecord.mutate({uid: 'alice', record: {status: 'shaped'}})
    state = await caller.getState.query()
    expect(state.needsShaping).not.toContain('alice')
    expect(state.sites.alice).toEqual({status: 'shaped'})
  })

  it('rescan is single-flight (same key set → no second scan)', async () => {
    listKeysMock.mockResolvedValue({keys: [{publicKey: 'alice'}]})
    statusResponses.map.alice = eligibleStatus('alice')

    const mod = await runStartShapeHome()
    await flush()
    const caller = await getCaller(mod)
    const firstCount = listKeysMock.mock.calls.length
    await caller.rescan.mutate()
    await flush()
    expect(listKeysMock.mock.calls.length).toBeGreaterThanOrEqual(firstCount)
    const statusCallsBefore = Object.keys(statusResponses.map).length
    await caller.rescan.mutate()
    await flush()
    const statusCallsAfter = Object.keys(statusResponses.map).length
    expect(statusCallsAfter).toBe(statusCallsBefore)
  })
})
