import {describe, expect, it} from 'vitest'
import {collapseResolvedEmbeds, markdownBlockNodesToHMBlockNodes, parseMarkdown} from './markdown-to-blocks'

const parse = (md: string) => markdownBlockNodesToHMBlockNodes(parseMarkdown(md).tree)

describe('resolved embeds written back', () => {
  it('become the embed again, not the embedded document copied in', () => {
    const md = [
      '<!-- embed: hm://z6Mkspace/agent/on-mention; title: On mention; view: Card --> <!-- id:card1 -->',
      'Respond to the mention.',
      '<!-- /embed: hm://z6Mkspace/agent/on-mention -->',
      '',
      '<!-- embed: hm://z6Mkdocs/app-environment/guide; title: Agent Guide --> <!-- id:default-skill -->',
      'This page is the default system prompt.',
      '<!-- embed: hm://z6Mkdocs/nested; title: Nested -->',
      'Nested text.',
      '<!-- /embed: hm://z6Mkdocs/nested -->',
      '<!-- /embed: hm://z6Mkdocs/app-environment/guide -->',
      '',
      'My own words.',
      '',
      // What an agent appends by hand to list an app.
      '<!-- embed: hm://z6Mkspace/agent/writing; view: Card -->',
      '<!-- /embed: hm://z6Mkspace/agent/writing -->',
    ].join('\n')
    const blocks = parse(md).map(
      (node) =>
        node.block as {type: string; id: string; link?: string; text: string; attributes: Record<string, unknown>},
    )
    expect(blocks.map((b) => [b.type, b.link ?? b.text, b.attributes.view])).toEqual([
      ['Embed', 'hm://z6Mkspace/agent/on-mention', 'Card'],
      ['Embed', 'hm://z6Mkdocs/app-environment/guide', undefined],
      ['Paragraph', 'My own words.', undefined],
      ['Embed', 'hm://z6Mkspace/agent/writing', 'Card'],
    ])
    expect(blocks[0]!.id).toBe('card1')
    expect(blocks[1]!.id).toBe('default-skill')
  })

  it('leaves markers inside code fences and unmatched markers alone', () => {
    const fenced = '```\n<!-- embed: hm://x/y; title: Y -->\ntext\n<!-- /embed: hm://x/y -->\n```'
    expect(collapseResolvedEmbeds(fenced)).toBe(fenced)
    const open = '<!-- embed: hm://x/y; title: Y -->\ntext'
    expect(collapseResolvedEmbeds(open)).toBe(open)
  })
})
