import * as dagCBOR from '@ipld/dag-cbor'
import * as cborg from 'cborg'

// Trying to work around the undefined problem with dag-cbor.
// See: https://github.com/ipld/js-dag-cbor/issues/57.
export const encodeOpts = {
  ...dagCBOR.encodeOptions,
  typeEncoders: {
    ...dagCBOR.encodeOptions.typeEncoders,
    undefined: () => null,
  },
} satisfies typeof dagCBOR.encodeOptions

export const code = dagCBOR.code

export function encode<T = any>(obj: T): Uint8Array {
  return cborg.encode(obj, encodeOpts)
}

export function decode<T = any>(data: Uint8Array): T {
  return dagCBOR.decode(data) as T
}
