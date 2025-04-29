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
  console.log(
    'getCommentGroups: Initial groups after filtering root comments:',
    groups,
  )

  groups.forEach((group) => {
    console.log(`Processing group with id ${group.id}`)
    let comment: HMComment | null = group.comments[0]
    while (comment) {
      const nextComments = comments?.filter(
        (c) => c.replyParent === comment?.id,
      )
      console.log(
        `Found ${nextComments?.length || 0} direct replies to comment ${
          comment.id
        }`,
      )

      if (nextComments?.length === 1) {
        comment = nextComments[0]
        group.comments.push(comment)
        console.log(
          `getCommentGroups: Added comment ${comment.id} to group ${group.id}`,
        )
      } else {
        comment = null
      }
    }

    const lastGroupComment = group.comments.at(-1)
    if (!lastGroupComment || !comments) return
    console.log(
      `getCommentGroups: Finding more comments for lastGroupComment: ${lastGroupComment.id}`,
    )

    const moreComments = new Set<string>()
    let walkMoreCommentIds = new Set<string>([lastGroupComment.id])
    while (walkMoreCommentIds.size) {
      walkMoreCommentIds.forEach((commentId) => moreComments.add(commentId))
      walkMoreCommentIds = new Set<string>(
        comments
          .filter((c) => c.replyParent && walkMoreCommentIds.has(c.replyParent))
          .map((comment) => comment.id),
      )
      console.log(
        'getCommentGroups: walkMoreCommentIds:',
        Array.from(walkMoreCommentIds),
      )
    }

    group.moreCommentsCount = moreComments.size - 1
    console.log(
      `getCommentGroups: Group ${group.id} moreCommentsCount: ${group.moreCommentsCount}`,
    )
  })

  console.log('Final groups:', groups)
  return groups
}
