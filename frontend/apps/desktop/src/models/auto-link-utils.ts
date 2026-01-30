/**
 * Auto-link child to parent on first publish - utility functions
 *
 * These pure functions are extracted to allow unit testing without
 * heavy dependencies from documents.ts
 */

import {
  HMBlockNode,
  HMDocument,
  UnpackedHypermediaId,
  hmIdPathToEntityQueryPath,
  packHmId,
  unpackHmId,
} from '@shm/shared'

/**
 * Check if a document contains a link/embed to a specific child document
 * Compares URLs ignoring version and latest flags
 */
export function documentContainsLinkToChild(
  document: HMDocument,
  childId: UnpackedHypermediaId,
): boolean {
  // Normalize the child URL by removing version and latest flags
  const childUrlNormalized = packHmId({...childId, version: null, latest: null})

  function searchBlocks(nodes: HMBlockNode[]): boolean {
    for (const node of nodes) {
      // Check embed blocks
      if (node.block.type === 'Embed') {
        const linkId = unpackHmId(node.block.link)
        if (linkId) {
          const linkUrl = packHmId({...linkId, version: null, latest: null})
          if (linkUrl === childUrlNormalized) return true
        }
      }
      // Check inline annotations for links (only some block types have annotations)
      const annotations =
        'annotations' in node.block ? node.block.annotations : undefined
      if (annotations) {
        for (const ann of annotations) {
          if (ann.type === 'Link' || ann.type === 'Embed') {
            const linkId = unpackHmId(ann.link)
            if (linkId) {
              const linkUrl = packHmId({...linkId, version: null, latest: null})
              if (linkUrl === childUrlNormalized) return true
            }
          }
        }
      }
      if (node.children && searchBlocks(node.children)) return true
    }
    return false
  }
  return searchBlocks(document.content || [])
}

/**
 * Check if a document has a self-referential Query block
 * (query to itself that would include children)
 */
export function documentHasSelfQuery(
  document: HMDocument,
  documentId: UnpackedHypermediaId,
): boolean {
  // hmIdPathToEntityQueryPath returns "/my/document" with leading slash
  // but Query blocks may store paths as "my/document" without leading slash
  // We normalize both to compare correctly
  const documentPathWithSlash = hmIdPathToEntityQueryPath(documentId.path)
  const documentPathWithoutSlash = documentId.path?.join('/') || ''

  function searchBlocks(nodes: HMBlockNode[]): boolean {
    for (const node of nodes) {
      if (node.block.type === 'Query') {
        const query = node.block.attributes?.query
        if (query?.includes) {
          for (const inc of query.includes) {
            // Self-referential if space is empty or matches document
            const isSpaceMatch = !inc.space || inc.space === documentId.uid
            // Path can be stored with or without leading slash
            const isPathMatch =
              !inc.path ||
              inc.path === documentPathWithSlash ||
              inc.path === documentPathWithoutSlash
            if (isSpaceMatch && isPathMatch) return true
          }
        }
      }
      if (node.children && searchBlocks(node.children)) return true
    }
    return false
  }
  return searchBlocks(document.content || [])
}
