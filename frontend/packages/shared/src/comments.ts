import {normalizeDate} from './utils/date'
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

/** Shows submitted roots before list refresh, without restoring acknowledged roots that were removed. */
export function getSubmittedCommentGroups(
  groups: HMCommentGroup[] | undefined,
  submittedRoots: HMComment[],
  acknowledgedRoots: ReadonlySet<string>,
): HMCommentGroup[] {
  const rootGroups = [...(groups ?? [])]
  for (const submittedRoot of submittedRoots) {
    const index = rootGroups.findIndex((group) => group.comments.some((comment) => comment.id === submittedRoot.id))
    if (index < 0 && acknowledgedRoots.has(submittedRoot.id)) continue
    const group =
      index >= 0
        ? rootGroups.splice(index, 1)[0]!
        : {id: submittedRoot.id, type: 'commentGroup' as const, comments: [submittedRoot], moreCommentsCount: 0}
    rootGroups.unshift(group)
  }
  return rootGroups
}

/** Resolves the root and all descendants, ordered by creation time, for a selected comment. */
export function getCommentThread(comments: HMComment[] | undefined, commentId: string) {
  const byId = new Map(comments?.map((comment) => [comment.id, comment]))
  let root = byId.get(commentId)
  if (!root) return null
  const visited = new Set<string>()
  while (root.replyParent) {
    if (visited.has(root.id)) return null
    visited.add(root.id)
    const parent = byId.get(root.replyParent)
    if (!parent) {
      root = byId.get(root.threadRoot || '') ?? root
      break
    }
    root = parent
  }
  const rootId = root.id
  const descendants = new Set([rootId])
  // threadRoot also keeps replies visible when an intermediate parent was deleted.
  for (const comment of comments ?? []) {
    if (comment.threadRoot === rootId) descendants.add(comment.id)
  }
  let changed = true
  while (changed) {
    changed = false
    for (const comment of comments ?? []) {
      if (comment.replyParent && descendants.has(comment.replyParent) && !descendants.has(comment.id)) {
        descendants.add(comment.id)
        changed = true
      }
    }
  }
  const replies = (comments ?? []).filter((comment) => comment.id !== rootId && descendants.has(comment.id))
  replies.sort(
    (a, b) =>
      (normalizeDate(a.createTime)?.getTime() ?? 0) - (normalizeDate(b.createTime)?.getTime() ?? 0) ||
      a.id.localeCompare(b.id),
  )
  return {root, replies}
}
