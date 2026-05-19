/**
 * Adds CORS headers to a Response object
 * @param response The Response object to add CORS headers to
 * @returns A new Response with CORS headers
 */
export const withCors = (response: Response) => {
  const headers = new Headers(response.headers)
  // Explicitly preserve Set-Cookie headers, which some Fetch implementations
  // drop when copying via new Headers(response.headers).
  if ('getSetCookie' in response.headers && typeof response.headers.getSetCookie === 'function') {
    const cookies = response.headers.getSetCookie()
    for (const cookie of cookies) {
      headers.append('Set-Cookie', cookie)
    }
  }
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'private, no-store')
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
