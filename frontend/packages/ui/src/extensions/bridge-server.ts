/**
 * Host side of the extension bridge (docs/extensions/design.md §5).
 *
 * Framework-free: takes a `post` function and a source check instead of a
 * window, so it can be driven from React (ExtensionFrame) or from tests with
 * plain objects. Responsibilities:
 *
 *  - ignore anything that is not a tagged extension message from the trusted source
 *  - answer `hello` / `getContext` itself
 *  - validate params (bridge-schemas.ts) → `invalid_params`
 *  - enforce EXTENSION_METHOD_PERMISSIONS against the current context → `permission_denied`
 *  - dispatch to the typed handler map; unknown → `unknown_method`, missing → `not_supported`
 *  - map thrown ExtensionError to its payload, anything else to `internal` (message only)
 *  - respond exactly once per request id
 */

import {
  EXTENSION_MESSAGE_TAG,
  EXTENSION_METHOD_PERMISSIONS,
  EXTENSION_PROTOCOL_VERSION,
  ExtensionError,
  isExtensionMessage,
  type ExtensionContext,
  type ExtensionErrorPayload,
  type ExtensionEventName,
  type ExtensionEvents,
  type ExtensionMessage,
  type ExtensionMethodName,
  type ExtensionMethods,
  type ExtensionRequestMessage,
} from '@seed-hypermedia/client/extensions'
import {EXTENSION_METHOD_PARAM_SCHEMAS, isKnownExtensionMethod} from './bridge-schemas'

/** Methods the host must implement. `hello` and `getContext` are answered by the server itself. */
export type ExtensionHandledMethodName = Exclude<ExtensionMethodName, 'hello' | 'getContext'>

export type ExtensionHandler<M extends ExtensionHandledMethodName> = (
  params: ExtensionMethods[M]['params'],
) => Promise<ExtensionMethods[M]['result']>

export type ExtensionHandlers = {[M in ExtensionHandledMethodName]: ExtensionHandler<M>}

export type ExtensionBridgeServerOptions = {
  /**
   * Deliver a message to the extension (host → iframe). `target` is the window
   * that sent the request being answered (absent for events); hosts should
   * drop a response whose target is no longer the live iframe window.
   */
  post: (msg: ExtensionMessage, target?: Window) => void
  /** Whether a `MessageEvent.source` is the extension's window. */
  isTrustedSource: (source: unknown) => boolean
  /** Current context; read on every request so permission checks see live state. */
  getContext: () => ExtensionContext
  handlers: Partial<ExtensionHandlers>
  /** Optional sink for handler failures (default: console.error for `internal` only). */
  onError?: (method: string, error: unknown) => void
}

export type ExtensionBridgeServer = {
  /** Feed a `message` event; non-extension messages are ignored. */
  handleMessage: (event: MessageEvent) => void
  /** Push an event to the extension. */
  emit: <E extends ExtensionEventName>(event: E, data: ExtensionEvents[E]) => void
  /** Stop answering; in-flight handlers still finish but their responses are dropped. */
  dispose: () => void
}

/** Convert anything thrown by a handler into a wire error payload (never leaks a stack). */
export function toExtensionErrorPayload(error: unknown): ExtensionErrorPayload {
  if (error instanceof ExtensionError) return error.toPayload()
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const e = error as {code: unknown; message: unknown; data?: unknown}
    if (typeof e.code === 'string' && typeof e.message === 'string' && isExtensionErrorCode(e.code)) {
      return {code: e.code, message: e.message, data: e.data}
    }
  }
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown error'
  return {code: 'internal', message}
}

const ERROR_CODES = new Set([
  'permission_denied',
  'user_rejected',
  'not_signed_in',
  'unknown_method',
  'invalid_params',
  'not_supported',
  'internal',
])
function isExtensionErrorCode(code: string): code is ExtensionErrorPayload['code'] {
  return ERROR_CODES.has(code)
}

export function createExtensionBridgeServer(options: ExtensionBridgeServerOptions): ExtensionBridgeServer {
  let disposed = false

  function respond(id: number, body: {result: unknown} | {error: ExtensionErrorPayload}, target?: Window) {
    if (disposed) return
    options.post({[EXTENSION_MESSAGE_TAG]: EXTENSION_PROTOCOL_VERSION, type: 'response', id, ...body}, target)
  }

  async function dispatch(msg: ExtensionRequestMessage): Promise<unknown> {
    const method: unknown = msg.method
    if (!isKnownExtensionMethod(method)) {
      throw new ExtensionError('unknown_method', `Unknown method: ${String(method)}`)
    }
    const parsed = EXTENSION_METHOD_PARAM_SCHEMAS[method].safeParse(msg.params)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
      throw new ExtensionError('invalid_params', `Invalid params for ${method}: ${issues}`)
    }
    const params = parsed.data

    if (method === 'hello' || method === 'getContext') {
      return options.getContext()
    }

    const context = options.getContext()
    const needed = EXTENSION_METHOD_PERMISSIONS[method]
    if (needed && !context.permissions.includes(needed)) {
      throw new ExtensionError(
        'permission_denied',
        `Method ${method} requires the "${needed}" permission, which this extension does not have`,
        {permission: needed},
      )
    }

    const handler = options.handlers[method] as ((params: unknown) => Promise<unknown>) | undefined
    if (!handler) {
      throw new ExtensionError('not_supported', `Method ${method} is not supported by this host`)
    }
    return handler(params)
  }

  function handleMessage(event: MessageEvent) {
    if (disposed) return
    if (!options.isTrustedSource(event.source)) return
    const data: unknown = event.data
    if (!isExtensionMessage(data)) return
    if (data.type !== 'request') return
    if (typeof data.id !== 'number') return
    const id = data.id
    // Answer the window that asked: if the iframe is torn down and re-created
    // while a handler is in flight, the response must not reach the new page
    // (whose request ids restart from 1).
    const target = typeof Window !== 'undefined' && event.source instanceof Window ? event.source : undefined
    let answered = false
    const once = (body: {result: unknown} | {error: ExtensionErrorPayload}) => {
      if (answered) return
      answered = true
      respond(id, body, target)
    }
    dispatch(data).then(
      (result) => once({result: result === undefined ? null : result}),
      (error) => {
        const payload = toExtensionErrorPayload(error)
        if (payload.code === 'internal') {
          if (options.onError) options.onError(String(data.method), error)
          else console.error(`[extension-bridge] ${String(data.method)} failed:`, error)
        }
        once({error: payload})
      },
    )
  }

  function emit<E extends ExtensionEventName>(event: E, data: ExtensionEvents[E]) {
    if (disposed) return
    options.post({[EXTENSION_MESSAGE_TAG]: EXTENSION_PROTOCOL_VERSION, type: 'event', event, data})
  }

  return {
    handleMessage,
    emit,
    dispose: () => {
      disposed = true
    },
  }
}
