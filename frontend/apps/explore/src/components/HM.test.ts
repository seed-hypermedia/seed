import {HMComment} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it, vi} from 'vitest'
import {getTabSearchParams} from './Tabs'

describe('getTabSearchParams', () => {
  it('preserves existing params when switching tabs', () => {
    const nextParams = getTabSearchParams(new URLSearchParams('tab=document&v=bafy123&foo=bar'), 'versions')

    expect(nextParams.get('tab')).toBe('versions')
    expect(nextParams.get('v')).toBe('bafy123')
    expect(nextParams.get('foo')).toBe('bar')
  })
})

function createComment(id: string, replyParent?: string): HMComment {
  return {
    id,
    version: `${id}-version`,
    author: 'zAuthor',
    targetAccount: 'zTarget',
    targetPath: '/notes/thread',
    targetVersion: 'zTargetVersion',
    replyParent,
    content: [],
    createTime: '2026-01-01T00:00:00Z',
    updateTime: '2026-01-01T00:00:00Z',
    visibility: 'PUBLIC',
  }
}

describe('getReplyComments', () => {
  it('returns direct and nested replies for the selected comment', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    })

    const {getReplyComments} = await import('./HM')
    const comments = [
      createComment('root'),
      createComment('direct-reply', 'root'),
      createComment('unrelated-root'),
      createComment('nested-reply', 'direct-reply'),
      createComment('other-thread-reply', 'unrelated-root'),
      createComment('second-direct-reply', 'root'),
    ]

    expect(getReplyComments(comments, 'root').map((comment) => comment.id)).toEqual([
      'direct-reply',
      'nested-reply',
      'second-direct-reply',
    ])

    vi.unstubAllGlobals()
  })
})
