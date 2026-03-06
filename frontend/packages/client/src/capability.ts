/**
 * Capability SDK — create capabilities (delegate access to other accounts).
 */

import {encode as cborEncode} from '@ipld/dag-cbor'
import type {HMPublishBlobsInput, HMSigner} from '@shm/shared/hm-types'
import {base58btc} from 'multiformats/bases/base58'
import {signObject, toPublishInput} from './signing'

/** Role values for capability blobs. */
export type CapabilityRole = 'WRITER' | 'AGENT'

export type CreateCapabilityInput = {
  /** The delegate account UID (base58btc-encoded principal) receiving the capability */
  delegateUid: string
  /** The access role being granted */
  role: CapabilityRole
  /** Optional path scope for the capability */
  path?: string
  /** Optional human-readable label */
  label?: string
}

/**
 * Create a signed capability blob ready for publishing.
 * The signer is the issuer granting access to the delegate.
 */
export async function createCapability(input: CreateCapabilityInput, signer: HMSigner): Promise<HMPublishBlobsInput> {
  const signerKey = await signer.getPublicKey()
  const ts = BigInt(Date.now())

  const unsigned: Record<string, unknown> = {
    type: 'Capability',
    signer: new Uint8Array(signerKey),
    sig: new Uint8Array(64),
    ts,
    delegate: new Uint8Array(base58btc.decode(input.delegateUid)),
    role: input.role,
  }

  if (input.path) {
    unsigned.path = input.path
  }
  if (input.label) {
    unsigned.label = input.label
  }

  unsigned.sig = await signObject(signer, unsigned)

  return toPublishInput(cborEncode(unsigned))
}
