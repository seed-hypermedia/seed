import {json, TypedResponse} from "@remix-run/node";
import {deserialize, serialize, SuperJSONResult} from "superjson";

export type Wrapped<T> = SuperJSONResult;

export type WrappedResponse<T> = TypedResponse<Wrapped<T>>;

export function wrapJSON<T>(value: T, resp?: ResponseInit): WrappedResponse<T> {
  return json(wrap(value), resp);
}

export function wrap<T>(value: T): Wrapped<T> {
  return serialize(value);
}

export function unwrap<T>(value: any): T {
  if (!value) throw new Error("unwrap value is undefined");
  return deserialize(value) as T;
}
