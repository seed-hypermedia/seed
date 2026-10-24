/* HOST_ORIGIN is injected by the runner server, never supplied by the app. */
;(() => {
  const launch = new URLSearchParams(location.hash.slice(1)).get('launch')
  if (parent === window || !launch) {
    document.body.textContent = 'Open this app through the Seed app workshop.'
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
    const call = (method, params = {}) =>
      new Promise((resolve, reject) => {
        if (closed) return reject(new Error('App session closed'))
        if (pending.size >= 32) return reject(new Error('Too many pending requests'))
        const id = String(++nextId)
        const message = {type: 'seed-call', id, method, params}
        if (new TextEncoder().encode(JSON.stringify(message)).length > 65536)
          return reject(new Error('Request too large'))
        const timeout = setTimeout(() => {
          pending.delete(id)
          reject(new Error('Request expired'))
        }, 5000)
        pending.set(id, {resolve, reject, timeout})
        port.postMessage(message)
      })
    Object.defineProperty(window, 'seed', {
      value: Object.freeze({
        context: () => call('context'),
        storage: Object.freeze({
          get: (key) => call('storage.get', {key}),
          set: (key, value) => call('storage.set', {key, value}),
        }),
        resource: (id) => call('resource', {id}),
      }),
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
