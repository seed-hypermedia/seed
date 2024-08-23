import {deserialize, serialize, SuperJSONResult} from "superjson";

export type Wrapped<T> = SuperJSONResult;

export function wrap<T>(value: T): Wrapped<T> {
  return serialize(value);
}

export function unwrap<T>(value: Wrapped<T> | undefined): T | undefined {
  if (!value) return undefined;
  return deserialize(value) as T;
}
