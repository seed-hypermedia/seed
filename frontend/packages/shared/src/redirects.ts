/**
 * Maximum redirect hops any resolver may follow before giving up.
 *
 * Redirect Refs are data served by the daemon, so a chain can be arbitrarily long or
 * even cyclic (A→B→C→A). Every follower must bound its walk with this limit and stop
 * early on a revisited address — an unbounded follower spins forever on a cycle,
 * growing a promise chain that degrades the whole process.
 */
export const MAX_REDIRECT_HOPS = 5
