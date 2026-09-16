import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'

/**
 * Maximum redirect hops any resolver may follow before giving up.
 *
 * Redirect Refs are data served by the daemon, so a chain can be arbitrarily long or
 * even cyclic (A→B→C→A). Every follower must bound its walk with this limit and stop
 * early on a revisited address — an unbounded follower spins forever on a cycle,
 * growing a promise chain that degrades the whole process.
 */
export const MAX_REDIRECT_HOPS = 5

/**
 * A republish shows its target's content, so a version pinned at the republish's address
 * (what the republish's web page advertises, and what a version-pinned embed of it stores)
 * is the target's version. Carry it across the hop, or the pinned lookup renders the
 * target's latest version. A move redirect is left alone: its old address's versions do
 * not belong to the target.
 */
export function republishVersionCarry(
  redirect: {republish?: boolean | null; redirectTarget: UnpackedHypermediaId},
  requested: UnpackedHypermediaId,
): Pick<UnpackedHypermediaId, 'version' | 'latest'> | {} {
  if (!redirect.republish || !requested.version || redirect.redirectTarget.version) return {}
  return {version: requested.version, latest: requested.latest}
}
