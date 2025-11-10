import {json, TypedResponse} from '@remix-run/node'
import {serialize, SuperJSONResult} from 'superjson'

// Re-export isomorphic functions.
export {wrap, unwrap, type Wrapped} from './wrapping'

// Server-only types and functions
export type WrappedResponse<T> = TypedResponse<SuperJSONResult>

export function wrapJSON<T>(value: T, resp?: ResponseInit): WrappedResponse<T> {
  return json(serialize(value), resp)
}
