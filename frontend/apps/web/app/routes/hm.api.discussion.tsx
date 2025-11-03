import {grpcClient} from '@/client.server'
import {wrapJSON, WrappedResponse} from '@/wrapping.server'
import {Params} from '@remix-run/react'
import {
  getCommentGroups,
  hmId,
  hmIdPathToEntityQueryPath,
  unpackHmId,
} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'
import {
  HMAccount,
  HMAccountsMetadata,
  HMComment,
  HMCommentGroup,
  HMMetadataPayload,
} from '@shm/shared/hm-types'
import {createBatchAccountsResolver} from '@shm/shared/models/entity'

const loadBatchAccounts = createBatchAccountsResolver(grpcClient)

export type HMDiscussionPayload = {
  commentGroups: HMCommentGroup[]
  authors: HMAccountsMetadata
  thread: HMComment[]
}

export const loader = async ({
  request,
  params,
}: {
  request: Request
  params: Params
}): Promise<WrappedResponse<HMDiscussionPayload>> => {
  const url = new URL(request.url)
  const targetId = unpackHmId(url.searchParams.get('targetId') || undefined)
  const commentId = url.searchParams.get('commentId')
  if (!targetId) throw new Error('targetId is required')
  if (!commentId) throw new Error('commentId is required')

  let result: HMDiscussionPayload | {error: string}
  try {
    const data = await grpcClient.comments.listComments({
      targetAccount: targetId.uid,
      targetPath: hmIdPathToEntityQueryPath(targetId.path),
      pageSize: BIG_INT,
    })

    const allComments = data.comments.map(
      (comment) => comment.toJson({emitDefaultValues: true}) as HMComment,
    )

    const commentGroups = getCommentGroups(allComments, commentId)

    const focusedComment = allComments.find((c) => c.id === commentId) || null

    if (!focusedComment) throw new Error('comment not found')
    let thread: HMComment[] = []
    thread = [focusedComment]
    let selectedComment = focusedComment
    while (selectedComment?.replyParent) {
      const parentComment =
        allComments.find((c) => c.id == selectedComment.replyParent) || null
      if (!parentComment) break
      thread.unshift(parentComment)
      selectedComment = parentComment
    }

    const authorAccounts = new Set<string>()
    // add all authors from the thread
    thread.forEach((comment) => {
      if (comment.author) authorAccounts.add(comment.author)
    })
    // add all authors from the comment groups
    commentGroups.forEach((group) => {
      group.comments.forEach((comment) => {
        authorAccounts.add(comment.author)
      })
    })

    const authorAccountUids = Array.from(authorAccounts)
    const authors = await loadBatchAccounts(authorAccountUids)

    result = {
      thread,
      commentGroups: commentGroups,
      authors,
    } satisfies HMDiscussionPayload
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
