/**
 * Adds CORS headers to a Response object
 * @param response The Response object to add CORS headers to
 * @returns A new Response with CORS headers
 */
export const withCors = (response: Response) => {
  const headers = new Headers(response.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
  headers.set('Access-Control-Allow-Headers', 'Content-Type')

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
