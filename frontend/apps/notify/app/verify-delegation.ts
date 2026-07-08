/**
 * Verifies that a signing key is authorized to act on behalf of an account
 * by checking the capability chain via the daemon's gRPC API.
 */
import {grpcClient} from './notify-request'
import {base58btc} from 'multiformats/bases/base58'
import {BIG_INT} from '@shm/shared/constants'

/** Returns the accounts that granted the delegate an AGENT capability. */
async function listAgentGrantorAccounts(delegateUid: string): Promise<Set<string>> {
  const result = await grpcClient.accessControl.listCapabilitiesForDelegate({
    delegate: delegateUid,
    pageSize: BIG_INT,
  })
  return new Set(result.capabilities.filter((cap) => cap.role === 3 /* AGENT */).map((cap) => cap.account))
}

/**
 * Resolves the effective account ID for a notification request.
 *
 * When `accountUid` is provided (delegation), verifies that the signer holds
 * an AGENT capability for that account via the daemon. One level of chaining
 * is supported: a web session key delegated by a user account (AGENT) may act
 * for any account that granted that user account an AGENT capability — e.g.
 * a site account whose owner is signed in through the vault. Returns
 * `accountUid` on success.
 *
 * When `accountUid` is absent, derives the account ID from the signer's
 * public key (the traditional path).
 */
export async function resolveAccountId(signerPublicKey: Uint8Array, accountUid: string | undefined): Promise<string> {
  const signerUid = base58btc.encode(signerPublicKey)

  if (!accountUid || accountUid === signerUid) {
    return signerUid
  }

  // Direct delegation: the target account granted the signer key an AGENT capability.
  const grantors = await listAgentGrantorAccounts(signerUid)
  if (grantors.has(accountUid)) {
    return accountUid
  }

  // Chained delegation: the signer key acts for an intermediate account
  // (e.g. the signed-in user), which in turn is an AGENT of the target account.
  for (const intermediate of grantors) {
    const intermediateGrantors = await listAgentGrantorAccounts(intermediate)
    if (intermediateGrantors.has(accountUid)) {
      return accountUid
    }
  }

  throw new Error(`Signer ${signerUid} is not authorized to act on behalf of account ${accountUid}`)
}
