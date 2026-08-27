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

  it('keeps existing URL-only bookmarks compatible', () => {
    expect(bookmarkItemsFromStored([{url: 'hm://space/document'}])[0]).toMatchObject({
      key: 'document',
      id: {uid: 'space', path: ['document']},
    })
  })
})
