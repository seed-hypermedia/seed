import {describe, expect, it} from 'vitest'
import {extractAllContentRefs, hasQueryBlockTargetingSelf} from '../content'
import {HMBlockNode} from '../hm-types'

function makeBlock(block: any, children?: HMBlockNode[]): HMBlockNode {
  return {block, children}
}

describe('extractAllContentRefs', () => {
  it('returns empty for empty content', () => {
    expect(extractAllContentRefs([])).toEqual([])
  })

  it('extracts Embed block refs', () => {
    const blocks: HMBlockNode[] = [
      makeBlock({
        type: 'Embed',
        id: 'b1',
        link: 'hm://abc123/child-doc',
        attributes: {},
      }),
    ]
    const refs = extractAllContentRefs(blocks)
    expect(refs).toHaveLength(1)
    expect(refs[0]!.blockId).toBe('b1')
    expect(refs[0]!.link).toBe('hm://abc123/child-doc')
    expect(refs[0]!.refId.uid).toBe('abc123')
    expect(refs[0]!.refId.path).toEqual(['child-doc'])
  })

  it('extracts inline Embed annotation refs', () => {
    const blocks: HMBlockNode[] = [
      makeBlock({
        type: 'Paragraph',
        id: 'p1',
        text: 'hello world',
        annotations: [
          {type: 'Embed', link: 'hm://uid1/doc-a', starts: [0], ends: [5]},
        ],
      }),
    ]
    const refs = extractAllContentRefs(blocks)
    expect(refs).toHaveLength(1)
    expect(refs[0]!.link).toBe('hm://uid1/doc-a')
    expect(refs[0]!.refId.uid).toBe('uid1')
  })

  it('extracts inline Link annotation refs with hm:// URLs', () => {
    const blocks: HMBlockNode[] = [
      makeBlock({
        type: 'Paragraph',
        id: 'p1',
        text: 'click here',
        annotations: [
          {type: 'Link', link: 'hm://uid2/linked-doc', starts: [0], ends: [10]},
        ],
      }),
    ]
    const refs = extractAllContentRefs(blocks)
    expect(refs).toHaveLength(1)
    expect(refs[0]!.link).toBe('hm://uid2/linked-doc')
    expect(refs[0]!.refId.uid).toBe('uid2')
  })

  it('ignores Link annotations with non-hm:// URLs', () => {
    const blocks: HMBlockNode[] = [
      makeBlock({
        type: 'Paragraph',
        id: 'p1',
        text: 'external',
        annotations: [
          {type: 'Link', link: 'https://example.com', starts: [0], ends: [8]},
        ],
      }),
    ]
    const refs = extractAllContentRefs(blocks)
    expect(refs).toHaveLength(0)
  })

  it('extracts refs from nested children blocks', () => {
    const blocks: HMBlockNode[] = [
      makeBlock({type: 'Paragraph', id: 'p1', text: 'parent'}, [
        makeBlock({
          type: 'Embed',
          id: 'e1',
          link: 'hm://uid3/nested-doc',
          attributes: {},
        }),
      ]),
    ]
    const refs = extractAllContentRefs(blocks)
    expect(refs).toHaveLength(1)
    expect(refs[0]!.refId.path).toEqual(['nested-doc'])
  })

  it('extracts multiple ref types from same content', () => {
    const blocks: HMBlockNode[] = [
      makeBlock({
        type: 'Embed',
        id: 'e1',
        link: 'hm://uid/doc-a',
        attributes: {},
      }),
      makeBlock({
        type: 'Paragraph',
        id: 'p1',
        text: 'text',
        annotations: [
          {type: 'Embed', link: 'hm://uid/doc-b', starts: [0], ends: [4]},
          {type: 'Link', link: 'hm://uid/doc-c', starts: [0], ends: [4]},
        ],
      }),
    ]
    const refs = extractAllContentRefs(blocks)
    expect(refs).toHaveLength(3)
    const links = refs.map((r) => r.link).sort()
    expect(links).toEqual([
      'hm://uid/doc-a',
      'hm://uid/doc-b',
      'hm://uid/doc-c',
    ])
  })

  it('ignores blocks without links', () => {
    const blocks: HMBlockNode[] = [
      makeBlock({type: 'Paragraph', id: 'p1', text: 'just text'}),
      makeBlock({type: 'Heading', id: 'h1', text: 'title'}),
    ]
    const refs = extractAllContentRefs(blocks)
    expect(refs).toHaveLength(0)
  })
})

describe('hasQueryBlockTargetingSelf', () => {
  it('returns false for empty content', () => {
    expect(hasQueryBlockTargetingSelf([], 'uid', ['path'])).toBe(false)
  })

  it('returns false when no Query blocks exist', () => {
    const blocks: HMBlockNode[] = [
      makeBlock({type: 'Paragraph', id: 'p1', text: 'hello'}),
    ]
    expect(hasQueryBlockTargetingSelf(blocks, 'uid', ['path'])).toBe(false)
  })

  it('returns true when Query block targets same uid and path', () => {
    const blocks: HMBlockNode[] = [
      makeBlock({
        type: 'Query',
        id: 'q1',
        attributes: {
          query: {
            includes: [{space: 'myuid', path: 'my/path', mode: 'Children'}],
          },
        },
      }),
    ]
    expect(hasQueryBlockTargetingSelf(blocks, 'myuid', ['my', 'path'])).toBe(
      true,
    )
  })

  it('returns true for root doc with empty path Query', () => {
    const blocks: HMBlockNode[] = [
      makeBlock({
        type: 'Query',
        id: 'q1',
        attributes: {
          query: {
            includes: [{space: 'uid1', path: '', mode: 'Children'}],
          },
        },
      }),
    ]
    expect(hasQueryBlockTargetingSelf(blocks, 'uid1', null)).toBe(true)
    expect(hasQueryBlockTargetingSelf(blocks, 'uid1', [])).toBe(true)
  })

  it('returns false when Query targets different uid', () => {
    const blocks: HMBlockNode[] = [
      makeBlock({
        type: 'Query',
        id: 'q1',
        attributes: {
          query: {
            includes: [{space: 'other-uid', path: 'path', mode: 'Children'}],
          },
        },
      }),
    ]
    expect(hasQueryBlockTargetingSelf(blocks, 'myuid', ['path'])).toBe(false)
  })

  it('returns false when Query targets different path', () => {
    const blocks: HMBlockNode[] = [
      makeBlock({
        type: 'Query',
        id: 'q1',
        attributes: {
          query: {
            includes: [{space: 'uid1', path: 'other/path', mode: 'Children'}],
          },
        },
      }),
    ]
    expect(hasQueryBlockTargetingSelf(blocks, 'uid1', ['my', 'path'])).toBe(
      false,
    )
  })

  it('detects Query block in nested children', () => {
    const blocks: HMBlockNode[] = [
      makeBlock({type: 'Paragraph', id: 'p1', text: 'parent'}, [
        makeBlock({
          type: 'Query',
          id: 'q1',
          attributes: {
            query: {
              includes: [{space: 'uid1', path: '', mode: 'Children'}],
            },
          },
        }),
      ]),
    ]
    expect(hasQueryBlockTargetingSelf(blocks, 'uid1', null)).toBe(true)
  })
})
