import {HMTimestamp} from './hm-types'
import {normalizeDate} from './utils/date'

/**
 * Deduplicate citations by source.id.id and targetFragment, keeping only the latest (by time) for each unique combination.
 * Citations with different targetFragment values are considered different even if they have the same source.
 * Assumes citations are of type HMCitation or compatible.
 */
export function deduplicateCitations<
  T extends {
    source: {id: {id: string}; time?: HMTimestamp}
    targetFragment?: any
    [key: string]: any
  },
>(citations: T[]): T[] {
  const latestBySourceAndFragment: Record<string, {citation: T; time: number}> =
    {}
  for (const citation of citations) {
    const sourceId = citation.source.id.id
    const targetFragment = citation.targetFragment
      ? JSON.stringify(citation.targetFragment)
      : ''
    const key = `${sourceId}:${targetFragment}`

    let timeVal = citation.source.time
    if (typeof timeVal === 'number') timeVal = String(timeVal)
    const time = timeVal ? normalizeDate(timeVal)?.getTime() ?? 0 : 0

    if (
      !latestBySourceAndFragment[key] ||
      time > latestBySourceAndFragment[key].time
    ) {
      latestBySourceAndFragment[key] = {citation, time}
    }
  }
  return Object.values(latestBySourceAndFragment).map((entry) => entry.citation)
}
