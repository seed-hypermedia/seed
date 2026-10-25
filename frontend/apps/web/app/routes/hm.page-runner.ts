import type {LoaderFunctionArgs} from '@remix-run/node'
import {DOCUMENT_PAGE_SANDBOX_CSP, documentPageRunnerHTML} from '@shm/shared/document-page-sandbox'

/** Serve the static runner with browser-enforced isolation, including on direct visits. */
export function loader({request}: LoaderFunctionArgs) {
  return new Response(documentPageRunnerHTML(new URL(request.url).origin), {
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
