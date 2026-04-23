import {describe, it, expect} from 'vitest'
import {blocksToMarkdown} from '../src/blocks-to-markdown'
import {parseMarkdown, parseInlineFormatting, markdownBlockNodesToHMBlockNodes} from '../src/markdown-to-blocks'
import type {HMBlockNode, HMDocument} from '../src/hm-types'

function doc(content: HMBlockNode[]): HMDocument {
  return {
    account: 'test',
    path: '',
    version: 'v1',
    metadata: {},
    authors: [],
    content,
    createTime: {seconds: 0n, nanos: 0},
    updateTime: {seconds: 0n, nanos: 0},
    genesis: 'g1',
  } as unknown as HMDocument
}

function roundtrip(content: HMBlockNode[]): HMBlockNode[] {
  const md = blocksToMarkdown(doc(content))
  const {tree} = parseMarkdown(md)
  return markdownBlockNodesToHMBlockNodes(tree)
}

describe('markdown round-trip', () => {
  it('preserves sibling paragraph blocks under a heading', () => {
    const tree: HMBlockNode[] = [
      {
        block: {
          type: 'Heading',
          id: 'H1',
          text: 'Section',
          annotations: [],
          attributes: {childrenType: 'Group'},
          link: '',
          revision: '',
        },
        children: [
          {
            block: {
              type: 'Paragraph',
              id: 'P1',
              text: 'first child',
              annotations: [],
              attributes: {},
              link: '',
              revision: '',
            },
            children: [],
          },
          {
            block: {
              type: 'Paragraph',
              id: 'P2',
              text: 'second child',
              annotations: [],
              attributes: {},
              link: '',
              revision: '',
            },
            children: [],
          },
          {
            block: {
              type: 'Paragraph',
              id: 'P3',
              text: 'third child',
              annotations: [],
              attributes: {},
              link: '',
              revision: '',
            },
            children: [],
          },
        ],
      },
    ]

    const md = blocksToMarkdown(doc(tree))
    // Each paragraph is separated from the next by a blank line
    expect(md).toMatch(/first child <!-- id:P1 -->\n\n.*second child <!-- id:P2 -->\n\n.*third child <!-- id:P3 -->/)
    // No HTML-comment markers leaking into any text field after round-trip
    expect(md).not.toMatch(/--&gt;|&lt;!--/)

    const result = roundtrip(tree)
    expect(result).toHaveLength(1)
    const heading = result[0]!
    expect(heading.block.id).toBe('H1')
    expect(heading.children).toHaveLength(3)
    expect(heading.children![0]!.block.id).toBe('P1')
    expect(heading.children![1]!.block.id).toBe('P2')
    expect(heading.children![2]!.block.id).toBe('P3')
    expect(heading.children![0]!.block.text).toContain('first child')
    expect(heading.children![1]!.block.text).toContain('second child')
    expect(heading.children![2]!.block.text).toContain('third child')
  })

  it('serializes Embed annotations as CommonMark autolinks', () => {
    const tree: HMBlockNode[] = [
      {
        block: {
          type: 'Paragraph',
          id: 'P1',
          text: 'cc ￼',
          annotations: [
            {
              type: 'Embed',
              starts: [3],
              ends: [4],
              link: 'hm://z6Mktest/:profile',
              attributes: {},
            },
          ],
          attributes: {},
          link: '',
          revision: '',
        },
        children: [],
      },
    ]

    const md = blocksToMarkdown(doc(tree))
    expect(md).toContain('<hm://z6Mktest/:profile>')
    // No ￼ placeholder leaks into the markdown output
    expect(md).not.toContain('￼')
    // No `[↗ profile]` link-label remnants
    expect(md).not.toContain('↗')
  })

  it('parses autolinks as Embed annotations', () => {
    const {text, annotations} = parseInlineFormatting('cc <hm://z6Mktest/:profile>')
    expect(text).toBe('cc ￼')
    expect(annotations).toHaveLength(1)
    expect(annotations[0]!.type).toBe('Embed')
    expect(annotations[0]!.link).toBe('hm://z6Mktest/:profile')
    expect(annotations[0]!.starts).toEqual([3])
    expect(annotations[0]!.ends).toEqual([4])
  })

  it('keeps bracketed links as Link annotations (not Embed)', () => {
    const {text, annotations} = parseInlineFormatting('[Julio](hm://z6Mktest/:profile)')
    expect(text).toBe('Julio')
    expect(annotations).toHaveLength(1)
    expect(annotations[0]!.type).toBe('Link')
    expect(annotations[0]!.link).toBe('hm://z6Mktest/:profile')
  })

  it('round-trips Embed annotations without downgrading to Link', () => {
    const tree: HMBlockNode[] = [
      {
        block: {
          type: 'Paragraph',
          id: 'P1',
          text: 'cc ￼ ￼',
          annotations: [
            {
              type: 'Embed',
              starts: [3],
              ends: [4],
              link: 'hm://z6Mkone/:profile',
              attributes: {},
            },
            {
              type: 'Embed',
              starts: [5],
              ends: [6],
              link: 'hm://z6Mktwo/:profile',
              attributes: {},
            },
          ],
          attributes: {},
          link: '',
          revision: '',
        },
        children: [],
      },
    ]

    const result = roundtrip(tree)
    expect(result).toHaveLength(1)
    const block = result[0]!.block as {annotations: Array<{type: string; link?: string}>}
    const embedAnns = block.annotations.filter((a) => a.type === 'Embed')
    expect(embedAnns).toHaveLength(2)
    expect(embedAnns[0]!.link).toBe('hm://z6Mkone/:profile')
    expect(embedAnns[1]!.link).toBe('hm://z6Mktwo/:profile')
    // Must not have been downgraded to Link annotations
    const linkAnns = block.annotations.filter((a) => a.type === 'Link')
    expect(linkAnns).toHaveLength(0)
  })

  it('round-trips the full damage scenario — heading with children + inline embeds', () => {
    const tree: HMBlockNode[] = [
      {
        block: {
          type: 'Paragraph',
          id: 'intro',
          text: 'Discussion from PR. cc ￼ ￼',
          annotations: [
            {type: 'Embed', starts: [23], ends: [24], link: 'hm://a/:profile', attributes: {}},
            {type: 'Embed', starts: [25], ends: [26], link: 'hm://b/:profile', attributes: {}},
          ],
          attributes: {},
          link: '',
          revision: '',
        },
        children: [],
      },
      {
        block: {
          type: 'Heading',
          id: 'section',
          text: 'Agent Attribution',
          annotations: [],
          attributes: {childrenType: 'Group'},
          link: '',
          revision: '',
        },
        children: [
          {
            block: {
              type: 'Paragraph',
              id: 'julio1',
              text: 'Julio: opening thought',
              annotations: [{type: 'Bold', starts: [0], ends: [6], attributes: {}}],
              attributes: {},
              link: '',
              revision: '',
            },
            children: [],
          },
          {
            block: {
              type: 'Paragraph',
              id: 'eric1',
              text: 'Eric: response',
              annotations: [{type: 'Bold', starts: [0], ends: [5], attributes: {}}],
              attributes: {},
              link: '',
              revision: '',
            },
            children: [],
          },
        ],
      },
    ]

    const result = roundtrip(tree)
    // Top-level structure preserved
    expect(result).toHaveLength(2)
    expect(result[0]!.block.id).toBe('intro')
    expect(result[1]!.block.id).toBe('section')
    // Section children both survive, no merging
    expect(result[1]!.children).toHaveLength(2)
    expect(result[1]!.children![0]!.block.id).toBe('julio1')
    expect(result[1]!.children![1]!.block.id).toBe('eric1')
    // No HTML-comment markers leaking into any block's text
    const collect = (ns: HMBlockNode[]): string[] =>
      ns.flatMap((n) => [n.block.text || '', ...collect(n.children || [])])
    const allText = collect(result)
    for (const t of allText) {
      expect(t).not.toMatch(/<!--\s*id:/)
    }
    // Intro block still has 2 Embed annotations, not Links
    const introAnns = (result[0]!.block as {annotations: Array<{type: string}>}).annotations
    expect(introAnns.filter((a) => a.type === 'Embed')).toHaveLength(2)
    expect(introAnns.filter((a) => a.type === 'Link')).toHaveLength(0)
  })
})
