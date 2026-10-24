import {
  DOCUMENT_APP_API_SCRIPT,
  DOCUMENT_APP_MAX_REQUEST_BYTES,
  documentAppMessageSize,
  type DocumentAppContext,
} from './document-app'

/** Same-origin resource route containing only the sandbox bootstrap, never app code or credentials. */
export const DOCUMENT_APP_RUNNER_PATH = '/hm/app-runner'

/** HTTP policy also isolates direct visits; app code may execute only inline scripts/styles. */
export const DOCUMENT_APP_SANDBOX_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ')

/** Render a static bootstrap pinned to the embedding site's origin. */
export function documentAppRunnerHTML(origin: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>Seed app</title></head><body><script>const HOST_ORIGIN = ' +
    JSON.stringify(origin).replace(/</g, '\\u003c') +
    ';\n' +
    runnerScript
      .replace('SEED_API_FACTORY', DOCUMENT_APP_API_SCRIPT)
      .replace('SEED_MESSAGE_SIZE', documentAppMessageSize.toString())
      .replace('SEED_MAX_BYTES', String(DOCUMENT_APP_MAX_REQUEST_BYTES)) +
    '</script></body></html>'
  )
}

const runnerScript = String.raw`
;(() => {
  const launch = new URLSearchParams(location.hash.slice(1)).get('launch')
  if (parent === window || !launch) {
    document.body.textContent = 'Open this app through its Seed document.'
    return
  }
  let connected = false
  const connect = (event) => {
    if (
      connected ||
      event.source !== parent ||
      event.origin !== HOST_ORIGIN ||
      event.data?.type !== 'seed-connect' ||
      event.data.launch !== launch ||
      event.ports.length !== 1
    )
      return
    connected = true
    window.removeEventListener('message', connect)
    const port = event.ports[0]
    const pending = new Map()
    let nextId = 0
    let loaded = false
    let closed = false
    const messageSize = SEED_MESSAGE_SIZE
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        if (closed) return reject(new Error('App session closed'))
        if (pending.size >= 32) return reject(new Error('Too many pending requests'))
        const id = String(++nextId)
        const message = {type: 'seed-call', id, method, params}
        if (messageSize(message) > SEED_MAX_BYTES)
          return reject(new Error('Request too large'))
        const timeout = ['context', 'profile', 'storage.get', 'storage.set', 'hm.parseMarkdown', 'hm.validateContent', 'hm.unpackHmId'].includes(method) ? setTimeout(() => {
          pending.delete(id)
          reject(new Error('Request expired'))
        }, 5000) : undefined
        pending.set(id, {resolve, reject, timeout})
        port.postMessage(message)
      })
    Object.defineProperty(window, 'seed', {
      value: (SEED_API_FACTORY)(call),
      writable: false,
      configurable: false,
    })
    window.addEventListener(
      'pagehide',
      () => {
        closed = true
        port.postMessage({type: 'seed-leaving'})
        port.close()
        for (const request of pending.values()) {
          clearTimeout(request.timeout)
          request.reject(new Error('App session closed'))
        }
        pending.clear()
      },
      {once: true},
    )
    port.onmessage = ({data}) => {
      if (data?.type === 'seed-load' && !loaded && typeof data.html === 'string') {
        loaded = true
        // Parse without executing, install the DOM, then execute inline scripts in order.
        // The response's HTTP CSP survives this DOM replacement.
        const app = new DOMParser().parseFromString(data.html, 'text/html')
        document.head.replaceChildren(...Array.from(app.head.childNodes, (node) => document.importNode(node, true)))
        document.body.replaceChildren(...Array.from(app.body.childNodes, (node) => document.importNode(node, true)))
        for (const old of [...document.querySelectorAll('script')]) {
          // Desktop apps include this bridge file. The web runner already installed the equivalent API.
          if (old.getAttribute('src') === '/.seed/client.js') { old.remove(); continue; }
          const script = document.createElement('script')
          for (const attribute of old.attributes) script.setAttribute(attribute.name, attribute.value)
          script.textContent = old.textContent
          old.replaceWith(script)
        }
        port.postMessage({type: 'seed-loaded'})
      } else if (data?.type === 'seed-result') {
        const request = pending.get(data.id)
        if (!request) return
        pending.delete(data.id)
        clearTimeout(request.timeout)
        if (data.error) request.reject(new Error(data.error))
        else request.resolve(data.result)
      }
    }
    port.postMessage({type: 'seed-connected'})
  }
  window.addEventListener('message', connect)
  parent.postMessage({type: 'seed-ready', launch}, HOST_ORIGIN)
})()
`

/** Mount one opaque app; the host binds its storage and read authority before any app code runs. */
export function mountDocumentApp({
  container,
  html,
  context,
  storage,
  resource,
  profile,
  content,
  onClose = () => {},
}: {
  container: HTMLElement
  html: string
  context: DocumentAppContext
  storage: Storage
  resource: (url: string) => Promise<unknown>
  profile: () => Promise<{id: string; name: string | null} | null>
  content?: (method: string, params: unknown, signal: AbortSignal) => Promise<unknown>
  onClose?: (reason: string) => void
}) {
  const controller = new AbortController()
  const launch = crypto.randomUUID()
  const frame = document.createElement('iframe')
  frame.title = 'Document app'
  frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:white'
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.referrerPolicy = 'no-referrer'
  frame.src = `${DOCUMENT_APP_RUNNER_PATH}#launch=${launch}`
  const channel = new MessageChannel()
  let active = true
  let connected = false
  let loaded = false
  let initialLoad = false
  let requestCount = 0
  let windowStart = performance.now()
  let resolveReady!: () => void
  let rejectReady!: (reason: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // Readiness timeout reports a broken runner; it is not used to order the handshake.
  const deadline = setTimeout(() => destroy('Runner did not become ready'), 10000)

  function destroy(reason = 'Closed') {
    if (!active) return
    active = false
    controller.abort()
    clearTimeout(deadline)
    window.removeEventListener('message', handshake)
    channel.port1.close()
    channel.port2.close()
    frame.remove()
    if (!loaded) rejectReady(new Error(reason))
    onClose(reason)
  }

  function handshake(event: MessageEvent) {
    if (
      !active ||
      connected ||
      event.source !== frame.contentWindow ||
      event.origin !== 'null' ||
      event.data?.type !== 'seed-ready' ||
      event.data.launch !== launch
    )
      return
    connected = true
    window.removeEventListener('message', handshake)
    // Opaque origins require '*'. Only the known frame gets this one-time port, before any app code runs.
    frame.contentWindow!.postMessage({type: 'seed-connect', launch}, '*', [channel.port2])
  }

  channel.port1.onmessage = async ({data}) => {
    if (!active) return
    if (data?.type === 'seed-connected' && connected) {
      channel.port1.postMessage({type: 'seed-load', html})
      return
    }
    if (data?.type === 'seed-loaded') {
      loaded = true
      clearTimeout(deadline)
      resolveReady()
      return
    }
    if (data?.type === 'seed-leaving') {
      destroy('App navigated away')
      return
    }
    if (data?.type !== 'seed-call' || typeof data.id !== 'string' || data.id.length > 64) return
    const reply: {type: string; id: string; result?: unknown; error?: string} = {type: 'seed-result', id: data.id}
    try {
      if (documentAppMessageSize(data) > DOCUMENT_APP_MAX_REQUEST_BYTES) throw new Error('Request too large')
      if (performance.now() - windowStart >= 1000) {
        windowStart = performance.now()
        requestCount = 0
      }
      if (++requestCount > 100) throw new Error('Request rate exceeded')
      const params = data.params
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Invalid parameters')
      if (data.method === 'context') {
        reply.result = context
      } else if (data.method === 'storage.get' || data.method === 'storage.set') {
        reply.result = documentAppStorage(storage, context, data.method, params)
      } else if (
        data.method === 'profile' ||
        (data.method === 'resource' && context.account && params.url === `hm://${context.account}/:profile`)
      ) {
        reply.result = await profile()
      } else if (data.method === 'resource' && params.url === context.document) {
        reply.result = await resource(params.url)
      } else {
        if (!content) throw new Error('Account access is not available.')
        reply.result = await content(data.method, params, controller.signal)
      }
    } catch (error) {
      reply.error = error instanceof Error ? error.message : String(error)
    }
    // Revocation wins over an asynchronous read that finishes after logout/navigation/replacement.
    if (!active) return
    channel.port1.postMessage(reply)
  }
  frame.addEventListener('load', () => {
    if (initialLoad) destroy('App navigated away')
    initialLoad = true
  })
  window.addEventListener('message', handshake)
  container.replaceChildren(frame)
  return {frame, ready, destroy}
}

/** Access only the viewer/resource namespace fixed by the host; revision changes preserve state. */
export function documentAppStorage(
  storage: Storage,
  context: DocumentAppContext,
  method: 'storage.get' | 'storage.set',
  params: Record<string, unknown>,
): unknown {
  if (Object.keys(params).some((key) => !['key', 'value'].includes(key))) throw new Error('Unknown storage parameter')
  if (typeof params.key !== 'string' || !params.key.length || params.key.length > 128)
    throw new Error('Invalid storage key')
  const namespace = `seed-app:${JSON.stringify([context.account, context.document])}:`
  const key = namespace + params.key
  if (method === 'storage.get') return JSON.parse(storage.getItem(key) || 'null')
  const value = JSON.stringify(params.value)
  if (value === undefined || new TextEncoder().encode(value).length > 16384) throw new Error('Storage value too large')
  const keys = Object.keys(storage).filter((item) => item.startsWith(namespace))
  if (!keys.includes(key) && keys.length >= 64) throw new Error('Storage key limit reached')
  storage.setItem(key, value)
  return null
}
