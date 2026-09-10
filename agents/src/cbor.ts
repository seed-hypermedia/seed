import * as sharedCBOR from '@shm/shared/cbor'
import {AGENTS_PROTOCOL_HEADER, AGENTS_PROTOCOL_VERSION} from '@seed-hypermedia/agents-protocol'

/** Encodes a value as canonical DAG-CBOR bytes. */
export function encode<T = unknown>(value: T): Uint8Array {
  return sharedCBOR.encode(value)
}

/** Decodes DAG-CBOR bytes into a JavaScript value. */
export function decode<T = unknown>(data: Uint8Array): T {
  return sharedCBOR.decode<T>(data)
}

/**
 * CORS headers plus the server's protocol version, for every route a browser client reads.
 * Browsers hide response headers from cross-origin scripts unless exposed, hence the second line
 * (see `agents/protocol/PROTOCOL.md`).
 */
export function corsHeaders(methods = 'POST, OPTIONS'): Record<string, string> {
  return {
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': AGENTS_PROTOCOL_HEADER,
    [AGENTS_PROTOCOL_HEADER]: String(AGENTS_PROTOCOL_VERSION),
  }
}

/** Creates an `application/cbor` response body. */
export function response(value: unknown, init?: ResponseInit): Response {
  return new Response(encode(value) as BodyInit, {
    ...init,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/cbor',
      ...(init?.headers ?? {}),
    },
  })
}

/** Reads and decodes an `application/cbor` request body. */
export async function readRequest<T = unknown>(req: Request): Promise<T> {
  return decode<T>(new Uint8Array(await req.arrayBuffer()))
}
