import {describe, expect, it} from 'bun:test'
import {buildReplyTarget, classifyEvent, extractBlockId, findMentionTargets, mentionsAccount, stripFragment} from './mentions.js'

const KM = 'z6MkAgentAccount'

describe('findMentionTargets', () => {
  it('extracts hm:// from @[Name](hm://...) syntax', () => {
    expect(findMentionTargets('hi @[Bot](hm://z6MkAgentAccount) what is X?')).toEqual(['z6MkAgentAccount'])
  })

  it('handles multiple mentions', () => {
    const t = '@[A](hm://z6MkA) and @[B](hm://z6MkB)'
    expect(findMentionTargets(t)).toEqual(['z6MkA', 'z6MkB'])
  })

  it('returns empty on plain text', () => {
    expect(findMentionTargets('plain text')).toEqual([])
  })
})

describe('classifyEvent — comment mention', () => {
  it('matches and returns kind=comment', () => {
    const m = classifyEvent(
      {
        comment: {
          id: 'bafyComment1',
          target: 'hm://z6MkSite/some/doc',
          body: '@[KM](hm://z6MkAgentAccount) hi',
          author: 'z6MkAuthor',
          time: '2026-05-05T00:00:00Z',
        },
      },
      KM,
    )
    expect(m).not.toBeNull()
    expect(m?.kind).toBe('comment')
    expect(m?.docId).toBe('hm://z6MkSite/some/doc')
    expect(m?.commentId).toBe('bafyComment1')
    expect(m?.author).toBe('z6MkAuthor')
  })

  it('extracts blockId from target fragment', () => {
    const m = classifyEvent(
      {
        comment: {
          id: 'bafyComment2',
          target: 'hm://z6MkSite/some/doc#blk-abc',
          body: '@[KM](hm://z6MkAgentAccount) ?',
          author: 'z6MkAuthor',
        },
      },
      KM,
    )
    expect(m?.blockId).toBe('blk-abc')
  })

  it('returns null when mention is for a different account', () => {
    const m = classifyEvent(
      {
        comment: {
          id: 'bafy3',
          target: 'hm://z6MkSite/some/doc',
          body: '@[Other](hm://z6MkOther) hi',
          author: 'z6MkAuthor',
        },
      },
      KM,
    )
    expect(m).toBeNull()
  })
})

describe('classifyEvent — document mention', () => {
  it('finds mention inside any block', () => {
    const m = classifyEvent(
      {
        document: {
          id: 'hm://z6MkSite/page',
          author: 'z6MkAuthor',
          blocks: [
            {id: 'blk1', text: 'intro'},
            {id: 'blk2', text: 'see also @[KM](hm://z6MkAgentAccount)'},
          ],
        },
      },
      KM,
    )
    expect(m).not.toBeNull()
    expect(m?.kind).toBe('doc-block')
    expect(m?.blockId).toBe('blk2')
    expect(m?.docId).toBe('hm://z6MkSite/page')
  })

  it('returns null without any mention block', () => {
    const m = classifyEvent({document: {id: 'hm://x', author: 'z6Mky', blocks: [{id: '1', text: 'plain'}]}}, KM)
    expect(m).toBeNull()
  })
})

describe('mentionsAccount / fragment helpers', () => {
  it('mentionsAccount', () => {
    expect(mentionsAccount('hi @[K](hm://z6Mkx)', 'z6Mkx')).toBe(true)
    expect(mentionsAccount('hi @[K](hm://z6Mkx)', 'z6Mky')).toBe(false)
  })
  it('extractBlockId', () => {
    expect(extractBlockId('hm://x/y#blk-1')).toBe('blk-1')
    expect(extractBlockId('hm://x/y')).toBeUndefined()
  })
  it('stripFragment', () => {
    expect(stripFragment('hm://x#blk')).toBe('hm://x')
  })
})

describe('buildReplyTarget', () => {
  it('threaded reply for comment mentions does NOT append the comment-internal blockId to the doc URL', () => {
    const r = buildReplyTarget({
      kind: 'comment',
      docId: 'hm://z6Mksite/doc',
      blockId: 'blk1', // belongs to the COMMENT, not the doc
      commentId: 'bafyc1',
      author: 'z6Mka',
      text: '...',
      ts: '',
    })
    expect(r.targetId).toBe('hm://z6Mksite/doc')
    expect(r.replyTo).toBe('bafyc1')
  })

  it('block-anchored top-level for doc mentions', () => {
    const r = buildReplyTarget({
      kind: 'doc-block',
      docId: 'hm://z6Mksite/doc',
      blockId: 'blk2',
      author: 'z6Mka',
      text: '...',
      ts: '',
    })
    expect(r.targetId).toBe('hm://z6Mksite/doc#blk2')
    expect(r.replyTo).toBeUndefined()
  })
})
