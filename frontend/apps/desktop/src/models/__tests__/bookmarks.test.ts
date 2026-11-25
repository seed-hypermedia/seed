import {describe, expect, it, vi} from 'vitest'

vi.mock('@/trpc', () => ({client: {}}))

import {bookmarkItemsFromStored} from '../bookmarks'

describe('bookmarkItemsFromStored', () => {
  it('parses comment snapshot metadata without treating the comment as a document', () => {
    const [bookmark] = bookmarkItemsFromStored([
      {
        url: 'hm://alice/comment-tsid',
        title: 'A saved comment snapshot',
        commentId: 'alice/comment-tsid',
        targetUrl: 'hm://space/document',
        authorAccountId: 'alice',
      },
    ])

    expect(bookmark).toMatchObject({
      key: 'comment',
      title: 'A saved comment snapshot',
      commentId: 'alice/comment-tsid',
      targetId: {uid: 'space', path: ['document']},
      authorAccountId: 'alice',
    })
  })

  it("keeps a mounted agent's view so the bookmark reopens it", () => {
    expect(bookmarkItemsFromStored([{url: 'hm://space/helper/:session/s-1'}])[0]).toMatchObject({
      key: 'document',
      id: {uid: 'space', path: ['helper']},
      agentView: 'session',
      agentSessionId: 's-1',
    })
    expect(bookmarkItemsFromStored([{url: 'hm://space/helper/:memory?file=notes%2Ftodo.md'}])[0]).toMatchObject({
      agentView: 'memory',
      agentMemoryPath: 'notes/todo.md',
    })
    expect(bookmarkItemsFromStored([{url: 'hm://space/helper/:settings/prompt'}])[0]).toMatchObject({
      agentView: 'prompt',
    })
    expect(bookmarkItemsFromStored([{url: 'hm://space/document'}])[0]).not.toHaveProperty('agentView')
  })

  it('keeps existing URL-only bookmarks compatible', () => {
    expect(bookmarkItemsFromStored([{url: 'hm://space/document'}])[0]).toMatchObject({
      key: 'document',
      id: {uid: 'space', path: ['document']},
    })
  })
})
