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
