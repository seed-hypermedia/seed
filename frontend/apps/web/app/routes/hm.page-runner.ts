import type {LoaderFunctionArgs} from '@remix-run/node'
import {DOCUMENT_PAGE_SANDBOX_CSP, documentPageRunnerHTML} from '@shm/shared/document-page-sandbox'
import {parseRequest} from '@/request'

/** Serve the static runner with browser-enforced isolation, including on direct visits. */
export function loader({request}: LoaderFunctionArgs) {
  // The runner only talks to the public origin that embeds it. Behind the TLS-terminating
  // proxy the raw request URL is http://, so take the origin from the forwarded headers.
  return new Response(documentPageRunnerHTML(parseRequest(request).origin), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': DOCUMENT_PAGE_SANDBOX_CSP,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    },
  })
}
