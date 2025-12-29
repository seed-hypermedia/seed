import { deserialize, serialize, SuperJSONResult } from "superjson";

export type Wrapped<T> = SuperJSONResult;

export function wrap<T>(value: T): Wrapped<T> {
  return serialize(value);
}

export function unwrap<T>(value: any): T {
  if (!value) throw new Error("unwrap value is undefined");
  return deserialize(value) as T;
}
