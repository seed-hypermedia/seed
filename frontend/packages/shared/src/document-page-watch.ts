/**
 * Live reads for document pages. A page that calls `seed.watch.resource` or `seed.watch.directory`
 * gets the current value and then every later one, so no page polls. The host owns the change
 * signal: it observes the data the page read and, when that data may have changed, reads it again
 * with the page's own authority and sends the value only when it differs from the last one sent.
 */

/** Reads a page may watch. Each is also an ordinary one-shot read of the same name. */
export const DOCUMENT_PAGE_WATCH_METHODS = ['resource', 'directory'] as const
export type DocumentPageWatchMethod = (typeof DOCUMENT_PAGE_WATCH_METHODS)[number]

/** Most watches one page session may hold; each one keeps a host query and a sync subscription alive. */
export const DOCUMENT_PAGE_MAX_WATCHES = 16

/** What the host pushes to the page for one watch: a new value, or why the watch stopped updating. */
export type DocumentPageWatchMessage = {watch: string; result: unknown} | {watch: string; error: string}

type WatchRead = (
  method: DocumentPageWatchMethod,
  params: Record<string, unknown>,
  signal: AbortSignal,
  /** False for the first read, which may ask the viewer; true for a refresh, which never asks. */
  refresh: boolean,
) => Promise<unknown>

type Watch = {
  method: DocumentPageWatchMethod
  params: Record<string, unknown>
  /** Fingerprint of the last value the page was sent. */
  sent: string
  controller: AbortController
  stopObserving: () => void
  reading: boolean
  /** A change arrived during a read; read once more when it finishes. */
  again: boolean
}

/** Stable text for comparing two read results, including the BigInt and bytes a resource may carry. */
function fingerprint(value: unknown): string {
  return (
    JSON.stringify(value, (_key, item) =>
      typeof item === 'bigint'
        ? `${item}n`
        : ArrayBuffer.isView(item)
          ? Array.from(item as unknown as ArrayLike<number>)
          : item,
    ) ?? ''
  )
}

/**
 * The watches of one page session.
 *
 * `read` answers a read as the page (permissions included); `observe` tells the host to watch the
 * same data and call back whenever it may have changed, returning how to stop; `send` delivers a
 * message to the page.
 */
export function createDocumentPageWatches(options: {
  read: WatchRead
  observe: (method: DocumentPageWatchMethod, params: Record<string, unknown>, changed: () => void) => () => void
  send: (message: DocumentPageWatchMessage) => void
}) {
  const watches = new Map<string, Watch>()

  const refresh = async (id: string, watch: Watch) => {
    if (watch.reading) {
      watch.again = true
      return
    }
    watch.reading = true
    try {
      do {
        watch.again = false
        let result: unknown
        try {
          result = await options.read(watch.method, watch.params, watch.controller.signal, true)
        } catch (error) {
          if (watches.get(id) !== watch) return
          // The page keeps its last value. A later change tries again, so a restored grant recovers.
          const message = error instanceof Error ? error.message : String(error)
          if (watch.sent !== `error:${message}`) {
            watch.sent = `error:${message}`
            options.send({watch: id, error: message})
          }
          continue
        }
        if (watches.get(id) !== watch) return
        const next = fingerprint(result)
        if (next === watch.sent) continue
        watch.sent = next
        options.send({watch: id, result})
      } while (watch.again)
    } finally {
      watch.reading = false
    }
  }

  const stop = (id: string) => {
    const watch = watches.get(id)
    if (!watch) return
    watches.delete(id)
    watch.controller.abort()
    watch.stopObserving()
  }

  return {
    /** Begin a watch and answer with the current value; the page gets later values through `send`. */
    async start(input: unknown, signal: AbortSignal): Promise<unknown> {
      const {watch: id, method, params, ...unknown} = (input ?? {}) as Record<string, unknown>
      if (Object.keys(unknown).length) throw new Error('Unknown watch parameter')
      if (typeof id !== 'string' || !id || id.length > 64) throw new Error('Invalid watch id')
      if (!(DOCUMENT_PAGE_WATCH_METHODS as readonly unknown[]).includes(method))
        throw new Error(`seed.watch supports: ${DOCUMENT_PAGE_WATCH_METHODS.join(', ')}`)
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Invalid watch parameters')
      if (watches.has(id)) throw new Error('Watch already started')
      if (watches.size >= DOCUMENT_PAGE_MAX_WATCHES)
        throw new Error(`A page can hold ${DOCUMENT_PAGE_MAX_WATCHES} watches. Stop one before starting another.`)
      const watch: Watch = {
        method: method as DocumentPageWatchMethod,
        params: params as Record<string, unknown>,
        sent: '',
        controller: new AbortController(),
        stopObserving: () => {},
        reading: true,
        again: false,
      }
      // Reserve the slot before the first read: that read can wait on a permission prompt.
      watches.set(id, watch)
      try {
        const result = await options.read(
          watch.method,
          watch.params,
          AbortSignal.any([signal, watch.controller.signal]),
          false,
        )
        if (watches.get(id) !== watch) throw new Error('Watch stopped')
        watch.sent = fingerprint(result)
        watch.stopObserving = options.observe(watch.method, watch.params, () => {
          if (watches.get(id) === watch) void refresh(id, watch)
        })
        return result
      } catch (error) {
        stop(id)
        throw error
      } finally {
        watch.reading = false
      }
    },
    /** End one watch. Unknown ids are ignored: the page may stop a watch whose start failed. */
    stop(input: unknown): null {
      const id = (input as {watch?: unknown} | null)?.watch
      if (typeof id === 'string') stop(id)
      return null
    },
    /** Read every watch again, for a change the host made itself (the page just published). */
    refreshAll() {
      watches.forEach((watch, id) => void refresh(id, watch))
    },
    /** End every watch: the frame navigated, reloaded or closed. */
    close() {
      Array.from(watches.keys()).forEach(stop)
    },
    /** How many watches are live. */
    get size() {
      return watches.size
    },
  }
}
