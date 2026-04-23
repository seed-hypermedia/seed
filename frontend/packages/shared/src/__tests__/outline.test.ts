import {describe, expect, it} from 'vitest'
import {getDraftNodesOutline, getNodesOutline} from '../outline'
import {HMBlockNode} from '@seed-hypermedia/client/hm-types'

describe('getDraftNodesOutline', () => {
  it('returns empty outline for empty content', () => {
    expect(getDraftNodesOutline([])).toEqual([])
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

    const outline = getDraftNodesOutline(blocks)
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

    const outline = getDraftNodesOutline(blocks)
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

    const outline = getDraftNodesOutline(blocks)
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

    const outline = getDraftNodesOutline(blocks)
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

    const outline = getDraftNodesOutline(blocks)
    expect(outline).toHaveLength(1)
    // Only text items are extracted, links are filtered out
    expect(outline[0]!.title).toBe('Hello !')
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

    const outline1 = getDraftNodesOutline(initialBlocks)
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

    const outline2 = getDraftNodesOutline(updatedBlocks)
    expect(outline2).toHaveLength(2)
    expect(outline2[1]!.title).toBe('Second Section')
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
})
