/**
 * Pending plugin tool-call manager (main process). A plugin action invoked by
 * the assistant runs in a renderer sandbox, so `execute` in app-chat.ts must
 * wait for an out-of-band result that arrives later via the `submitToolResult`
 * tRPC mutation. This maps a requestId to the promise that `execute` awaits,
 * with a hard timeout so a crashed/closed renderer can never hang the stream.
 *
 * Pure and framework-free (setTimeout only) so it can be unit-tested with fake
 * timers. Every request settles exactly once: the first of resolve/reject/
 * timeout wins and removes the entry; later calls for the same id are no-ops.
 */

type Pending = {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

export type PendingToolCalls = {
  /** Register a request and get the promise `execute` awaits. */
  request(requestId: string): Promise<unknown>
  /** Settle a request with its output. No-op if unknown/already settled. */
  resolve(requestId: string, result: unknown): void
  /** Fail a request with an error message. No-op if unknown/already settled. */
  reject(requestId: string, error: string): void
  /** Whether a request is still awaiting a result. */
  has(requestId: string): boolean
  /** Number of in-flight requests. */
  size(): number
  /** Reject every in-flight request (e.g. on shutdown). */
  clear(reason?: string): void
}

export function createPendingToolCalls(timeoutMs: number): PendingToolCalls {
  const pending = new Map<string, Pending>()

  function settle(requestId: string): Pending | undefined {
    const entry = pending.get(requestId)
    if (!entry) return undefined
    pending.delete(requestId)
    clearTimeout(entry.timeout)
    return entry
  }

  return {
    request(requestId) {
      // A duplicate id means two live calls would share one result slot; reject
      // the new one rather than silently orphan the old promise.
      if (pending.has(requestId)) {
        return Promise.reject(new Error(`Duplicate plugin tool request id: ${requestId}`))
      }
      return new Promise<unknown>((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(requestId)
          reject(new Error(`Plugin tool call timed out after ${timeoutMs}ms`))
        }, timeoutMs)
        pending.set(requestId, {resolve, reject, timeout})
      })
    },
    resolve(requestId, result) {
      settle(requestId)?.resolve(result)
    },
    reject(requestId, error) {
      settle(requestId)?.reject(new Error(error))
    },
    has(requestId) {
      return pending.has(requestId)
    },
    size() {
      return pending.size
    },
    clear(reason = 'Pending plugin tool calls cleared') {
      for (const requestId of Array.from(pending.keys())) {
        settle(requestId)?.reject(new Error(reason))
      }
    },
  }
}
