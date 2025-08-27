import {grpcClient} from '@/client'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {
  BIG_INT,
  getCommentGroups,
  hmId,
  hmIdPathToEntityQueryPath,
  unpackHmId,
} from '@shm/shared'
import {
  HMAccount,
  HMAccountsMetadata,
  HMComment,
  HMCommentGroup,
  HMMetadataPayload,
} from '@shm/shared/hm-types'

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
    const _accounts = await grpcClient.documents.batchGetAccounts({
      ids: authorAccountUids,
    })

    if (!_accounts?.accounts) {
      throw new Error('No accounts found')
    }

    const authors: Record<string, HMMetadataPayload> = {}

    Object.entries(_accounts.accounts).forEach(([id, account]) => {
      let metadata = (
        account.toJson({emitDefaultValues: true}) as unknown as HMAccount
      )?.metadata

      if (metadata) {
        authors[id] = {id: hmId(id), metadata}
      }
    })

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
