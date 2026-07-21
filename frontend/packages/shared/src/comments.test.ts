import {HMComment} from '@seed-hypermedia/client/hm-types'
import {describe, expect, test} from 'vitest'
import {getCommentGroups} from './comments'

// Only the fields getCommentGroups reads.
function comment(id: string, replyParent: string, updateTime: string): HMComment {
  return {id, replyParent, updateTime} as HMComment
}

describe('getCommentGroups', () => {
  // The shape from the field: a root with two branches. The linearized group
  // walk stops at the branch point, so everything behind it is only reachable
  // through moreCommentsCount.
  //
  //   root ─ a1 ─ a2 (branch A)
  //     └─── b1 ─ b2 (branch B)
  const branched = [
    comment('root', '', '2026-07-16T08:00:00Z'),
    comment('a1', 'root', '2026-07-17T08:00:00Z'),
    comment('a2', 'a1', '2026-07-17T09:00:00Z'),
    comment('b1', 'root', '2026-07-18T08:00:00Z'),
    comment('b2', 'b1', '2026-07-18T09:00:00Z'),
  ]

  test('branched thread linearizes to the root and counts every buried reply', () => {
    const groups = getCommentGroups(branched)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.comments.map((c) => c.id)).toEqual(['root'])
    expect(groups[0]!.moreCommentsCount).toBe(4)
  })

  test('a new deep branch reply increments moreCommentsCount', () => {
    const groups = getCommentGroups([...branched, comment('b3', 'b2', '2026-07-20T16:00:00Z')])
    expect(groups[0]!.moreCommentsCount).toBe(5)
  })

  test('a linear thread keeps its full chain and has no buried replies', () => {
    const groups = getCommentGroups([
      comment('root', '', '2026-07-16T08:00:00Z'),
      comment('r1', 'root', '2026-07-17T08:00:00Z'),
      comment('r2', 'r1', '2026-07-18T08:00:00Z'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.comments.map((c) => c.id)).toEqual(['root', 'r1', 'r2'])
    expect(groups[0]!.moreCommentsCount).toBe(0)
  })

  test('fresh activity deep in a branch floats its thread to the top', () => {
    const oldThread = [
      comment('old', '', '2026-07-01T08:00:00Z'),
      comment('old-a', 'old', '2026-07-02T08:00:00Z'),
      comment('old-b', 'old', '2026-07-02T09:00:00Z'),
    ]
    const newerThread = [comment('newer', '', '2026-07-10T08:00:00Z')]

    // Without the branch reply, the newer thread sorts first.
    expect(getCommentGroups([...oldThread, ...newerThread]).map((g) => g.id)).toEqual(['newer', 'old'])

    // A fresh reply buried in the old thread's branch must float it up, even
    // though the rendered chain (just the root) is untouched.
    const withFreshBranchReply = [...oldThread, ...newerThread, comment('old-b1', 'old-b', '2026-07-20T16:00:00Z')]
    expect(getCommentGroups(withFreshBranchReply).map((g) => g.id)).toEqual(['old', 'newer'])
  })
})
