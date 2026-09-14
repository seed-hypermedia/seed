import type * as api from '@seed-hypermedia/agents-protocol'

type Connection = {
  id: string
  actor: string
  lease: ReturnType<typeof setTimeout>
  queue: api.BrowserRequest[]
  poll?: (request?: api.BrowserRequest) => void
  pending: Map<string, {resolve: (output: Record<string, unknown>) => void; reject: (error: Error) => void}>
}

/** In-memory signed-session relay. Commands are never replayed after delivery or reconnection. */
export class BrowserTools {
  #connections = new Map<string, Connection>()

  /** Connects one authenticated actor/window; a second window cannot silently take over. */
  connect(scope: string, actor: string, id: string): void {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(id)) throw new Error('Invalid browser connection ID')
    const existing = this.#connections.get(scope)
    if (existing) {
      if (existing.actor === actor && existing.id === id) return
      throw new Error('This session already has a browser connected. Disconnect it in the other window first.')
    }
    const connection: Connection = {
      id,
      actor,
      queue: [],
      pending: new Map(),
      lease: setTimeout(() => this.#close(scope), 60000),
    }
    this.#connections.set(scope, connection)
  }

  #get(scope: string, actor: string, id: string): Connection {
    const connection = this.#connections.get(scope)
    if (!connection || connection.actor !== actor || connection.id !== id)
      throw new Error('Browser connection is no longer active')
    return connection
  }

  /** Long-polls with a bounded network heartbeat and renews the desktop's lease. */
  async poll(scope: string, actor: string, id: string): Promise<api.BrowserRequest | undefined> {
    const connection = this.#get(scope, actor, id)
    if (connection.poll) throw new Error('A browser poll is already pending')
    clearTimeout(connection.lease)
    connection.lease = setTimeout(() => this.#close(scope), 60000)
    const queued = connection.queue.shift()
    if (queued) return queued
    return new Promise((resolve) => {
      const heartbeat = setTimeout(() => connection.poll?.(), 20000)
      connection.poll = (request) => {
        clearTimeout(heartbeat)
        connection.poll = undefined
        if (request) {
          clearTimeout(connection.lease)
          connection.lease = setTimeout(() => this.#close(scope), 60000)
        }
        resolve(request)
      }
    })
  }

  /** Dispatches a command to the session's current desktop, with a bounded execution deadline. */
  execute(scope: string, command: api.BrowserCommand): Promise<Record<string, unknown>> {
    const connection = this.#connections.get(scope)
    if (!connection)
      return Promise.reject(
        new Error(
          'Browser unavailable. Open a website and connect browser access in this session’s desktop assistant panel.',
        ),
      )
    if (connection.pending.size >= 8) return Promise.reject(new Error('Too many browser commands pending'))
    const request = {id: crypto.randomUUID(), command}
    return new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        connection.queue = connection.queue.filter((item) => item.id !== request.id)
        connection.pending.delete(request.id)
        reject(
          new Error(
            'Browser command timed out; its outcome may be unknown. Inspect the page before retrying an action.',
          ),
        )
      }, 45000)
      connection.pending.set(request.id, {
        resolve: (output) => {
          clearTimeout(deadline)
          resolve(output)
        },
        reject: (error) => {
          clearTimeout(deadline)
          reject(error)
        },
      })
      if (connection.poll) connection.poll(request)
      else connection.queue.push(request)
    })
  }

  /** Resolves exactly the pending command owned by this authenticated connection. */
  resolve(scope: string, actor: string, action: api.ResolveSessionBrowser): void {
    const connection = this.#get(scope, actor, action.connectionId)
    const pending = connection.pending.get(action.requestId)
    if (!pending) throw new Error('Browser request is no longer pending')
    if (action.error !== undefined && typeof action.error !== 'string') throw new Error('Browser error must be text')
    if (
      action.output !== undefined &&
      (!action.output || typeof action.output !== 'object' || Array.isArray(action.output))
    )
      throw new Error('Browser output must be an object')
    if (new TextEncoder().encode(JSON.stringify(action.output ?? {})).byteLength > 4 * 1024 * 1024)
      throw new Error('Browser response exceeds 4 MiB')
    connection.pending.delete(action.requestId)
    if (action.error) pending.reject(new Error(action.error.slice(0, 2000)))
    else pending.resolve(action.output ?? {})
  }

  /** Revokes only the matching actor/window, including queued and in-flight commands. */
  disconnect(scope: string, actor: string, id: string): void {
    if (!this.#connections.has(scope)) return
    this.#get(scope, actor, id)
    this.#close(scope)
  }

  #close(scope: string): void {
    const connection = this.#connections.get(scope)
    if (!connection) return
    this.#connections.delete(scope)
    clearTimeout(connection.lease)
    connection.poll?.()
    for (const pending of connection.pending.values())
      pending.reject(new Error('Browser disconnected. Inspect the page before retrying an action.'))
  }

  /** Releases leases and pending requests when the service shuts down. */
  close(): void {
    for (const scope of this.#connections.keys()) this.#close(scope)
  }
}
