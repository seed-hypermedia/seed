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
} from '../hm-types'
import {BIG_INT} from '../constants'
import {hmIdPathToEntityQueryPath} from '../utils/path-api'
import {getCommentGroups} from '../comments'
import {parseFragment, unpackHmId} from '../utils'
import {documentMetadataParseAdjustments} from './entity'

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
async function loadDocumentMetadata(
  client: GRPCClient,
  id: UnpackedHypermediaId,
): Promise<HMMetadataPayload> {
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
      console.error(
        `Failed to parse document metadata for ${id.id}:`,
        parsed.error,
      )
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

      const authors =
        authorAccountUids.length > 0
          ? await loadAccounts(client, authorAccountUids)
          : {}

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
      client.entities
        .listEntityMentions({id: targetId.id, pageSize: BIG_INT})
        .catch(() => null),
    ])

    // Process direct comments
    const allComments = directCommentsResult?.comments
      .map(parseComment)
      .filter((c): c is HMComment => c !== null) ?? []
    const discussions = getCommentGroups(allComments, commentId)
    discussions.forEach((g) => g.comments.forEach(addAuthor))

    // Process citing discussions - group by doc to dedupe listComments calls
    const mentionsByDoc = new Map<string, {mention: any; id: UnpackedHypermediaId}[]>()
    citationsResult?.mentions
      .filter((m) => m.sourceType === 'Comment' && m.sourceDocument !== targetId.id)
      .forEach((mention) => {
        const id = unpackHmId(mention.sourceDocument)
        if (!id) return
        if (!mentionsByDoc.has(mention.sourceDocument)) {
          mentionsByDoc.set(mention.sourceDocument, [])
        }
        mentionsByDoc.get(mention.sourceDocument)!.push({mention, id})
      })

    const citingResults = await Promise.all(
      Array.from(mentionsByDoc.values()).map(async (mentions) => {
        const docId = mentions[0]!.id
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
        if (!commentsRes) return []

        const comments = commentsRes.comments
          .map(parseComment)
          .filter((c): c is HMComment => c !== null)

        return mentions.map(({mention}): HMExternalCommentGroup | null => {
          const citingCommentId = mention.source.slice(5)
          const citingComment = comments.find((c) => c.id === citingCommentId)
          if (!citingComment) return null

          addAuthor(citingComment)
          const replies = getCommentGroups(comments, citingCommentId)[0]?.comments ?? []
          replies.forEach(addAuthor)

          return {
            comments: [citingComment, ...replies],
            moreCommentsCount: 0,
            id: mention.source,
            target: metadata,
            type: 'externalCommentGroup',
          }
        })
      }),
    )

    const citingDiscussions = citingResults
      .flat()
      .filter((d): d is HMExternalCommentGroup => d !== null)

    const authors = authorAccounts.size > 0
      ? await loadAccounts(client, Array.from(authorAccounts)).catch(() => ({}))
      : {}

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
    try {
      const citations = await client.entities.listEntityMentions({
        id: targetId.id,
        pageSize: BIG_INT,
      })

      const commentCitations = citations.mentions.filter((m) => {
        if (m.sourceType != 'Comment') return false
        const targetFragment = parseFragment(m.targetFragment)
        if (!targetFragment) return false
        return targetFragment.blockId == blockRef
      })

      const commentIds = commentCitations
        .map((c) => {
          const id = unpackHmId(c.source)
          if (!id) return null
          return `${id.uid}/${id.path}`
        })
        .filter((id): id is string => id !== null)

      if (commentIds.length === 0) {
        return {
          comments: [],
          authors: {},
        }
      }

      const res = await client.comments.batchGetComments({
        ids: commentIds,
      })

      const authorAccounts = new Set<string>()

      const comments: HMComment[] = res.comments
        .sort((a, b) => {
          const aTime =
            a?.updateTime && typeof a?.updateTime == 'string'
              ? new Date(a?.updateTime).getTime()
              : 0
          const bTime =
            b?.updateTime && typeof b?.updateTime == 'string'
              ? new Date(b?.updateTime).getTime()
              : 1
          return aTime - bTime
        })
        .map((c) => {
          if (c.author && c.author.trim() !== '') {
            authorAccounts.add(c.author)
          }
          return parseComment(c)
        })
        .filter((c): c is HMComment => c !== null)

      const authorAccountUids = Array.from(authorAccounts)
      const authors =
        authorAccountUids.length > 0
          ? await loadAccounts(client, authorAccountUids)
          : {}

      return {
        comments,
        authors,
      }
    } catch (e) {
      console.error(
        `Failed to load comments by reference for ${targetId.id}#${blockRef}:`,
        e,
      )
      return {
        comments: [],
        authors: {},
      }
    }
  }
}

/**
 * Creates a resolver for batch loading comments by IDs
 * @param client - gRPC client instance
 * @returns Async function that loads comments by their IDs
 */
export function createCommentsByIdResolver(client: GRPCClient) {
  return async (
    commentIds: string[],
  ): Promise<{
    comments: HMComment[]
    authors: Record<string, HMMetadataPayload>
  }> => {
    if (commentIds.length === 0) {
      return {
        comments: [],
        authors: {},
      }
    }

    try {
      const res = await client.comments.batchGetComments({
        ids: commentIds,
      })

      const authorAccounts = new Set<string>()

      const comments: HMComment[] = res.comments
        .sort((a, b) => {
          const aTime =
            a?.updateTime && typeof a?.updateTime == 'string'
              ? new Date(a?.updateTime).getTime()
              : 0
          const bTime =
            b?.updateTime && typeof b?.updateTime == 'string'
              ? new Date(b?.updateTime).getTime()
              : 1
          return aTime - bTime
        })
        .map((c) => {
          if (c.author && c.author.trim() !== '') {
            authorAccounts.add(c.author)
          }
          return parseComment(c)
        })
        .filter((c): c is HMComment => c !== null)

      const authorAccountUids = Array.from(authorAccounts)
      const authors =
        authorAccountUids.length > 0
          ? await loadAccounts(client, authorAccountUids)
          : {}

      return {
        comments,
        authors,
      }
    } catch (e) {
      console.error('Failed to batch load comments:', e)
      return {
        comments: [],
        authors: {},
      }
    }
  }
}

/**
 * Creates a resolver for loading a discussion thread with comment groups
 * Builds parent thread for a specific comment and loads related discussions
 * @param client - gRPC client instance
 * @returns Async function that loads discussion thread with comment groups
 */
export function createDiscussionThreadResolver(client: GRPCClient) {
  return async (
    targetId: UnpackedHypermediaId,
    commentId: string,
  ): Promise<{
    thread: HMComment[]
    commentGroups: HMCommentGroup[]
    authors: Record<string, HMMetadataPayload>
  }> => {
    try {
      const res = await client.comments.listComments({
        targetAccount: targetId.uid,
        targetPath: hmIdPathToEntityQueryPath(targetId.path),
        pageSize: BIG_INT,
      })

      const allComments: HMComment[] = []
      res.comments.forEach((c) => {
        const parsed = parseComment(c)
        if (parsed) {
          allComments.push(parsed)
        }
      })

      const commentGroups = getCommentGroups(allComments, commentId)

      const focusedComment = allComments.find((c) => c.id === commentId)
      if (!focusedComment) {
        throw new Error(`Comment not found: ${commentId}`)
      }

      // Build thread from focused comment to root
      const thread: HMComment[] = [focusedComment]
      let selectedComment = focusedComment
      while (selectedComment?.replyParent) {
        const parentComment = allComments.find(
          (c) => c.id === selectedComment.replyParent,
        )
        if (!parentComment) break
        thread.unshift(parentComment)
        selectedComment = parentComment
      }

      // Collect all author UIDs
      const authorAccounts = new Set<string>()
      thread.forEach((comment) => {
        if (comment.author && comment.author.trim() !== '') {
          authorAccounts.add(comment.author)
        }
      })
      commentGroups.forEach((group: HMCommentGroup) => {
        group.comments.forEach((comment: HMComment) => {
          if (comment.author && comment.author.trim() !== '') {
            authorAccounts.add(comment.author)
          }
        })
      })

      const authorAccountUids = Array.from(authorAccounts)
      const authors =
        authorAccountUids.length > 0
          ? await loadAccounts(client, authorAccountUids)
          : {}

      return {
        thread,
        commentGroups,
        authors,
      }
    } catch (e) {
      console.error(
        `Failed to load discussion thread for ${targetId.id}#${commentId}:`,
        e,
      )
      throw e
    }
  }
}
