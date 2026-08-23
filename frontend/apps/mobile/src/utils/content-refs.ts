/**
 * Content-reference extraction — mobile port of the logic in
 * @shm/shared/content.ts (extractAllContentRefs / hasQueryBlockTargetingSelf)
 * used by the web's UnreferencedDocuments. Kept dependency-light: only the
 * client package's id utilities.
 */

import {entityQueryPathToHmIdPath, unpackHmId, type HMBlockNode} from '@seed-hypermedia/client/hm-types'

/** Ids (hm id strings) referenced by embed blocks and embed/link annotations. */
export function extractContentRefIds(children: HMBlockNode[]): Set<string> {
  const refs = new Set<string>()
  function walk(node: HMBlockNode) {
    const block = node.block as {type?: string; link?: string; annotations?: Array<{type?: string; link?: string}>}
    if (block?.type === 'Embed' && block.link) {
      const refId = unpackHmId(block.link)
      if (refId) refs.add(refId.id)
    }
    block?.annotations?.forEach((annotation) => {
      if ((annotation.type === 'Embed' || annotation.type === 'Link') && annotation.link) {
        const refId = unpackHmId(annotation.link)
        if (refId) refs.add(refId.id)
      }
    })
    node.children?.forEach(walk)
  }
  children.forEach(walk)
  return refs
}

/**
 * True when a Query block in the content lists the document's own children —
 * in that case the query already shows everything and the unreferenced
 * section stays hidden (web parity).
 */
export function hasQueryBlockTargetingSelf(
  children: HMBlockNode[],
  parentUid: string,
  parentPath: string[] | null,
): boolean {
  const parentPathStr = (parentPath ?? []).filter(Boolean).join('/')
  let found = false
  function walk(node: HMBlockNode) {
    if (found) return
    const block = node.block as {
      type?: string
      attributes?: {query?: {includes?: Array<{space?: string; path?: string}>}}
    }
    if (block?.type === 'Query') {
      const includes = block.attributes?.query?.includes ?? []
      if (
        includes.some(
          (include) =>
            include.space === parentUid && entityQueryPathToHmIdPath(include.path).join('/') === parentPathStr,
        )
      ) {
        found = true
        return
      }
    }
    node.children?.forEach(walk)
  }
  children.forEach(walk)
  return found
}
