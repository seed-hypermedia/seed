import {queryClient} from '@/client'
import {getAccount} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {Params} from '@remix-run/react'
import {BIG_INT, getCommentGroups, unpackHmId} from '@shm/shared'
import {
  HMAccountsMetadata,
  HMComment,
  HMCommentGroup,
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
    const res = await queryClient.entities.listEntityMentions({
      id: targetId.id,
      pageSize: BIG_INT,
    })

    const allComments: HMComment[] = []

    for (const mention of res.mentions) {
      try {
        const sourceId = unpackHmId(mention.source)
        if (!sourceId) continue
        if (sourceId.type !== 'c') continue
        const comment = await queryClient.comments.getComment({
          id: mention.sourceBlob?.cid,
        })
        if (!comment) continue
        allComments.push(comment.toJson({emitDefaultValues: true}) as HMComment)
      } catch (error) {
        console.error('=== comment error', error)
      }
    }

    const commentGroups = getCommentGroups(allComments, commentId)

    const focusedComment = allComments.find((c) => c.id === commentId) || null

    if (!focusedComment) throw new Error('comment not found')
    let thread: HMComment[] = []
    thread = [focusedComment]
    let selectedComment = focusedComment
    while (selectedComment?.replyParent) {
      const parentComment =
        allComments.find((c) => c.id === selectedComment.replyParent) || null
      if (!parentComment) break
      thread.unshift(parentComment)
      selectedComment = parentComment
    }

    const authorAccounts = new Set<string>()
    thread.forEach((comment) => {
      authorAccounts.add(comment.author)
    })
    commentGroups.forEach((group) => {
      group.comments.forEach((comment) => {
        authorAccounts.add(comment.author)
      })
    })

    const authorAccountUids = Array.from(authorAccounts)
    const accounts = await Promise.all(
      authorAccountUids.map(async (accountUid) => {
        return await getAccount(accountUid)
      }),
    )

    result = {
      thread,
      commentGroups: commentGroups,
      authors: Object.fromEntries(
        authorAccountUids.map((acctUid, idx) => [acctUid, accounts[idx]]),
      ),
    } satisfies HMDiscussionPayload
  } catch (e: any) {
    result = {error: e.message}
  }

  return wrapJSON(result)
}
