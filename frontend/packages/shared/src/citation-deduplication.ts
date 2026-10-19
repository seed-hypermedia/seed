import {HMTimestamp} from '@seed-hypermedia/client/hm-types'
import {normalizeDate} from './utils/date'

/**
 * Deduplicate citations so each one counts once per place it comes from, keeping the latest (by time)
 * of every group. A document citation is one per citing block: ListCitations returns one row per
 * block that links the target, and a paper citing one bibliography entry from four paragraphs is four
 * citations, while the same block republished by later versions is still one. A comment citation is
 * one per comment. Citations with different targetFragment values are different even from the same
 * source. Assumes citations are of type HMCitation or compatible.
 */
export function deduplicateCitations<
  T extends {
    source: {id: {id: string}; type?: 'd' | 'c'; blockId?: string; time?: HMTimestamp}
    targetFragment?: any
    [key: string]: any
  },
>(citations: T[]): T[] {
  const latestBySourceAndFragment: Record<string, {citation: T; time: number}> = {}
  for (const citation of citations) {
    const sourceId = citation.source.id.id
    const sourceBlock = citation.source.type === 'd' ? citation.source.blockId ?? '' : ''
    const targetFragment = citation.targetFragment ? JSON.stringify(citation.targetFragment) : ''
    const key = `${sourceId}:${sourceBlock}:${targetFragment}`

    let timeVal = citation.source.time
    if (typeof timeVal === 'number') timeVal = String(timeVal)
    const time = timeVal ? normalizeDate(timeVal)?.getTime() ?? 0 : 0

    if (!latestBySourceAndFragment[key] || time > latestBySourceAndFragment[key].time) {
      latestBySourceAndFragment[key] = {citation, time}
    }
  }
  return Object.values(latestBySourceAndFragment).map((entry) => entry.citation)
}
