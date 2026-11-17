import {unpackHmId, type HMBlockNode, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, latestId} from './entity-id-url'

/**
 * Card targets in document order, once per document, always opening its latest version. Only Cards that follow the
 * latest version count: a link with no `v`, or with both `v` and `l`. A Card pinned to a version is not navigation.
 */
export function getCardNavigationTargets(content: HMBlockNode[]): UnpackedHypermediaId[] {
  const targets = new Map<string, UnpackedHypermediaId>()
  function visit(nodes: HMBlockNode[]) {
    for (const {block, children} of nodes) {
      if (block.type === 'Embed' && block.attributes?.view === 'Card') {
        const target = unpackHmId(block.link)
        if (target?.uid && target.latest) {
          // A sidebar entry names the whole document, even when its Card points at a block.
          const id = latestId(hmId(target.uid, {path: target.path}))
          if (!targets.has(id.id)) targets.set(id.id, id)
        }
      }
      if (children) visit(children)
    }
  }
  visit(content)
  return Array.from(targets.values())
}
