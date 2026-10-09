/**
 * Signing of agents-server actions on the server side: tests, tooling, and the convert relay,
 * which signs as an agent's own identity when it asks the hosted server to convert a document.
 */

import type * as api from '@/api'
import {AGENTS_PROTOCOL_VERSION} from '@seed-hypermedia/agents-protocol'
import * as blobs from '@shm/shared/blobs'

/** Creates a signed envelope for an action, as a client would. */
export async function createSignedEnvelope(
  signer: blobs.Signer,
  input: {
    account?: blobs.Principal
    /** CID of the Capability by which `account` delegated to the signer (see the envelope type). */
    capability?: string
    capabilityBlob?: Uint8Array
    action: api.UnsignedAgentAction
    ts?: number
    /**
     * Protocol version to declare; defaults to this build's. `null` declares none, as clients from
     * before protocol 2 do (servers read that as protocol 1).
     */
    protocol?: number | null
  },
): Promise<api.SignedActionEnvelope> {
  const protocol = input.protocol === undefined ? AGENTS_PROTOCOL_VERSION : input.protocol
  const envelope: api.SignedActionEnvelope = {
    type: 'AgentsAction',
    signer: signer.principal,
    sig: new Uint8Array(blobs.ED25519_SIGNATURE_SIZE),
    account: input.account ?? signer.principal,
    ...(input.capability !== undefined ? {capability: input.capability} : {}),
    ...(input.capabilityBlob !== undefined ? {capabilityBlob: input.capabilityBlob} : {}),
    ...(protocol !== null ? {protocol} : {}),
    action: {...input.action, ts: input.ts ?? Date.now()} as api.AgentAction,
  }
  return (await blobs.sign(signer, envelope as unknown as blobs.Blob)) as unknown as api.SignedActionEnvelope
}
