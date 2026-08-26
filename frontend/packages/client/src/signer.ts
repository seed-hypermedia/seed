/**
 * The signer abstraction shared across this package.
 *
 * Two signer shapes grew up independently here:
 *
 *   - {@link HMSigner} (`getPublicKey()`) — used by the blob builders
 *     (`createComment`, `createContact`, `createChange`, …) and by `SeedClient`.
 *   - {@link PrincipalSigner} (`principal`) — used by the blob primitives in
 *     `./blobs` and by the auth/vault code, where the principal is already
 *     known synchronously.
 *
 * Neither is wrong, and both produce identical bytes. Rather than break one set
 * of callers, every public entry point now accepts {@link AnySigner} and
 * normalizes with the helpers below, so callers never have to care which shape
 * a given function was originally written against.
 *
 * This module intentionally has no runtime imports, so importing it never pulls
 * crypto or schema code into a bundle.
 */

import type {HMSigner} from './hm-types'

export type {HMSigner}

/**
 * A signer that exposes its principal synchronously.
 *
 * Structurally identical to the `Signer` interface in `./blobs`; declared
 * separately here so this module stays dependency-free.
 */
export type PrincipalSigner = {
  readonly principal: Uint8Array
  sign(data: Uint8Array): Promise<Uint8Array>
}

/** Either accepted signer shape. */
export type AnySigner = HMSigner | PrincipalSigner

function hasPrincipal(signer: AnySigner): signer is PrincipalSigner {
  return 'principal' in signer
}

/** Normalize to the `getPublicKey()` shape. Cheap — no key material is touched. */
export function toHMSigner(signer: AnySigner): HMSigner {
  if (!hasPrincipal(signer)) return signer
  const {principal} = signer
  return {
    getPublicKey: async () => principal,
    sign: (data) => signer.sign(data),
  }
}

/**
 * Normalize to the synchronous-principal shape.
 *
 * Async because an {@link HMSigner} only reveals its public key through a
 * promise; the result caches it so callers can read `.principal` directly.
 */
export async function toPrincipalSigner(signer: AnySigner): Promise<PrincipalSigner> {
  if (hasPrincipal(signer)) return signer
  const principal = await signer.getPublicKey()
  return {
    principal,
    sign: (data) => signer.sign(data),
  }
}
