import type {HMResource, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'

/**
 * Maximum redirect hops any resolver may follow before giving up.
 *
 * Redirect Refs are data served by the daemon, so a chain can be arbitrarily long or
 * even cyclic (A→B→C→A). Every follower must bound its walk with this limit and stop
 * early on a revisited address — an unbounded follower spins forever on a cycle,
 * growing a promise chain that degrades the whole process.
 */
export const MAX_REDIRECT_HOPS = 5

/** Where a walk through redirects ended up. */
export type RedirectWalk = {
  /**
   * The resource the walk ended at. Never a redirect, except when `stopAtMove` stopped the walk
   * at a move redirect on the first hop — the caller then answers with a redirect of its own.
   */
  resource: HMResource
  /**
   * The first address of the walk when it began with a republish, else null. Content reached
   * through a republish is presented at that address: the page keeps the republish's own id
   * and never pins the target's version onto it (see #1120).
   */
  republishSourceId: UnpackedHypermediaId | null
  /** Every address fetched, in order; on a cycle the repeated address is appended. */
  visited: string[]
  /** Set when the walk gave up instead of ending at a resource. */
  stopped?: 'cycle' | 'limit'
}

/**
 * Follows redirects from `id` with a single set of rules shared by every reader — the client
 * query (`queryResource`), the shared resolver and the web SSR loader — so they cannot drift
 * apart on how a republish is presented or when a chain is unresolvable.
 *
 * Redirects are daemon-served data, so the chain can be cyclic: a revisited address stops the
 * walk at once (before refetching it), and so does a chain longer than {@link MAX_REDIRECT_HOPS}.
 * Both come back as an `error` resource with `stopped` set, never as a thrown error, so a
 * caller can decide how loud to be.
 *
 * `stopAtMove`: a move redirect met before any republish is returned as-is instead of followed.
 * The web loader uses it to 302 a moved path, while it still renders a republished path in place.
 */
export async function followRedirects(
  fetch: (id: UnpackedHypermediaId) => Promise<HMResource>,
  id: UnpackedHypermediaId,
  {stopAtMove = false}: {stopAtMove?: boolean} = {},
): Promise<RedirectWalk> {
  const visited: string[] = [id.id]
  const seen = new Set(visited)
  let current = id
  let republishSourceId: UnpackedHypermediaId | null = null

  while (true) {
    const resource = await fetch(current)
    if (resource.type !== 'redirect') {
      return {resource, republishSourceId, visited}
    }
    if (stopAtMove && !resource.republish && !republishSourceId) {
      return {resource, republishSourceId: null, visited}
    }
    if (resource.republish && !republishSourceId) {
      republishSourceId = current
    }

    const next: UnpackedHypermediaId = {
      ...resource.redirectTarget,
      hostname: resource.redirectTarget.hostname || resource.id?.hostname || current.hostname,
    }
    if (seen.has(next.id)) {
      return {
        resource: {type: 'error', id, message: 'Redirect cycle detected while resolving resource'},
        republishSourceId,
        visited: [...visited, next.id],
        stopped: 'cycle',
      }
    }
    seen.add(next.id)
    visited.push(next.id)
    if (visited.length > MAX_REDIRECT_HOPS + 1) {
      return {
        resource: {type: 'error', id, message: 'Too many redirects while resolving resource'},
        republishSourceId,
        visited,
        stopped: 'limit',
      }
    }
    current = next
  }
}
