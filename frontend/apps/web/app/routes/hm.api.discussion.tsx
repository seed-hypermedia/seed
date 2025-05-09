import {queryClient} from '@/client'
import {getAccount} from '@/loaders'
import {wrapJSON, WrappedResponse} from '@/wrapping'
import {PlainMessage} from '@bufbuild/protobuf'
import {
  getCommentGroups,
  HMAccountsMetadata,
  HMComment,
  HMCommentGroup,
  hmIdPathToEntityQueryPath,
  ListDocumentsResponse,
  unpackHmId,
} from '@shm/shared'

export type HMDiscussion = PlainMessage<ListDocumentsResponse>

export type DiscussionPayload = {
  commentGroups?: HMCommentGroup[]
  commentAuthors?: HMAccountsMetadata
  error?: string
}

export const loader = async ({
  request,
}: {
  request: Request
}): Promise<WrappedResponse<DiscussionPayload>> => {
  const url = new URL(request.url)
  const id = unpackHmId(url.searchParams.get('id') || undefined)
  const targetCommentId = url.searchParams.get('targetCommentId')
  if (!id) throw new Error('id is required')
  let result: DiscussionPayload
  try {
    const targetAccount = id.uid
    const targetPath = hmIdPathToEntityQueryPath(id.path)
    // TODO: change this to use hm.api.comments
    const res = await queryClient.comments.listComments({
      targetAccount,
      targetPath,
    })
    const allComments = res.comments.map(
      (c) => c.toJson({emitDefaultValues: true}) as HMComment,
    )
    const commentGroups = getCommentGroups(allComments, targetCommentId || null)
    const commentGroupAuthors = new Set<string>()
    commentGroups.forEach((commentGroup) => {
      commentGroup.comments.forEach((comment) => {
        commentGroupAuthors.add(comment.author)
      })
    })
    const commentAuthors: HMAccountsMetadata = Object.fromEntries(
      await Promise.all(
        Array.from(commentGroupAuthors).map(async (authorUid) => {
          return [authorUid, await getAccount(authorUid)]
        }),
      ),
    )
    result = {
      commentGroups,
      commentAuthors,
    } satisfies DiscussionPayload
  } catch (e: any) {
    result = {error: e.message}
  }
  return wrapJSON(result)
}
