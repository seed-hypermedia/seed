import {describe, expect, it} from 'bun:test'
import {buildThreadReplyMention, detectThreadReplyToKm} from './mentions.js'
import type {SeedComment} from './mentions.js'

const KM = 'z6MkAgent'
const USER = 'z6MkUser'
const SITE = 'z6MkSite'

function makeComment(
  id: string,
  author: string,
  replyParent?: string,
  opts: {text?: string; targetPath?: string} = {},
): SeedComment {
  return {
    id,
    author,
    targetAccount: SITE,
    targetPath: opts.targetPath,
    replyParent,
    content: [{block: {id: 'b1', text: opts.text ?? 'hi'}}],
  }
}

describe('detectThreadReplyToKm', () => {
  it('returns hit when the direct parent is KM', async () => {
    const parent = makeComment('c-parent', KM)
    const cache = new Map<string, SeedComment | null>()
    const fetchComment = async (id: string) => (id === 'c-parent' ? parent : null)
    const child = makeComment('c-child', USER, 'c-parent')
    const result = await detectThreadReplyToKm({comment: child, kmAccountId: KM, fetchComment, cache})
    expect(result).toEqual({ancestorCommentId: 'c-parent'})
  })

  it('returns hit when KM is a transitive ancestor', async () => {
    const root = makeComment('c-root', KM)
    const mid = makeComment('c-mid', USER, 'c-root')
    const cache = new Map<string, SeedComment | null>()
    const fetchComment = async (id: string): Promise<SeedComment | null> => {
      if (id === 'c-root') return root
      if (id === 'c-mid') return mid
      return null
    }
    const child = makeComment('c-child', USER, 'c-mid')
    const result = await detectThreadReplyToKm({comment: child, kmAccountId: KM, fetchComment, cache})
    expect(result).toEqual({ancestorCommentId: 'c-root'})
  })

  it('returns null when no KM ancestor exists', async () => {
    const parent = makeComment('c-parent', USER)
    const cache = new Map<string, SeedComment | null>()
    const fetchComment = async (id: string) => (id === 'c-parent' ? parent : null)
    const child = makeComment('c-child', USER, 'c-parent')
    const result = await detectThreadReplyToKm({comment: child, kmAccountId: KM, fetchComment, cache})
    expect(result).toBeNull()
  })

  it('returns null when the comment has no replyParent', async () => {
    const cache = new Map<string, SeedComment | null>()
    const fetchComment = async () => null
    const orphan = makeComment('c-1', USER)
    const result = await detectThreadReplyToKm({comment: orphan, kmAccountId: KM, fetchComment, cache})
    expect(result).toBeNull()
  })

  it('caps the walk at maxHops', async () => {
    const cache = new Map<string, SeedComment | null>()
    let fetches = 0
    const fetchComment = async (id: string): Promise<SeedComment | null> => {
      fetches++
      const n = Number(id.split('-')[1])
      return makeComment(id, USER, `c-${n - 1}`)
    }
    const start = makeComment('c-100', USER, 'c-99')
    const result = await detectThreadReplyToKm({
      comment: start,
      kmAccountId: KM,
      fetchComment,
      cache,
      maxHops: 5,
    })
    expect(result).toBeNull()
    expect(fetches).toBeLessThanOrEqual(5)
  })

  it('does not infinite-loop on a reply cycle', async () => {
    const a = makeComment('c-a', USER, 'c-b')
    const b = makeComment('c-b', USER, 'c-a')
    const cache = new Map<string, SeedComment | null>()
    const fetchComment = async (id: string): Promise<SeedComment | null> => {
      if (id === 'c-a') return a
      if (id === 'c-b') return b
      return null
    }
    const result = await detectThreadReplyToKm({comment: a, kmAccountId: KM, fetchComment, cache})
    expect(result).toBeNull()
  })

  it('reuses the cache to avoid refetching shared ancestors', async () => {
    const parent = makeComment('c-parent', KM)
    let fetches = 0
    const cache = new Map<string, SeedComment | null>()
    const fetchComment = async (id: string): Promise<SeedComment | null> => {
      fetches++
      return id === 'c-parent' ? parent : null
    }
    const child1 = makeComment('c-1', USER, 'c-parent')
    const child2 = makeComment('c-2', USER, 'c-parent')
    await detectThreadReplyToKm({comment: child1, kmAccountId: KM, fetchComment, cache})
    await detectThreadReplyToKm({comment: child2, kmAccountId: KM, fetchComment, cache})
    expect(fetches).toBe(1)
  })

  it('stops when fetchComment returns null (parent unavailable)', async () => {
    const cache = new Map<string, SeedComment | null>()
    const fetchComment = async () => null
    const child = makeComment('c-child', USER, 'c-missing')
    const result = await detectThreadReplyToKm({comment: child, kmAccountId: KM, fetchComment, cache})
    expect(result).toBeNull()
  })
})

describe('buildThreadReplyMention', () => {
  it('concatenates all block texts and tags trigger source', () => {
    const c: SeedComment = {
      id: 'c1',
      author: USER,
      targetAccount: SITE,
      targetPath: '/page',
      content: [
        {block: {id: 'b1', text: 'line one'}},
        {block: {id: 'b2', text: 'line two'}},
      ],
    }
    const m = buildThreadReplyMention(c, '2026-05-11T00:00:00Z')
    expect(m.kind).toBe('comment')
    expect(m.commentId).toBe('c1')
    expect(m.author).toBe(USER)
    expect(m.docId).toBe(`hm://${SITE}/page`)
    expect(m.blockId).toBeUndefined()
    expect(m.triggerSource).toBe('thread-reply')
    expect(m.text).toBe('line one\nline two')
  })

  it('strips U+FFFC object-replacement characters', () => {
    const c: SeedComment = {
      id: 'c2',
      author: USER,
      targetAccount: SITE,
      content: [{block: {id: 'b1', text: 'hi ￼ there'}}],
    }
    const m = buildThreadReplyMention(c, 'ts')
    expect(m.text).toBe('hi   there')
  })

  it('renders docId without a path when targetPath is absent', () => {
    const c: SeedComment = {
      id: 'c3',
      author: USER,
      targetAccount: SITE,
      content: [{block: {id: 'b1', text: 'question'}}],
    }
    const m = buildThreadReplyMention(c, 'ts')
    expect(m.docId).toBe(`hm://${SITE}`)
  })
})
