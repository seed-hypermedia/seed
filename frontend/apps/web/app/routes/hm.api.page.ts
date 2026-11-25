import type {LoaderFunctionArgs} from '@remix-run/node'
import {unpackHmId} from '@seed-hypermedia/client'
import {parseDocumentPageReference} from '@shm/shared/document-page'
import {getDaemonAuthToken, withDaemonAuthToken} from '@/daemon-auth.server'
import {fetchResource} from '@/loaders'
import {requireSignInEnabled} from '@/require-sign-in.server'
import {isSignedInRequest} from '@/web-session.server'
import {loader as loadFile} from './hm.api.file.$'

/** Fetch a page entry point only when it belongs to the requested, readable document revision. */
export async function loader(args: LoaderFunctionArgs) {
  const {request} = args
  if (requireSignInEnabled() && !isSignedInRequest(request)) return new Response('Sign in required', {status: 401})
  const url = new URL(request.url)
  const id = unpackHmId(url.searchParams.get('id') || '')
  const cid = parseDocumentPageReference(url.searchParams.get('cid'))
  const version = url.searchParams.get('version')
  if (!id || !cid || !version) return new Response('Document, version and page CID required', {status: 400})
  const token = await getDaemonAuthToken(request)
  return withDaemonAuthToken(token, async () => {
    const resource = await fetchResource({...id, version, latest: false})
    if (
      resource.type !== 'document' ||
      resource.document.metadata.type !== 'hm://hyper.media/page' ||
      parseDocumentPageReference(resource.document.metadata.html) !== cid
    ) {
      return new Response('Page not found in this document', {status: 404})
    }
    const file = (await loadFile({...args, params: {'*': `${cid}/index.html`}})) as Response
    if (!file.ok) return new Response('Page file unavailable', {status: 502})
    // HTML is returned as data. Navigating to this endpoint never executes page code.
    return new Response(file.body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    })
  })
}
