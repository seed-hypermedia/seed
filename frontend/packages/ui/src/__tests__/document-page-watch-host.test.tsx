// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const uid = 'z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  /** The host's own directory query, which the watch observes for changes. */
  observed: vi.fn(async () => []),
  client: {} as Record<string, unknown>,
}))
vi.mock('@shm/shared/routing', () => ({
  useUniversalClient: () => mocks.client,
  useOpenUrl: () => vi.fn(),
  useUniversalAppContext: () => ({originHomeId: null}),
}))
vi.mock('@shm/shared/models/contacts', () => ({
  useSelectedAccountContacts: () => ({
    data: [{subject: 'z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj', subscribe: {site: true}}],
  }),
}))
vi.mock('@shm/shared/models/entity', () => ({useSelectedAccountId: () => 'viewer', useResource: vi.fn()}))
vi.mock('@shm/shared/models/queries', async (original) => ({
  ...(await original<typeof import('@shm/shared/models/queries')>()),
  queryAccount: () => ({queryKey: ['test-account'], queryFn: async () => ({metadata: {name: 'Viewer'}})}),
  queryDirectory: (_client: unknown, id: {id: string}, mode: string) => ({
    queryKey: ['DOC_LIST_DIRECTORY', id.id, mode],
    queryFn: mocks.observed,
  }),
}))

import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {setDocumentPagePlatform} from '@shm/shared/document-page'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {DocumentPageView} from '../document-page'

const cid = 'bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e'
const origin = `seed-page://${'c'.repeat(40)}`
const docId = unpackHmId(`hm://${uid}/pages/board`)!
const entries = `hm://${uid}/entries`
const directoryKey = ['DOC_LIST_DIRECTORY', entries]
const document = {
  metadata: {name: 'Board', type: 'hm://hyper.media/page', html: `ipfs://${cid}`},
  version: 'v1',
  content: [],
} as unknown as HMDocument

/** A directory entry in the page's own space, which it may read without asking. */
const record = (name: string) => ({id: unpackHmId(`${entries}/${name}`)})

let root: Root
let container: HTMLDivElement
let queryClient: QueryClient
/** What the page's own read of the directory returns. */
let records: unknown[]

beforeEach(() => {
  records = [record('first')]
  mocks.request.mockReset()
  mocks.request.mockImplementation(async (key: string) => (key === 'Query' ? {results: records} : null))
  mocks.observed.mockClear()
  mocks.client = {request: mocks.request}
  queryClient = new QueryClient({defaultOptions: {queries: {retry: false, staleTime: 30_000}}})
  window.localStorage.clear()
  setDocumentPagePlatform({resolvePageUrl: async () => `${origin}/`})
  container = window.document.createElement('div')
  window.document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  setDocumentPagePlatform(null)
  vi.useRealTimers()
})

/** Render the page and start one directory watch from inside its frame. */
async function startWatch() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <DocumentPageView docId={docId} document={document} cid={cid} />
      </QueryClientProvider>,
    ),
  )
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(container.querySelector('iframe')).not.toBeNull()
  })
  const source = container.querySelector('iframe')!.contentWindow!
  const posted = vi.spyOn(source, 'postMessage')
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent('message', {
        source,
        origin,
        data: {
          seedPage: 1,
          id: 'start',
          method: 'watch.start',
          params: {watch: 'entries', method: 'directory', params: {url: entries}},
        },
      }),
    )
  })
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(posted).toHaveBeenCalledWith({seedPage: 1, id: 'start', result: [record('first')]}, origin)
  })
  // The observer's first load of the host query settles before the test changes anything.
  await vi.waitFor(async () => {
    await act(async () => {})
    expect(queryClient.getQueryState(directoryKey.concat('Children'))?.status).toBe('success')
    expect(queryClient.isFetching()).toBe(0)
  })
  posted.mockClear()
  return posted
}

/**
 * Mark the observed query changed, as the change feed does. The host tells one refetch from the
 * next by its timestamp, so let the clock move first: these mocks answer within a millisecond.
 */
async function invalidate() {
  await new Promise((resolve) => setTimeout(resolve, 5))
  await act(async () => {
    await queryClient.invalidateQueries({queryKey: directoryKey})
  })
}

const pushes = (posted: {mock: {calls: unknown[][]}}) =>
  posted.mock.calls.map(([data]) => data).filter((data) => (data as {type?: string}).type === 'seed-data')

describe('document page live reads in the host', () => {
  it('pushes a new value when the observed query is invalidated, and nothing when the data is the same', async () => {
    const posted = await startWatch()

    // Invalidated, but the page would read the same value: nothing is sent.
    const reads = mocks.request.mock.calls.length
    await invalidate()
    await vi.waitFor(() => expect(mocks.request.mock.calls.length).toBe(reads + 1))
    await act(async () => {})
    expect(pushes(posted)).toEqual([])

    records = [record('first'), record('second')]
    await invalidate()
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(pushes(posted)).toEqual([
        expect.objectContaining({message: {watch: 'entries', result: [record('first'), record('second')]}}),
      ])
    })
  })

  it('polls only while the change stream is not live', async () => {
    const stop = vi.fn()
    let setLive!: (live: boolean) => void
    const watchChanges = vi.fn((_opts: unknown, onLive: (live: boolean) => void) => {
      setLive = onLive
      return stop
    })
    mocks.client = {request: mocks.request, watchChanges}
    await startWatch()
    expect(watchChanges).toHaveBeenCalledWith(
      {id: expect.objectContaining({id: entries}), recursive: true},
      expect.any(Function),
    )

    vi.useFakeTimers()
    // Re-arm the observer's interval under the fake clock.
    setLive(true)
    setLive(false)
    const fetched = mocks.observed.mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_000)
    })
    expect(mocks.observed.mock.calls.length).toBe(fetched)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(mocks.observed.mock.calls.length).toBe(fetched + 1)

    setLive(true)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000)
    })
    expect(mocks.observed.mock.calls.length).toBe(fetched + 1)
    expect(stop).not.toHaveBeenCalled()
  })

  it('ends its watches when the view unmounts', async () => {
    const stopChanges = vi.fn()
    const stopSync = vi.fn()
    mocks.client = {
      request: mocks.request,
      watchChanges: vi.fn(() => stopChanges),
      subscribeEntity: vi.fn(() => stopSync),
    }
    const posted = await startWatch()
    const query = queryClient.getQueryCache().find(directoryKey, {exact: false})!
    expect(query.getObserversCount()).toBe(1)

    act(() => root.unmount())
    expect(stopChanges).toHaveBeenCalledTimes(1)
    expect(stopSync).toHaveBeenCalledTimes(1)
    expect(query.getObserversCount()).toBe(0)

    // A change after the page closed reaches nobody and reads nothing.
    const reads = mocks.request.mock.calls.length
    records = [record('late')]
    await queryClient.invalidateQueries({queryKey: directoryKey})
    expect(mocks.request.mock.calls.length).toBe(reads)
    expect(pushes(posted)).toEqual([])
    root = createRoot(container)
  })
})
