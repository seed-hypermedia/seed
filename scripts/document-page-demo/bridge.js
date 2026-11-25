/** Mount a single opaque page instance with parent-owned identity, storage, and revision-scoped grants. */
export function mountApp({container, runnerOrigin, artifact, viewer, grants = [], resource, onEvent = () => {}}) {
  const launch = crypto.randomUUID()
  const frame = document.createElement('iframe')
  frame.title = artifact.title
  frame.setAttribute('sandbox', 'allow-scripts')
  frame.referrerPolicy = 'no-referrer'
  frame.src = `${runnerOrigin}/runner#launch=${launch}`
  const channel = new MessageChannel()
  const allowed = new Set(grants)
  const namespace = `seed-page-demo:${JSON.stringify([viewer, artifact.id])}:`
  let active = true
  let connected = false
  let loaded = false
  let initialLoad = false
  let requestCount = 0
  let windowStart = performance.now()
  let resolveReady, rejectReady
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // Readiness timeout reports a broken runner; it is not used to order the handshake.
  const deadline = setTimeout(() => destroy('Runner did not become ready'), 10000)

  function destroy(reason = 'Closed') {
    if (!active) return
    active = false
    clearTimeout(deadline)
    window.removeEventListener('message', handshake)
    channel.port1.close()
    channel.port2.close()
    frame.remove()
    if (!loaded) rejectReady(new Error(reason))
    onEvent({type: 'closed', reason})
  }

  function handshake(event) {
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
    // Opaque origins require '*'. Only the known frame gets this one-time port, before any page code runs.
    frame.contentWindow.postMessage({type: 'seed-connect', launch}, '*', [channel.port2])
  }

  channel.port1.onmessage = async ({data}) => {
    if (!active) return
    if (data?.type === 'seed-connected' && connected) {
      channel.port1.postMessage({type: 'seed-load', html: artifact.html})
      return
    }
    if (data?.type === 'seed-loaded') {
      loaded = true
      clearTimeout(deadline)
      resolveReady()
      onEvent({type: 'ready'})
      return
    }
    if (data?.type === 'seed-leaving') {
      destroy('Page navigated away')
      return
    }
    if (data?.type !== 'seed-call' || typeof data.id !== 'string' || data.id.length > 64) return
    const reply = {type: 'seed-result', id: data.id}
    try {
      if (new TextEncoder().encode(JSON.stringify(data)).length > 65536) throw new Error('Request too large')
      if (performance.now() - windowStart >= 1000) {
        windowStart = performance.now()
        requestCount = 0
      }
      if (++requestCount > 100) throw new Error('Request rate exceeded')
      const params = data.params
      if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('Invalid parameters')
      if (data.method === 'context') {
        reply.result = {page: artifact.id, viewer, revision: artifact.revision}
      } else if (data.method === 'storage.get' || data.method === 'storage.set') {
        if (Object.keys(params).some((key) => !['key', 'value'].includes(key)))
          throw new Error('Unknown storage parameter')
        if (typeof params.key !== 'string' || !params.key.length || params.key.length > 128)
          throw new Error('Invalid storage key')
        const key = namespace + params.key
        if (data.method === 'storage.get') reply.result = JSON.parse(localStorage.getItem(key) || 'null')
        else {
          const value = JSON.stringify(params.value)
          if (value === undefined || new TextEncoder().encode(value).length > 16384)
            throw new Error('Storage value too large')
          const keys = Object.keys(localStorage).filter((item) => item.startsWith(namespace))
          if (!keys.includes(key) && keys.length >= 64) throw new Error('Storage key limit reached')
          localStorage.setItem(key, value)
          reply.result = null
        }
      } else if (data.method === 'resource') {
        if (typeof params.id !== 'string' || !allowed.has(params.id))
          throw new Error('Permission denied: share this document in Seed first')
        reply.result = await resource(params.id, viewer)
      } else throw new Error('Unknown method')
    } catch (error) {
      reply.error = error.message
    }
    // Revocation wins over an asynchronous read that finishes after logout/navigation/replacement.
    if (!active) return
    channel.port1.postMessage(reply)
    onEvent({type: 'request', method: data.method, key: data.params?.key, error: reply.error})
  }
  frame.addEventListener('load', () => {
    if (initialLoad) destroy('Page navigated away')
    initialLoad = true
  })
  window.addEventListener('message', handshake)
  container.replaceChildren(frame)
  return {frame, ready, destroy}
}
