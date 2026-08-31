/**
 * Iframe side of the Seed extension bridge.
 *
 * An extension runs in a sandboxed iframe (`sandbox="allow-scripts ..."`,
 * without `allow-same-origin`) and can only reach the host app through
 * `window.parent.postMessage`. This module implements the request/response
 * protocol defined in `@seed-hypermedia/client/extensions` and wraps every
 * method in a small typed API ({@link SeedExtension}).
 */

import {
  EXTENSION_MESSAGE_TAG,
  EXTENSION_PROTOCOL_VERSION,
  ExtensionError,
  isExtensionMessage,
} from '@seed-hypermedia/client/extensions'
import type {
  ExtensionContext,
  ExtensionErrorPayload,
  ExtensionEventName,
  ExtensionMessage,
  ExtensionMethodName,
  ExtensionMethods,
  ExtensionPermission,
  ExtensionReadQueryKey,
  ExtensionRequestMessage,
  ExtensionUser,
} from '@seed-hypermedia/client/extensions'
import type {HMResource, HMSearchInput, HMSearchPayload} from '@seed-hypermedia/client/hm-types'
import {base64Decode, base64Encode, toBytes} from './base64'

export const SDK_VERSION = '0.0.1'

// ── Transport ────────────────────────────────────────────────────────────────

/** How messages physically travel. The default posts to `window.parent`; tests inject a fake. */
export type ExtensionTransport = {
  post(message: ExtensionMessage): void
  /** Deliver every bridge message from the host to `handler`; returns an unsubscribe function. */
  listen(handler: (message: ExtensionMessage) => void): () => void
}

export function createWindowTransport(win: Window = window): ExtensionTransport {
  const parent = win.parent
  return {
    post(message) {
      // The iframe has an opaque origin (sandboxed without allow-same-origin),
      // so there is no concrete targetOrigin the host could be matched against:
      // '*' is the only value that delivers. Nothing secret travels this way
      // that the host did not already know, and the host authenticates us by
      // `event.source` (this iframe's window) on its side.
      parent.postMessage(message, '*')
    },
    listen(handler) {
      const onMessage = (event: MessageEvent) => {
        // Only the embedding host may talk to us. Anything else — other frames,
        // browser extensions, our own echoed requests when opened standalone —
        // is dropped before it is even parsed.
        if (event.source !== parent) return
        if (!isExtensionMessage(event.data)) return
        handler(event.data)
      }
      win.addEventListener('message', onMessage)
      return () => win.removeEventListener('message', onMessage)
    },
  }
}

// ── Request/response multiplexer ─────────────────────────────────────────────

type Pending = {resolve: (value: unknown) => void; reject: (error: ExtensionError) => void}

class Bridge {
  private nextId = 1
  private pending = new Map<number, Pending>()
  private eventHandlers = new Set<(event: ExtensionEventName, data: unknown) => void>()
  private unlisten: (() => void) | null

  constructor(private transport: ExtensionTransport) {
    this.unlisten = transport.listen((message) => this.handle(message))
  }

  get closed(): boolean {
    return this.unlisten === null
  }

  allocateId(): number {
    return this.nextId++
  }

  buildRequest<M extends ExtensionMethodName>(
    id: number,
    method: M,
    params: ExtensionMethods[M]['params'],
  ): ExtensionRequestMessage {
    return {[EXTENSION_MESSAGE_TAG]: EXTENSION_PROTOCOL_VERSION, type: 'request', id, method, params}
  }

  /** Register a pending request under `id` and post `message`. The caller may re-post the same message (handshake retry). */
  send<M extends ExtensionMethodName>(message: ExtensionRequestMessage): Promise<ExtensionMethods[M]['result']> {
    if (this.closed) {
      return Promise.reject(new ExtensionError('internal', 'Extension is disconnected from the host'))
    }
    return new Promise((resolve, reject) => {
      this.pending.set(message.id, {resolve, reject})
      this.transport.post(message)
    })
  }

  request<M extends ExtensionMethodName>(
    method: M,
    params: ExtensionMethods[M]['params'],
  ): Promise<ExtensionMethods[M]['result']> {
    return this.send<M>(this.buildRequest(this.allocateId(), method, params))
  }

  onEvent(handler: (event: ExtensionEventName, data: unknown) => void): () => void {
    this.eventHandlers.add(handler)
    return () => this.eventHandlers.delete(handler)
  }

  private handle(message: ExtensionMessage) {
    if (message.type === 'response') {
      const pending = this.pending.get(message.id)
      // Unknown ids are stray replies (e.g. the host answered a retried hello twice).
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(toExtensionError(message.error))
      else pending.resolve(message.result)
    } else if (message.type === 'event') {
      for (const handler of this.eventHandlers) handler(message.event, message.data)
    }
    // 'request' messages only flow host-ward; ignore any that come back.
  }

  close() {
    if (this.closed) return
    this.unlisten?.()
    this.unlisten = null
    const error = new ExtensionError('internal', 'Extension is disconnected from the host')
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    this.eventHandlers.clear()
  }
}

function toExtensionError(payload: ExtensionErrorPayload): ExtensionError {
  return new ExtensionError(payload.code || 'internal', payload.message || 'Unknown error', payload.data)
}

// ── Public API ───────────────────────────────────────────────────────────────

export type ConnectOptions = {
  /** How long to wait for the host to answer the handshake. Default 5000 ms. */
  timeoutMs?: number
  /** How often `hello` is re-sent until the host answers. Default 250 ms. */
  helloIntervalMs?: number
  /** Reported to the host in the handshake. Defaults to the SDK version. */
  sdkVersion?: string
  /** Advanced: replace the postMessage transport (used by tests). */
  transport?: ExtensionTransport
}

/** A hypermedia id as the SDK sends it to the host: a packed `hm://` URL. See README, "Hypermedia ids". */
export type HMIdRef = {id: string}

/**
 * Build the `{id: 'hm://...'}` shape the host accepts wherever its API wants
 * an `UnpackedHypermediaId`. Pass `version` to pin a document version.
 */
export function hmRef(url: string, version?: string | null): HMIdRef {
  if (!version) return {id: url}
  const separator = url.includes('?') ? '&' : '?'
  return {id: `${url}${separator}v=${encodeURIComponent(version)}`}
}

export type SearchOptions = Omit<HMSearchInput, 'query'>

export type SignDataResult = {
  /** Signature over `buildSignDataPayload(extensionId, data)` — see @seed-hypermedia/client/extensions. */
  signature: Uint8Array
  /** Signer principal (`z6Mk...`). May be a delegated device key. */
  signer: string
  /** Account the signer acts for. */
  accountId: string
}

export class SeedExtension {
  /** Latest context pushed by the host. Read-only; subscribe with {@link onContext}. */
  context: ExtensionContext
  private contextListeners = new Set<(context: ExtensionContext) => void>()
  private stopEvents: () => void

  /** @internal Use {@link connect}. */
  constructor(
    private bridge: Bridge,
    context: ExtensionContext,
  ) {
    this.context = context
    this.stopEvents = bridge.onEvent((event, data) => {
      if (event === 'context') {
        this.context = data as ExtensionContext
        for (const listener of this.contextListeners) listener(this.context)
      }
    })
  }

  // ── Context ──

  /** Subscribe to context changes. `cb` is also called immediately with the current context. */
  onContext(cb: (context: ExtensionContext) => void): () => void {
    this.contextListeners.add(cb)
    cb(this.context)
    return () => this.contextListeners.delete(cb)
  }

  /** The signed-in viewer, or null. */
  get user(): ExtensionUser | null {
    return this.context.user
  }

  /** Whether the host granted `permission` to this extension. */
  hasPermission(permission: ExtensionPermission): boolean {
    return this.context.permissions.includes(permission)
  }

  // ── Raw RPC ──

  /** Call any bridge method with its exact typed params/result. */
  call<M extends ExtensionMethodName>(
    method: M,
    params: ExtensionMethods[M]['params'],
  ): Promise<ExtensionMethods[M]['result']> {
    return this.bridge.request(method, params)
  }

  // ── Reading ──

  /** Read-only hypermedia query, routed to the host's universal `request(key, input)`. */
  query(key: ExtensionReadQueryKey, input: unknown): Promise<unknown> {
    return this.call('api.query', {key, input})
  }

  /** Load a document/comment by `hm://` URL. Version-less ids resolve to the latest known version. */
  getResource(id: string, opts?: {version?: string}): Promise<HMResource> {
    return this.query('Resource', hmRef(id, opts?.version)) as Promise<HMResource>
  }

  /** Full-text search. Pass `{accountUid}` to restrict results to one space. */
  search(query: string, opts?: SearchOptions): Promise<HMSearchPayload> {
    return this.query('Search', {...opts, query}) as Promise<HMSearchPayload>
  }

  /** A URL for an IPFS file by CID that works in `<img src>`, `<video>` and (CORS permitting) `fetch`. */
  async fileUrl(cid: string): Promise<string> {
    const {url} = await this.call('file.url', {cid})
    return url
  }

  /** Read an IPFS file through the host — use when the iframe cannot fetch the URL itself. */
  async readFile(cid: string, opts?: {maxBytes?: number}): Promise<Uint8Array> {
    const {base64} = await this.call('file.read', {cid, maxBytes: opts?.maxBytes})
    return base64Decode(base64)
  }

  // ── Writing (each call is confirmed by the user in the host) ──

  readonly sign = {
    /** Publish a comment on a document as the current user. Requires the `sign` permission. */
    comment: (params: ExtensionMethods['sign.comment']['params']) => this.call('sign.comment', params),
    /** Create or update a document as the current user. Requires the `sign` permission. */
    document: (params: ExtensionMethods['sign.document']['params']) => this.call('sign.document', params),
    /**
     * Sign arbitrary bytes (strings are UTF-8 encoded). The host domain-separates
     * the payload; verify with `buildSignDataPayload` from @seed-hypermedia/client/extensions.
     */
    data: async (data: Uint8Array | string, purpose: string): Promise<SignDataResult> => {
      const result = await this.call('sign.data', {base64: base64Encode(toBytes(data)), purpose})
      return {signature: base64Decode(result.signature), signer: result.signer, accountId: result.accountId}
    },
  }

  // ── Navigation ──

  /** Navigate the host to an `hm://` URL or a site-relative path. Requires `navigate`. */
  async navigate(url: string, opts?: {replace?: boolean}): Promise<void> {
    await this.call('navigate', {url, replace: opts?.replace})
  }

  /** Open an external http(s) URL in a new tab / the system browser. Requires `navigate`. */
  async openExternal(url: string): Promise<void> {
    await this.call('openExternal', {url})
  }

  /** Update the URL beneath the mount (for in-extension routing). The new `subPath`/`query` arrive via a context event. */
  async setRoute(subPath: string[], query?: Record<string, string>, opts?: {replace?: boolean}): Promise<void> {
    await this.call('route.set', {subPath, query, replace: opts?.replace})
  }

  // ── Storage (per extension, in the viewer's browser; requires `storage`) ──

  readonly storage = {
    get: async (key: string): Promise<string | null> => (await this.call('storage.get', {key})).value,
    set: async (key: string, value: string): Promise<void> => {
      await this.call('storage.set', {key, value})
    },
    remove: async (key: string): Promise<void> => {
      await this.call('storage.remove', {key})
    },
    keys: async (): Promise<string[]> => (await this.call('storage.keys', {})).keys,
  }

  // ── UI ──

  async toast(message: string, kind?: 'info' | 'success' | 'error'): Promise<void> {
    await this.call('ui.toast', {message, kind})
  }

  async setTitle(title: string): Promise<void> {
    await this.call('ui.setTitle', {title})
  }

  /** Ask the host to size the iframe to `height` CSS pixels (the host may clamp). */
  async resize(height: number): Promise<void> {
    await this.call('ui.resize', {height})
  }

  // ── Lifecycle ──

  /** Stop listening to the host. Pending calls reject; further calls reject with `internal`. */
  disconnect(): void {
    this.stopEvents()
    this.contextListeners.clear()
    this.bridge.close()
  }
}

/**
 * Perform the `hello` handshake and resolve with a ready {@link SeedExtension}.
 *
 * The host may attach its message listener a moment after the iframe script
 * starts, so `hello` is re-sent every `helloIntervalMs` until answered. If no
 * host answers within `timeoutMs` the promise rejects with
 * `ExtensionError('not_supported')` — typically because the page was opened
 * outside a Seed host.
 */
export function connect(options: ConnectOptions = {}): Promise<SeedExtension> {
  const timeoutMs = options.timeoutMs ?? 5000
  const helloIntervalMs = options.helloIntervalMs ?? 250
  const transport = options.transport ?? createWindowTransport()
  const bridge = new Bridge(transport)

  const hello = bridge.buildRequest(bridge.allocateId(), 'hello', {
    protocol: EXTENSION_PROTOCOL_VERSION,
    sdkVersion: options.sdkVersion ?? SDK_VERSION,
  })

  return new Promise<SeedExtension>((resolve, reject) => {
    const retry = setInterval(() => transport.post(hello), helloIntervalMs)
    const timeout = setTimeout(() => {
      clearInterval(retry)
      bridge.close()
      reject(
        new ExtensionError(
          'not_supported',
          `No Seed host answered within ${timeoutMs}ms. Is this page running inside a Seed extension frame?`,
        ),
      )
    }, timeoutMs)

    bridge.send<'hello'>(hello).then(
      (context) => {
        clearInterval(retry)
        clearTimeout(timeout)
        resolve(new SeedExtension(bridge, context))
      },
      (error) => {
        clearInterval(retry)
        clearTimeout(timeout)
        bridge.close()
        reject(error)
      },
    )
  })
}
