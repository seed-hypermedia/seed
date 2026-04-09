const ALLOWED_METHODS = 'GET, POST, OPTIONS, PUT, PATCH, DELETE, HEAD'
const ALLOWED_HEADERS = 'Content-Type, Authorization, X-Requested-With, Accept, Origin'
const MAX_AGE_SECONDS = '86400'

function applyCorsHeaders(headers: Headers) {
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', ALLOWED_METHODS)
  headers.set('Access-Control-Allow-Headers', ALLOWED_HEADERS)
  headers.set('Access-Control-Max-Age', MAX_AGE_SECONDS)
}

export function preflightCorsResponse() {
  const headers = new Headers()
  applyCorsHeaders(headers)
  return new Response(null, {
    status: 204,
    headers,
  })
}

/**
 * Returns a preflight response for API `OPTIONS` requests, or `null` for all other methods.
 */
export function getApiPreflightResponse(request: Request): Response | null {
  if (request.method === 'OPTIONS') {
    return preflightCorsResponse()
  }
  return null
}

/**
 * Handles action-only API routes by serving preflight requests and rejecting non-`OPTIONS` loader traffic.
 */
export function apiActionOnlyLoader({request}: {request: Request}) {
  return getApiPreflightResponse(request) ?? withCors(new Response(null, {status: 405}))
}

/**
 * Adds CORS headers to a Response object.
 */
export const withCors = (response: Response) => {
  const headers = new Headers(response.headers)
  applyCorsHeaders(headers)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
