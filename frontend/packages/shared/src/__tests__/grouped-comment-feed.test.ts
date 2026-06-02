import {describe, expect, it} from 'vitest'
import {hmId} from '../utils/entity-id-url'
import {groupCommentFeedEvents} from '../grouped-comment-feed'
import {LoadedEventWithNotifMeta} from '../models/activity-service'

function createCommentEvent({
  id,
  version,
  targetPath = '/doc',
  eventAtMs,
  threadRoot,
  threadRootVersion,
}: {
  id: string
  version: string
  targetPath?: string
  eventAtMs: number
  threadRoot?: string
  threadRootVersion?: string
}): LoadedEventWithNotifMeta {
  return {
    type: 'comment',
    id: `cid-${id}`,
    feedEventId: `feed-${id}`,
    eventAtMs,
    time: new Date(eventAtMs).toISOString() as any,
    author: {id: hmId('author-a'), metadata: {name: 'Author A'}},
    replyParentAuthor: null,
    replyingComment: null,
    replyCount: 0,
    commentId: hmId('author-a', {path: [id.split('/')[1]!], version}),
    target: {
      id: hmId('target-a', {path: targetPath.replace(/^\//, '').split('/').filter(Boolean)}),
      metadata: {name: 'Target Doc'},
    },
    comment: {
      id,
      version,
      author: 'author-a',
      targetAccount: 'target-a',
      targetPath,
      targetVersion: 'doc-version',
      replyParent: '',
      content: [],
      createTime: new Date(eventAtMs).toISOString() as any,
      updateTime: new Date(eventAtMs).toISOString() as any,
      visibility: 'PUBLIC',
      ...(threadRoot ? {threadRoot} : {}),
      ...(threadRootVersion ? {threadRootVersion} : {}),
    },
  }
}

describe('groupCommentFeedEvents', () => {
  it('filters out non-comment events', () => {
    const groups = groupCommentFeedEvents([
      {
        type: 'doc-update',
        id: 'doc-update-1',
        feedEventId: 'feed-doc-update-1',
        eventAtMs: 10,
        time: new Date(10).toISOString() as any,
        author: {id: hmId('author-a'), metadata: {name: 'Author A'}},
        docId: hmId('target-a', {path: ['doc']}),
        document: {
          version: 'doc-v1',
          authors: [],
          content: [],
          account: 'target-a',
          path: '/doc',
          createTime: new Date(10).toISOString() as any,
          updateTime: new Date(10).toISOString() as any,
          metadata: {name: 'Target Doc'},
          genesis: 'genesis',
          visibility: 'PUBLIC',
        },
      } as LoadedEventWithNotifMeta,
      createCommentEvent({id: 'author-a/root-1', version: 'root-v1', eventAtMs: 20}),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]?.threadRootId).toBe('author-a/root-1')
  })

  it('groups replies under the true thread root and tracks the latest reply separately', () => {
    const rootId = 'author-a/root-1'
    const groups = groupCommentFeedEvents([
      createCommentEvent({id: 'author-a/reply-2', version: 'reply-v2', eventAtMs: 200, threadRoot: rootId, threadRootVersion: 'root-v1'}),
      createCommentEvent({id: rootId, version: 'root-v1', eventAtMs: 100}),
      createCommentEvent({id: 'author-a/reply-1', version: 'reply-v1', eventAtMs: 150, threadRoot: rootId, threadRootVersion: 'root-v1'}),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      threadRootId: rootId,
      threadRootVersion: 'root-v1',
      eventCount: 3,
      latestEventAtMs: 200,
      rootCommentEvent: {comment: {id: rootId}},
      latestCommentEvent: {comment: {id: 'author-a/reply-2'}},
      latestReplyEvent: {comment: {id: 'author-a/reply-2'}},
    })
  })

  it('sorts grouped discussions by latest activity descending', () => {
    const groups = groupCommentFeedEvents([
      createCommentEvent({id: 'author-a/root-older', version: 'older-v1', eventAtMs: 10}),
      createCommentEvent({id: 'author-a/root-newer', version: 'newer-v1', eventAtMs: 100}),
    ])

    expect(groups.map((group) => group.threadRootId)).toEqual(['author-a/root-newer', 'author-a/root-older'])
  })

  it('keeps a discussion even when only a reply is visible in fetched feed pages', () => {
    const groups = groupCommentFeedEvents([
      createCommentEvent({
        id: 'author-a/reply-only',
        version: 'reply-v1',
        eventAtMs: 100,
        threadRoot: 'author-a/root-missing',
        threadRootVersion: 'root-missing-v1',
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      threadRootId: 'author-a/root-missing',
      threadRootVersion: 'root-missing-v1',
      rootCommentEvent: null,
      latestReplyEvent: {comment: {id: 'author-a/reply-only'}},
    })
  })
})
