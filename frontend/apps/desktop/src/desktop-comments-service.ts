import {getAccount} from '@/models/entities'
import {
  getCommentGroups,
  HMComment,
  HMMetadataPayload,
  parseFragment,
  unpackHmId,
} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'
import {
  CommentsService,
  ListCommentsByIdRequest,
  ListCommentsByReferenceRequest,
  ListCommentsByReferenceResponse,
  ListCommentsRequest,
  ListCommentsResponse,
  ListDiscussionsRequest,
  ListDiscussionsResponse,
} from '@shm/shared/models/comments-service'
import {hmIdPathToEntityQueryPath} from '@shm/shared/utils/path-api'
import {grpcClient} from './grpc-client'

async function getCommentsAuthors(
  authorUids: Array<string>,
): Promise<ListCommentsResponse['authors']> {
  const authorAccounts = new Map<string, HMMetadataPayload>()

  await Promise.all(
    authorUids.map(async (accountUid) => {
      try {
        let account = await getAccount(accountUid)

        if (account) {
          authorAccounts.set(accountUid, account)
        }
      } catch (error) {
        // ignore fetch account error
        console.error(`Error fetching account ${accountUid}`, error)
      }
    }),
  )

  return Object.fromEntries(authorAccounts) as ListCommentsResponse['authors']
}

export class DesktopCommentsService implements CommentsService {
  async listComments(
    params: ListCommentsRequest,
  ): Promise<ListCommentsResponse> {
    const res = await grpcClient.comments.listComments({
      targetAccount: params.targetId.uid,
      targetPath: hmIdPathToEntityQueryPath(params.targetId.path),
      pageSize: BIG_INT,
    })

    const comments = res.comments.map((c) =>
      c.toJson({emitDefaultValues: true}),
    ) as Array<HMComment>

    const authorAccounts = new Set<string>()

    comments.forEach((c) => {
      if (c.author && c.author.trim() !== '') {
        authorAccounts.add(c.author)
      }
    })

    const authorAccountUids = Array.from(authorAccounts)

    const authors = await getCommentsAuthors(authorAccountUids)

    return {
      comments,
      authors,
    }
  }

  async listDiscussions(
    params: ListDiscussionsRequest,
  ): Promise<ListDiscussionsResponse> {
    const res = await grpcClient.comments.listComments({
      targetAccount: params.targetId.uid,
      targetPath: hmIdPathToEntityQueryPath(params.targetId.path),
      pageSize: BIG_INT,
    })
    const authorAccounts = new Set<string>()

    const comments = res.comments.map((c) => {
      if (c.author && c.author.trim() !== '') {
        authorAccounts.add(c.author)
      }
      return c.toJson({emitDefaultValues: true})
    }) as Array<HMComment>

    const authorAccountUids = Array.from(authorAccounts)
    const authors = await getCommentsAuthors(authorAccountUids)
    const discussions = getCommentGroups(comments, params.commentId || '')

    return {
      discussions,
      authors,
    }
  }

  async listCommentsById(
    params: ListCommentsByIdRequest,
  ): Promise<ListCommentsResponse> {
    throw new Error('Method not implemented.')
  }

  async listCommentsByReference(
    params: ListCommentsByReferenceRequest,
  ): Promise<ListCommentsByReferenceResponse> {
    const citations = await grpcClient.entities.listEntityMentions({
      id: params.targetId.id,
      pageSize: BIG_INT,
      pageToken: '',
    })

    const commentCitations = citations.mentions.filter((m) => {
      if (m.sourceType != 'Comment') return false
      const targetFragment = parseFragment(m.targetFragment)
      if (!targetFragment) return false
      return targetFragment.blockId == params.targetId.blockRef
    })

    const commentIds = commentCitations
      .map((c) => {
        const id = unpackHmId(c.source)
        if (!id) return null
        return `${id.uid}/${id.path}`
      })
      .filter(Boolean) as Array<string>

    const res = await grpcClient.comments.batchGetComments({
      ids: commentIds,
    })

    const authorAccounts = new Set<string>()

    const comments = res.comments
      .sort((a, b) => {
        const aTime =
          a?.updateTime && typeof a?.updateTime == 'string'
            ? new Date(a?.updateTime).getTime()
            : 0
        const bTime =
          b?.updateTime && typeof b?.updateTime == 'string'
            ? new Date(b?.updateTime).getTime()
            : 1
        return aTime - bTime // Newest first (descending order)
      })
      .map((c) => {
        if (c.author && c.author.trim() !== '') {
          authorAccounts.add(c.author)
        }
        return c.toJson({emitDefaultValues: true})
      }) as Array<HMComment>

    const authorAccountUids = Array.from(authorAccounts)
    const authors = await getCommentsAuthors(authorAccountUids)

    return {
      comments,
      authors,
    }
  }
}
