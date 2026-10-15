import {isOpenPath, requireSignInEnabled, safeNextPath, signInUrl} from '@/require-sign-in.server'
import {isSignedInRequest} from '@/web-session.server'
import type {ActionFunctionArgs, LoaderFunctionArgs} from '@remix-run/node'
import {redirect} from '@remix-run/node'

/**
 * The proxy's forward_auth target: answers from the signed session cookie
 * alone, with no daemon or vault round trip, because it runs on every request.
 * With X-Forwarded-Uri it judges the original request (open paths pass);
 * without it, it is a plain "do I have a session?" probe.
 */
export async function loader({request}: LoaderFunctionArgs) {
  if (!requireSignInEnabled()) return new Response(null, {status: 204})

  const forwardedUri = request.headers.get('X-Forwarded-Uri')
  const method = request.headers.get('X-Forwarded-Method') || request.method
  const original = forwardedUri ? new URL(forwardedUri, 'http://forwarded.invalid') : null
  if (original && isOpenPath(original.pathname, method)) return new Response(null, {status: 204})

  if (isSignedInRequest(request)) return new Response(null, {status: 204})

  const accept = request.headers.get('Accept') || ''
  if (original && accept.includes('text/html')) {
    // A Remix data request (`?_data=<route>`) must not become the page the
    // person is sent back to after sign-in: that URL answers JSON.
    original.searchParams.delete('_data')
    return redirect(signInUrl(safeNextPath(`${original.pathname}${original.search}`)))
  }
  return new Response(JSON.stringify({error: 'Sign in required'}), {
    status: 401,
    headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store'},
  })
}

export async function action(args: ActionFunctionArgs) {
  return loader(args)
}
