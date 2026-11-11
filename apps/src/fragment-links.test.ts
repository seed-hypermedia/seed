import {describe, expect, test} from 'bun:test'
import {markdownBlockNodesToHMBlockNodes, parseMarkdown} from '@seed-hypermedia/client'
import {resolveFragmentLinks} from '@/api-service'

describe('resolveFragmentLinks', () => {
  test('turns #blockId links into links into the published document, leaving other links alone', () => {
    const markdown = [
      'Irregular arcs [[1](#ref-1), [2](#ref-2)] and [a site](https://example.com/#frag).',
      '',
      '- [1] First entry <!-- id:ref-1 -->',
      '- [2] Second entry <!-- id:ref-2 -->',
      '',
    ].join('\n')
    const nodes = markdownBlockNodesToHMBlockNodes(parseMarkdown(markdown).tree)
    const resolved = resolveFragmentLinks(nodes, 'hm://z6MkOwner/papers/rank')
    const paragraph = resolved[0]!.block as {text: string; annotations?: {type: string; link?: string}[]}
    expect(paragraph.text).toContain('[1, 2]')
    const links = (paragraph.annotations ?? []).filter((a) => a.type === 'Link').map((a) => a.link)
    expect(links).toEqual([
      'hm://z6MkOwner/papers/rank#ref-1',
      'hm://z6MkOwner/papers/rank#ref-2',
      'https://example.com/#frag',
    ])
    // The bibliography entries keep the ids the links point at.
    const ids = resolved.flatMap((node) => [node, ...(node.children ?? [])]).map((node) => node.block.id)
    expect(ids).toContain('ref-1')
    expect(ids).toContain('ref-2')
    // Untouched input is returned as-is, not copied.
    const plain = markdownBlockNodesToHMBlockNodes(parseMarkdown('Just text.\n').tree)
    expect(resolveFragmentLinks(plain, 'hm://x')[0]!.block).toBe(plain[0]!.block)
  })
})
