import {unpackHmId, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, latestId} from './entity-id-url'

/**
 * Card targets from the indexer's navigation Cards (hm:// IDs in reading order), each opening its latest version. The
 * backend decides which blocks count as Cards; the frontend only reads its list.
 */
export function getIndexedCardNavigationTargets(ids: string[]): UnpackedHypermediaId[] {
  const targets = new Map<string, UnpackedHypermediaId>()
  for (const raw of ids) {
    const target = unpackHmId(raw)
    if (!target?.uid) continue
    const id = latestId(hmId(target.uid, {path: target.path}))
    if (!targets.has(id.id)) targets.set(id.id, id)
  }
  return Array.from(targets.values())
}
