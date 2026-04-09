import type {HMAccountResult, HMMetadata} from '@seed-hypermedia/client/hm-types'

/** Resolved notification account data for a possibly aliased signer. */
export type ResolvedNotificationAccount = {
  uid: string
  metadata: HMMetadata | null
}

/** Resolves a signer UID to the effective account UID by following profile aliases. */
export async function resolveNotificationAccount(
  loadAccount: (uid: string) => Promise<HMAccountResult>,
  uid: string,
): Promise<ResolvedNotificationAccount> {
  const account = await loadAccount(uid)
  if (account.type !== 'account') {
    return {
      uid,
      metadata: null,
    }
  }
  return {
    uid: account.id.uid,
    metadata: account.metadata ?? null,
  }
}
