import {HMComment, HMCommentGroup} from '.'

export function getCommentGroups(
  comments: HMComment[] | undefined,
  targetCommentId: string | null,
): HMCommentGroup[] {
  const groups: HMCommentGroup[] = []
  comments?.forEach((comment) => {
    if (
      comment.replyParent === targetCommentId ||
      (!targetCommentId && comment.replyParent === '')
    ) {
      groups.push({
        comments: [comment],
        moreCommentsCount: 0,
        id: comment.id,
        type: 'commentGroup',
      })
    }
  })
  groups.forEach((group) => {
    let comment: HMComment | null = group.comments[0]
    while (comment) {
      const nextComments = comments?.filter(
        (c) => c.replyParent === comment?.id,
      )
      if (nextComments?.length === 1) {
        comment = nextComments[0]
        group.comments.push(comment)
      } else {
        comment = null
      }
    }
    const lastGroupComment = group.comments.at(-1)
    if (!lastGroupComment || !comments) return
    const moreComments = new Set<string>()
    let walkMoreCommentIds = new Set<string>([lastGroupComment.id])
    while (walkMoreCommentIds.size) {
      walkMoreCommentIds.forEach((commentId) => moreComments.add(commentId))
      walkMoreCommentIds = new Set<string>(
        comments
          .filter((c) => c.replyParent && walkMoreCommentIds.has(c.replyParent))
          .map((comment) => comment.id),
      )
    }
    group.moreCommentsCount = moreComments.size - 1
  })
  return groups
}
