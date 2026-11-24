import {describe, expect, it, vi} from 'vitest'
import {
  computeReplaceOps,
  createBlocksMap,
  describeContentChange,
  markdownUpdateTree,
  toAPIBlockNode,
} from '../src/block-diff'
import {blocksToMarkdown, documentToResolvedMarkdown} from '../src/blocks-to-markdown'
import type {HMBlockNode, HMDocument} from '../src/hm-types'
import {MarkdownResolvedRangeError, parseMarkdown, stripResolvedRanges} from '../src/markdown-to-blocks'

const node = (block: Record<string, unknown>, children: HMBlockNode[] = []): HMBlockNode =>
  ({block: {text: '', annotations: [], attributes: {}, ...block}, children}) as unknown as HMBlockNode

const paragraph = (id: string, text: string, extra: Record<string, unknown> = {}, children: HMBlockNode[] = []) =>
  node({type: 'Paragraph', id, text, ...extra}, children)

/** One of everything the display writer used to lose. */
function richDocument(): HMDocument {
  const content: HMBlockNode[] = [
    node({type: 'Heading', id: 'h1', text: 'Section', attributes: {childrenType: 'Group'}}, [
      paragraph('multi', 'first line\nsecond line\nthird line'),
      paragraph('ranges', 'one two three', {
        annotations: [{type: 'Bold', starts: [0, 8], ends: [3, 13]}],
      }),
      paragraph('mention', 'ask ￼ and see ￼', {
        annotations: [
          {type: 'Embed', starts: [4], ends: [5], link: 'hm://alice'},
          {type: 'Embed', starts: [14], ends: [15], link: 'hm://site/docs'},
        ],
      }),
      paragraph('list', '', {attributes: {childrenType: 'Unordered'}}, [
        paragraph('item1', 'an item', {attributes: {childrenType: 'Group'}}, [
          node({type: 'Code', id: 'code', text: 'if (a) {\n  b()\n}', attributes: {language: 'ts'}}),
          node({type: 'Math', id: 'math', text: 'x = 1\n  y = 2'}),
        ]),
        paragraph('item2', 'another item'),
      ]),
      paragraph('after-list', 'a paragraph after the list', {attributes: {childrenType: 'Ordered'}}, [
        paragraph('n1', 'nested one'),
      ]),
      node({type: 'Embed', id: 'embed', link: 'hm://site/embedded', attributes: {view: 'Card'}}),
      node({
        type: 'Query',
        id: 'query',
        attributes: {style: 'List', query: {includes: [{space: 'site', mode: 'Children'}]}},
      }),
      node({type: 'Video', id: 'video', link: 'ipfs://bafyvideo', text: 'A caption', attributes: {name: 'clip.mp4'}}),
      node({type: 'Image', id: 'image', link: 'ipfs://bafyimage', text: 'alt text'}),
      node({type: 'File', id: 'file', link: 'ipfs://bafyfile', attributes: {name: 'report.pdf', size: 1234}}),
      node({type: 'Slot', id: 'slot', attributes: {slot: 'sidebar'}}),
      node({type: 'Button', id: 'button', link: 'https://example.com', text: 'Go', attributes: {alignment: 'center'}}),
      node({type: 'WebEmbed', id: 'web', link: 'https://x.com/a/status/1'}),
      node({type: 'Table', id: 'table'}, [
        node({type: 'TableColumn', id: 'c1', attributes: {width: 120}}),
        node({type: 'TableColumn', id: 'c2'}),
        node({type: 'TableRow', id: 'r1', attributes: {isHeader: true}}, [
          paragraph('cell1', 'Name', {attributes: {columnId: 'c1'}}),
          paragraph('cell2', 'Age', {attributes: {columnId: 'c2'}}),
        ]),
        node({type: 'TableRow', id: 'r2'}, [
          paragraph('cell3', 'Alice', {attributes: {columnId: 'c1'}}),
          paragraph('cell4', '30', {attributes: {columnId: 'c2'}}),
        ]),
      ]),
    ]),
    paragraph('tail', 'the end'),
  ]
  return {
    metadata: {name: 'Rich'},
    content,
    version: 'v',
    authors: [],
    account: 'site',
    path: '/rich',
  } as unknown as HMDocument
}

const client = {
  request: vi.fn(async (key: string, input: any) => {
    if (key === 'Query')
      return {results: [{id: {id: 'hm://site/found', uid: 'site', path: ['found']}, metadata: {name: 'Found'}}]}
    if (key === 'Account') return {type: 'account', metadata: {name: 'Alice'}}
    const path = (input?.path || []).join('/')
    if (path === 'embedded')
      return {
        type: 'document',
        document: {
          metadata: {name: 'Embedded -- doc'},
          version: 'v',
          authors: [],
          content: [
            paragraph('e1', 'embedded text'),
            node({type: 'Code', id: 'e2', text: '<!-- /resolved -->\nnot the end'}),
            node({type: 'Embed', id: 'e3', link: 'hm://site/docs'}),
          ],
        },
      }
    return {
      type: 'document',
      document: {metadata: {name: 'Docs'}, version: 'v', authors: [], content: [paragraph('d1', 'docs text')]},
    }
  }),
} as any

function opsFor(doc: HMDocument, markdown: string) {
  const oldNodes = (doc.content || []).map(toAPIBlockNode)
  const tree = markdownUpdateTree(doc.content || [], parseMarkdown(markdown).tree)
  const ops = computeReplaceOps(createBlocksMap(oldNodes), tree)
  return {ops, change: describeContentChange(oldNodes, tree, ops)}
}

describe('a markdown body written back', () => {
  it('shows what embeds, queries and mentions point at', async () => {
    const markdown = await documentToResolvedMarkdown(richDocument(), {client, ipfsGateway: false})
    expect(markdown).toContain('ask [@Alice](hm://alice) and see [@Docs](hm://site/docs)')
    expect(markdown).toContain('<!-- resolved: Embedded - doc -->')
    expect(markdown).toContain('embedded text <!-- id:e1 -->')
    expect(markdown).toContain('docs text <!-- id:d1 -->')
    expect(markdown).toContain('- [Found](hm://site/found)')
    expect(markdown).toContain('<ipfs://bafyfile>')
  })

  it('changes nothing when it is what read returned', async () => {
    const doc = richDocument()
    const markdown = await documentToResolvedMarkdown(doc, {client, ipfsGateway: false})
    expect(opsFor(doc, markdown)).toEqual({ops: [], change: {blocks: 29, added: 0, rewritten: 0, moved: 0, deleted: 0}})
  })

  it('changes nothing when media links are gateway addresses', async () => {
    const doc = richDocument()
    expect(opsFor(doc, await documentToResolvedMarkdown(doc, {client})).ops).toEqual([])
    expect(opsFor(doc, blocksToMarkdown(doc)).ops).toEqual([])
  })

  it('stores one block for a one-word edit', async () => {
    const doc = richDocument()
    const markdown = await documentToResolvedMarkdown(doc, {client, ipfsGateway: false})
    const {ops, change} = opsFor(doc, markdown.replace('second line', 'second LINE'))
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({
      type: 'ReplaceBlock',
      block: {id: 'multi', text: 'first line\nsecond LINE\nthird line'},
    })
    expect(change).toMatchObject({rewritten: 1, added: 0, deleted: 0, moved: 0})
  })

  it('gives blocks their ids back when the id comments are gone', async () => {
    const doc = {
      ...richDocument(),
      content: [
        node({type: 'Heading', id: 'h', text: 'Title', attributes: {childrenType: 'Group'}}, [
          paragraph('a', 'alpha'),
          paragraph('b', 'beta'),
          paragraph('b2', 'beta'),
          node({type: 'Image', id: 'i', link: 'ipfs://bafyimage', text: 'alt'}),
        ]),
      ],
    } as unknown as HMDocument
    const stripped = '# Title\n\nalpha\n\nbeta\n\nbeta\n\n![alt](ipfs://bafyimage)\n'
    expect(opsFor(doc, stripped).ops).toEqual([])

    const edited = opsFor(doc, '# Title\n\nbeta\n\nalpha changed\n\nbeta\n\n![alt](ipfs://bafyimage)\n')
    expect(edited.change).toMatchObject({added: 1, deleted: 1, rewritten: 0})
    expect(edited.ops.filter((op) => op.type === 'ReplaceBlock')).toHaveLength(1)
  })

  it('counts moves by the blocks that changed place, not the ones they passed', () => {
    const flat = ['a', 'b', 'c', 'd', 'e'].map((id) => paragraph(id, `text ${id}`))
    const doc = {...richDocument(), content: flat} as unknown as HMDocument
    const body = (ids: string[]) => ids.map((id) => `text ${id} <!-- id:${id} -->`).join('\n\n')
    expect(opsFor(doc, body(['b', 'c', 'd', 'e', 'a'])).change).toMatchObject({moved: 1, added: 0, deleted: 0})
    expect(opsFor(doc, body(['e', 'd', 'c', 'b', 'a'])).change).toMatchObject({moved: 4})
    expect(opsFor(doc, body(['a', 'c', 'e'])).change).toMatchObject({moved: 0, deleted: 2})
    expect(opsFor(doc, 'text a <!-- id:a -->\n\n  text b <!-- id:b -->\n\ntext c <!-- id:c -->').change).toMatchObject({
      moved: 1,
      rewritten: 1,
      deleted: 2,
    })
  })

  it('keeps text that looks like markup, and space at the edges, in table cells and headings', () => {
    const cellTexts = ['see <!-- id:fake --> here', ' leading', 'trailing ', '<!-- col:fake -->', 'a | b']
    const content = [
      node({type: 'Heading', id: 'h', text: ' spaced heading '}),
      node({type: 'Table', id: 't'}, [
        node({type: 'TableColumn', id: 'c1'}),
        ...cellTexts.map((text, i) =>
          node({type: 'TableRow', id: `r${i}`}, [paragraph(`cell${i}`, text, {attributes: {columnId: 'c1'}})]),
        ),
      ]),
    ]
    const parsed = parseMarkdown(blocksToMarkdown({metadata: {}, content} as unknown as HMDocument)).tree
    expect(parsed[0]!.block.text).toBe(' spaced heading ')
    const rows = parsed[1]!.children.filter((n) => n.block.type === 'TableRow')
    expect(rows.map((row) => row.block.id)).toEqual(cellTexts.map((_, i) => `r${i}`))
    expect(rows.map((row) => row.children[0]!.block.text)).toEqual(cellTexts)
  })

  it('skips resolved ranges wherever a block can sit', () => {
    const markdown = [
      '- <hm://site/a> <!-- id:e1 type:Embed -->',
      '  <!-- resolved: A -->',
      '  ```',
      '  <!-- /resolved -->',
      '  ```',
      '  $$',
      '  <!-- /resolved -->',
      '  $$',
      '  - shown item <!-- id:x1 -->',
      '  <!-- /resolved -->',
      '- second <!-- id:p2 -->',
      '',
      '  ```md <!-- id:c1 -->',
      '  <!-- resolved: not a marker -->',
      '  ```',
    ].join('\n')
    const [list] = parseMarkdown(markdown).tree
    expect(list!.children.map((n) => [n.block.id, n.block.type])).toEqual([
      ['e1', 'Embed'],
      ['p2', 'Paragraph'],
    ])
    expect(list!.children[1]!.children[0]!.block).toMatchObject({
      id: 'c1',
      type: 'Code',
      text: '<!-- resolved: not a marker -->',
    })
    expect(
      parseMarkdown('text\n<!-- resolved: x -->\nshown', {strictResolvedRanges: false}).tree.map((n) => n.block.text),
    ).toEqual(['text'])
  })

  it('refuses a resolved range that never ends, and skips markers inside code', () => {
    expect(() => parseMarkdown('text\n<!-- resolved: x -->\nshown')).toThrow(MarkdownResolvedRangeError)
    expect(
      stripResolvedRanges(
        'a\n<!-- resolved -->\nb\n<!-- resolved: n -->\nc\n<!-- /resolved -->\nd\n<!-- /resolved -->\ne',
      ),
    ).toBe('a\ne')
    const code = '```\n<!-- resolved -->\n```\nafter'
    expect(stripResolvedRanges(code)).toBe(code)
  })
})
