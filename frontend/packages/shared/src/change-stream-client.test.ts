import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {CHANGE_STREAM_MAX_SUBSCRIPTIONS} from './change-signal'
import {createChangeStreamClient, type ChangeEventSource} from './change-stream-client'
import {queryKeys} from './models/query-keys'

type FakeSource = ChangeEventSource & {url: string; closed: boolean; emit: (type: string, data?: string) => void}

function setup(options: {hidden?: boolean} = {}) {
  const sources: FakeSource[] = []
  const invalidate = vi.fn()
  let hidden = !!options.hidden
  const visibilityListeners = new Set<() => void>()
  const client = createChangeStreamClient({
    connect: (url) => {
      const listeners = new Map<string, ((event: {data?: unknown}) => void)[]>()
      const source: FakeSource = {
        url,
        closed: false,
        addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
        close: () => (source.closed = true),
        emit: (type, data) => listeners.get(type)?.forEach((listener) => listener({data})),
      }
      sources.push(source)
      return source
    },
    invalidate,
    visibility: {
      hidden: () => hidden,
      subscribe: (changed) => {
        visibilityListeners.add(changed)
        return () => visibilityListeners.delete(changed)
      },
    },
    random: () => 1,
  })
  return {
    client,
    sources,
    invalidate,
    visibilityListeners,
    open: () => sources.filter((source) => !source.closed),
    setHidden: (value: boolean) => {
      hidden = value
      visibilityListeners.forEach((listener) => listener())
    },
  }
}

const doc = {id: 'hm://alice/notes/today', recursive: false}
const dir = {id: 'hm://alice/notes', recursive: true}

describe('change stream client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens one stream for everything watched, and reports it live once the server is ready', async () => {
    const {client, sources} = setup()
    const docLive = vi.fn()
    const dirLive = vi.fn()
    client.watch(doc, docLive)
    client.watch(dir, dirLive)
    client.watch(doc, vi.fn())
    expect(sources).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(50)
    expect(sources).toHaveLength(1)
    expect(sources[0]!.url).toBe('/hm/api/changes?r=hm%3A%2F%2Falice%2Fnotes%2Ftoday&d=hm%3A%2F%2Falice%2Fnotes')
    expect(docLive).not.toHaveBeenCalled()

    sources[0]!.emit('ready')
    expect(docLive.mock.calls).toEqual([[true]])
    expect(dirLive.mock.calls).toEqual([[true]])

    // A watcher that joins a live subscription is told straight away, without a new stream.
    const late = vi.fn()
    client.watch(doc, late)
    expect(late.mock.calls).toEqual([[true]])
    await vi.advanceTimersByTimeAsync(50)
    expect(sources).toHaveLength(1)
  })

  it('invalidates the queries that show a changed resource', async () => {
    const {client, sources, invalidate} = setup()
    client.watch(dir, vi.fn())
    await vi.advanceTimersByTimeAsync(50)
    sources[0]!.emit('ready')
    expect(invalidate).not.toHaveBeenCalled()

    sources[0]!.emit('message', 'hm://alice/notes/today')
    expect(invalidate).toHaveBeenCalledWith([queryKeys.ENTITY, 'hm://alice/notes/today'])
    expect(invalidate).toHaveBeenCalledWith([queryKeys.DOC_LIST_DIRECTORY, 'hm://alice/notes'])
    expect(invalidate).toHaveBeenCalledWith([queryKeys.DOC_LIST_DIRECTORY, 'hm://alice'])
  })

  it('reports not live when the stream fails, reconnects with backoff, and catches up on return', async () => {
    const {client, sources, invalidate, open} = setup()
    const live = vi.fn()
    client.watch(doc, live)
    await vi.advanceTimersByTimeAsync(50)
    sources[0]!.emit('ready')

    sources[0]!.emit('error')
    expect(live.mock.calls).toEqual([[true], [false]])
    expect(sources[0]!.closed).toBe(true)
    await vi.advanceTimersByTimeAsync(999)
    expect(sources).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(sources).toHaveLength(2)

    // A refused or unreachable server is retried less and less often.
    sources[1]!.emit('error')
    await vi.advanceTimersByTimeAsync(1_999)
    expect(sources).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(sources).toHaveLength(3)
    sources[2]!.emit('error')
    await vi.advanceTimersByTimeAsync(4_000)
    expect(sources).toHaveLength(4)
    expect(open()).toHaveLength(1)
    expect(live).toHaveBeenCalledTimes(2)

    // Back: live again, and whatever changed meanwhile is re-read once.
    sources[3]!.emit('ready')
    expect(live.mock.calls.at(-1)).toEqual([true])
    expect(invalidate.mock.calls).toEqual([[[queryKeys.ENTITY, doc.id]], [[queryKeys.RESOLVED_ENTITY, doc.id]]])

    // The backoff starts over after a good connection.
    sources[3]!.emit('error')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sources).toHaveLength(5)
  })

  it('never reports live when the stream cannot connect', async () => {
    const {client, sources} = setup()
    const live = vi.fn()
    client.watch(doc, live)
    await vi.advanceTimersByTimeAsync(50)
    sources[0]!.emit('error')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(sources).toHaveLength(2)
    // The second attempt hangs without an answer; it is abandoned and retried too.
    await vi.advanceTimersByTimeAsync(50_000)
    expect(sources[1]!.closed).toBe(true)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(sources).toHaveLength(3)
    expect(live).not.toHaveBeenCalled()
  })

  it('takes a silent stream for dead', async () => {
    const {client, sources} = setup()
    const live = vi.fn()
    client.watch(doc, live)
    await vi.advanceTimersByTimeAsync(50)
    sources[0]!.emit('ready')
    // Heartbeats keep it alive.
    for (let i = 0; i < 6; i++) {
      await vi.advanceTimersByTimeAsync(20_000)
      sources[0]!.emit('ping')
    }
    expect(live.mock.calls).toEqual([[true]])
    await vi.advanceTimersByTimeAsync(50_000)
    expect(live.mock.calls).toEqual([[true], [false]])
    expect(sources[0]!.closed).toBe(true)
  })

  it('closes the stream when nothing is watched any more', async () => {
    const {client, sources, open, visibilityListeners} = setup()
    const stopDoc = client.watch(doc, vi.fn())
    const stopDir = client.watch(dir, vi.fn())
    await vi.advanceTimersByTimeAsync(50)
    sources[0]!.emit('ready')

    // Dropping one of two keeps the stream: reconnecting would cost more than a stray signal.
    stopDoc()
    stopDoc()
    await vi.advanceTimersByTimeAsync(50)
    expect(open()).toHaveLength(1)
    expect(sources).toHaveLength(1)

    stopDir()
    await vi.advanceTimersByTimeAsync(50)
    expect(open()).toHaveLength(0)
    expect(visibilityListeners.size).toBe(0)
    await vi.advanceTimersByTimeAsync(300_000)
    expect(sources).toHaveLength(1)
  })

  it('opens a new stream when a watch is added, without reporting the old ones down', async () => {
    const {client, sources, open} = setup()
    const docLive = vi.fn()
    client.watch(doc, docLive)
    await vi.advanceTimersByTimeAsync(50)
    sources[0]!.emit('ready')

    const dirLive = vi.fn()
    client.watch(dir, dirLive)
    await vi.advanceTimersByTimeAsync(50)
    expect(sources).toHaveLength(2)
    expect(open()).toEqual([sources[1]])
    sources[1]!.emit('ready')
    expect(docLive.mock.calls).toEqual([[true]])
    expect(dirLive.mock.calls).toEqual([[true]])
  })

  it('leaves subscriptions past the stream limit not live, so their callers keep polling', async () => {
    const {client, sources} = setup()
    const lives = Array.from({length: CHANGE_STREAM_MAX_SUBSCRIPTIONS + 1}, (_, i) => {
      const live = vi.fn()
      client.watch({id: `hm://alice/${i}`, recursive: false}, live)
      return live
    })
    await vi.advanceTimersByTimeAsync(50)
    expect(new URL(sources[0]!.url, 'http://site.test').searchParams.getAll('r')).toHaveLength(
      CHANGE_STREAM_MAX_SUBSCRIPTIONS,
    )
    sources[0]!.emit('ready')
    expect(lives[0]).toHaveBeenCalledWith(true)
    expect(lives.at(-1)).not.toHaveBeenCalled()
  })

  it('lets go of the stream in a tab hidden for a while, and catches up when it is shown again', async () => {
    const {client, sources, open, invalidate, setHidden} = setup()
    const live = vi.fn()
    client.watch(dir, live)
    await vi.advanceTimersByTimeAsync(50)
    sources[0]!.emit('ready')

    // A quick switch away and back changes nothing.
    setHidden(true)
    await vi.advanceTimersByTimeAsync(5_000)
    setHidden(false)
    await vi.advanceTimersByTimeAsync(20_000)
    sources[0]!.emit('ping')
    expect(open()).toHaveLength(1)

    setHidden(true)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(open()).toHaveLength(0)
    expect(live.mock.calls).toEqual([[true], [false]])

    setHidden(false)
    expect(sources).toHaveLength(2)
    sources[1]!.emit('ready')
    expect(live.mock.calls.at(-1)).toEqual([true])
    expect(invalidate.mock.calls).toEqual([[[queryKeys.DOC_LIST_DIRECTORY, dir.id]]])
  })

  it('re-reads what it watches when the server says changes were skipped', async () => {
    const {client, sources, invalidate} = setup()
    client.watch(doc, vi.fn())
    await vi.advanceTimersByTimeAsync(50)
    sources[0]!.emit('ready')
    sources[0]!.emit('resync')
    sources[0]!.emit('resync')
    expect(invalidate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(invalidate.mock.calls).toEqual([[[queryKeys.ENTITY, doc.id]], [[queryKeys.RESOLVED_ENTITY, doc.id]]])
  })
})
