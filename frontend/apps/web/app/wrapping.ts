import {deserialize, serialize, SuperJSONResult} from 'superjson'

export type Wrapped<T> = SuperJSONResult

export function wrap<T>(value: T): Wrapped<T> {
  return serialize(value)
}

/**
 * Deserialized payloads by their wrapped object. A route's loader data is
 * unwrapped by its component and again by its meta function (twice, for the
 * document route) on every server render, and by the component on every client
 * re-render; superjson deep-copies the whole payload each time. The wrapped
 * object Remix hands out is stable for a given load, so deserialize it once.
 * Callers must treat the result as read-only, as they already treat loader data.
 */
const unwrapped = new WeakMap<object, unknown>()

export function unwrap<T>(value: any): T {
  if (!value) throw new Error('unwrap value is undefined')
  if (typeof value !== 'object') return deserialize(value) as T
  if (unwrapped.has(value)) return unwrapped.get(value) as T
  const result = deserialize(value)
  unwrapped.set(value, result)
  return result as T
}
