/**
 * Internal signing utilities shared across blob creation modules.
 * Not exported from the package index.
 */

import {encode as cborEncode} from '@ipld/dag-cbor'
import type {HMPublishBlobsInput} from './hm-types'
import {type AnySigner, toHMSigner} from './signer'

export const cborCodec = {
  code: 0x71 as const,
  encode: (input: unknown) => cborEncode(input),
  name: 'DAG-CBOR' as const,
}

export function normalizeBytes(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const normalized = new Uint8Array(data.byteLength)
  normalized.set(data)
  return normalized
}

export async function signObject(signer: AnySigner, data: unknown): Promise<Uint8Array> {
  return await signer.sign(cborEncode(data))
}

/**
 * Read a signer's principal, accepting either signer shape.
 *
 * Lets the blob builders take an `AnySigner` without each one having to
 * normalize first.
 */
export async function signerPublicKey(signer: AnySigner): Promise<Uint8Array> {
  return toHMSigner(signer).getPublicKey()
}

export function toPublishInput(
  blobData: Uint8Array,
  extraBlobs?: Array<{cid?: string; data: Uint8Array}>,
): HMPublishBlobsInput {
  return {
    blobs: [
      {data: normalizeBytes(blobData)},
      ...(extraBlobs || []).map((b) => ({
        ...(b.cid ? {cid: b.cid} : {}),
        data: normalizeBytes(b.data),
      })),
    ],
  }
}
