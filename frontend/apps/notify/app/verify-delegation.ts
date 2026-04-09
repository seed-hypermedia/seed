/**
 * Verifies that a signing key is authorized to act on behalf of an account
 * by checking the capability chain via the daemon's gRPC API.
 */
import {grpcClient} from './notify-request'
import {base58btc} from 'multiformats/bases/base58'
import {BIG_INT} from '@shm/shared/constants'

/**
 * Resolves the effective account ID for a notification request.
 *
 * When `accountUid` is provided (delegation), verifies that the signer holds
 * an AGENT capability for that account via the daemon. Returns `accountUid`
 * on success.
 *
 * When `accountUid` is absent, derives the account ID from the signer's
 * public key (the traditional path).
 */
export async function resolveAccountId(signerPublicKey: Uint8Array, accountUid: string | undefined): Promise<string> {
  const signerUid = base58btc.encode(signerPublicKey)

  if (!accountUid || accountUid === signerUid) {
    return signerUid
  }

  // Delegation: verify the signer has a capability for the claimed account
  const result = await grpcClient.accessControl.listCapabilitiesForDelegate({
    delegate: signerUid,
    pageSize: BIG_INT,
  })

  const hasCapability = result.capabilities.some((cap) => cap.account === accountUid && cap.role === 3 /* AGENT */)

  if (!hasCapability) {
    throw new Error(`Signer ${signerUid} is not authorized to act on behalf of account ${accountUid}`)
  }

  return accountUid
}
