/**
 * In-memory registry of account alias relationships.
 *
 * When account A's home document is an alias of account B, A's [ACCOUNT, A]
 * cache entry actually holds B's metadata. So when B's profile changes we must
 * also invalidate every account that aliases to it. The registry tracks
 * `target → Set<source>` so we can walk that fan-out efficiently.
 *
 * The registry is process-local and append-only during a session — entries are
 * added when an alias is discovered, replaced when a source's target changes,
 * and removed only via `unregisterAlias` or `clearAliasRegistry`.
 */
import {invalidateQueries} from './query-client'
import {queryKeys} from './query-keys'

const aliasRegistry = new Map<string, Set<string>>()

/**
 * Record that `sourceUid`'s profile data is borrowed from `targetUid`.
 * Replaces any prior alias registration for `sourceUid`.
 */
export function registerAlias(sourceUid: string, targetUid: string) {
  if (sourceUid === targetUid) return
  unregisterAlias(sourceUid)
  let sources = aliasRegistry.get(targetUid)
  if (!sources) {
    sources = new Set()
    aliasRegistry.set(targetUid, sources)
  }
  sources.add(sourceUid)
}

/**
 * Remove any alias registration where `sourceUid` is the source.
 */
export function unregisterAlias(sourceUid: string) {
  const empties: string[] = []
  aliasRegistry.forEach((sources, target) => {
    if (sources.delete(sourceUid) && sources.size === 0) {
      empties.push(target)
    }
  })
  empties.forEach((target) => aliasRegistry.delete(target))
}

/**
 * Returns the uids of all accounts that alias to `targetUid` (one hop).
 */
export function getAliasesOf(targetUid: string): string[] {
  const sources = aliasRegistry.get(targetUid)
  return sources ? Array.from(sources) : []
}

/**
 * Returns `uid` plus every account whose profile transitively borrows from
 * `uid`. Cycle-safe: each uid is visited at most once.
 */
export function collectAliasClosure(uid: string): string[] {
  const visited = new Set<string>()
  const stack = [uid]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (visited.has(current)) continue
    visited.add(current)
    const sources = aliasRegistry.get(current)
    if (sources) {
      sources.forEach((source) => stack.push(source))
    }
  }
  return Array.from(visited)
}

/**
 * Invalidate `[ACCOUNT, uid]` plus every account that transitively aliases
 * to `uid`, so a single profile change refreshes every cache entry that
 * displays its data.
 */
export function invalidateAccountAndAliases(uid: string) {
  for (const accountUid of collectAliasClosure(uid)) {
    invalidateQueries([queryKeys.ACCOUNT, accountUid])
  }
}

/** Clear all registered aliases. Intended for tests and full cache resets. */
export function clearAliasRegistry() {
  aliasRegistry.clear()
}
