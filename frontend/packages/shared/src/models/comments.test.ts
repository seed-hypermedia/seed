import {describe, expect, it} from 'vitest'
import type {HMComment} from '@seed-hypermedia/client/hm-types'
import {getMentionThreadContext} from './comments'

function comment(id: string, author: string, threadRoot?: string, seconds = 1): HMComment {
  return {
    id,
    author,
    version: id + '-v2',
    threadRoot,
    threadRootVersion: threadRoot ? threadRoot + '-v1' : undefined,
    targetAccount: 'site',
    targetVersion: 'v1',
    content: [],
    visibility: 'PUBLIC',
    createTime: {seconds, nanos: 0},
    updateTime: {seconds, nanos: 0},
  }
}

describe('reply mention context', () => {
  const comments = [
    comment('root', 'alice'),
    comment('reply', 'bob', 'root', 2),
    comment('nested', 'bob', 'root', 3),
    comment('other', 'eve'),
  ]
  it('includes only the current thread, deduplicates authors, and identifies the direct reply author', () => {
    expect(getMentionThreadContext(comments, {replyCommentId: 'reply'})).toEqual({
      replyAuthorUid: 'bob',
      participants: [
        {uid: 'alice', isThreadAuthor: true, latestCommentTime: 1000},
        {uid: 'bob', isThreadAuthor: false, latestCommentTime: 3000},
      ],
    })
  })
  it('resolves replies by version when no comment ID was passed', () => {
    expect(getMentionThreadContext(comments, {replyCommentVersion: 'reply-v2'})?.replyAuthorUid).toBe('bob')
  })
  it('does not boost document authors or unrelated comments outside a reply', () => {
    expect(getMentionThreadContext(comments, {})).toBeUndefined()
    expect(getMentionThreadContext(comments, {replyCommentId: 'missing'})).toBeUndefined()
  })
  it('uses a known root version when the reply parent has not loaded', () => {
    expect(
      getMentionThreadContext(comments, {rootReplyCommentVersion: 'root-v1'})?.participants?.map((p) => p.uid),
    ).toEqual(['alice', 'bob'])
  })
})
