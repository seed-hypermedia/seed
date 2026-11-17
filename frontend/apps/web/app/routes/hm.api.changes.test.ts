import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({listEvents: vi.fn()}))
vi.mock('@/client.server', () => ({grpcClient: {activityFeed: {listEvents: mocks.listEvents}}}))

import {changeHub} from '@/change-hub.server'
import {loader} from './hm.api.changes'

const blob = (blobId: number, resource: string) => ({
  data: {case: 'newBlob', value: {blobId: BigInt(blobId), resource}},
})

/** The node's feed, newest first; the test prepends to it. */
let feed: ReturnType<typeof blob>[] = []

function open(query: string, signal?: AbortSignal) {
  return loader({
    request: new Request(`http://site.test/hm/api/changes?${query}`, {signal}),
    params: {},
    context: {},
  })
}

function reader(response: Response) {
  const stream = response.body!.getReader()
  const decoder = new TextDecoder()
  return {
    stream,
    next: async () => decoder.decode((await stream.read()).value),
  }
}

describe('/hm/api/changes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    feed = [blob(1, 'hm://alice/old')]
    mocks.listEvents.mockReset()
    mocks.listEvents.mockImplementation(async () => ({events: feed, nextPageToken: ''}))
    delete process.env.SEED_REQUIRE_SIGN_IN
  })
  afterEach(() => {
    vi.useRealTimers()
    delete process.env.SEED_REQUIRE_SIGN_IN
  })

  it('streams the changes a browser subscribed to, and stops polling the node when it leaves', async () => {
    const abort = new AbortController()
    const response = await open('d=hm://alice/notes&r=hm://bob/profile', abort.signal)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform')
    expect(response.headers.get('X-Accel-Buffering')).toBe('no')
    expect(changeHub.size).toBe(1)

    const events = reader(response)
    expect(await events.next()).toBe('event: ready\ndata:\n\n')

    // The first poll only marks where the feed is.
    await vi.advanceTimersByTimeAsync(0)
    expect(mocks.listEvents).toHaveBeenCalledTimes(1)

    feed = [blob(3, 'hm://carol/elsewhere'), blob(2, 'hm://alice/notes/today?v=bafy'), ...feed]
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await events.next()).toBe('data: hm://alice/notes/today\n\n')

    await vi.advanceTimersByTimeAsync(20_000)
    expect(await events.next()).toBe('event: ping\ndata:\n\n')

    const polls = mocks.listEvents.mock.calls.length
    abort.abort()
    expect(changeHub.size).toBe(0)
    expect((await events.stream.read()).done).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(mocks.listEvents.mock.calls.length).toBe(polls)
  })

  it('asks the node once per interval for any number of streams', async () => {
    const abort = new AbortController()
    for (let i = 0; i < 20; i++) await open(`r=hm://alice/${i}`, abort.signal)
    expect(changeHub.size).toBe(20)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(mocks.listEvents).toHaveBeenCalledTimes(6)
    abort.abort()
    expect(changeHub.size).toBe(0)
  })

  it('lets go of the subscription when the browser cancels the stream', async () => {
    const response = await open('r=hm://alice/a')
    expect(changeHub.size).toBe(1)
    await response.body!.cancel()
    expect(changeHub.size).toBe(0)
  })

  it('refuses a request it cannot serve without subscribing', async () => {
    for (const query of ['', 'r=nonsense', 'x=1', `r=${encodeURIComponent('hm://alice/a?v=bafy')}`]) {
      const response = await open(query)
      expect(response.status).toBe(400)
    }
    const many = Array.from({length: 33}, (_, i) => `r=hm://alice/${i}`).join('&')
    expect((await open(many)).status).toBe(400)
    expect(changeHub.size).toBe(0)
    expect(mocks.listEvents).not.toHaveBeenCalled()
  })

  it('refuses streams past the process limit', async () => {
    const stops = Array.from(
      {length: 2_000},
      () => changeHub.subscribe([{id: 'hm://alice/a', recursive: false}], vi.fn())!,
    )
    const response = await open('r=hm://alice/a')
    expect(response.status).toBe(503)
    expect(response.headers.get('Retry-After')).toBe('30')
    expect(changeHub.size).toBe(2_000)
    stops.forEach((stop) => stop())
    expect(changeHub.size).toBe(0)
  })

  it('requires a session where the site requires sign-in', async () => {
    process.env.SEED_REQUIRE_SIGN_IN = '1'
    const response = await open('r=hm://alice/a')
    expect(response.status).toBe(401)
    expect(changeHub.size).toBe(0)
  })
})
