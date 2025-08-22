import {getAccount} from '@/models/entities'
import {
  BIG_INT,
  getCommentGroups,
  HMComment,
  HMMetadataPayload,
} from '@shm/shared'
import {
  CommentsService,
  ListCommentsByIdRequest,
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

        console.log(`== ~ getCommentsAuthors ~ account:`, account)
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
    console.log('== ~ CommentsService ~ listComments ~ params:', params)

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

  listCommentsById(
    params: ListCommentsByIdRequest,
  ): Promise<ListCommentsResponse> {
    throw new Error('Method not implemented.')
  }
}
