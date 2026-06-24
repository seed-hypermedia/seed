import {HMCitation, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {deduplicateCitations} from './citation-deduplication'
import {ListDocumentChangesResponse} from './client/.generated/documents/v3alpha/documents_pb'
import {ListCitationsResponse} from './client/.generated/documents/v3alpha/resources_pb'
import {hmId, unpackHmId} from './utils'
import {parseFragment} from './utils/entity-id-url'

export type InteractionSummaryPayload = {
  citations: number
  comments: number
  changes: number
  children: number
  /** UIDs of all authors who created mentions/citations targeting this document. */
  authorUids: string[]
  blocks: Record<
    string,
    {
      citations: number
      comments: number
    }
  >
}

/**
 * Processes resource citations into HMCitation format
 */
function processResourceCitations(
  citations: ListCitationsResponse['citations'],
  targetDocId: UnpackedHypermediaId,
): HMCitation[] {
  return citations
    .map((citation) => {
      const sourceId = unpackHmId(citation.source)
      if (!sourceId) return null

      // Map both Ref (document) and Comment types
      const sourceType = citation.sourceType === 'Ref' ? 'd' : citation.sourceType === 'Comment' ? 'c' : null
      if (!sourceType) return null

      const targetId = hmId(targetDocId.uid, {
        path: targetDocId.path,
        version: citation.targetVersion,
      })

      const targetFragment = parseFragment(citation.targetFragment)

      return {
        source: {
          id: sourceId,
          type: sourceType as 'd' | 'c',
          author: citation.sourceBlob?.author,
          time: citation.sourceBlob?.createTime,
        },
        targetFragment,
        isExactVersion: citation.isExactVersion,
        targetId,
      } as HMCitation
    })
    .filter((citation): citation is HMCitation => citation !== null)
}

/**
 * Calculates block-level citation counts from deduplicated citations
 * Core logic used by calculateInteractionSummary
 */
function calculateBlocksFromCitations(dedupedCitations: HMCitation[]): {
  blocks: Record<string, {citations: number; comments: number}>
  citationCount: number
  commentCount: number
} {
  let citationCount = 0
  let commentCount = 0
  const blocks: Record<string, {citations: number; comments: number}> = {}

  dedupedCitations.forEach((citation) => {
    if (!citation.source.id) return

    const targetFragment = citation.targetFragment
    const blockCounts = targetFragment?.blockId
      ? (blocks[targetFragment.blockId] = blocks[targetFragment.blockId] || {
          citations: 0,
          comments: 0,
        })
      : null

    if (citation.source.type === 'c') {
      if (blockCounts) blockCounts.comments += 1
      commentCount += 1
    }
    if (citation.source.type === 'd') {
      if (blockCounts) blockCounts.citations += 1
      citationCount += 1
    }
  })

  return {blocks, citationCount, commentCount}
}

/**
 * Calculates interaction summary from citations, comments, changes, and children
 */
export function calculateInteractionSummary(
  citations: ListCitationsResponse['citations'],
  changes: ListDocumentChangesResponse['changes'],
  targetDocId: UnpackedHypermediaId,
  childrenCount: number = 0,
): InteractionSummaryPayload {
  const allCitations = processResourceCitations(citations, targetDocId)
  const dedupedCitations = deduplicateCitations(allCitations)

  const {blocks} = calculateBlocksFromCitations(dedupedCitations)

  // Count distinct source documents, not per-block citations
  // A single document can cite multiple blocks, but should only count as one citation
  const uniqueDocSources = new Set(
    dedupedCitations.filter((citation) => citation.source.type === 'd').map((citation) => citation.source.id.id),
  )

  // Count distinct comment sources, not all comment citations
  // A single comment can cite multiple blocks, but should only count as one comment
  const uniqueCommentSources = new Set(
    dedupedCitations.filter((citation) => citation.source.type === 'c').map((citation) => citation.source.id.id),
  )

  // Collect unique author UIDs from all citations (both document and comment sources)
  const authorUids = Array.from(
    new Set(dedupedCitations.map((citation) => citation.source.author).filter((author): author is string => !!author)),
  )

  return {
    citations: uniqueDocSources.size, // Count distinct document sources citing this document
    comments: uniqueCommentSources.size, // Count distinct comment sources
    changes: changes.length,
    children: childrenCount,
    authorUids,
    blocks,
  }
}
