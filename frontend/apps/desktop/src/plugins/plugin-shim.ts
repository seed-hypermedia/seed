/**
 * The plugin sandbox shim: the static HTML document loaded (via srcdoc) into
 * every plugin iframe, plus the message protocol both sides speak.
 *
 * Security invariants (see docs/plugins/design.md §2):
 * - The iframe is created with sandbox="allow-scripts" ONLY — an opaque
 *   origin with no storage, no popups, no navigation, no app-origin access.
 * - This HTML is a fixed string: no plugin content is ever interpolated into
 *   it (srcdoc HTML-injection is structurally impossible).
 * - The meta CSP closes the network entirely (`connect-src 'none'`), and
 *   blob workers inherit it — plugin code cannot fetch/XHR/WebSocket.
 * - Plugin code runs in a fresh Worker PER INVOCATION, created from a Blob
 *   URL; the shim terminates it on completion, error, or host command. A
 *   hung worker burns its own thread, never the app's.
 * - All host↔shim traffic runs over a MessagePort handed across in the
 *   bootstrap message; the host verifies `event.source` before handing the
 *   port over, and ports are unforgeable afterwards.
 */

/** Messages the host sends to the shim (over the bootstrap port). */
export type HostToShimMessage =
  | {type: 'invoke'; callId: string; code: string; action: string; input: unknown}
  | {type: 'cancel'; callId: string}

/** Messages the shim sends to the host. */
export type ShimToHostMessage =
  | {type: 'shim-ready'}
  | {type: 'result'; callId: string; output: unknown}
  | {type: 'error'; callId: string; message: string}
  // A permission-gated capability call from plugin code (seed.call). The
  // host answers with a BridgeResponseMessage carrying the same rpcId.
  | {type: 'bridge-call'; callId: string; rpcId: string; method: string; params: unknown}

/** The host's answer to a bridge-call, sent back over the same port. */
export type BridgeResponseMessage = {
  type: 'bridge-response'
  callId: string
  rpcId: string
  result?: unknown
  error?: string
}

/**
 * Source for the in-worker SDK bootstrap prepended to plugin code. Defines
 * the `seed` global; the plugin registers handlers with `seed.action(...)`
 * and the worker invokes the requested one when the shim posts `run`.
 */
const WORKER_BOOTSTRAP = `
const __actions = Object.create(null)
const __pendingBridge = new Map()
let __bridgeSeq = 0
const seed = {
  action(name, handler) {
    if (typeof name !== 'string' || typeof handler !== 'function') throw new Error('seed.action(name, handler)')
    __actions[name] = handler
  },
  call(method, params) {
    return new Promise((resolve, reject) => {
      const rpcId = 'rpc' + (++__bridgeSeq)
      __pendingBridge.set(rpcId, {resolve, reject})
      postMessage({type: 'bridge-call', rpcId, method, params})
    })
  },
}
self.seed = seed
self.onmessage = async (event) => {
  const message = event.data
  if (message && message.type === 'bridge-response') {
    const pending = __pendingBridge.get(message.rpcId)
    if (!pending) return
    __pendingBridge.delete(message.rpcId)
    if (message.error !== undefined) pending.reject(new Error(String(message.error)))
    else pending.resolve(message.result)
    return
  }
  if (message && message.type === 'run') {
    try {
      const handler = __actions[message.action]
      if (!handler) throw new Error('Unknown action: ' + message.action)
      const output = await handler(message.input)
      postMessage({type: 'done', output})
    } catch (error) {
      postMessage({type: 'fail', message: error instanceof Error ? error.message : String(error)})
    }
  }
}
`

/**
 * The shim page script. Runs inside the sandboxed iframe (trusted code, ours).
 * Waits for the bootstrap message carrying the MessagePort, then serves
 * invocations: one fresh Worker per call, plugin code appended to the SDK
 * bootstrap, bridge calls proxied between worker and host port.
 */
const SHIM_SCRIPT = `
'use strict'
let hostPort = null
const liveCalls = new Map() // callId -> {worker, cleanup}

function endCall(callId) {
  const call = liveCalls.get(callId)
  if (!call) return
  liveCalls.delete(callId)
  call.worker.terminate()
  URL.revokeObjectURL(call.codeUrl)
}

function handleHostMessage(event) {
  const message = event.data
  if (!message) return
  if (message.type === 'cancel') {
    endCall(message.callId)
    return
  }
  if (message.type !== 'invoke') return
  const {callId, code, action, input} = message
  let worker, codeUrl
  try {
    codeUrl = URL.createObjectURL(new Blob([WORKER_BOOTSTRAP + '\\n;\\n' + code], {type: 'text/javascript'}))
    worker = new Worker(codeUrl)
  } catch (error) {
    hostPort.postMessage({type: 'error', callId, message: 'Failed to start plugin: ' + (error && error.message)})
    return
  }
  liveCalls.set(callId, {worker, codeUrl})
  worker.onerror = (event) => {
    hostPort.postMessage({type: 'error', callId, message: String((event && event.message) || 'Plugin crashed')})
    endCall(callId)
  }
  worker.onmessage = (event) => {
    const out = event.data
    if (!out) return
    if (out.type === 'done') {
      hostPort.postMessage({type: 'result', callId, output: out.output})
      endCall(callId)
    } else if (out.type === 'fail') {
      hostPort.postMessage({type: 'error', callId, message: String(out.message)})
      endCall(callId)
    } else if (out.type === 'bridge-call') {
      // Tag with the callId so the host can enforce per-invocation context.
      hostPort.postMessage({type: 'bridge-call', callId, rpcId: out.rpcId, method: out.method, params: out.params})
    }
  }
  // Route host bridge responses to the owning worker via a per-call listener
  // installed below (hostPort has one listener; it dispatches by callId).
  worker.postMessage({type: 'run', action, input})
}

window.addEventListener('message', (event) => {
  // The one-time bootstrap: the host (our parent) transfers a MessagePort.
  if (hostPort || !event.ports || !event.ports.length) return
  hostPort = event.ports[0]
  hostPort.onmessage = (portEvent) => {
    const message = portEvent.data
    if (message && message.type === 'bridge-response') {
      const call = liveCalls.get(message.callId)
      if (call) call.worker.postMessage({type: 'bridge-response', rpcId: message.rpcId, result: message.result, error: message.error})
      return
    }
    handleHostMessage(portEvent)
  }
  hostPort.postMessage({type: 'shim-ready'})
})
`

/**
 * The complete srcdoc document. `WORKER_BOOTSTRAP` is embedded via JSON
 * stringification of a fixed constant — still zero non-constant content.
 */
export const PLUGIN_SHIM_HTML = `<!doctype html>
<html>
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' blob:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'">
</head>
<body>
<script>
const WORKER_BOOTSTRAP = ${JSON.stringify(WORKER_BOOTSTRAP)}
${SHIM_SCRIPT}
</script>
</body>
</html>`

/** sandbox attribute for the plugin iframe — allow-scripts and NOTHING else. */
export const PLUGIN_IFRAME_SANDBOX = 'allow-scripts'

/** Default per-invocation deadline. */
export const PLUGIN_CALL_TIMEOUT_MS = 30_000
