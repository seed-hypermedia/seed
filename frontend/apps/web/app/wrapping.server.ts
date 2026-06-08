import {serialize, SuperJSONResult} from 'superjson'

// Re-export isomorphic functions.
export {wrap, unwrap, type Wrapped} from './wrapping'

// Server-only types and functions.
export type WrappedResponse<T> = Response

/** Serializes a value as SuperJSON using a framework-neutral Web Response. */
export function wrapJSON<T>(value: T, resp?: ResponseInit): WrappedResponse<T> {
  const headers = new Headers(resp?.headers)
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', 'private, no-cache')
  }
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json; charset=utf-8')
  }
  return new Response(JSON.stringify(serialize(value) satisfies SuperJSONResult), {
    ...resp,
    headers,
  })
}
