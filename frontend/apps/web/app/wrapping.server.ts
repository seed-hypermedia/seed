import {serialize} from 'superjson'

// Re-export isomorphic functions.
export {wrap, unwrap, type Wrapped} from './wrapping'

// Server-only types and functions
export type WrappedResponse<T> = Response

export function wrapJSON<T>(value: T, resp?: ResponseInit): WrappedResponse<T> {
  const serialized = serialize(value)
  return Response.json(serialized, resp) as WrappedResponse<T>
}
