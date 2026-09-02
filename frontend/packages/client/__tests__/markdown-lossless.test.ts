/**
 * Lossless markdown round-trip: every block type, every annotation, every
 * block attribute and every metadata key must survive
 *
 *   blocksToMarkdown → parseMarkdown → markdownBlockNodesToHMBlockNodes
 *
 * with an identical document, and the markdown itself must be a fixed point
 * (exporting the re-imported document reproduces the same text).
 *
 * One `it` per feature so a failure names exactly what is lossy.
 */
import {describe, expect, it} from 'vitest'
import {blocksToMarkdown} from '../src/blocks-to-markdown'
import type {HMBlockNode, HMDocument, HMMetadata} from '../src/hm-types'
import {markdownBlockNodesToHMBlockNodes, parseMarkdown} from '../src/markdown-to-blocks'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function doc(content: HMBlockNode[], metadata: HMMetadata = {}): HMDocument {
  return {
    account: 'test',
    path: '',
    version: 'v1',
    metadata,
    authors: [],
    content,
    createTime: {seconds: 0n, nanos: 0},
    updateTime: {seconds: 0n, nanos: 0},
    genesis: 'g1',
  } as unknown as HMDocument
}

/**
 * Canonical shape for comparison: drop empty `attributes`, empty
 * `annotations`, empty `text`/`link`, and empty `children`, so that the two
 * sides are compared on meaning rather than on which optional keys a
 * producer happened to spell out.
 */
function canon(nodes: HMBlockNode[] | undefined): unknown[] {
  return (nodes || []).map((n) => {
    const b = n.block as Record<string, unknown>
    const out: Record<string, unknown> = {type: b.type, id: b.id}
    // Table cells never carry their id in markdown: a cell is identified by
    // (row id, column id) and its block id is re-derived during update diffing.
    if (b.type === 'Paragraph' && (b.attributes as Record<string, unknown> | undefined)?.columnId) delete out.id
    if (b.text) out.text = b.text
    if (b.link) out.link = b.link
    const anns = (b.annotations as unknown[] | undefined) || []
    if (anns.length) {
      out.annotations = [...anns]
        .map((a) => {
          const ann = {...(a as Record<string, unknown>)}
          if (ann.attributes && Object.keys(ann.attributes as object).length === 0) delete ann.attributes
          return ann
        })
        .sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)))
    }
    const attrs = {...((b.attributes as Record<string, unknown> | undefined) || {})}
    for (const k of Object.keys(attrs)) if (attrs[k] === undefined) delete attrs[k]
    if (Object.keys(attrs).length) out.attributes = attrs
    const kids = canon(n.children)
    if (kids.length) out.children = kids
    return out
  })
}

function reimport(md: string): {content: HMBlockNode[]; metadata: HMMetadata} {
  const {tree, metadata} = parseMarkdown(md)
  return {content: markdownBlockNodesToHMBlockNodes(tree), metadata}
}

/** Assert content round-trips and the markdown is a fixed point. */
function expectLossless(content: HMBlockNode[], metadata: HMMetadata = {}) {
  const md = blocksToMarkdown(doc(content, metadata), {ipfsGateway: false})
  const back = reimport(md)
  expect(canon(back.content)).toEqual(canon(content))
  expect(back.metadata).toEqual(metadata)
  const md2 = blocksToMarkdown(doc(back.content, back.metadata), {ipfsGateway: false})
  expect(md2).toEqual(md)
}

const block = (b: Record<string, unknown>, children?: HMBlockNode[]): HMBlockNode =>
  ({block: b, ...(children ? {children} : {})}) as unknown as HMBlockNode

const p = (id: string, text: string, extra: Record<string, unknown> = {}, children?: HMBlockNode[]) =>
  block({type: 'Paragraph', id, text, ...extra}, children)

const h = (id: string, text: string, children?: HMBlockNode[]) =>
  block({type: 'Heading', id, text, attributes: {childrenType: 'Group'}}, children)

const ann = (type: string, starts: number[], ends: number[], extra: Record<string, unknown> = {}) => ({
  type,
  starts,
  ends,
  ...extra,
})

// ─── Text blocks ─────────────────────────────────────────────────────────────

describe('lossless: text blocks', () => {
  it('Paragraph', () => expectLossless([p('a1', 'Hello world')]))
  it('Paragraph with a hard line break', () => expectLossless([p('a1', 'line one\nline two')]))
  it('Heading', () => expectLossless([h('h1', 'Title', [p('a1', 'body')])]))
  it('Heading levels follow nesting depth', () =>
    expectLossless([h('h1', 'One', [h('h2', 'Two', [h('h3', 'Three', [p('a1', 'deep')])])])]))
  it('Heading with no children', () => expectLossless([h('h1', 'Lonely'), p('a1', 'after')]))
  it('Code with language', () =>
    expectLossless([block({type: 'Code', id: 'c1', text: 'const x = 1\nconst y = 2', attributes: {language: 'ts'}})]))
  it('Code without language', () => expectLossless([block({type: 'Code', id: 'c1', text: 'plain'})]))
  it('Code nested under two headings keeps its indentation stable', () =>
    expectLossless([
      h('h1', 'One', [
        h('h2', 'Two', [block({type: 'Code', id: 'c1', text: 'a\n  b\n    c', attributes: {language: 'txt'}})]),
      ]),
    ]))
  it('Code whose text contains a fence', () =>
    expectLossless([block({type: 'Code', id: 'c1', text: '```\nnested\n```', attributes: {language: 'md'}})]))
  it('Math', () => expectLossless([block({type: 'Math', id: 'm1', text: 'x^2 + y^2 = z^2'})]))
})

// ─── Media blocks ────────────────────────────────────────────────────────────

describe('lossless: media blocks', () => {
  it('Image with caption', () =>
    expectLossless([block({type: 'Image', id: 'i1', text: 'the caption', link: 'ipfs://bafyimg'})]))
  it('Image without caption', () => expectLossless([block({type: 'Image', id: 'i1', link: 'ipfs://bafyimg'})]))
  it('Image with width and name attributes', () =>
    expectLossless([
      block({type: 'Image', id: 'i1', text: 'cap', link: 'ipfs://bafyimg', attributes: {width: 400, name: 'pic.png'}}),
    ]))
  it('Image caption with annotations', () =>
    expectLossless([
      block({type: 'Image', id: 'i1', text: 'bold cap', link: 'ipfs://bafyimg', annotations: [ann('Bold', [0], [4])]}),
    ]))
  it('Video', () => expectLossless([block({type: 'Video', id: 'v1', link: 'ipfs://bafyvid'})]))
  it('Video with playback attributes', () =>
    expectLossless([
      block({
        type: 'Video',
        id: 'v1',
        link: 'ipfs://bafyvid',
        attributes: {width: 640, name: 'clip.mp4', autoplay: true, loop: false, muted: true},
      }),
    ]))
  it('File', () =>
    expectLossless([
      block({type: 'File', id: 'f1', link: 'ipfs://bafyfile', attributes: {name: 'notes.txt', size: 123}}),
    ]))
  it('File without name', () => expectLossless([block({type: 'File', id: 'f1', link: 'ipfs://bafyfile'})]))
})

// ─── Reference blocks ────────────────────────────────────────────────────────

describe('lossless: reference blocks', () => {
  it('Embed', () => expectLossless([block({type: 'Embed', id: 'e1', link: 'hm://z6Mkabc/path'})]))
  it('Embed with view', () =>
    expectLossless([block({type: 'Embed', id: 'e1', link: 'hm://z6Mkabc/path', attributes: {view: 'Card'}})]))
  it('WebEmbed', () => expectLossless([block({type: 'WebEmbed', id: 'w1', link: 'https://x.com/seed/status/1'})]))
  it('Button', () =>
    expectLossless([
      block({type: 'Button', id: 'b1', text: 'Click me', link: 'hm://z6Mkabc/path', attributes: {alignment: 'center'}}),
    ]))
  it('Button with name attribute', () =>
    expectLossless([
      block({type: 'Button', id: 'b1', text: 'Go', link: 'https://example.com', attributes: {name: 'cta'}}),
    ]))
  it('Nostr', () => expectLossless([block({type: 'Nostr', id: 'n1', link: 'nostr:nevent1abc'})]))
  it('Query', () =>
    expectLossless([
      block({
        type: 'Query',
        id: 'q1',
        attributes: {
          style: 'Card',
          columnCount: 2,
          banner: false,
          query: {
            includes: [{space: 'z6Mkabc', path: '', mode: 'Children'}],
            sort: [{term: 'UpdateTime', reverse: false}],
            limit: 10,
          },
        },
      }),
    ]))
  it('Query with table config', () =>
    expectLossless([
      block({
        type: 'Query',
        id: 'q1',
        attributes: {
          style: 'List',
          columnCount: 3,
          banner: true,
          query: {includes: [{space: 'z6Mkabc', path: '/docs', mode: 'AllDescendants'}]},
          table: {columns: [{key: 'name', label: 'Name'}]},
        },
      }),
    ]))
})

// ─── Structure ───────────────────────────────────────────────────────────────

describe('lossless: structure', () => {
  it('paragraph with Group children', () =>
    expectLossless([p('a1', 'parent', {attributes: {childrenType: 'Group'}}, [p('a2', 'child')])]))
  it('paragraph with Unordered children', () =>
    expectLossless([p('a1', 'parent', {attributes: {childrenType: 'Unordered'}}, [p('a2', 'one'), p('a3', 'two')])]))
  it('paragraph with Ordered children', () =>
    expectLossless([p('a1', 'parent', {attributes: {childrenType: 'Ordered'}}, [p('a2', 'one'), p('a3', 'two')])]))
  it('paragraph with Blockquote children', () =>
    expectLossless([p('a1', 'parent', {attributes: {childrenType: 'Blockquote'}}, [p('a2', 'quoted')])]))
  it('invisible Unordered container', () =>
    expectLossless([p('a1', '', {attributes: {childrenType: 'Unordered'}}, [p('a2', 'one'), p('a3', 'two')])]))
  it('invisible Ordered container at document start', () =>
    expectLossless([p('a1', '', {attributes: {childrenType: 'Ordered'}}, [p('a2', 'one')]), p('a4', 'after')]))
  it('nested lists (list item with its own list)', () =>
    expectLossless([
      p('a1', '', {attributes: {childrenType: 'Unordered'}}, [
        p('a2', 'one', {attributes: {childrenType: 'Unordered'}}, [p('a3', 'one.a'), p('a4', 'one.b')]),
        p('a5', 'two'),
      ]),
    ]))
  it('list item with a Group child (non-list nesting inside a list)', () =>
    expectLossless([
      p('a1', '', {attributes: {childrenType: 'Unordered'}}, [
        p('a2', 'one', {attributes: {childrenType: 'Group'}}, [block({type: 'Code', id: 'c1', text: 'x'})]),
      ]),
    ]))
  it('heading directly holding a list (childrenType on the heading)', () =>
    expectLossless([
      block({type: 'Heading', id: 'h1', text: 'T', attributes: {childrenType: 'Unordered'}}, [
        p('a1', 'one'),
        p('a2', 'two'),
      ]),
    ]))
  it('non-heading block with children under a heading', () =>
    expectLossless([
      h('h1', 'T', [
        p('a1', 'intro', {attributes: {childrenType: 'Group'}}, [p('a2', 'nested'), p('a3', 'more')]),
        p('a4', 'sibling'),
      ]),
    ]))
  it('Heading nested under a paragraph (heading level cannot express the parent)', () =>
    expectLossless([
      p('a1', 'parent', {attributes: {childrenType: 'Group'}}, [h('h1', 'Inner', [p('a2', 'body')])]),
      p('a3', 'root again'),
    ]))
  it('columnCount on a Group parent', () =>
    expectLossless([
      p('a1', 'cols', {attributes: {childrenType: 'Group', columnCount: 2}}, [p('a2', 'left'), p('a3', 'right')]),
    ]))
  it('Slot', () =>
    expectLossless([block({type: 'Slot', id: 's1', attributes: {childrenType: 'Group'}}, [p('a1', 'in slot')])]))
  it('Table', () =>
    expectLossless([
      block({type: 'Table', id: 't1'}, [
        block({type: 'TableColumn', id: 'c1'}),
        block({type: 'TableColumn', id: 'c2'}),
        block({type: 'TableRow', id: 'r0', attributes: {isHeader: true}}, [
          p('x1', 'Name', {attributes: {columnId: 'c1'}}),
          p('x2', 'Age', {attributes: {columnId: 'c2'}}),
        ]),
        block({type: 'TableRow', id: 'r1'}, [
          p('x3', 'Alice', {attributes: {columnId: 'c1'}}),
          p('x4', '30', {attributes: {columnId: 'c2'}}),
        ]),
      ]),
    ]))
  it('Table with column widths', () =>
    expectLossless([
      block({type: 'Table', id: 't1'}, [
        block({type: 'TableColumn', id: 'c1', attributes: {width: 200}}),
        block({type: 'TableRow', id: 'r1'}, [p('x1', 'only', {attributes: {columnId: 'c1'}})]),
      ]),
    ]))
})

// ─── Annotations ─────────────────────────────────────────────────────────────

describe('lossless: annotations', () => {
  const text = 'The quick brown fox'
  const single = (type: string, extra: Record<string, unknown> = {}) => [
    p('a1', text, {annotations: [ann(type, [4], [9], extra)]}),
  ]
  it('Bold', () => expectLossless(single('Bold')))
  it('Italic', () => expectLossless(single('Italic')))
  it('Underline', () => expectLossless(single('Underline')))
  it('Strike', () => expectLossless(single('Strike')))
  it('Code', () => expectLossless(single('Code')))
  it('Link', () => expectLossless(single('Link', {link: 'https://example.com'})))
  it('Link to hm://', () => expectLossless(single('Link', {link: 'hm://z6Mkabc/path'})))
  it('Range', () => expectLossless(single('Range')))
  it('TextColor', () => expectLossless(single('TextColor', {attributes: {value: '#ff0000'}})))
  it('BackgroundColor', () => expectLossless(single('BackgroundColor', {attributes: {value: '#00ff00'}})))
  it('TextSize', () => expectLossless(single('TextSize', {attributes: {value: 'large'}})))
  it('TextFamily', () => expectLossless(single('TextFamily', {attributes: {value: 'mono'}})))
  it('Embed (inline mention)', () =>
    expectLossless([p('a1', 'see ￼ here', {annotations: [ann('Embed', [4], [5], {link: 'hm://z6Mkabc/path'})]})]))
  it('overlapping Bold and Italic', () =>
    expectLossless([p('a1', text, {annotations: [ann('Bold', [0], [9]), ann('Italic', [4], [15])]})]))
  it('nested Bold inside Link', () =>
    expectLossless([
      p('a1', text, {annotations: [ann('Link', [4], [15], {link: 'https://x.y'}), ann('Bold', [4], [9])]}),
    ]))
  it('Bold in a Heading', () => expectLossless([h('h1', text, [p('a1', 'x')])]))
  it('annotations in list items', () =>
    expectLossless([
      p('a1', '', {attributes: {childrenType: 'Unordered'}}, [p('a2', text, {annotations: [ann('Code', [4], [9])]})]),
    ]))
  it('text containing markdown syntax characters', () =>
    expectLossless([p('a1', 'a * b ** c _d_ `e` [f](g) <h> # i | j \\ k')]))
  it('text that begins with markdown block syntax', () =>
    expectLossless([
      p('a1', '- not a list'),
      p('a2', '1. not ordered'),
      p('a3', '# not heading'),
      p('a4', '| not | table |'),
    ]))
})

// ─── Metadata ────────────────────────────────────────────────────────────────

describe('lossless: metadata', () => {
  it('every documented key', () =>
    expectLossless([p('a1', 'x')], {
      name: 'Doc',
      summary: 'A summary: with punctuation, "quotes" and #hashes',
      icon: 'ipfs://bafyicon',
      cover: 'ipfs://bafycover',
      siteUrl: 'https://example.com',
      layout: 'Seed/Experimental/Newspaper',
      displayPublishTime: '2024-01-01',
      displayAuthor: 'Someone',
      seedExperimentalLogo: 'ipfs://bafylogo',
      seedExperimentalHomeOrder: 'UpdatedFirst',
      showOutline: true,
      showActivity: false,
      contentWidth: 'L',
      childrenType: 'Ordered',
      theme: {headerLayout: 'Center'},
      importCategories: 'a,b',
      importTags: 'c',
    } as HMMetadata))
  it('schema binding keys', () =>
    expectLossless([p('a1', 'x')], {
      name: 'Person',
      schema: 'hm://z6Mkabc/person',
      childrenSchema: 'ipfs://bafyschema',
      schemaDefinition: 'ipfs://bafyschema2',
    } as HMMetadata))
  it('nested object metadata (spaceAgents, agentServerUrl)', () =>
    expectLossless([p('a1', 'x')], {
      name: 'Space',
      agentServerUrl: 'https://agents.example.com',
      spaceAgents: {ion: {name: 'Ion', enabled: true, models: ['a', 'b']}},
    } as HMMetadata))
  it('passthrough (unknown) metadata keys', () =>
    expectLossless([p('a1', 'x')], {
      name: 'Typed',
      surname: 'Vicenti',
      age: 42,
      tags: ['x', 'y'],
      nested: {deep: {value: null}},
    } as HMMetadata))
  it('empty metadata', () => expectLossless([p('a1', 'x')], {}))
  it('name that looks like YAML', () => expectLossless([p('a1', 'x')], {name: 'yes: 1 - [two] {three}'} as HMMetadata))
  it('multi-line summary', () => expectLossless([p('a1', 'x')], {summary: 'line one\nline two'} as HMMetadata))
})
