import {HMTimestamp} from './hm-types'
import {normalizeDate} from './utils/date'

/**
 * Deduplicate citations by source.id.id, keeping only the latest (by time) for each source.id.id.
 * Assumes citations are of type HMCitation or compatible.
 */
export function deduplicateCitations<
  T extends {
    source: {id: {id: string}; time?: HMTimestamp}
    [key: string]: any
  },
>(citations: T[]): T[] {
  const latestBySource: Record<string, {citation: T; time: number}> = {}
  for (const citation of citations) {
    const id = citation.source.id.id
    let timeVal = citation.source.time
    if (typeof timeVal === 'number') timeVal = String(timeVal)
    const time = timeVal ? normalizeDate(timeVal)?.getTime() ?? 0 : 0
    if (!latestBySource[id] || time > latestBySource[id].time) {
      latestBySource[id] = {citation, time}
    }
  }
  return Object.values(latestBySource).map((entry) => entry.citation)
}
