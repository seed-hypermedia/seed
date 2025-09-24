/**
 * This is a helper to create a JSON response, replacing the json helper from Remix v2.
 * It returns a Response with the JSON stringified body and proper content-type header.
 */
export function json<Data = unknown>(
  data: Data,
  init?: number | ResponseInit,
): Response {
  const responseInit: ResponseInit =
    typeof init === 'number' ? {status: init} : init || {}

  const headers = new Headers(responseInit.headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8')
  }

  return new Response(JSON.stringify(data), {
    ...responseInit,
    headers,
  })
}

/**
 * TypedResponse type for type-safe responses
 */
export interface TypedResponse<T = unknown> extends Response {
  json(): Promise<T>
}
