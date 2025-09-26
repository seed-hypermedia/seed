import {deduplicateCitations} from './citation-deduplication'
import {ListCommentsResponse} from './client/.generated/documents/v3alpha/comments_pb'
import {ListDocumentChangesResponse} from './client/.generated/documents/v3alpha/documents_pb'
import {ListEntityMentionsResponse} from './client/.generated/entities/v1alpha/entities_pb'
import {HMCitation, UnpackedHypermediaId} from './hm-types'
import {hmId, unpackHmId} from './utils'
import {parseFragment} from './utils/entity-id-url'

export type InteractionSummaryPayload = {
  citations: number
  comments: number
  changes: number
  blocks: Record<
    string,
    {
      citations: number
      comments: number
    }
  >
}

/**
 * Processes entity mentions into HMCitation format
 */
export function processMentionsToCitations(
  mentions: ListEntityMentionsResponse['mentions'],
  targetDocId: UnpackedHypermediaId,
): HMCitation[] {
  return mentions
    .map((mention) => {
      const sourceId = unpackHmId(mention.source)
      if (!sourceId) return null

      // Map both Ref (document) and Comment types
      const sourceType =
        mention.sourceType === 'Ref'
          ? 'd'
          : mention.sourceType === 'Comment'
          ? 'c'
          : null
      if (!sourceType) return null

      const targetId = hmId(targetDocId.uid, {
        path: targetDocId.path,
        version: mention.targetVersion,
      })

      const targetFragment = parseFragment(mention.targetFragment)

      return {
        source: {
          id: sourceId,
          type: sourceType as 'd' | 'c',
          author: mention.sourceBlob?.author,
          time: mention.sourceBlob?.createTime,
        },
        targetFragment,
        isExactVersion: mention.isExactVersion,
        targetId,
      } as HMCitation
    })
    .filter((citation): citation is HMCitation => citation !== null)
}

/**
 * Calculates block-level citation counts from deduplicated citations
 * This is the core logic used by both calculateInteractionSummary and calculateBlockCitations
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
 * Calculates interaction summary from mentions, comments, and changes
 */
export function calculateInteractionSummary(
  mentions: ListEntityMentionsResponse['mentions'],
  comments: ListCommentsResponse['comments'],
  changes: ListDocumentChangesResponse['changes'],
  targetDocId: UnpackedHypermediaId,
): InteractionSummaryPayload {
  // Process mentions into citations
  const allCitations = processMentionsToCitations(mentions, targetDocId)
  const dedupedCitations = deduplicateCitations(allCitations)

  const {blocks, citationCount} = calculateBlocksFromCitations(dedupedCitations)

  return {
    citations: citationCount, // Document citations/references to this document
    comments: comments.length, // Actual comments on this document
    changes: changes.length,
    blocks,
  }
}

/**
 * Separates citations into document and comment citations
 */
export function sortCitationsByType(citations: HMCitation[]): {
  docCitations: HMCitation[]
  commentCitations: HMCitation[]
} {
  const dedupedCitations = deduplicateCitations(citations)
  const docCitations: HMCitation[] = []
  const commentCitations: HMCitation[] = []

  dedupedCitations.forEach((citation) => {
    if (citation.source.type === 'd') {
      docCitations.push(citation)
    } else if (citation.source.type === 'c') {
      commentCitations.push(citation)
    }
  })

  return {docCitations, commentCitations}
}

/**
 * Calculates block-level citation counts from an array of citations
 * Used by the desktop app for displaying block-level citation indicators
 */
export function calculateBlockCitations(
  citations: HMCitation[],
): Record<string, {citations: number; comments: number}> {
  // Deduplicate citations first
  const dedupedCitations = deduplicateCitations(citations)

  // Use the shared core logic
  const {blocks} = calculateBlocksFromCitations(dedupedCitations)

  return blocks
}
