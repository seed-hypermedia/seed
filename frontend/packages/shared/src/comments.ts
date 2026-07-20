import {useMemo} from 'react'
import {HMBlockNode, HMComment, HMCommentGroup} from '@seed-hypermedia/client/hm-types'

/**
 * Removes trailing empty blocks from comment content before publishing.
 * The editor always keeps a trailing empty paragraph for UX, but we
 * don't want to publish it.
 */
export function trimTrailingEmptyBlocks(blocks: HMBlockNode[]): HMBlockNode[] {
  let end = blocks.length
  while (end > 0) {
    const node = blocks[end - 1]!
    if (!isEmptyBlockNode(node)) break
    end--
  }
  return blocks.slice(0, end)
}

function isEmptyBlockNode(node: HMBlockNode): boolean {
  const {block, children} = node
  if (children && children.length > 0) return false
  if (block.type !== 'Paragraph' && block.type !== 'Heading') return false
  return !block.text || block.text.trim() === ''
}

export function getCommentGroups(comments?: Array<HMComment>, targetCommentId?: string): HMCommentGroup[] {
  const groups: HMCommentGroup[] = []

  if (!comments) return groups

  comments?.forEach((comment) => {
    if (comment.replyParent === targetCommentId || (!targetCommentId && comment.replyParent === '')) {
      groups.push({
        comments: [comment],
        moreCommentsCount: 0,
        id: comment.id,
        type: 'commentGroup',
      })
    }
  })

  const commentTime = (c: HMComment | undefined): number => {
    if (!c?.updateTime || typeof c.updateTime !== 'string') return 0
    const t = new Date(c.updateTime).getTime()
    return Number.isFinite(t) ? t : 0
  }
  const byId = new Map(comments.map((c) => [c.id, c]))

  // Latest activity per group across the WHOLE thread — the linear chain plus
  // every branched reply behind moreCommentsCount. Sorting by the chain alone
  // pins a thread in place when someone replies deep in a branch, so fresh
  // activity was invisible in the list order.
  const latestActivity = new Map<string, number>()

  groups.forEach((group) => {
    // @ts-ignore
    let comment: HMComment | null = group.comments[0]

    while (comment) {
      const nextComments = comments?.filter((c) => c.replyParent === comment?.id)

      if (nextComments?.length === 1) {
        // @ts-ignore
        comment = nextComments[0]
        // @ts-ignore
        group.comments.push(comment)
      } else {
        comment = null
      }
    }

    let latest = Math.max(0, ...group.comments.map(commentTime))

    const lastGroupComment = group.comments.at(-1)
    if (lastGroupComment && comments) {
      const moreComments = new Set<string>()
      let walkMoreCommentIds = new Set<string>([lastGroupComment.id])
      while (walkMoreCommentIds.size) {
        walkMoreCommentIds.forEach((commentId) => moreComments.add(commentId))
        walkMoreCommentIds = new Set<string>(
          comments.filter((c) => c.replyParent && walkMoreCommentIds.has(c.replyParent)).map((comment) => comment.id),
        )
      }

      group.moreCommentsCount = moreComments.size - 1
      moreComments.forEach((id) => {
        latest = Math.max(latest, commentTime(byId.get(id)))
      })
    }

    latestActivity.set(group.id, latest)
  })

  // Sort groups by latest thread activity (newest first).
  return groups.sort((a, b) => (latestActivity.get(b.id) ?? 0) - (latestActivity.get(a.id) ?? 0))
}

export function useCommentParents(comments: Array<HMComment> | undefined, focusedCommentId: string) {
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

export function useCommentGroups(comments?: Array<HMComment>, targetCommentId?: string) {
  // we are using the data object here for future migration to react-query
  return useMemo(
    () => ({
      data: getCommentGroups(comments, targetCommentId),
    }),
    [comments, targetCommentId],
  )
}
