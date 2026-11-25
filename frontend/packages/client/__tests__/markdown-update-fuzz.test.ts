/**
 * Property tests for updating a document from markdown, over seeded random documents and over the
 * repo's `hypermedia/` corpus:
 *
 *  - a document written back as it reads (resolved or plain, native or gateway media links) stores
 *    nothing;
 *  - what resolved markdown shows under embeds and queries never reaches the parsed document;
 *  - a change to one block stores that block and no other;
 *  - a block or subtree removed from the body deletes exactly those blocks;
 *  - edits by block id leave every block they do not name as the same stored object.
 */
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {
  computeReplaceOps,
  createBlocksMap,
  describeContentChange,
  hmBlockNodeToBlockNode,
  markdownUpdateTree,
  toAPIBlockNode,
} from '../src/block-diff'
import {applyBlockEdits} from '../src/block-edits'
import {blocksToMarkdown, documentToResolvedMarkdown} from '../src/blocks-to-markdown'
import type {HMBlockNode, HMDocument} from '../src/hm-types'
import {markdownBlockNodesToHMBlockNodes, parseMarkdown, type BlockNode} from '../src/markdown-to-blocks'

// ── A seeded generator of documents ──────────────────────────────────────────

type Random = {
  next: () => number
  int: (n: number) => number
  pick: <T>(items: T[]) => T
  chance: (p: number) => boolean
}

function random(seed: number): Random {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (n: number) => Math.floor(next() * n)
  return {next, int, pick: (items) => items[int(items.length)]!, chance: (p) => next() < p}
}

/** Words and fragments that are markdown syntax, block starts, or the markers this change adds. */
const FRAGMENTS = [
  'alpha',
  'beta',
  'gamma',
  'delta',
  'one two',
  'Ünïcödé',
  '漢字',
  '🙂',
  '# not a heading',
  '- not a list',
  '1. not a list',
  '> not a quote',
  '| not | a table |',
  '$$',
  '```',
  '~~~',
  '*star*',
  '_under_',
  '`tick`',
  '~~strike~~',
  '[label](https://example.com)',
  '<b>',
  'a < b > c',
  'back\\slash',
  '<!-- /resolved -->',
  '<!-- resolved: x -->',
  '<!-- id:fake -->',
  '<!-- page: characters 0-1 of 2; x -->',
  '-->',
  'trailing space ',
  ' leading space',
  'https://example.com/a_b',
  '@mention',
  'x  y',
]

type Gen = {r: Random; ids: number}
const nextId = (g: Gen) => `b${(g.ids++).toString(36).padStart(7, '0')}`

function text(g: Gen, lines = 1): string {
  const line = () => Array.from({length: 1 + g.r.int(4)}, () => g.r.pick(FRAGMENTS)).join(' ')
  return Array.from({length: lines}, line).join('\n')
}

function annotations(g: Gen, value: string): unknown[] {
  const out: unknown[] = []
  if (value.length < 4) return out
  const span = () => {
    const start = g.r.int(value.length - 1)
    return [start, start + 1 + g.r.int(value.length - start - 1)] as const
  }
  for (let i = g.r.int(3); i > 0; i--) {
    const type = g.r.pick(['Bold', 'Italic', 'Strike', 'Underline', 'Code', 'Link', 'Range'])
    const ranges = [span()]
    // Several ranges in one annotation: markdown writes them as one annotation per range.
    if (g.r.chance(0.3)) ranges.push(span())
    out.push({
      type,
      starts: ranges.map((range) => range[0]),
      ends: ranges.map((range) => range[1]),
      ...(type === 'Link' ? {link: g.r.pick(['https://example.com', 'hm://z6Mkspace/doc', 'ipfs://bafylink'])} : {}),
    })
  }
  return out
}

/** A paragraph that mentions an account or a document, with or without the kind spelled out. */
function mention(g: Gen): HMBlockNode {
  const before = `${g.r.pick(['see', 'ask', 'cc'])} `
  const link = g.r.pick(['hm://z6Mkalice', 'hm://z6Mkalice/:profile', 'hm://z6Mkspace/doc', 'hm://z6Mkspace/a/b'])
  const kind = g.r.pick([undefined, undefined, link.includes('/doc') || link.includes('/a/') ? 'document' : 'account'])
  return leaf(g, {
    type: 'Paragraph',
    text: `${before}￼ ${g.r.pick(FRAGMENTS)}`,
    annotations: [
      {
        type: 'Embed',
        starts: [before.length],
        ends: [before.length + 1],
        link,
        ...(kind ? {attributes: {mentionKind: kind}} : {}),
      },
    ],
  })
}

const leaf = (g: Gen, block: Record<string, unknown>, children: HMBlockNode[] = []): HMBlockNode =>
  ({block: {id: nextId(g), text: '', annotations: [], attributes: {}, ...block}, children}) as unknown as HMBlockNode

function table(g: Gen): HMBlockNode {
  const columns = Array.from({length: 1 + g.r.int(3)}, () =>
    leaf(g, {type: 'TableColumn', attributes: g.r.chance(0.3) ? {width: 80 + g.r.int(200)} : {}}),
  )
  const header = g.r.chance(0.6)
  const rows = Array.from({length: 1 + g.r.int(3)}, (_, index) =>
    leaf(
      g,
      {type: 'TableRow', attributes: header && index === 0 ? {isHeader: true} : {}},
      columns.map((column) => leaf(g, {type: 'Paragraph', text: text(g), attributes: {columnId: column.block.id}})),
    ),
  )
  return leaf(g, {type: 'Table'}, [...columns, ...rows])
}

/** One block that never has children. */
function single(g: Gen): HMBlockNode {
  switch (g.r.int(12)) {
    case 0:
      return leaf(g, {
        type: 'Code',
        text: text(g, 1 + g.r.int(4)).replace(/^/gm, g.r.pick(['', '  ', '    '])),
        attributes: g.r.chance(0.5) ? {language: 'ts'} : {},
      })
    case 1:
      return leaf(g, {type: 'Math', text: ['x = 1', '  y = 2', 'z'].slice(0, 1 + g.r.int(3)).join('\n')})
    case 2:
      return leaf(g, {type: 'Image', link: 'ipfs://bafyimage' + g.r.int(9), text: g.r.chance(0.5) ? text(g) : ''})
    case 3:
      return leaf(g, {
        type: 'Video',
        link: 'ipfs://bafyvideo' + g.r.int(9),
        text: g.r.chance(0.5) ? text(g) : '',
        attributes: {name: 'clip.mp4'},
      })
    case 4:
      return leaf(g, {
        type: 'File',
        link: 'ipfs://bafyfile' + g.r.int(9),
        attributes: {name: 'report.pdf', size: 1 + g.r.int(9999)},
      })
    case 5:
      return leaf(g, {
        type: 'Embed',
        link: g.r.pick(['hm://z6Mkspace/doc', 'hm://z6Mkspace/a/b', 'hm://z6Mkspace/missing']),
        attributes: g.r.chance(0.5) ? {view: g.r.pick(['Card', 'Content'])} : {},
      })
    case 6:
      return leaf(g, {
        type: 'Query',
        attributes: {
          style: g.r.pick(['Card', 'List']),
          query: {includes: [{space: 'z6Mkspace', path: '', mode: 'Children'}], limit: 1 + g.r.int(5)},
        },
      })
    case 7:
      return leaf(g, {type: 'Button', link: 'https://example.com/go', text: text(g), attributes: {alignment: 'center'}})
    case 8:
      return leaf(g, {type: 'WebEmbed', link: 'https://x.com/a/status/' + g.r.int(99)})
    case 9:
      return table(g)
    case 10:
      return mention(g)
    default: {
      const value = text(g, g.r.chance(0.3) ? 1 + g.r.int(3) : 1)
      return leaf(g, {type: 'Paragraph', text: value, annotations: annotations(g, value)})
    }
  }
}

/** Blocks at one level: headings with sections, paragraphs with lists under them, lists, and singles. */
function level(g: Gen, depth: number, count = 1 + g.r.int(4)): HMBlockNode[] {
  return Array.from({length: count}, () => {
    const kind = depth >= 3 ? 9 : g.r.int(10)
    if (kind === 0)
      return leaf(g, {type: 'Heading', text: text(g), attributes: {childrenType: 'Group'}}, level(g, depth + 1))
    if (kind === 1 || kind === 2) {
      // A list: a holder with no text, or a paragraph that carries it.
      const listType = g.r.pick(['Unordered', 'Ordered', 'Blockquote'])
      const items = Array.from({length: 1 + g.r.int(3)}, () => {
        const item = leaf(g, {type: 'Paragraph', text: text(g)})
        if (depth < 2 && g.r.chance(0.35)) {
          item.children = level(g, depth + 2, 1 + g.r.int(2))
          ;(item.block as {attributes: Record<string, unknown>}).attributes = {childrenType: 'Group'}
        }
        return item
      })
      return leaf(g, {type: 'Paragraph', text: kind === 1 ? '' : text(g), attributes: {childrenType: listType}}, items)
    }
    if (kind === 3)
      return leaf(
        g,
        {type: 'Paragraph', text: text(g), attributes: {childrenType: 'Group'}},
        level(g, depth + 1, 1 + g.r.int(2)),
      )
    return single(g)
  })
}

function document(seed: number): HMDocument {
  const g: Gen = {r: random(seed), ids: seed * 1000}
  return {
    metadata: {name: `Doc ${seed}`},
    content: level(g, 0, 2 + g.r.int(5)),
    version: 'v',
    authors: [],
    account: 'z6Mkspace',
    path: '/fuzz',
  } as unknown as HMDocument
}

/** A site that answers every lookup: other random documents, an account with an awkward name. */
const client = {
  request: async (key: string, input: any) => {
    if (key === 'Query')
      return {
        results: [
          {id: {id: 'hm://z6Mkspace/found', uid: 'z6Mkspace', path: ['found']}, metadata: {name: 'Found ] -- > it'}},
        ],
      }
    if (key === 'Account') return {type: 'account', metadata: {name: '@Alice ] --> [x](y)'}}
    const path = (input?.path || []).join('/')
    if (path === 'missing') return {type: 'not-found'}
    const embedded = document(path === 'doc' ? 9001 : 9002)
    return {type: 'document', document: {...embedded, metadata: {name: 'Embedded -- > <!-- /resolved -->'}}}
  },
} as any

// ── Helpers ──────────────────────────────────────────────────────────────────

const allIds = (nodes: HMBlockNode[]): string[] => nodes.flatMap((n) => [n.block.id, ...allIds(n.children || [])])

function update(stored: HMBlockNode[], markdown: string) {
  const oldNodes = stored.map(toAPIBlockNode)
  const tree = markdownUpdateTree(stored, parseMarkdown(markdown).tree)
  const ops = computeReplaceOps(createBlocksMap(oldNodes), tree)
  return {ops, change: describeContentChange(oldNodes, tree, ops), tree}
}

/** The parsed tree without the things that differ between spellings of the same document. */
const shape = (nodes: BlockNode[], inRow = false): unknown[] =>
  nodes.map((n) => [
    // A table cell has no id in markdown: each parse makes one, and the update gives the stored one back.
    inRow ? '' : n.block.id,
    n.block.type,
    n.block.text,
    n.block.link ?? '',
    n.block.childrenType ?? '',
    shape(n.children, n.block.type === 'TableRow'),
  ])

const SEEDS = Array.from({length: 300}, (_, i) => i + 1)

/** Every block that has text of its own and is not inside a table. */
function textBlocks(nodes: HMBlockNode[], out: HMBlockNode[] = []): HMBlockNode[] {
  for (const n of nodes) {
    if (n.block.type === 'Table') continue
    if (['Paragraph', 'Heading'].includes(n.block.type) && (n.block as {text?: string}).text) out.push(n)
    textBlocks(n.children || [], out)
  }
  return out
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const find = (nodes: HMBlockNode[], id: string): HMBlockNode | undefined => {
  for (const n of nodes) {
    if (n.block.id === id) return n
    const found = find(n.children || [], id)
    if (found) return found
  }
  return undefined
}

/**
 * A block tree reduced to what it says. Markdown has one spelling for some things, so those are
 * compared by meaning: an annotation is the characters it covers, a parent with no children type
 * is a Group, and a mention's kind follows from its link.
 */
function meaning(nodes: HMBlockNode[] | undefined, inRow = false): unknown[] {
  return (nodes || []).map((n) => {
    const b = n.block as {
      id: string
      type: string
      text?: string
      link?: string
      annotations?: any[]
      attributes?: Record<string, unknown>
    }
    const {childrenType, ...attributes} = b.attributes || {}
    const covered = new Map<string, Set<number>>()
    for (const a of b.annotations || []) {
      const key = `${a.type} ${a.link || ''}`
      const set = covered.get(key) || new Set<number>()
      ;(a.starts || []).forEach((start: number, i: number) => {
        for (let at = start; at < (a.ends?.[i] ?? start); at++) set.add(at)
      })
      if (set.size) covered.set(key, set)
    }
    return {
      id: inRow ? '' : b.id,
      type: b.type,
      text: b.text || '',
      link: b.link || '',
      attributes,
      childrenType: n.children?.length && b.type !== 'Table' && b.type !== 'TableRow' ? childrenType || 'Group' : '',
      annotations: Array.from(covered.keys())
        .sort()
        .map((key) => [key, Array.from(covered.get(key)!).sort((x, y) => x - y)]),
      children: meaning(n.children, b.type === 'TableRow'),
    }
  })
}

// ── Properties ───────────────────────────────────────────────────────────────

describe('random documents', () => {
  it.each(SEEDS)('seed %i: every block comes back from markdown saying what it said', async (seed) => {
    const doc = document(seed)
    const back = (markdown: string) => meaning(markdownBlockNodesToHMBlockNodes(parseMarkdown(markdown).tree))
    expect(back(blocksToMarkdown(doc, {ipfsGateway: false}))).toEqual(meaning(doc.content))
    expect(back(await documentToResolvedMarkdown(doc, {client, ipfsGateway: false}))).toEqual(meaning(doc.content))
  })

  it.each(SEEDS)('seed %i: the document written back as it reads stores nothing', async (seed) => {
    const doc = document(seed)
    const stored = doc.content!
    const plain = blocksToMarkdown(doc, {ipfsGateway: false})
    const resolved = await documentToResolvedMarkdown(doc, {client, ipfsGateway: false})
    const viaGateway = await documentToResolvedMarkdown(doc, {client})
    const zero = {blocks: allIds(stored).length, added: 0, rewritten: 0, moved: 0, deleted: 0}
    for (const markdown of [plain, blocksToMarkdown(doc), resolved, viaGateway]) {
      expect(update(stored, markdown)).toMatchObject({ops: [], change: zero})
    }
    // What is shown under embeds and queries never reaches the document: the resolved markdown
    // parses to the tree the plain markdown parses to.
    expect(shape(parseMarkdown(resolved).tree)).toEqual(shape(parseMarkdown(plain).tree))
    // And the stored blocks come out of the update as the stored blocks.
    expect(allIds(markdownBlockNodesToHMBlockNodes(update(stored, resolved).tree))).toEqual(allIds(stored))
  })

  it.each(SEEDS)('seed %i: a change to one block stores that block and no other', async (seed) => {
    const doc = document(seed)
    const r = random(seed * 7919)
    const candidates = textBlocks(doc.content!)
    if (!candidates.length) return
    const edited = clone(doc)
    const target = find(edited.content!, r.pick(candidates).block.id)!
    ;(target.block as {text: string}).text += ' edited'
    const {ops, change} = update(doc.content!, await documentToResolvedMarkdown(edited, {client, ipfsGateway: false}))
    expect(ops.map((op) => [op.type, (op as {block?: {id: string}}).block?.id])).toEqual([
      ['ReplaceBlock', target.block.id],
    ])
    expect(change).toMatchObject({added: 0, rewritten: 1, moved: 0, deleted: 0})
  })

  it.each(SEEDS)('seed %i: a block left out of the body deletes that block and its children only', (seed) => {
    const doc = document(seed)
    const r = random(seed * 104729)
    const ids = allIds(doc.content!).filter(
      (id) => !['TableColumn', 'TableRow'].includes(find(doc.content!, id)!.block.type),
    )
    const victimId = r.pick(
      ids.filter(
        (id) =>
          find(doc.content!, id)!.block.type !== 'Paragraph' || !find(doc.content!, id)!.block.attributes?.columnId,
      ),
    )
    const edited = clone(doc)
    let parentId = ''
    const remove = (nodes: HMBlockNode[], parent: string): boolean => {
      const index = nodes.findIndex((n) => n.block.id === victimId)
      if (index >= 0) {
        nodes.splice(index, 1)
        parentId = parent
        return true
      }
      return nodes.some((n) => remove(n.children || [], n.block.id))
    }
    remove(edited.content!, '')
    const gone = allIds([find(doc.content!, victimId)!])
    const {ops, change} = update(doc.content!, blocksToMarkdown(edited, {ipfsGateway: false}))
    const deleted = ops.filter((op) => op.type === 'DeleteBlocks').flatMap((op) => (op as {blocks: string[]}).blocks)
    expect(deleted.sort()).toEqual([...gone].sort())
    expect(change).toMatchObject({added: 0, deleted: gone.length})
    // A parent that lost its last child no longer says how children are arranged; nothing else is rewritten.
    const rewritten = ops.filter((op) => op.type === 'ReplaceBlock').map((op) => (op as {block: {id: string}}).block.id)
    expect(rewritten.filter((id) => id !== parentId)).toEqual([])
  })

  it.each(SEEDS)('seed %i: edits by id leave every block they do not name as stored', (seed) => {
    const doc = document(seed)
    const r = random(seed * 15485863)
    const stored = doc.content!.map(hmBlockNodeToBlockNode)
    const before = new Map<string, unknown>()
    const index = (nodes: BlockNode[]) => nodes.forEach((n) => (before.set(n.block.id, n.block), index(n.children)))
    index(stored)
    const targets = textBlocks(doc.content!).map((n) => n.block.id)
    if (targets.length < 3) return
    const [replaced, anchor, removed] = [r.pick(targets), r.pick(targets), r.pick(targets)]
    const removedIds = new Set(allIds([find(doc.content!, removed)!]))
    const edits: Record<string, unknown>[] = []
    if (!removedIds.has(replaced)) edits.push({replace: replaced, content: 'replaced text'})
    if (!removedIds.has(anchor)) edits.push({after: anchor, content: 'a new block'})
    edits.push({delete: removed})
    const {tree, written} = applyBlockEdits(stored, edits, (markdown) => parseMarkdown(markdown).tree)

    const named = new Set([...written.map((n) => n.block.id), replaced])
    const after = new Map<string, unknown>()
    const collect = (nodes: BlockNode[]) => nodes.forEach((n) => (after.set(n.block.id, n.block), collect(n.children)))
    collect(tree)
    for (const [id, block] of Array.from(before)) {
      if (removedIds.has(id)) expect(after.has(id)).toBe(false)
      else if (!named.has(id)) expect(after.get(id)).toBe(block)
    }
    const ops = computeReplaceOps(createBlocksMap(doc.content!.map(toAPIBlockNode)), tree)
    const rewritten = ops.filter((op) => op.type === 'ReplaceBlock').map((op) => (op as {block: {id: string}}).block.id)
    expect(rewritten.filter((id) => !named.has(id))).toEqual([])
    // The input tree is untouched.
    expect(allIds(doc.content!)).toEqual(allIds(markdownBlockNodesToHMBlockNodes(stored)))
  })
})

// ── The repo's own documents ─────────────────────────────────────────────────

const CORPUS = resolve(__dirname, '../../../../hypermedia')

function markdownFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d).sort()) {
      const full = join(d, entry)
      if (statSync(full).isDirectory()) {
        if (!entry.startsWith('.')) walk(full)
      } else if (entry.endsWith('.md')) out.push(relative(dir, full))
    }
  }
  walk(dir)
  return out
}

describe.skipIf(!existsSync(CORPUS))('hypermedia/ corpus', () => {
  const files = existsSync(CORPUS) ? markdownFiles(CORPUS) : []
  it.each(files)('%s written back as it reads stores nothing', async (file) => {
    const {tree, metadata} = parseMarkdown(readFileSync(resolve(CORPUS, file), 'utf8'))
    const doc = {
      metadata,
      content: markdownBlockNodesToHMBlockNodes(tree),
      version: 'v',
      authors: [],
    } as unknown as HMDocument
    for (const markdown of [
      blocksToMarkdown(doc),
      await documentToResolvedMarkdown(doc, {client, ipfsGateway: false}),
      await documentToResolvedMarkdown(doc, {client}),
    ]) {
      expect(update(doc.content!, markdown).ops).toEqual([])
    }
  })
})
