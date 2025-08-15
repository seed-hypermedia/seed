import {useMemo} from 'react'
import {
  entityQueryPathToHmIdPath,
  HMComment,
  HMCommentGroup,
  hmId,
  UnpackedHypermediaId,
} from '.'

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
    // @ts-ignore
    let comment: HMComment | null = group.comments[0]
    while (comment) {
      const nextComments = comments?.filter(
        (c) => c.replyParent === comment?.id,
      )

      if (nextComments?.length === 1) {
        // @ts-ignore
        comment = nextComments[0]
        // @ts-ignore
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
        ? comments?.find((c) => c.id == selectedComment?.replyParent)
        : null
      if (!parentComment) break

      parentThread.unshift(parentComment)
      selectedComment = parentComment
    }

    const authorAccounts = new Set<string>()
    comments?.forEach((comment) => {
      if (comment.author) authorAccounts.add(comment.author)
    })

    return {
      thread: parentThread,
      authorAccounts: Array.from(authorAccounts),
    }
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

export function getCommentTargetId(
  comment: HMComment | undefined,
): UnpackedHypermediaId | undefined {
  if (!comment) return undefined
  return hmId(comment.targetAccount, {
    path: entityQueryPathToHmIdPath(comment.targetPath || ''),
    // we don't really want to reference the version here, because it tends to cause UX issues.
    // version: comment.targetVersion,
  })
}
