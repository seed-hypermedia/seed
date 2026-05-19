import * as sharedCBOR from '@shm/shared/cbor'

/** Encodes a value as canonical DAG-CBOR bytes. */
export function encode<T = unknown>(value: T): Uint8Array {
  return sharedCBOR.encode(value)
}

/** Decodes DAG-CBOR bytes into a JavaScript value. */
export function decode<T = unknown>(data: Uint8Array): T {
  return sharedCBOR.decode<T>(data)
}

/** Creates an `application/cbor` response body. */
export function response(value: unknown, init?: ResponseInit): Response {
  return new Response(encode(value) as BodyInit, {
    ...init,
    headers: {
      'Access-Control-Allow-Headers': 'Content-Type, Accept',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/cbor',
      ...(init?.headers ?? {}),
    },
  })
}

/** Reads and decodes an `application/cbor` request body. */
export async function readRequest<T = unknown>(req: Request): Promise<T> {
  return decode<T>(new Uint8Array(await req.arrayBuffer()))
}
