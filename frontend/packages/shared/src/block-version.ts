import type {HMBlockNode, HMRawDocumentChange} from '@seed-hypermedia/client/hm-types'
import {findContentBlock} from './outline'

/**
 * Finds the newest version of a document that still contains `blockId`, searching only changes that descend from
 * `knownVersion` (a version where the block is known to exist). Falls back to `knownVersion`.
 */
export async function findLatestVersionWithBlock(input: {
  changes: HMRawDocumentChange[]
  latestVersion: string
  knownVersion: string
  blockId: string
  loadContent: (version: string) => Promise<HMBlockNode[] | null>
  maxLookups?: number
}): Promise<string> {
  const {changes, latestVersion, knownVersion, blockId, loadContent} = input
  const maxLookups = input.maxLookups ?? 10

  const knownHeads = knownVersion.split('.').filter(Boolean)
  const changeById = new Map<string, HMRawDocumentChange>()
  for (const change of changes) {
    if (change.id) changeById.set(change.id, change)
  }
  if (!knownHeads.some((head) => changeById.has(head))) return knownVersion

  const children = new Map<string, HMRawDocumentChange[]>()
  for (const change of changes) {
    if (!change.id) continue
    for (const dep of change.deps ?? []) {
      const list = children.get(dep)
      if (list) list.push(change)
      else children.set(dep, [change])
    }
  }

  const latestHeads = new Set(latestVersion.split('.').filter(Boolean))
  const seen = new Set<string>(knownHeads)
  const candidates: HMRawDocumentChange[] = []
  const queue = [...knownHeads]
  while (queue.length) {
    const head = queue.shift()!
    for (const child of children.get(head) ?? []) {
      if (!child.id || seen.has(child.id)) continue
      seen.add(child.id)
      queue.push(child.id)
      if (!latestHeads.has(child.id)) candidates.push(child)
    }
  }

  candidates.sort((a, b) => (b.createTime ?? '').localeCompare(a.createTime ?? ''))

  let lookups = 0
  for (const candidate of candidates) {
    if (lookups >= maxLookups || !candidate.id) break
    lookups += 1
    const content = await loadContent(candidate.id)
    if (content && findContentBlock(content, blockId)) return candidate.id
  }
  return knownVersion
}
