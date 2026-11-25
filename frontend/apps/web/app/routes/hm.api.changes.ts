import {changeHub} from '@/change-hub.server'
import {requireSignInEnabled} from '@/require-sign-in.server'
import {isSignedInRequest} from '@/web-session.server'
import type {LoaderFunctionArgs} from '@remix-run/node'
import {CHANGE_STREAM_HEARTBEAT_MS, encodeChangeStreamEvent, parseChangeStreamQuery} from '@shm/shared/change-signal'

const refuse = (status: number, error: string, headers?: Record<string, string>) =>
  new Response(JSON.stringify({error}), {status, headers: {'Content-Type': 'application/json', ...headers}})

/**
 * The change stream: server-sent events naming resources that may have changed, for the ids in
 * the query (`r` a resource, `d` a directory and everything below it). It carries no content, so
 * it checks no document access. A browser opens it only once a page starts a watch.
 */
export async function loader({request}: LoaderFunctionArgs) {
  if (requireSignInEnabled() && !isSignedInRequest(request)) return refuse(401, 'Sign in required')
  const subscriptions = parseChangeStreamQuery(new URL(request.url).searchParams)
  if ('error' in subscriptions) return refuse(400, subscriptions.error)

  const encoder = new TextEncoder()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let unsubscribe: (() => void) | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null

  const close = () => {
    unsubscribe?.()
    unsubscribe = null
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
    request.signal.removeEventListener('abort', close)
    try {
      controller.close()
    } catch {
      // Already closed or cancelled by the client.
    }
  }
  const send = (event: Parameters<typeof encodeChangeStreamEvent>[0]) => {
    try {
      controller.enqueue(encoder.encode(encodeChangeStreamEvent(event)))
    } catch {
      close()
    }
  }

  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
    },
    cancel: close,
  })
  // Ready goes out before any replayed change, so the browser hears them in order.
  send({type: 'ready'})
  unsubscribe = changeHub.subscribe(subscriptions, send)
  if (!unsubscribe) {
    close()
    return refuse(503, 'Too many change streams', {'Retry-After': '30'})
  }
  heartbeat = setInterval(() => send({type: 'ping'}), CHANGE_STREAM_HEARTBEAT_MS)
  if (request.signal.aborted) close()
  else request.signal.addEventListener('abort', close)

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      // no-transform keeps the server's compression middleware from buffering the stream.
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
