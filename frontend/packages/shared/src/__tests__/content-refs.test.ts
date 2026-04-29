import {describe, expect, it} from 'vitest'
import {
  extractAllContentRefs,
  findSelfQueryBlock,
  hasQueryBlockTargetingSelf,
  hasSelfQueryBlockInEditorContent,
} from '../content'
import {editorBlocksToHMBlockNodes} from '@seed-hypermedia/client/editorblock-to-hmblock'
import type {EditorBlock} from '@seed-hypermedia/client/editor-types'
import {HMBlockNode} from '@seed-hypermedia/client/hm-types'

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
        annotations: [{type: 'Embed', link: 'hm://uid1/doc-a', starts: [0], ends: [5]}],
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
        annotations: [{type: 'Link', link: 'hm://uid2/linked-doc', starts: [0], ends: [10]}],
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
        annotations: [{type: 'Link', link: 'https://example.com', starts: [0], ends: [8]}],
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
    expect(links).toEqual(['hm://uid/doc-a', 'hm://uid/doc-b', 'hm://uid/doc-c'])
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
    const blocks: HMBlockNode[] = [makeBlock({type: 'Paragraph', id: 'p1', text: 'hello'})]
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
    expect(hasQueryBlockTargetingSelf(blocks, 'myuid', ['my', 'path'])).toBe(true)
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
    expect(hasQueryBlockTargetingSelf(blocks, 'uid1', ['my', 'path'])).toBe(false)
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

describe('findSelfQueryBlock', () => {
  it('returns null for empty content', () => {
    expect(findSelfQueryBlock([], 'uid', ['path'])).toBeNull()
  })

  it('returns null when no Query blocks exist', () => {
    const blocks: HMBlockNode[] = [makeBlock({type: 'Paragraph', id: 'p1', text: 'hello'})]
    expect(findSelfQueryBlock(blocks, 'uid', ['path'])).toBeNull()
  })

  it('returns the block when Query targets same uid and path', () => {
    const queryBlock = {
      type: 'Query',
      id: 'q1',
      attributes: {
        query: {
          includes: [{space: 'myuid', path: 'my/path', mode: 'Children'}],
        },
      },
    }
    const blocks: HMBlockNode[] = [makeBlock(queryBlock)]
    const result = findSelfQueryBlock(blocks, 'myuid', ['my', 'path'])
    expect(result).not.toBeNull()
    expect(result!.id).toBe('q1')
  })

  it('returns the block for root doc with empty path', () => {
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
    expect(findSelfQueryBlock(blocks, 'uid1', null)).not.toBeNull()
    expect(findSelfQueryBlock(blocks, 'uid1', [])).not.toBeNull()
  })

  it('returns null when Query targets different uid', () => {
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
    expect(findSelfQueryBlock(blocks, 'myuid', ['path'])).toBeNull()
  })

  it('returns null when Query targets different path', () => {
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
    expect(findSelfQueryBlock(blocks, 'uid1', ['my', 'path'])).toBeNull()
  })

  it('returns the first match when multiple self-referential blocks exist', () => {
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
      makeBlock({
        type: 'Query',
        id: 'q2',
        attributes: {
          query: {
            includes: [{space: 'uid1', path: '', mode: 'AllDescendants'}],
          },
        },
      }),
    ]
    const result = findSelfQueryBlock(blocks, 'uid1', null)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('q1')
  })

  it('finds Query block in nested children', () => {
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
    const result = findSelfQueryBlock(blocks, 'uid1', null)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('q1')
  })
})

describe('hasSelfQueryBlockInEditorContent', () => {
  function queryBlock(props: {space: string; path: string; mode?: string}, id = 'q1') {
    return {
      id,
      type: 'query',
      props: {
        queryIncludes: JSON.stringify([{space: props.space, path: props.path, mode: props.mode || 'Children'}]),
      },
      content: [],
      children: [],
    }
  }

  it('returns false for empty input', () => {
    expect(hasSelfQueryBlockInEditorContent([], 'uid1', ['p'])).toBe(false)
    expect(hasSelfQueryBlockInEditorContent(null, 'uid1', ['p'])).toBe(false)
    expect(hasSelfQueryBlockInEditorContent(undefined, 'uid1', ['p'])).toBe(false)
  })

  it('returns false when no query blocks exist', () => {
    expect(
      hasSelfQueryBlockInEditorContent([{id: 'p1', type: 'paragraph', props: {}, content: [], children: []}], 'uid1', [
        'p',
      ]),
    ).toBe(false)
  })

  it('returns true when query targets same uid and path with leading slash', () => {
    const blocks = [queryBlock({space: 'uid1', path: '/my/doc'})]
    expect(hasSelfQueryBlockInEditorContent(blocks, 'uid1', ['my', 'doc'])).toBe(true)
  })

  it('returns true when query targets same uid and path without leading slash', () => {
    const blocks = [queryBlock({space: 'uid1', path: 'my/doc'})]
    expect(hasSelfQueryBlockInEditorContent(blocks, 'uid1', ['my', 'doc'])).toBe(true)
  })

  it('returns true for root doc with empty path', () => {
    const blocks = [queryBlock({space: 'uid1', path: ''})]
    expect(hasSelfQueryBlockInEditorContent(blocks, 'uid1', null)).toBe(true)
    expect(hasSelfQueryBlockInEditorContent(blocks, 'uid1', [])).toBe(true)
  })

  it('returns false when space mismatches', () => {
    const blocks = [queryBlock({space: 'other', path: 'my/doc'})]
    expect(hasSelfQueryBlockInEditorContent(blocks, 'uid1', ['my', 'doc'])).toBe(false)
  })

  it('returns false when path mismatches', () => {
    const blocks = [queryBlock({space: 'uid1', path: 'other/path'})]
    expect(hasSelfQueryBlockInEditorContent(blocks, 'uid1', ['my', 'doc'])).toBe(false)
  })

  it('returns false when query has empty space (unconfigured)', () => {
    const blocks = [queryBlock({space: '', path: ''})]
    expect(hasSelfQueryBlockInEditorContent(blocks, 'uid1', ['my', 'doc'])).toBe(false)
  })

  it('finds query block in nested children', () => {
    const blocks = [
      {
        id: 'g1',
        type: 'group',
        props: {},
        content: [],
        children: [queryBlock({space: 'uid1', path: 'my/doc'})],
      },
    ]
    expect(hasSelfQueryBlockInEditorContent(blocks, 'uid1', ['my', 'doc'])).toBe(true)
  })

  it('returns false on malformed queryIncludes JSON', () => {
    const blocks = [
      {
        id: 'q1',
        type: 'query',
        props: {queryIncludes: 'not-json'},
        content: [],
        children: [],
      },
    ]
    expect(hasSelfQueryBlockInEditorContent(blocks, 'uid1', ['my', 'doc'])).toBe(false)
  })

  it('uses default queryIncludes when missing (treated as empty space, not self)', () => {
    const blocks = [{id: 'q1', type: 'query', props: {}, content: [], children: []}]
    expect(hasSelfQueryBlockInEditorContent(blocks, 'uid1', ['my', 'doc'])).toBe(false)
  })

  it('matches when one of multiple includes targets self', () => {
    const blocks = [
      {
        id: 'q1',
        type: 'query',
        props: {
          queryIncludes: JSON.stringify([
            {space: 'other', path: 'foo', mode: 'Children'},
            {space: 'uid1', path: 'my/doc', mode: 'Children'},
          ]),
        },
        content: [],
        children: [],
      },
    ]
    expect(hasSelfQueryBlockInEditorContent(blocks, 'uid1', ['my', 'doc'])).toBe(true)
  })
})

// `UnreferencedDocuments` relies on `editorBlocksToHMBlockNodes` to convert
// in-memory draft content (BlockNote `EditorBlock[]`) into the published
// `HMBlockNode[]` shape so the existing ref/query extraction utilities work
// uniformly. These tests pin that conversion path.
describe('extractAllContentRefs from editor draft blocks', () => {
  it('extracts refs from embed blocks, link inlines, and inline-embeds', () => {
    const draftBlocks: EditorBlock[] = [
      {
        id: 'e1',
        type: 'embed',
        props: {view: 'Content', url: 'hm://uid1/embedded'},
        content: [],
        children: [],
      },
      {
        id: 'p1',
        type: 'paragraph',
        props: {},
        content: [
          {
            type: 'link',
            href: 'hm://uid1/linked',
            content: [{type: 'text', text: 'click', styles: {}}],
          },
        ],
        children: [],
      },
      {
        id: 'p2',
        type: 'paragraph',
        props: {},
        content: [{type: 'inline-embed', link: 'hm://uid1/mentioned', styles: {}}],
        children: [],
      },
    ]
    const refs = extractAllContentRefs(editorBlocksToHMBlockNodes(draftBlocks))
    const links = refs.map((r) => r.link).sort()
    expect(links).toEqual(['hm://uid1/embedded', 'hm://uid1/linked', 'hm://uid1/mentioned'])
  })

  it('extracts refs from nested children of editor blocks', () => {
    const draftBlocks: EditorBlock[] = [
      {
        id: 'p1',
        type: 'paragraph',
        props: {},
        content: [{type: 'text', text: 'parent', styles: {}}],
        children: [
          {
            id: 'e1',
            type: 'embed',
            props: {view: 'Content', url: 'hm://uid1/nested'},
            content: [],
            children: [],
          },
        ],
      },
    ]
    const refs = extractAllContentRefs(editorBlocksToHMBlockNodes(draftBlocks))
    expect(refs).toHaveLength(1)
    expect(refs[0]!.refId.path).toEqual(['nested'])
  })

  it('hasQueryBlockTargetingSelf detects a self-targeting Query block in a draft', () => {
    const draftBlocks: EditorBlock[] = [
      {
        id: 'q1',
        type: 'query',
        props: {
          style: 'List',
          queryIncludes: JSON.stringify([{space: 'uid1', path: '', mode: 'Children'}]),
        },
        content: [],
        children: [],
      },
    ]
    expect(hasQueryBlockTargetingSelf(editorBlocksToHMBlockNodes(draftBlocks), 'uid1', null)).toBe(true)
  })
})
