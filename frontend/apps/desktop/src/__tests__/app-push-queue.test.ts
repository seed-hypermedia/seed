import {beforeEach, describe, expect, it, vi} from 'vitest'
import type {PushQueueDeps} from '../app-push-queue'

const storeData: Record<string, any> = {}

const appStoreMock = {
  get: vi.fn((key: string) => storeData[key]),
  set: vi.fn((key: string, value: any) => {
    storeData[key] = value
  }),
}

vi.mock('../app-store.mts', () => ({appStore: appStoreMock}))
vi.mock('../app-grpc', () => ({grpcClient: {resources: {pushResourcesToPeer: vi.fn()}}}))
vi.mock('../logger', () => ({info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn()}))
vi.mock('electron', () => ({net: {isOnline: () => true}, powerMonitor: {on: vi.fn()}}))

const DOC = 'hm://z6MkSpace/notes'
const GATEWAY = 'https://hyper.media'
const SITE = 'https://example.site'
const ADDRS = ['/dns4/hyper.media/tcp/56001/p2p/12D3KooWgateway']
const NOW = 1_800_000_000_000
const MINUTE = 60_000

function fakeDeps(overrides: Partial<PushQueueDeps> = {}): PushQueueDeps {
  return {
    isOnline: () => true,
    fetchHostConfig: vi.fn(async () => ({addrs: ADDRS})),
    pushToPeer: vi.fn(async () => {}),
    now: () => NOW,
    ...overrides,
  }
}

async function loadQueue() {
  return await import('../app-push-queue')
}

describe('pending push queue', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    for (const key of Object.keys(storeData)) delete storeData[key]
  })

  it('records one entry per resource and host; a waiting entry keeps its schedule', async () => {
    const queue = await loadQueue()
    queue.enqueuePush(DOC, GATEWAY, NOW)
    queue.enqueuePush(DOC, GATEWAY, NOW + MINUTE)
    queue.enqueuePush(DOC, SITE, NOW)
    expect(queue.listPendingPushes()).toEqual([
      {resourceUrl: DOC, host: GATEWAY, createdAt: NOW, attempts: 0, nextAttempt: NOW},
      {resourceUrl: DOC, host: SITE, createdAt: NOW, attempts: 0, nextAttempt: NOW},
    ])
  })

  it('delivers a due entry and forgets it', async () => {
    const queue = await loadQueue()
    queue.enqueuePush(DOC, GATEWAY, NOW)
    const deps = fakeDeps()
    await queue.runPushQueuePass(deps)
    expect(deps.fetchHostConfig).toHaveBeenCalledWith(GATEWAY)
    expect(deps.pushToPeer).toHaveBeenCalledWith(ADDRS, DOC)
    expect(queue.listPendingPushes()).toEqual([])
  })

  it('keeps a failed entry with the error and the next backoff step', async () => {
    const queue = await loadQueue()
    queue.enqueuePush(DOC, GATEWAY, NOW)
    const pushToPeer = vi.fn(async () => {
      throw new Error('dial failed')
    })
    await queue.runPushQueuePass(fakeDeps({pushToPeer}))
    expect(queue.listPendingPushes()).toEqual([
      {
        resourceUrl: DOC,
        host: GATEWAY,
        createdAt: NOW,
        attempts: 1,
        nextAttempt: NOW + MINUTE,
        lastError: 'dial failed',
      },
    ])

    // Not due yet: a pass right after leaves it alone.
    await queue.runPushQueuePass(fakeDeps({pushToPeer}))
    expect(pushToPeer).toHaveBeenCalledTimes(1)

    // Due again: the second failure moves to the next step.
    await queue.runPushQueuePass(fakeDeps({pushToPeer, now: () => NOW + MINUTE}))
    expect(pushToPeer).toHaveBeenCalledTimes(2)
    expect(queue.listPendingPushes()[0]).toMatchObject({attempts: 2, nextAttempt: NOW + MINUTE + 5 * MINUTE})
  })

  it('treats an unreachable host config like a failed push', async () => {
    const queue = await loadQueue()
    queue.enqueuePush(DOC, GATEWAY, NOW)
    const deps = fakeDeps({
      fetchHostConfig: vi.fn(async () => {
        throw new Error('The operation was aborted due to timeout')
      }),
    })
    await queue.runPushQueuePass(deps)
    expect(deps.pushToPeer).not.toHaveBeenCalled()
    expect(queue.listPendingPushes()[0]).toMatchObject({
      attempts: 1,
      lastError: 'The operation was aborted due to timeout',
    })
  })

  it('leaves the queue untouched while offline, so offline time does not burn the backoff', async () => {
    const queue = await loadQueue()
    queue.enqueuePush(DOC, GATEWAY, NOW)
    const deps = fakeDeps({isOnline: () => false})
    await queue.runPushQueuePass(deps)
    expect(deps.fetchHostConfig).not.toHaveBeenCalled()
    expect(queue.listPendingPushes()).toEqual([
      {resourceUrl: DOC, host: GATEWAY, createdAt: NOW, attempts: 0, nextAttempt: NOW},
    ])
  })

  it('gives up on entries older than seven days', async () => {
    const queue = await loadQueue()
    queue.enqueuePush(DOC, GATEWAY, NOW - queue.PUSH_EXPIRY_MS)
    queue.enqueuePush(DOC, SITE, NOW - queue.PUSH_EXPIRY_MS + MINUTE)
    const deps = fakeDeps()
    await queue.runPushQueuePass(deps)
    expect(deps.pushToPeer).toHaveBeenCalledTimes(1)
    expect(deps.pushToPeer).toHaveBeenCalledWith(ADDRS, DOC)
    expect(queue.listPendingPushes()).toEqual([])
  })

  it('caps the retry delay at six hours', async () => {
    const queue = await loadQueue()
    expect(queue.pushRetryDelay(1)).toBe(MINUTE)
    expect(queue.pushRetryDelay(5)).toBe(6 * 60 * MINUTE)
    expect(queue.pushRetryDelay(40)).toBe(6 * 60 * MINUTE)
  })

  it('serves the renderer through the tRPC router', async () => {
    const queue = await loadQueue()
    const caller = queue.pushQueueApi.createCaller({})
    await caller.enqueue({resourceUrl: DOC, host: GATEWAY})
    expect(await caller.list()).toHaveLength(1)
    await caller.remove({resourceUrl: DOC, host: GATEWAY})
    expect(await caller.list()).toEqual([])
  })
})
