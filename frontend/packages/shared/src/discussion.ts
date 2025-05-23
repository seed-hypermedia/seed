import {useMemo} from 'react'
import {HMComment, HMCommentGroup} from '.'

export function getCommentGroups(
  comments?: Array<HMComment>,
  targetCommentId?: string,
): HMCommentGroup[] {
  const groups: HMCommentGroup[] = []
  if (!comments) return groups
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

export function useCommentParents(
  comments: Array<HMComment> | undefined,
  focusedCommentId: string,
) {
  return useMemo(() => {
    const focusedComment = comments?.find((c) => c.id === focusedCommentId)
    if (!focusedComment) return null
    let selectedComment: HMComment | null = focusedComment
    const parentThread: HMComment[] = [focusedComment]
    while (selectedComment?.replyParent) {
      const parentComment: HMComment | null | undefined = selectedComment
        ? comments?.find((c) => c.id === selectedComment?.replyParent)
        : null
      if (!parentComment) {
        selectedComment = null
        break
      }
      parentThread.unshift(parentComment)
      selectedComment = parentComment
    }
    return parentThread
  }, [comments, focusedCommentId])
}

export function useCommentGroups(
  comments?: Array<HMComment>,
  targetCommentId?: string,
) {
  // we are using the data object here for future migration to react-query
  return useMemo(
    () => ({
      data: getCommentGroups(comments, targetCommentId),
    }),
    [comments, targetCommentId],
  )
}
