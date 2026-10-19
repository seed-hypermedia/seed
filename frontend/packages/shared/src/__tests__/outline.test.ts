import {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {getDraftMentionRefs, getDraftNodesOutline, getNodesOutline} from '../outline'

function getDraftOutline(blocks: any[], resolvedNames?: Record<string, string>) {
  return getDraftNodesOutline(blocks, undefined, undefined, resolvedNames)
}

describe('getDraftNodesOutline', () => {
  it('returns empty outline for empty content', () => {
    expect(getDraftOutline([])).toEqual([])
  })

  it('extracts headings from editor-format blocks', () => {
    // This simulates the format returned by editor.topLevelBlocks
    const blocks = [
      {
        id: 'block-1',
        type: 'heading',
        props: {level: '2'},
        content: [{type: 'text', text: 'Introduction', styles: {}}],
        children: [],
      },
      {
        id: 'block-2',
        type: 'paragraph',
        props: {},
        content: [{type: 'text', text: 'Some text', styles: {}}],
        children: [],
      },
      {
        id: 'block-3',
        type: 'heading',
        props: {level: '2'},
        content: [{type: 'text', text: 'Conclusion', styles: {}}],
        children: [],
      },
    ] as any

    const outline = getDraftOutline(blocks)
    expect(outline).toHaveLength(2)
    expect(outline[0]!.id).toBe('block-1')
    expect(outline[0]!.title).toBe('Introduction')
    expect(outline[1]!.id).toBe('block-3')
    expect(outline[1]!.title).toBe('Conclusion')
  })

  it('extracts headings nested inside non-heading blocks', () => {
    const blocks = [
      {
        id: 'block-1',
        type: 'paragraph',
        props: {},
        content: [{type: 'text', text: 'Intro', styles: {}}],
        children: [
          {
            id: 'block-2',
            type: 'heading',
            props: {level: '2'},
            content: [{type: 'text', text: 'Nested Heading', styles: {}}],
            children: [],
          },
        ],
      },
    ] as any

    const outline = getDraftOutline(blocks)
    expect(outline).toHaveLength(1)
    expect(outline[0]!.id).toBe('block-2')
    expect(outline[0]!.title).toBe('Nested Heading')
  })

  it('handles headings with children', () => {
    const blocks = [
      {
        id: 'h1',
        type: 'heading',
        props: {level: '1'},
        content: [{type: 'text', text: 'Parent Section', styles: {}}],
        children: [
          {
            id: 'h2',
            type: 'heading',
            props: {level: '2'},
            content: [{type: 'text', text: 'Child Section', styles: {}}],
            children: [],
          },
        ],
      },
    ] as any

    const outline = getDraftOutline(blocks)
    expect(outline).toHaveLength(1)
    expect(outline[0]!.title).toBe('Parent Section')
    expect(outline[0]!.children).toHaveLength(1)
    expect(outline[0]!.children![0]!.title).toBe('Child Section')
  })

  it('handles empty heading content', () => {
    const blocks = [
      {
        id: 'h1',
        type: 'heading',
        props: {level: '1'},
        content: [],
        children: [],
      },
    ] as any

    const outline = getDraftOutline(blocks)
    expect(outline).toHaveLength(1)
    expect(outline[0]!.title).toBeUndefined()
  })

  it('handles heading with mixed inline content (text + link)', () => {
    const blocks = [
      {
        id: 'h1',
        type: 'heading',
        props: {level: '1'},
        content: [
          {type: 'text', text: 'Hello ', styles: {}},
          {type: 'link', href: 'https://example.com', content: [{type: 'text', text: 'world', styles: {}}]},
          {type: 'text', text: '!', styles: {}},
        ],
        children: [],
      },
    ] as any

    const outline = getDraftOutline(blocks)
    expect(outline).toHaveLength(1)
    expect(outline[0]!.title).toBe('Hello world!')
  })

  it('uses link text for a heading that is entirely a link', () => {
    const blocks = [
      {
        id: 'h1',
        type: 'heading',
        props: {level: '1'},
        content: [
          {
            type: 'link',
            href: 'https://github.com/seed-hypermedia/seed/pull/1206',
            content: [{type: 'text', text: 'https://github.com/seed-hypermedia/seed/pull/1206', styles: {}}],
          },
        ],
        children: [],
      },
    ] as any

    const outline = getDraftOutline(blocks)
    expect(outline).toHaveLength(1)
    expect(outline[0]!.title).toBe('https://github.com/seed-hypermedia/seed/pull/1206')
  })

  it('replaces mentions with resolved names and drops unresolved ones', () => {
    const blocks = [
      {
        id: 'h1',
        type: 'heading',
        props: {level: '1'},
        content: [
          {type: 'text', text: 'Thanks ', styles: {}},
          {type: 'inline-embed', link: 'hm://alice', mentionKind: 'account', styles: {}},
          {type: 'text', text: '!', styles: {}},
        ],
        children: [],
      },
    ] as any

    expect(getDraftOutline(blocks, {'account:hm://alice': 'Alice'})[0]!.title).toBe('Thanks Alice!')
    expect(getDraftOutline(blocks)[0]!.title).toBe('Thanks !')
  })

  it('produces updated outline when blocks change (simulating editor updates)', () => {
    // Initial state: one heading
    const initialBlocks = [
      {
        id: 'h1',
        type: 'heading',
        props: {level: '1'},
        content: [{type: 'text', text: 'First Section', styles: {}}],
        children: [],
      },
    ] as any

    const outline1 = getDraftOutline(initialBlocks)
    expect(outline1).toHaveLength(1)

    // After edit: two headings
    const updatedBlocks = [
      ...initialBlocks,
      {
        id: 'h2',
        type: 'heading',
        props: {level: '1'},
        content: [{type: 'text', text: 'Second Section', styles: {}}],
        children: [],
      },
    ] as any

    const outline2 = getDraftOutline(updatedBlocks)
    expect(outline2).toHaveLength(2)
    expect(outline2[1]!.title).toBe('Second Section')
  })
})

describe('getDraftMentionRefs', () => {
  it('collects mentions from nested blocks and links', () => {
    const blocks = [
      {
        id: 'p1',
        type: 'paragraph',
        props: {},
        content: [{type: 'inline-embed', link: 'hm://alice', mentionKind: 'account', styles: {}}],
        children: [
          {
            id: 'h1',
            type: 'heading',
            props: {level: '2'},
            content: [
              {
                type: 'link',
                href: 'https://example.com',
                content: [{type: 'inline-embed', link: 'hm://site/doc', styles: {}}],
              },
            ],
            children: [],
          },
        ],
      },
      {id: 'img', type: 'image', props: {url: 'ipfs://x'}, content: [], children: []},
    ] as any

    expect(getDraftMentionRefs(blocks)).toEqual([
      {link: 'hm://alice', mentionKind: 'account'},
      {link: 'hm://site/doc', mentionKind: undefined},
    ])
  })
})

describe('getNodesOutline', () => {
  it('returns empty for empty content', () => {
    expect(getNodesOutline([])).toEqual([])
  })

  it('extracts Heading blocks', () => {
    const blocks: HMBlockNode[] = [
      {
        block: {id: 'b1', type: 'Heading', text: 'Title', attributes: {}},
        children: [],
      },
    ]
    const outline = getNodesOutline(blocks)
    expect(outline).toHaveLength(1)
    expect(outline[0]!.title).toBe('Title')
    expect(outline[0]!.id).toBe('b1')
  })

  it('replaces mentions after multi-unit characters with resolved names', () => {
    const blocks: HMBlockNode[] = [
      {
        block: {
          id: 'b1',
          type: 'Heading',
          text: '🌱 \uFFFC and \uFFFC',
          annotations: [
            {type: 'Embed', starts: [2], ends: [3], link: 'hm://alice', attributes: {mentionKind: 'account'}},
            {type: 'Embed', starts: [8], ends: [9], link: 'hm://site/doc'},
          ],
          attributes: {},
        },
        children: [],
      },
    ]
    const names = {'account:hm://alice': 'Alice', 'hm://site/doc': 'Roadmap'}
    expect(getNodesOutline(blocks, undefined, undefined, names)[0]!.title).toBe('🌱 Alice and Roadmap')
  })
})
