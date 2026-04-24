import type {DomainIdChangedCallback, DomainResolverFn} from '@seed-hypermedia/client'
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
 * Resolves a domain to its registered account UID using the daemon's domain store.
 * Tries getDomain first (cached), falls back to checkDomain (fresh HTTP check).
 * Returns the registered account UID, or null if the domain is unknown/unreachable.
 */
export async function resolveDomainAccountUid(grpcClient: GRPCClient, domain: string): Promise<string | null> {
  try {
    const info = await grpcClient.daemon.getDomain({domain})
    if (info.status === 'success' && info.registeredAccountUid) {
      return info.registeredAccountUid
    }
  } catch {
    // Domain not in cache yet
  }
  // Cache miss or stale — do a fresh check
  try {
    const info = await grpcClient.daemon.checkDomain({domain})
    if (info.status === 'success' && info.registeredAccountUid) {
      return info.registeredAccountUid
    }
  } catch {
    // Check failed — domain unreachable
  }
  return null
}

/**
 * Create a DomainResolverFn backed by the daemon's domain store.
 * Pass the returned function as opts.domainResolver to resolveHypermediaUrl.
 */
export function createDomainResolver(grpcClient: GRPCClient, onIdChanged?: DomainIdChangedCallback): DomainResolverFn {
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
      const isStale = !lastCheck || Date.now() - lastCheck.getTime() > STALE_THRESHOLD_MS

      if (isStale) {
        const previousUid = cachedUid
        grpcClient.daemon
          .checkDomain({domain: hostname})
          .then((result) => {
            if (result.registeredAccountUid && result.registeredAccountUid !== previousUid && onIdChanged) {
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

/**
 * Creates a domain verifier that checks whether a domain is live and serving
 * the expected account. Results are cached in-memory; call `clear()` to reset.
 *
 * Used by the notification service to decide whether email links should use
 * clean custom-domain URLs or fall back to gateway URLs.
 */
export function createDomainVerifier(grpcClient: GRPCClient) {
  const cache = new Map<string, string | null>()

  async function resolve(domain: string): Promise<string | null> {
    const cached = cache.get(domain)
    if (cached !== undefined) return cached
    const uid = await resolveDomainAccountUid(grpcClient, domain)
    cache.set(domain, uid)
    return uid
  }

  return {
    /** Returns true if the domain is live and serving the expected account UID. */
    async isVerified(domain: string, expectedAccountUid: string): Promise<boolean> {
      const uid = await resolve(domain)
      return uid === expectedAccountUid
    },
    /** Clears the in-memory cache. Call at the start of each processing cycle. */
    clear() {
      cache.clear()
    },
  }
}
