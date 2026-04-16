/**
 * Reconciles a user-defined manual ordering with a live list of items from the API.
 *
 * - Items present in both `userOrder` and `liveItems` appear in `userOrder` sequence.
 * - New items (in `liveItems` but not in `userOrder`) are appended at the end.
 * - Stale IDs (in `userOrder` but not in `liveItems`) are silently skipped.
 *
 * Only intended for `sortMode === 'manual'`.
 */
export function mergeWithUserOrder<T>(userOrder: string[], liveItems: T[], getId: (item: T) => string): T[] {
  const liveMap = new Map<string, T>()
  for (const item of liveItems) {
    liveMap.set(getId(item), item)
  }

  const placed = new Set<string>()
  const result: T[] = []

  // Walk userOrder — emit items that still exist in live data
  for (const id of userOrder) {
    if (placed.has(id)) continue
    const item = liveMap.get(id)
    if (item !== undefined) {
      result.push(item)
      placed.add(id)
    }
  }

  // Append new items that weren't in userOrder (preserving their live order)
  for (const item of liveItems) {
    const id = getId(item)
    if (!placed.has(id)) {
      result.push(item)
    }
  }

  return result
}
