import type {
  DomainIdChangedCallback,
  DomainResolverFn,
} from '@seed-hypermedia/client'
import type {GRPCClient} from '../grpc-client'

/**
 * Domain Resolution Workflows
 * ===========================
 *
 * Three resolution modes:
 *
 * 1. **Fast cached** (most common)
 *    GetDomain — returns the cached account UID immediately, even if stale.
 *    If the cache is empty (domain never seen), falls through to full resolution.
 *
 * 2. **Full resolution** (rare)
 *    GetDomain with forceCheck — HTTP request to the domain's /hm/api/config,
 *    updates the cache, returns the fresh result.
 *
 * 3. **Fast + background refresh** (default behavior)
 *    Returns the cached result immediately, then fires a background
 *    forceCheck if the cached data is stale (last check > 3 hours ago).
 *    If the background check discovers a different account UID,
 *    the onIdChanged callback fires.
 */

const STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000 // 3 hours

/**
 * Create a DomainResolverFn backed by the daemon's domain store.
 * Pass the returned function as opts.domainResolver to resolveHypermediaUrl.
 */
export function createDomainResolver(
  grpcClient: GRPCClient,
  onIdChanged?: DomainIdChangedCallback,
): DomainResolverFn {
  return async (hostname: string) => {
    // Fast cached lookup
    let cachedUid: string | null = null
    let lastCheck: Date | null = null
    try {
      const domainInfo = await grpcClient.daemon.getDomain({domain: hostname})
      if (domainInfo.registeredAccountUid) {
        cachedUid = domainInfo.registeredAccountUid
        lastCheck = domainInfo.lastCheck?.toDate() ?? null
      }
    } catch {
      // Domain not in cache yet
    }

    if (cachedUid) {
      // Check staleness — fire background refresh if last check was > 3 hours ago
      const isStale =
        !lastCheck || Date.now() - lastCheck.getTime() > STALE_THRESHOLD_MS

      if (isStale) {
        const previousUid = cachedUid
        grpcClient.daemon
          .checkDomain({domain: hostname})
          .then((result) => {
            if (
              result.registeredAccountUid &&
              result.registeredAccountUid !== previousUid &&
              onIdChanged
            ) {
              onIdChanged(hostname, previousUid, result.registeredAccountUid)
            }
          })
          .catch(() => {
            // Background refresh failed — cached data still valid
          })
      }

      return cachedUid
    }

    // Cache miss — do a full resolution (blocking) to populate the cache
    try {
      const result = await grpcClient.daemon.checkDomain({domain: hostname})
      if (result.registeredAccountUid) {
        return result.registeredAccountUid
      }
    } catch {
      // Full resolution failed — fall through to OPTIONS
    }

    return null
  }
}
