import {loadAccounts} from '../api-account'
import {GRPCClient} from '../grpc-client'
import {
  HMComment,
  HMCommentGroup,
  HMCommentSchema,
  HMDocumentMetadataSchema,
  HMExternalCommentGroup,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {BIG_INT} from '../constants'
import {LIST_PAGE_SIZE, listAllPages} from '../list-all-pages'
import {entityQueryPathToHmIdPath, hmIdPathToEntityQueryPath} from '../utils/path-api'
import {getCommentGroups} from '../comments'
import {extractAllContentRefs} from '../content'
import {normalizeDate} from '../utils/date'
import {hmId, parseFragment} from '../utils'
import {documentMetadataParseAdjustments} from './entity'

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
 * Loads document metadata for a given ID with validation
 * @param client - gRPC client instance
 * @param id - Unpacked hypermedia ID
 * @returns HMMetadataPayload or empty metadata on error
 */
async function loadDocumentMetadata(client: GRPCClient, id: UnpackedHypermediaId): Promise<HMMetadataPayload> {
  try {
    const rawDoc = await client.documents.getDocument({
      account: id.uid,
      path: hmIdPathToEntityQueryPath(id.path),
      version: id.latest ? undefined : id.version || undefined,
    })
    const metadataJSON = rawDoc.metadata?.toJson({
      emitDefaultValues: true,
      enumAsInteger: false,
    })
    documentMetadataParseAdjustments(metadataJSON)
    const parsed = HMDocumentMetadataSchema.safeParse(metadataJSON)
    if (!parsed.success) {
      console.error(`Failed to parse document metadata for ${id.id}:`, parsed.error)
      return {id, metadata: {}}
    }
    return {
      id,
      metadata: parsed.data,
    }
  } catch (e) {
    console.error(`Failed to load document metadata for ${id.id}:`, e)
    return {id, metadata: {}}
  }
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
 * Creates a resolver for loading discussions (comment groups + citations)
 */
export function createDiscussionsResolver(client: GRPCClient) {
  return async (
    targetId: UnpackedHypermediaId,
    commentId?: string,
  ): Promise<{
    discussions: HMCommentGroup[]
    authors: Record<string, HMMetadataPayload>
    citingDiscussions: HMExternalCommentGroup[]
  }> => {
    const authorAccounts = new Set<string>()
    const addAuthor = (c: HMComment) => {
      if (c.author?.trim()) authorAccounts.add(c.author)
    }

    // Fetch direct comments and citations in parallel
    const [directCommentsResult, citationsResult] = await Promise.all([
      client.comments
        .listComments({
          targetAccount: targetId.uid,
          targetPath: hmIdPathToEntityQueryPath(targetId.path),
          pageSize: BIG_INT,
        })
        .catch(() => null),
      // maxPages bounded on purpose: unbounded ListCitations enumeration took
      // production down on 2026-08-11 (hypermedia/apps/daemon.md, "Load and the read pool").
      listAllPages(
        (pageToken) => client.resources.listCitations({iri: targetId.id, pageSize: LIST_PAGE_SIZE, pageToken}),
        (r) => ({items: r.citations, nextPageToken: r.nextPageToken}),
        {maxPages: 1},
      ).catch(() => null),
    ])

    // Process direct comments
    const allComments = directCommentsResult?.comments.map(parseComment).filter((c): c is HMComment => c !== null) ?? []
    const discussions = getCommentGroups(allComments, commentId)
    discussions.forEach((g) => g.comments.forEach(addAuthor))

    // Process citing discussions: comments on other documents that link to this one.
    // citation.sourceDocument can't be used to find the citing comment's own document,
    // because the backend sets it to the requested IRI for every comment citation (see
    // seed-hypermedia/seed#921), so fetch each candidate comment and read its real target.
    const directCommentIds = new Set(allComments.map((c) => c.id))
    const citingCommentIds = new Set(
      citationsResult
        ?.filter((m) => m.sourceType === 'Comment')
        .map((m) => m.source.slice('hm://'.length))
        .filter((id) => !directCommentIds.has(id)) ?? [],
    )

    const citingComments = (
      await mapWithConcurrency(Array.from(citingCommentIds), CITING_LOOKUP_CONCURRENCY, (id) =>
        client.comments
          .getComment({id})
          .then(parseComment)
          .catch(() => null),
      )
    ).filter((c): c is HMComment => c !== null)

    // Group by the citing comment's own document to dedupe listComments calls
    const citingByDoc = new Map<string, {docId: UnpackedHypermediaId; comments: HMComment[]}>()
    citingComments.forEach((comment) => {
      const docId = hmId(comment.targetAccount, {path: entityQueryPathToHmIdPath(comment.targetPath)})
      // A comment targeting this document that listComments didn't return
      // (e.g. deleted or private) is not a citing discussion.
      if (!docId.uid || docId.id === targetId.id) return
      const group = citingByDoc.get(docId.id) ?? {docId, comments: []}
      group.comments.push(comment)
      citingByDoc.set(docId.id, group)
    })

    const citingResults = await mapWithConcurrency(
      Array.from(citingByDoc.values()),
      CITING_LOOKUP_CONCURRENCY,
      async ({docId, comments: docCitingComments}) => {
        const [commentsRes, metadata] = await Promise.all([
          client.comments
            .listComments({
              targetAccount: docId.uid,
              targetPath: hmIdPathToEntityQueryPath(docId.path),
              pageSize: BIG_INT,
            })
            .catch(() => null),
          loadDocumentMetadata(client, docId),
        ])

        const comments = commentsRes?.comments.map(parseComment).filter((c): c is HMComment => c !== null) ?? []

        return docCitingComments.map((citingComment): HMExternalCommentGroup => {
          addAuthor(citingComment)
          const replies = getCommentGroups(comments, citingComment.id)[0]?.comments ?? []
          replies.forEach(addAuthor)

          return {
            comments: [citingComment, ...replies],
            moreCommentsCount: 0,
            id: `hm://${citingComment.id}`,
            target: metadata,
            type: 'externalCommentGroup',
          }
        })
      },
    )

    const citingDiscussions = citingResults.flat().filter((d): d is HMExternalCommentGroup => d !== null)

    const authors =
      authorAccounts.size > 0 ? await loadAccounts(client, Array.from(authorAccounts)).catch(() => ({})) : {}

    return {discussions, authors, citingDiscussions}
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
