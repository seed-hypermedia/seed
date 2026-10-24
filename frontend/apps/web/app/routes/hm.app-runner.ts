import type {LoaderFunctionArgs} from '@remix-run/node'
import {DOCUMENT_APP_SANDBOX_CSP, documentAppRunnerHTML} from '@shm/shared/document-app-sandbox'

/** Serve the static runner with browser-enforced isolation, including on direct visits. */
export function loader({request}: LoaderFunctionArgs) {
  return new Response(documentAppRunnerHTML(new URL(request.url).origin), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': DOCUMENT_APP_SANDBOX_CSP,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    },
  })
}
