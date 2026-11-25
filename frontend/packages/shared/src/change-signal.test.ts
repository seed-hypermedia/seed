import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {createActivityCursor, getBlobId} from './activity-changes'
import {
  CHANGE_STREAM_MAX_SUBSCRIPTIONS,
  changeStreamUrl,
  createChangeHub,
  encodeChangeStreamEvent,
  parseChangeStreamQuery,
  resourceChangeQueryKeys,
  type ChangeSignal,
} from './change-signal'
import {queryKeys} from './models/query-keys'

const resource = (id: string): ChangeSignal => ({type: 'change', resource: id})

/** A feed the test fills; each poll hands over what was added since the last one. */
function feed() {
  let pending: string[] = []
  let truncated = false
  const poll = vi.fn(async () => {
    const result = {resources: pending, truncated}
    pending = []
    truncated = false
    return result
  })
  return {
    poll,
    follow: vi.fn(() => poll),
    add: (...resources: string[]) => pending.push(...resources),
    truncate: () => (truncated = true),
  }
}

describe('change hub', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('polls once per interval however many listeners there are, and stops when the last leaves', async () => {
    const source = feed()
    const hub = createChangeHub({follow: source.follow, maxListeners: 100})
    expect(source.follow).not.toHaveBeenCalled()

    const stops = Array.from({length: 25}, () => hub.subscribe([{id: 'hm://alice/a', recursive: false}], vi.fn())!)
    await vi.advanceTimersByTimeAsync(0)
    expect(source.follow).toHaveBeenCalledTimes(1)
    expect(source.poll).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(3_000)
    expect(source.poll).toHaveBeenCalledTimes(4)

    stops.slice(1).forEach((stop) => stop())
    await vi.advanceTimersByTimeAsync(1_000)
    expect(source.poll).toHaveBeenCalledTimes(5)

    stops[0]!()
    expect(hub.size).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(source.poll).toHaveBeenCalledTimes(5)

    // The next listener follows the feed afresh rather than catching up on the idle stretch.
    hub.subscribe([{id: 'hm://alice/a', recursive: false}], vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    expect(source.follow).toHaveBeenCalledTimes(2)
    expect(source.poll).toHaveBeenCalledTimes(6)
  })

  it('tells a listener only about what it subscribed to', async () => {
    const source = feed()
    const hub = createChangeHub({follow: source.follow, maxListeners: 100})
    const exact = vi.fn()
    const directory = vi.fn()
    const root = vi.fn()
    const other = vi.fn()
    hub.subscribe([{id: 'hm://alice/notes/today', recursive: false}], exact)
    hub.subscribe([{id: 'hm://alice/notes', recursive: true}], directory)
    hub.subscribe([{id: 'hm://alice', recursive: true}], root)
    hub.subscribe(
      [
        {id: 'hm://bob/notes', recursive: true},
        {id: 'hm://alice/notes', recursive: false},
      ],
      other,
    )
    await vi.advanceTimersByTimeAsync(0)

    source.add('hm://alice/notes/today', 'hm://alice/notes/today')
    await vi.advanceTimersByTimeAsync(1_000)
    // One signal per resource per poll, however many blobs arrived for it.
    expect(exact.mock.calls).toEqual([[resource('hm://alice/notes/today')]])
    expect(directory.mock.calls).toEqual([[resource('hm://alice/notes/today')]])
    expect(root.mock.calls).toEqual([[resource('hm://alice/notes/today')]])
    expect(other).not.toHaveBeenCalled()

    // A directory hears about itself and deeper descendants; a resource does not hear about children.
    source.add('hm://alice/notes', 'hm://alice/notes/today/draft', 'hm://alice/notesy', 'hm://alice')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(exact).toHaveBeenCalledTimes(1)
    expect(directory.mock.calls.slice(1)).toEqual([
      [resource('hm://alice/notes')],
      [resource('hm://alice/notes/today/draft')],
    ])
    expect(root).toHaveBeenCalledTimes(5)
    expect(other.mock.calls).toEqual([[resource('hm://alice/notes')]])
  })

  it('stops telling a listener that left, and keeps the others', async () => {
    const source = feed()
    const hub = createChangeHub({follow: source.follow, maxListeners: 100})
    const gone = vi.fn()
    const kept = vi.fn()
    const stop = hub.subscribe([{id: 'hm://alice/a', recursive: false}], gone)!
    hub.subscribe([{id: 'hm://alice/a', recursive: false}], kept)
    await vi.advanceTimersByTimeAsync(0)
    stop()
    stop()
    expect(hub.size).toBe(1)
    source.add('hm://alice/a')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(gone).not.toHaveBeenCalled()
    expect(kept).toHaveBeenCalledTimes(1)
  })

  it('refuses listeners past its limit, and takes one again when a place frees up', async () => {
    const source = feed()
    const hub = createChangeHub({follow: source.follow, maxListeners: 2})
    const first = hub.subscribe([{id: 'hm://alice/a', recursive: false}], vi.fn())
    hub.subscribe([{id: 'hm://alice/b', recursive: false}], vi.fn())
    expect(hub.subscribe([{id: 'hm://alice/c', recursive: false}], vi.fn())).toBeNull()
    expect(hub.size).toBe(2)
    first!()
    expect(hub.subscribe([{id: 'hm://alice/c', recursive: false}], vi.fn())).not.toBeNull()
  })

  it('replays recent changes to a listener that joins a running hub', async () => {
    const source = feed()
    const hub = createChangeHub({follow: source.follow, maxListeners: 100, replayMs: 5_000})
    hub.subscribe([{id: 'hm://alice', recursive: true}], vi.fn())
    await vi.advanceTimersByTimeAsync(0)
    source.add('hm://alice/old')
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(4_000)
    source.add('hm://alice/new', 'hm://alice/unrelated')
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)

    const late = vi.fn()
    hub.subscribe(
      [
        {id: 'hm://alice/new', recursive: false},
        {id: 'hm://alice/old', recursive: false},
      ],
      late,
    )
    expect(late.mock.calls).toEqual([[resource('hm://alice/new')]])
  })

  it('tells every listener to resync when the feed skipped changes', async () => {
    const source = feed()
    const hub = createChangeHub({follow: source.follow, maxListeners: 100})
    const a = vi.fn()
    const b = vi.fn()
    hub.subscribe([{id: 'hm://alice/a', recursive: false}], a)
    hub.subscribe([{id: 'hm://bob/b', recursive: false}], b)
    await vi.advanceTimersByTimeAsync(0)
    source.add('hm://alice/a')
    source.truncate()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(a.mock.calls).toEqual([[{type: 'resync'}]])
    expect(b.mock.calls).toEqual([[{type: 'resync'}]])
  })

  it('keeps going after a failed poll, asking less often while the node is failing', async () => {
    let fail = true
    const poll = vi.fn(async () => {
      if (fail) throw new Error('node down')
      return {resources: ['hm://alice/a']}
    })
    const onError = vi.fn()
    const hub = createChangeHub({follow: () => poll, maxListeners: 100, onError})
    const listener = vi.fn()
    hub.subscribe([{id: 'hm://alice/a', recursive: false}], listener)
    await vi.advanceTimersByTimeAsync(0)
    expect(poll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    // The second attempt waits two seconds, not one.
    expect(poll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(poll).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(2)
    fail = false
    await vi.advanceTimersByTimeAsync(4_000)
    expect(listener).toHaveBeenCalledWith(resource('hm://alice/a'))
    const calls = poll.mock.calls.length
    await vi.advanceTimersByTimeAsync(2_000)
    expect(poll.mock.calls.length).toBe(calls + 2)
  })

  it('drops what a poll returns after the hub stopped', async () => {
    let finish!: (value: {resources: string[]}) => void
    const poll = vi.fn(() => new Promise<{resources: string[]}>((resolve) => (finish = resolve)))
    const hub = createChangeHub({follow: () => poll, maxListeners: 100})
    const listener = vi.fn()
    const stop = hub.subscribe([{id: 'hm://alice/a', recursive: false}], listener)!
    stop()
    finish({resources: ['hm://alice/a']})
    await vi.advanceTimersByTimeAsync(5_000)
    expect(listener).not.toHaveBeenCalled()
    expect(poll).toHaveBeenCalledTimes(1)
  })
})

describe('change stream protocol', () => {
  it('round-trips subscriptions through the stream address', () => {
    const subscriptions = [
      {id: 'hm://alice/notes', recursive: true},
      {id: 'hm://alice/notes', recursive: false},
      {id: 'hm://bob', recursive: false},
    ]
    const url = new URL(changeStreamUrl(subscriptions), 'http://site.test')
    expect(url.pathname).toBe('/hm/api/changes')
    expect(parseChangeStreamQuery(url.searchParams)).toEqual(subscriptions)
  })

  it('refuses an address it cannot serve', () => {
    const parse = (query: string) => parseChangeStreamQuery(new URLSearchParams(query))
    expect(parse('')).toEqual({error: 'Nothing to watch'})
    expect(parse('x=hm://alice')).toEqual({error: 'Unknown parameter: x'})
    expect(parse('r=https://example.com/a')).toEqual({error: 'Invalid resource id'})
    expect(parse(`r=${encodeURIComponent('hm://alice/a?v=bafy')}`)).toEqual({error: 'Invalid resource id'})
    expect(parse(`r=hm://alice/${'a'.repeat(600)}`)).toEqual({error: 'Invalid resource id'})
    const many = Array.from({length: CHANGE_STREAM_MAX_SUBSCRIPTIONS + 1}, (_, i) => `r=hm://alice/${i}`).join('&')
    expect(parse(many)).toEqual({error: `A stream carries at most ${CHANGE_STREAM_MAX_SUBSCRIPTIONS} subscriptions`})
    // The same subscription twice is one.
    expect(parse('r=hm://alice/a&r=hm://alice/a')).toEqual([{id: 'hm://alice/a', recursive: false}])
  })

  it('writes server-sent events a resource id cannot break out of', () => {
    expect(encodeChangeStreamEvent({type: 'ready'})).toBe('event: ready\ndata:\n\n')
    expect(encodeChangeStreamEvent({type: 'ping'})).toBe('event: ping\ndata:\n\n')
    expect(encodeChangeStreamEvent({type: 'resync'})).toBe('event: resync\ndata:\n\n')
    expect(encodeChangeStreamEvent(resource('hm://alice/a\n\nevent: ready'))).toBe('data: hm://alice/aevent: ready\n\n')
  })

  it('names the queries a changed resource makes stale', () => {
    expect(resourceChangeQueryKeys('hm://alice/notes/today')).toEqual([
      [queryKeys.ENTITY, 'hm://alice/notes/today'],
      [queryKeys.RESOLVED_ENTITY, 'hm://alice/notes/today'],
      [queryKeys.ACCOUNT, 'alice'],
      [queryKeys.DOC_LIST_DIRECTORY, 'hm://alice'],
      [queryKeys.DOC_LIST_DIRECTORY, 'hm://alice/notes'],
      [queryKeys.DOC_LIST_DIRECTORY, 'hm://alice/notes/today'],
      [queryKeys.DOCUMENT_INTERACTION_SUMMARY, 'hm://alice/notes/today'],
    ])
    expect(resourceChangeQueryKeys('not a resource')).toEqual([])
  })
})

describe('activity cursor', () => {
  const event = (blobId: number, observedMs = 0) =>
    ({
      data: {case: 'newBlob', value: {blobId: BigInt(blobId), resource: `hm://alice/${blobId}?v=x`}},
      observeTime: {seconds: BigInt(Math.floor(observedMs / 1000)), nanos: (observedMs % 1000) * 1e6},
    }) as any

  /** A feed of blob ids, newest first, served in pages. */
  function pagedFeed(ids: () => number[], observed: (id: number) => number = () => 0) {
    return vi.fn(async (request: {pageSize?: number; pageToken?: string}) => {
      const all = ids()
      const start = request.pageToken ? Number(request.pageToken) : 0
      const size = request.pageSize ?? 30
      const next = start + size
      return {
        events: all.slice(start, next).map((id) => event(id, observed(id))),
        nextPageToken: next < all.length ? String(next) : '',
      } as any
    })
  }

  it('starts from now, then returns only what arrived since', async () => {
    let ids = [5, 4, 3, 2, 1]
    const listEvents = pagedFeed(() => ids)
    const cursor = createActivityCursor(listEvents)
    expect(await cursor.poll()).toEqual({events: [], truncated: false})
    expect(listEvents).toHaveBeenLastCalledWith(expect.objectContaining({pageSize: 1}))
    expect(await cursor.poll()).toEqual({events: [], truncated: false})

    ids = [7, 6, 5, 4, 3, 2, 1]
    const {events} = await cursor.poll()
    expect(events.map(getBlobId)).toEqual([BigInt(7), BigInt(6)])
    expect((await cursor.poll()).events).toEqual([])
  })

  it('walks back through pages to the watermark', async () => {
    let ids = [1]
    const listEvents = pagedFeed(() => ids)
    const cursor = createActivityCursor(listEvents)
    await cursor.poll()
    ids = Array.from({length: 71}, (_, i) => 71 - i)
    listEvents.mockClear()
    const {events, truncated} = await cursor.poll()
    expect(events).toHaveLength(70)
    expect(truncated).toBe(false)
    expect(listEvents).toHaveBeenCalledTimes(3)
  })

  it('stops at its page limit and says changes were skipped', async () => {
    let ids = [1]
    const listEvents = pagedFeed(() => ids)
    const cursor = createActivityCursor(listEvents, {maxPages: 2})
    await cursor.poll()
    ids = Array.from({length: 200}, (_, i) => 200 - i)
    listEvents.mockClear()
    const {events, truncated} = await cursor.poll()
    expect(truncated).toBe(true)
    expect(events).toHaveLength(60)
    expect(listEvents).toHaveBeenCalledTimes(2)
    // The skipped events are behind the watermark now.
    expect(await cursor.poll()).toEqual({events: [], truncated: false})
  })

  it('replays events the node received just before the first poll, when asked', async () => {
    const listEvents = pagedFeed(
      () => [3, 2, 1],
      (id) => ({3: 99_000, 2: 96_000, 1: 90_000})[id]!,
    )
    const cursor = createActivityCursor(listEvents, {replayMs: 5_000, now: () => 100_000})
    const {events} = await cursor.poll()
    expect(events.map(getBlobId)).toEqual([BigInt(3), BigInt(2)])
    expect((await cursor.poll()).events).toEqual([])
  })
})
