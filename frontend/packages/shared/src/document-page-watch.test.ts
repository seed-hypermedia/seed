import {describe, expect, it, vi} from 'vitest'
import {DOCUMENT_PAGE_API_SCRIPT, DOCUMENT_PAGE_METHODS, type DocumentPageSDK} from './document-page'
import {createDocumentPageAccess, documentPageAccessWithoutPrompts} from './document-page-permissions'
import {
  createDocumentPageWatches,
  DOCUMENT_PAGE_MAX_WATCHES,
  type DocumentPageWatchMessage,
} from './document-page-watch'

const signal = () => new AbortController().signal
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A host whose data and change signal the test drives by hand. */
function host(initial: unknown) {
  const state = {value: initial, fail: null as string | null}
  const sent: DocumentPageWatchMessage[] = []
  const observers = new Set<() => void>()
  const read = vi.fn(async (_method: string, _params: unknown, _signal: AbortSignal, _refresh: boolean) => {
    if (state.fail) throw new Error(state.fail)
    return structuredClone(state.value)
  })
  const watches = createDocumentPageWatches({
    read,
    observe: (_method, _params, changed) => {
      observers.add(changed)
      return () => observers.delete(changed)
    },
    send: (message) => sent.push(message),
  })
  const change = async (value: unknown) => {
    state.value = value
    for (const changed of [...observers]) changed()
    await settle()
  }
  return {state, sent, observers, read, watches, change}
}

describe('document page watches', () => {
  it('answers the first read, then pushes each value that differs from the last one sent', async () => {
    const {watches, sent, change, read} = host([{id: 'a'}])
    const start = {watch: 'w1', method: 'directory', params: {url: 'hm://z6Mk/entries', all: false}}
    expect(await watches.start(start, signal())).toEqual([{id: 'a'}])
    expect(read).toHaveBeenLastCalledWith('directory', start.params, expect.anything(), false)
    expect(sent).toEqual([])

    await change([{id: 'a'}, {id: 'b'}])
    expect(read).toHaveBeenLastCalledWith('directory', start.params, expect.anything(), true)
    expect(sent).toEqual([{watch: 'w1', result: [{id: 'a'}, {id: 'b'}]}])

    // The host's signal is "may have changed": identical data is not sent again.
    await change([{id: 'a'}, {id: 'b'}])
    expect(sent).toHaveLength(1)
  })

  it('compares values that carry BigInt and bytes', async () => {
    const {watches, sent, change} = host({size: 1n, data: new Uint8Array([1, 2])})
    await watches.start({watch: 'w1', method: 'resource', params: {url: 'hm://z6Mk/doc'}}, signal())
    await change({size: 1n, data: new Uint8Array([1, 2])})
    expect(sent).toEqual([])
    await change({size: 2n, data: new Uint8Array([1, 2])})
    expect(sent).toHaveLength(1)
  })

  it('stops pushing once a watch is stopped or the session closes', async () => {
    const {watches, sent, change, observers} = host(1)
    await watches.start({watch: 'w1', method: 'resource', params: {url: 'hm://z6Mk/a'}}, signal())
    await watches.start({watch: 'w2', method: 'resource', params: {url: 'hm://z6Mk/b'}}, signal())
    expect(watches.stop({watch: 'w1'})).toBeNull()
    expect(watches.stop({watch: 'never-started'})).toBeNull()
    await change(2)
    expect(sent).toEqual([{watch: 'w2', result: 2}])
    watches.close()
    expect(observers.size).toBe(0)
    expect(watches.size).toBe(0)
    await change(3)
    expect(sent).toHaveLength(1)
  })

  it('reports a refresh it could not make once, keeps watching, and recovers', async () => {
    const {watches, sent, change, state} = host('first')
    await watches.start({watch: 'w1', method: 'resource', params: {url: 'hm://z6Mk/a'}}, signal())
    state.fail = 'This page needs permission again to keep this data current.'
    await change('second')
    await change('third')
    expect(sent).toEqual([{watch: 'w1', error: state.fail}])
    state.fail = null
    await change('third')
    expect(sent.at(-1)).toEqual({watch: 'w1', result: 'third'})
  })

  it('fails the start, and holds no watch, when the first read is refused', async () => {
    const {watches, state, observers} = host(null)
    state.fail = 'Page permission denied.'
    await expect(
      watches.start({watch: 'w1', method: 'resource', params: {url: 'hm://z6Mk/a'}}, signal()),
    ).rejects.toThrow('Page permission denied.')
    expect(watches.size).toBe(0)
    expect(observers.size).toBe(0)
  })

  it('reads once more when a change arrives during a refresh, never concurrently', async () => {
    let release!: () => void
    let reads = 0
    let running = 0
    let peak = 0
    let changed!: () => void
    const sent: DocumentPageWatchMessage[] = []
    const watches = createDocumentPageWatches({
      read: async (_method, _params, _signal, refresh) => {
        if (!refresh) return 0
        running++
        peak = Math.max(peak, running)
        const value = ++reads
        if (value === 1) await new Promise<void>((resolve) => (release = resolve))
        running--
        return value
      },
      observe: (_method, _params, notify) => {
        changed = notify
        return () => {}
      },
      send: (message) => sent.push(message),
    })
    await watches.start({watch: 'w1', method: 'resource', params: {url: 'hm://z6Mk/a'}}, signal())
    changed()
    changed()
    changed()
    await settle()
    release()
    await settle()
    expect(peak).toBe(1)
    expect(reads).toBe(2)
    expect(sent).toEqual([
      {watch: 'w1', result: 1},
      {watch: 'w1', result: 2},
    ])
  })

  it('validates the request and caps the watches of one page', async () => {
    const {watches} = host(1)
    const params = {url: 'hm://z6Mk/a'}
    await expect(watches.start({watch: 'w', method: 'request', params}, signal())).rejects.toThrow(
      'seed.watch supports',
    )
    await expect(watches.start({watch: '', method: 'resource', params}, signal())).rejects.toThrow('Invalid watch id')
    await expect(watches.start({watch: 'w', method: 'resource', params, extra: 1}, signal())).rejects.toThrow(
      'Unknown watch parameter',
    )
    for (let index = 0; index < DOCUMENT_PAGE_MAX_WATCHES; index++)
      await watches.start({watch: `w${index}`, method: 'resource', params}, signal())
    await expect(watches.start({watch: 'w0', method: 'resource', params}, signal())).rejects.toThrow(
      'Watch already started',
    )
    await expect(watches.start({watch: 'one-more', method: 'resource', params}, signal())).rejects.toThrow(
      'Stop one before starting another',
    )
  })
})

describe('page access without prompts', () => {
  it('passes requests a grant covers and refuses the rest without asking', async () => {
    const approve = vi.fn(async () => 'site' as const)
    const access = createDocumentPageAccess(approve)
    const read = {
      kind: 'read' as const,
      type: 'Resource',
      title: 'Read',
      site: 'z6MkSite',
      resource: 'hm://z6MkSite/a',
      details: {},
    }
    const quiet = documentPageAccessWithoutPrompts(access)
    await expect(quiet.authorize(read, signal())).rejects.toThrow('needs permission again')
    expect(approve).not.toHaveBeenCalled()
    await access.authorize(read, signal())
    expect(approve).toHaveBeenCalledTimes(1)
    await quiet.authorize({...read, resource: 'hm://z6MkSite/b'}, signal())
    await expect(quiet.authorize({...read, site: 'z6MkOther'}, signal())).rejects.toThrow('needs permission again')
    expect(approve).toHaveBeenCalledTimes(1)
  })
})

describe('seed.watch in the page SDK', () => {
  /** The SDK as a page gets it, over a fake transport. */
  function sdk() {
    const listeners = new Map<string, (message: DocumentPageWatchMessage) => void>()
    const calls: Array<{method: string; params: any}> = []
    const answers: Record<string, unknown> = {}
    const call = vi.fn(async (method: string, params: any) => {
      calls.push({method, params})
      if (answers[method] instanceof Error) throw answers[method]
      return answers[method] ?? null
    })
    const seed = new Function(`return (${DOCUMENT_PAGE_API_SCRIPT})`)()(
      call,
      () => () => {},
      (id: string, listener: (message: DocumentPageWatchMessage) => void) => {
        listeners.set(id, listener)
        return () => listeners.delete(id)
      },
    ) as DocumentPageSDK
    return {seed, calls, answers, listeners}
  }
  const record = (path: string) => ({id: {id: `hm://z6Mk/${path}`, uid: 'z6Mk', path: [path]}, metadata: {}})

  it('lists the watch methods in the runtime contract', () => {
    expect(DOCUMENT_PAGE_METHODS).toContain('watch.start')
    expect(DOCUMENT_PAGE_METHODS).toContain('watch.stop')
  })

  it('delivers the current directory and each pushed one in the shape seed.directory gives', async () => {
    const {seed, calls, answers, listeners} = sdk()
    answers['watch.start'] = [record('a')]
    const seen: any[] = []
    const stop = seed.watch.directory('hm://z6Mk/entries', (records) => seen.push(records))
    await settle()
    expect(calls[0]).toMatchObject({
      method: 'watch.start',
      params: {method: 'directory', params: {url: 'hm://z6Mk/entries', all: false}},
    })
    expect(seen[0].map((item: any) => item.url)).toEqual(['hm://z6Mk/a'])
    expect(String(seen[0][0].id)).toBe('hm://z6Mk/a')

    const id = calls[0]!.params.watch as string
    listeners.get(id)!({watch: id, result: [record('a'), record('b')]})
    expect(seen[1].map((item: any) => item.url)).toEqual(['hm://z6Mk/a', 'hm://z6Mk/b'])

    stop()
    expect(listeners.has(id)).toBe(false)
    expect(calls.at(-1)).toEqual({method: 'watch.stop', params: {watch: id}})
    stop()
    expect(calls.filter((entry) => entry.method === 'watch.stop')).toHaveLength(1)
  })

  it('passes directory options and watches a resource', async () => {
    const {seed, calls, answers} = sdk()
    answers['watch.start'] = []
    seed.watch.directory('hm://z6Mk/entries', {all: true}, () => {})
    seed.watch.resource('hm://z6Mk/doc', () => {})
    await settle()
    expect(calls[0]!.params).toMatchObject({method: 'directory', params: {all: true}})
    expect(calls[1]!.params).toMatchObject({method: 'resource', params: {url: 'hm://z6Mk/doc'}})
  })

  it('hands errors to onError and survives a listener that throws', async () => {
    const {seed, answers, listeners, calls} = sdk()
    answers['watch.start'] = new Error('Page permission denied.')
    const errors: string[] = []
    seed.watch.resource(
      'hm://z6Mk/doc',
      () => {},
      (error) => errors.push(error.message),
    )
    await settle()
    expect(errors).toEqual(['Page permission denied.'])

    answers['watch.start'] = {type: 'document', id: record('doc').id, document: {metadata: {name: 'Doc'}}}
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    let count = 0
    seed.watch.resource('hm://z6Mk/doc', () => {
      count++
      throw new Error('render failed')
    })
    await settle()
    const id = calls.at(-1)!.params.watch as string
    listeners.get(id)!({watch: id, result: answers['watch.start']})
    expect(count).toBe(2)
    quiet.mockRestore()
    expect(() => seed.watch.resource('hm://z6Mk/doc', undefined as never)).toThrow('listener')
  })
})
