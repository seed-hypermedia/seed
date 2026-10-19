import {grpcClient} from '@/client.server'
import {BIG_INT} from '@shm/shared/constants'

// The vault is the member directory for an Enterprise site. It is reached
// over the internal network with the admin secret, never through the proxy.
async function isVaultMember(accountUid: string): Promise<boolean> {
  const vaultUrl = process.env.SEED_VAULT_INTERNAL_URL
  const adminSecret = process.env.SEED_VAULT_ADMIN_SECRET
  if (!vaultUrl || !adminSecret) {
    console.error('Membership check unavailable: SEED_VAULT_INTERNAL_URL or SEED_VAULT_ADMIN_SECRET is unset')
    return false
  }
  try {
    const response = await fetch(
      `${vaultUrl.replace(/\/+$/, '')}/vault/api/admin/accounts/${encodeURIComponent(accountUid)}`,
      {headers: {Authorization: `Bearer ${adminSecret}`}},
    )
    return response.status === 200
  } catch (e) {
    console.error('Membership check failed for', accountUid, e)
    return false
  }
}

/** Accounts that granted the key an AGENT capability (the vault's delegation). */
async function listAgentGrantorAccounts(delegateUid: string): Promise<string[]> {
  const result = await grpcClient.accessControl.listCapabilitiesForDelegate({
    delegate: delegateUid,
    pageSize: BIG_INT,
  })
  return [...new Set(result.capabilities.filter((cap) => cap.role === 3 /* AGENT */).map((cap) => cap.account))]
}

/**
 * Resolves the signing key behind a sign-in to the member account it acts for,
 * or null when no such member exists. A web session key is an AGENT of the
 * vault account; a key with no delegation is treated as the account itself.
 */
export async function resolveMemberAccount(principalUid: string): Promise<string | null> {
  const grantors = await listAgentGrantorAccounts(principalUid)
  const candidates = grantors.length ? grantors : [principalUid]
  for (const account of candidates) {
    if (await isVaultMember(account)) return account
  }
  return null
}
