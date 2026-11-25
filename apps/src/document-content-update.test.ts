/**
 * The body of a document update, without a site: what `planContentUpdate` stores for a whole new
 * body and for edits by block id, what it refuses, and how a paged read marks its pages.
 * The same paths run against a real daemon in tests/prepare-change.integration.test.ts.
 */
import {describe, expect, test} from 'bun:test'
import {blocksToMarkdown} from '@seed-hypermedia/client'
import type {HMBlockNode, HMDocument} from '@seed-hypermedia/client/hm-types'
import * as apisvc from './api-service'

const node = (block: Record<string, unknown>, children: HMBlockNode[] = []): HMBlockNode =>
  ({block: {text: '', annotations: [], attributes: {}, ...block}, children}) as unknown as HMBlockNode
const para = (id: string, text: string, attributes: Record<string, unknown> = {}, children: HMBlockNode[] = []) =>
  node({type: 'Paragraph', id, text, attributes}, children)

/** Twelve blocks: a section with a list, a query, an embed and a table, then a closing paragraph. */
const STORED: HMBlockNode[] = [
  node({type: 'Heading', id: 'head', text: 'Report', attributes: {childrenType: 'Group'}}, [
    para('intro', 'Revenue grew.\nCosts were flat.'),
    para('list', '', {childrenType: 'Unordered'}, [para('north', 'North'), para('south', 'South')]),
    node({type: 'Query', id: 'query', attributes: {style: 'List', query: {includes: [{space: 'z6Mkspace'}]}}}),
    node({type: 'Embed', id: 'embed', link: 'hm://z6Mkspace/other', attributes: {view: 'Card'}}),
    node({type: 'Table', id: 'table'}, [
      node({type: 'TableColumn', id: 'col'}),
      node({type: 'TableRow', id: 'row'}, [para('cell', 'Total', {columnId: 'col'})]),
    ]),
  ]),
  para('tail', 'The end.'),
]
const BLOCKS = 12
const markdown = () => blocksToMarkdown({metadata: {}, content: STORED} as unknown as HMDocument, {ipfsGateway: false})
const ZERO = {blocks: BLOCKS, added: 0, rewritten: 0, moved: 0, deleted: 0}
const plan = (input: Record<string, unknown>) => apisvc.planContentUpdate(STORED, input)!
const refused = (input: Record<string, unknown>): apisvc.APIError => {
  try {
    apisvc.planContentUpdate(STORED, input)
  } catch (error) {
    expect(error).toBeInstanceOf(apisvc.APIError)
    return error as apisvc.APIError
  }
  throw new Error('the update was not refused')
}

describe('the body of a document update', () => {
  test('no content and no edits leaves the body alone', () => {
    expect(apisvc.planContentUpdate(STORED, {metadata: {name: 'Renamed'}})).toBeUndefined()
  })

  test('the document written back as it reads stores nothing', () => {
    expect(plan({content: markdown()})).toMatchObject({ops: [], written: [], changes: ZERO, refusal: undefined})
  })

  test('what a read shows under an embed or a query is not part of the body', () => {
    const shown = markdown()
      .replace(
        /(.*id:query .*)/,
        '$1\n<!-- resolved: query results -->\n- [Found](hm://z6Mkspace/found)\n<!-- /resolved -->',
      )
      .replace(/(.*id:embed .*)/, '$1\n<!-- resolved: Other -->\nembedded text <!-- id:foreign -->\n<!-- /resolved -->')
    expect(shown).toContain('embedded text')
    expect(plan({content: shown})).toMatchObject({ops: [], changes: ZERO})
  })

  test('one changed sentence stores one block, and only that block is checked', () => {
    const result = plan({content: markdown().replace('Costs were flat.', 'Costs fell.')})
    expect(result.changes).toEqual({...ZERO, rewritten: 1})
    expect(result.ops).toHaveLength(1)
    expect(result.written.map((written) => written.block.id)).toEqual(['intro'])
    expect((result.written[0]!.block as {text: string}).text).toBe('Revenue grew.\nCosts fell.')
  })

  test('the frontmatter of a markdown body is its metadata', () => {
    expect(plan({content: `---\nname: Renamed\n---\n${markdown().replace(/^---\n---\n/, '')}`})).toMatchObject({
      metadata: {name: 'Renamed'},
      ops: [],
    })
  })

  test('blocks given as JSON are compared as given', () => {
    expect(plan({content: STORED, format: 'json'})).toMatchObject({ops: [], changes: ZERO})
    const edited = JSON.parse(JSON.stringify(STORED)) as HMBlockNode[]
    ;(edited[1]!.block as {text: string}).text = 'Fin.'
    expect(plan({content: edited, format: 'json'}).changes).toEqual({...ZERO, rewritten: 1})
  })

  test('edits store the blocks they name and leave the body otherwise as stored', () => {
    const result = plan({
      edits: [
        {replace: 'north', content: 'North, revised'},
        {after: 'south', content: '- West'},
        {delete: 'tail'},
        {move: 'embed', before: 'intro'},
      ],
    })
    expect(result.changes).toEqual({blocks: BLOCKS, added: 1, rewritten: 1, moved: 1, deleted: 1})
    expect(result.written.map((written) => (written.block as {text: string}).text).sort()).toEqual([
      'North, revised',
      'West',
    ])
    expect(result.refusal).toBeUndefined()
    const section = result.body[0]!.children!
    expect(section.map((child) => child.block.id).slice(0, 2)).toEqual(['embed', 'intro'])
    // The untouched query and table are the stored blocks, attributes and all.
    expect(section.find((child) => child.block.id === 'query')!.block).toMatchObject(STORED[0]!.children![2]!.block)
    expect(section.find((child) => child.block.id === 'table')!.children).toHaveLength(2)
  })

  test('edits that delete most of a document are not second-guessed: they name what they delete', () => {
    const result = plan({edits: [{delete: 'head'}]})
    expect(result.changes).toMatchObject({deleted: 11})
    expect(result.refusal).toBeUndefined()
  })

  test.each([
    [{content: 'x', edits: [{delete: 'tail'}]}, 'either content', 'both ways at once'],
    [
      {edits: [{replace: 'missing', content: 'x'}]},
      'Edit 1: the document has no block with id "missing"',
      'unknown id',
    ],
    [{edits: [{delete: 'tail'}, {after: 'tail', content: 'x'}]}, 'Edit 2', 'an id an earlier edit deleted'],
    [{edits: []}, 'edits must be a list', 'an empty list'],
    [{edits: 'delete tail'}, 'edits must be a list', 'not a list'],
    [{edits: Array.from({length: 501}, () => ({delete: 'tail'}))}, 'Too many edits', 'too many edits'],
    [{edits: [{after: 'tail', content: 'x\n<!-- resolved -->\ny'}]}, 'never closed', 'an unclosed resolved range'],
    [{content: 'text\n<!-- resolved: Title -->\nshown'}, 'never closed', 'an unclosed resolved range in a body'],
  ])('refuses %j (%s)', (input, message) => {
    const error = refused(input as Record<string, unknown>)
    expect(error.status).toBe(400)
    expect(error.message).toContain(message)
  })

  test('a refused edit list says nothing was applied', () => {
    expect(refused({edits: [{replace: 'north', content: 'x'}, {delete: 'missing'}]}).message).toContain(
      'Nothing was published; no edit in the list was applied.',
    )
  })
})

describe('a body that leaves out most of the document', () => {
  /** A flat document of `count` paragraphs, and a body that keeps the first `kept` of them. */
  const flat = (count: number) => Array.from({length: count}, (_, i) => para(`p${i}`, `Paragraph ${i}`))
  const keeping = (count: number, kept: number) => {
    const stored = flat(count)
    const body = blocksToMarkdown({metadata: {}, content: stored.slice(0, kept)} as unknown as HMDocument)
    return apisvc.planContentUpdate(stored, {content: body})!
  }

  test.each([
    [12, 7, false, 'deletes 5: under six blocks'],
    [12, 6, false, 'deletes 6 of 12: exactly half'],
    [12, 5, true, 'deletes 7 of 12'],
    [11, 5, true, 'deletes 6 of 11'],
    [40, 21, false, 'deletes 19 of 40'],
    [40, 19, true, 'deletes 21 of 40'],
    [5, 0, false, 'a document of five blocks, emptied'],
    [6, 0, true, 'a document of six blocks, emptied'],
  ])('%i blocks, %i kept: refused %p (%s)', (count, kept, expected) => {
    const result = keeping(count, kept)
    expect(result.changes).toMatchObject({blocks: count, deleted: count - kept, added: 0, rewritten: 0})
    expect(result.refusal !== undefined).toBe(expected)
  })

  test('the refusal counts the blocks and names the ways out', () => {
    const message = keeping(40, 2).refusal!
    expect(message).toContain("would delete 38 of the document's 40 blocks and keep 2")
    expect(message).toContain('options.edits')
    expect(message).toContain('options.force: true')
  })

  test('a body written from memory, with no ids and other words, is refused', () => {
    const result = apisvc.planContentUpdate(STORED, {content: '# Report\n\nA summary of the report.'})!
    expect(result.changes).toMatchObject({deleted: 11, added: 1})
    expect(result.refusal).toBeDefined()
  })

  test('the same words without their ids are the same blocks', () => {
    const stripped = markdown().replace(/ ?<!-- id:[A-Za-z0-9_-]+ -->/g, '')
    const result = apisvc.planContentUpdate(STORED, {content: stripped})!
    expect(result.refusal).toBeUndefined()
    const kept = new Set<string>()
    const visit = (nodes: HMBlockNode[]) =>
      nodes.forEach((child) => {
        kept.add(child.block.id)
        visit(child.children ?? [])
      })
    visit(result.body)
    // Every block with words of its own keeps its id.
    for (const id of ['head', 'intro', 'north', 'south', 'tail']) expect(kept.has(id)).toBe(true)
  })
})

describe('a page of a paged read', () => {
  const long = Array.from({length: 1500}, (_, i) => `Paragraph ${i} of a long document. <!-- id:p${i} -->`).join('\n\n')
  const read = (offset?: number) =>
    apisvc.paginateReadResult(
      {type: 'hypermedia_document', summary: 'Read.', markdown: long},
      {address: 'hm://z6Mkspace/long', ...(offset ? {options: {offset}} : {})},
    ) as {markdown: string; page: {offset: number; end: number; total: number; nextOffset?: number}}
  const MARKER = /\n<!-- page: characters \d+-\d+ of \d+; part of the document, not all of it -->\n$/

  test('ends with a line saying it is part of the document, and the pages still rejoin', () => {
    let joined = ''
    let offset = 0
    let pages = 0
    for (;;) {
      const page = read(offset)
      const {end, total, nextOffset} = page.page
      // The page is the text of its range, then the line (on a line of its own).
      const chunk = long.slice(offset, end)
      expect(page.markdown.startsWith(chunk)).toBe(true)
      expect(page.markdown.slice(chunk.length)).toBe(
        `${
          chunk.endsWith('\n') ? '' : '\n'
        }<!-- page: characters ${offset}-${end} of ${total}; part of the document, not all of it -->\n`,
      )
      expect(page.markdown).toMatch(MARKER)
      joined += chunk
      pages++
      if (nextOffset === undefined) break
      offset = nextOffset
    }
    expect(pages).toBeGreaterThan(2)
    expect(joined).toBe(long)
  })

  test('a document that fits in one page, and text that is not a document, carry no line', () => {
    const short = {type: 'hypermedia_document', summary: 'Read.', markdown: 'short'}
    expect(apisvc.paginateReadResult(short, {address: 'hm://z6Mkspace/short'})).toBe(short)
    const file = apisvc.paginateReadResult({summary: 'Read.', content: long}, {address: '~/memory/long.md'})
    expect(String(file.content)).not.toContain('<!-- page:')
  })

  test('is refused as a body and as the content of an edit, whichever page it is', () => {
    for (const page of [read(), read(read().page.nextOffset)]) {
      const error = (() => {
        try {
          apisvc.planContentUpdate(STORED, {content: page.markdown})
        } catch (thrown) {
          return thrown as apisvc.APIError
        }
        throw new Error('the page was not refused')
      })()
      expect(error.status).toBe(400)
      expect(error.message).toContain('part of a document and not a whole body')
      expect(error.message).toContain('options.edits')
    }
    expect(() => apisvc.planContentUpdate(STORED, {edits: [{after: 'tail', content: read().markdown}]})).toThrow(
      'part of a document',
    )
  })

  test('a block on the page can be edited by its id without the other pages', () => {
    const stored = Array.from({length: 1500}, (_, i) => para(`p${i}`, `Paragraph ${i} of a long document.`))
    const id = /<!-- id:(p7) -->/.exec(read().markdown)![1]
    const result = apisvc.planContentUpdate(stored, {edits: [{replace: id, content: 'Rewritten from one page.'}]})!
    expect(result.changes).toEqual({blocks: 1500, added: 0, rewritten: 1, moved: 0, deleted: 0})
    expect(result.body).toHaveLength(1500)
  })
})
