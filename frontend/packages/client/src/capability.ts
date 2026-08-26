/**
 * Capability SDK — create and resolve capabilities (delegate access to other accounts).
 */

import type {HMPublishBlobsInput} from './hm-types'
import {entityQueryPathToHmIdPath, packBaseId} from './hm-types'
import {base58btc} from 'multiformats/bases/base58'
import {createCapability as createCapabilityBlob} from './blobs'
import type {AnySigner} from './signer'
import {toPublishInput} from './signing'
import type {SeedClient} from './client'

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
 *
 * Wraps the blob primitive in `./blobs`, which is the single implementation of
 * the Capability wire format; this adds the string-keyed input shape and the
 * publish envelope the rest of the SDK expects.
 */
export async function createCapability(input: CreateCapabilityInput, signer: AnySigner): Promise<HMPublishBlobsInput> {
  const encoded = await createCapabilityBlob(
    signer,
    new Uint8Array(base58btc.decode(input.delegateUid)),
    input.role,
    Date.now(),
    {path: input.path || undefined, label: input.label || undefined},
  )
  return toPublishInput(encoded.data)
}

/**
 * Find a WRITER or AGENT capability for `signerAccount` on `targetAccount`.
 * Returns the capability CID if found, undefined if not needed (same account) or not found.
 *
 * @param path - The document path being written to (e.g. "/podcasts"). When provided,
 *   ListCapabilities is queried with this path so the backend returns capabilities
 *   scoped to that path (or any ancestor path that covers it).
 */
export async function resolveCapability(
  client: SeedClient,
  targetAccount: string,
  signerAccount: string,
  path?: string,
): Promise<string | undefined> {
  if (targetAccount === signerAccount) return undefined
  const pathSegments = path ? entityQueryPathToHmIdPath(path) : null
  const targetId = {
    id: packBaseId(targetAccount, pathSegments),
    uid: targetAccount,
    path: pathSegments,
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: null,
    latest: true,
    scheme: null,
  }
  const caps = await client.request('ListCapabilities', {targetId})
  const match = caps.capabilities.find(
    (c) => c.delegate === signerAccount && (c.role === 'WRITER' || c.role === 'AGENT'),
  )
  return match?.id
}
