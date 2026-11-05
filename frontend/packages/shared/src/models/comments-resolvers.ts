import {loadAccounts} from '../api-account'
import {GRPCClient} from '../grpc-client'
import {
  HMComment,
  HMCommentGroup,
  HMCommentSchema,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {BIG_INT} from '../constants'
import {LIST_PAGE_SIZE, listAllPages} from '../list-all-pages'
import {hmIdPathToEntityQueryPath} from '../utils/path-api'
import {getCommentGroups} from '../comments'
import {extractAllContentRefs} from '../content'
import {normalizeDate} from '../utils/date'
import {parseFragment} from '../utils'

/**
 * Maps items to async results with at most `limit` requests in flight. The daemon has no
 * in-flight cap of its own, so callers fanning out per-item RPCs bound the burst here
 * (hypermedia/apps/daemon.md, "Load and the read pool"). Real relief is server-side citation/comment
 * pagination; until then this keeps a heavily-cited document from firing a whole
 * citations page of lookups at once.
 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({length: Math.min(limit, items.length)}, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}

const CITING_LOOKUP_CONCURRENCY = 16

/**
 * Parses raw comment data with validation, filtering out invalid comments
 * @param rawComment - Raw comment object from gRPC
 * @returns Parsed HMComment or null if validation fails
 */
function parseComment(rawComment: any): HMComment | null {
  const commentJson =
    typeof rawComment.toJson === 'function'
      ? rawComment.toJson({emitDefaultValues: true, enumAsInteger: false})
      : rawComment

  const parsed = HMCommentSchema.safeParse(commentJson)
  if (!parsed.success) {
    console.error('Failed to parse comment:', parsed.error)
    return null
  }
  return parsed.data
}

/**
 * Extracts unique author UIDs from comments with defensive filtering
 * @param comments - Array of HMComment objects
 * @returns Set of author UIDs
 */
function extractAuthorUids(comments: HMComment[]): Set<string> {
  const authorUids = new Set<string>()
  comments.forEach((comment) => {
    if (comment.author && comment.author.trim() !== '') {
      authorUids.add(comment.author)
    }
  })
  return authorUids
}

/**
 * Creates a resolver for loading comments for a target document
 * @param client - gRPC client instance
 * @returns Async function that loads comments and authors
 */
export function createCommentsResolver(client: GRPCClient) {
  return async (
    targetId: UnpackedHypermediaId,
  ): Promise<{
    comments: HMComment[]
    authors: Record<string, HMMetadataPayload>
  }> => {
    try {
      const res = await client.comments.listComments({
        targetAccount: targetId.uid,
        targetPath: hmIdPathToEntityQueryPath(targetId.path),
        pageSize: BIG_INT,
      })

      const comments: HMComment[] = []
      res.comments.forEach((c) => {
        const parsed = parseComment(c)
        if (parsed) {
          comments.push(parsed)
        }
      })

      const authorUids = extractAuthorUids(comments)
      const authorAccountUids = Array.from(authorUids)

      const authors = authorAccountUids.length > 0 ? await loadAccounts(client, authorAccountUids) : {}

      return {
        comments,
        authors,
      }
    } catch (e) {
      console.error(`Failed to load comments for ${targetId.id}:`, e)
      return {
        comments: [],
        authors: {},
      }
    }
  }
}

/**
 * Creates a resolver for loading discussions (comment groups targeting this document).
 */
export function createDiscussionsResolver(client: GRPCClient) {
  return async (
    targetId: UnpackedHypermediaId,
    commentId?: string,
  ): Promise<{
    discussions: HMCommentGroup[]
    authors: Record<string, HMMetadataPayload>
  }> => {
    const authorAccounts = new Set<string>()
    const addAuthor = (c: HMComment) => {
      if (c.author?.trim()) authorAccounts.add(c.author)
    }

    const directCommentsResult = await client.comments
      .listComments({
        targetAccount: targetId.uid,
        targetPath: hmIdPathToEntityQueryPath(targetId.path),
        pageSize: BIG_INT,
      })
      .catch(() => null)

    const allComments = directCommentsResult?.comments.map(parseComment).filter((c): c is HMComment => c !== null) ?? []
    const discussions = getCommentGroups(allComments, commentId)
    discussions.forEach((g) => g.comments.forEach(addAuthor))

    const authors =
      authorAccounts.size > 0 ? await loadAccounts(client, Array.from(authorAccounts)).catch(() => ({})) : {}

    return {discussions, authors}
  }
}

/**
 * Creates a resolver for loading comments by reference (block-level comments)
 * @param client - gRPC client instance
 * @returns Async function that loads comments for a specific block
 */
export function createCommentsByReferenceResolver(client: GRPCClient) {
  return async (
    targetId: UnpackedHypermediaId,
    blockRef: string,
  ): Promise<{
    comments: HMComment[]
    authors: Record<string, HMMetadataPayload>
  }> => {
    // Direct comments are the source of truth for this document. Citation
    // enumeration is bounded and can omit recent comments on busy documents.
    const [directComments, citations] = await Promise.all([
      listAllPages(
        (pageToken) =>
          client.comments.listComments({
            targetAccount: targetId.uid,
            targetPath: hmIdPathToEntityQueryPath(targetId.path),
            pageSize: LIST_PAGE_SIZE,
            pageToken,
          }),
        (r) => ({items: r.comments, nextPageToken: r.nextPageToken}),
      ),
      // Keep the citation cap: unbounded enumeration can exhaust the daemon's read pool.
      listAllPages(
        (pageToken) =>
          client.resources.listCitations({
            iri: targetId.id,
            pageSize: LIST_PAGE_SIZE,
            pageToken,
            reverseOrder: true,
          }),
        (r) => ({items: r.citations, nextPageToken: r.nextPageToken}),
        {maxPages: 1},
      ).catch(() => []),
    ])
    const commentsById = new Map<string, HMComment>()
    const directIds = new Set(directComments.map((c) => c.id))
    const citedIds = new Set(
      citations
        .filter((c) => c.sourceType === 'Comment' && parseFragment(c.targetFragment)?.blockId === blockRef)
        .map((c) => c.source.slice('hm://'.length))
        .filter((id) => !directIds.has(id)),
    )
    // A deleted or inaccessible citation must not discard every other comment.
    const citedComments = await mapWithConcurrency(Array.from(citedIds), CITING_LOOKUP_CONCURRENCY, (id) =>
      client.comments.getComment({id}).catch(() => null),
    )
    for (const raw of [...directComments, ...citedComments]) {
      if (!raw) continue
      const comment = parseComment(raw)
      if (!comment) continue
      const referencesBlock = extractAllContentRefs(comment.content).some(
        ({refId}) => refId?.id === targetId.id && refId.blockRef === blockRef,
      )
      if (referencesBlock) commentsById.set(comment.id, comment)
    }
    const comments = Array.from(commentsById.values()).sort(
      (a, b) => (normalizeDate(a.createTime)?.getTime() ?? 0) - (normalizeDate(b.createTime)?.getTime() ?? 0),
    )
    const authorUids = Array.from(extractAuthorUids(comments))
    const authors = authorUids.length ? await loadAccounts(client, authorUids).catch(() => ({})) : {}
    return {comments, authors}
  }
}
