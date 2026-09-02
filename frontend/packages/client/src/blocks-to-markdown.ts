/**
 * Seed block tree → Markdown formatter.
 *
 * The lossless half of the markdown pair (see `markdown-to-blocks.ts` for the
 * dialect). Converts HMDocument/HMBlockNode trees to markdown with:
 *   - YAML frontmatter carrying every metadata key
 *   - a trailing `<!-- id:X [type:T] [attrs:{…}] -->` comment on every block
 *   - nesting by indentation, heading level by heading depth
 *   - annotations as markdown markers, split at boundaries so they nest
 *
 * This module is purely synchronous and does NOT resolve embeds, mentions,
 * or queries over the network. For resolved output, see the
 * `documentToResolvedMarkdown` family below, which is a display format and
 * not round-trip safe.
 *
 * Round-trip: `parseMarkdown(blocksToMarkdown(doc))` reproduces `doc`, and
 * exporting that parse reproduces the same markdown. Use
 * `{ipfsGateway: false}` to keep `ipfs://` links verbatim.
 */

import type {SeedClient} from './client'
import type {
  HMAnnotation,
  HMBlock,
  HMBlockNode,
  HMComment,
  HMDocument,
  HMMetadata,
  UnpackedHypermediaId,
} from './hm-types'
import {unpackHmId} from './hm-types'
import {stringify as stringifyYaml} from 'yaml'

// ─── Options ─────────────────────────────────────────────────────────────────

export type BlocksToMarkdownOptions = {
  /** Format ipfs:// URLs as https gateway URLs. Default: true. */
  ipfsGateway?: boolean
}

// ─── Frontmatter ─────────────────────────────────────────────────────────────

/**
 * Metadata keys emitted first, in this order; every other key follows,
 * sorted. Nested maps are sorted too, so the same metadata always yields
 * the same frontmatter.
 */
const FM_KEY_ORDER = [
  'name',
  'summary',
  'icon',
  'cover',
  'displayAuthor',
  'displayPublishTime',
  'schema',
  'childrenSchema',
  'schemaDefinition',
  'siteUrl',
  'layout',
  'theme',
  'contentWidth',
  'childrenType',
  'showOutline',
  'showActivity',
  'seedExperimentalLogo',
  'seedExperimentalHomeOrder',
  'importCategories',
  'importTags',
]

function frontmatterKeyRank(key: string): number {
  const idx = FM_KEY_ORDER.indexOf(key)
  return idx === -1 ? FM_KEY_ORDER.length : idx
}

/**
 * Emit YAML frontmatter from HMMetadata. Every defined key is emitted,
 * including nested values and keys this client does not know about.
 * System fields (authors, version, genesis, account) are not metadata and
 * are never present here.
 */
export function emitFrontmatter(metadata: HMMetadata): string {
  const entries = Object.entries(metadata || {}).filter(([, v]) => v !== undefined)
  if (entries.length === 0) return '---\n---\n'
  const body = stringifyYaml(Object.fromEntries(entries), {
    lineWidth: 0,
    sortMapEntries: (a, b) => {
      const ka = String(a.key)
      const kb = String(b.key)
      return frontmatterKeyRank(ka) - frontmatterKeyRank(kb) || ka.localeCompare(kb)
    },
  })
  return '---\n' + body.replace(/\n$/, '') + '\n---\n'
}

// ─── Block comments ──────────────────────────────────────────────────────────

/** Stable-key JSON that can live inside an HTML comment (no `--`). */
function commentJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value)).replace(/--/g, '-\\u002d')
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as object).sort()) {
      const v = (value as Record<string, unknown>)[k]
      if (v !== undefined) out[k] = sortKeysDeep(v)
    }
    return out
  }
  return value
}

/** `<!-- id:X [type:T] [attrs:{…}] -->` */
function blockComment(id: string, type?: string, attrs?: Record<string, unknown>): string {
  let s = `<!-- id:${id}`
  if (type) s += ` type:${type}`
  if (attrs && Object.keys(attrs).length) s += ` attrs:${commentJson(attrs)}`
  return s + ' -->'
}

/** Kept for the table emitter and the resolved emitter. */
function idComment(id: string): string {
  return blockComment(id)
}

/** Block types with native markdown syntax; every other type is named in the comment. */
const NATIVE_TYPES = new Set(['Paragraph', 'Heading', 'Code', 'Math', 'Image', 'Table'])

/** Attributes expressed by syntax rather than in `attrs:`. */
function isNativeAttribute(type: string, key: string, value: unknown, hasChildren: boolean): boolean {
  if (key === 'childrenType') {
    if (value === 'Unordered' || value === 'Ordered' || value === 'Blockquote') return true
    // Group is the default for any block with children; only an explicit
    // Group on a childless block needs spelling out.
    if (value === 'Group') return hasChildren
    return false
  }
  if (type === 'Code' && key === 'language') return true
  return false
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Convert an HMDocument to markdown with frontmatter and block IDs.
 *
 * This is a synchronous, pure conversion. Embeds/queries are rendered
 * as placeholder links (not resolved).
 */
export function blocksToMarkdown(doc: HMDocument, options?: BlocksToMarkdownOptions): string {
  const opts = {ipfsGateway: true, ...options}
  const out: string[] = [emitFrontmatter(doc.metadata || {}).replace(/\n$/, '')]
  renderNodes(doc.content || [], '', undefined, 0, opts, out)
  return out.join('\n')
}

type ChildrenType = string | undefined

const LIST_TYPES = new Set(['Unordered', 'Ordered', 'Blockquote'])

function markerFor(childrenType: ChildrenType, index: number): string {
  if (childrenType === 'Unordered') return '- '
  if (childrenType === 'Ordered') return `${index + 1}. `
  if (childrenType === 'Blockquote') return '> '
  return ''
}

/**
 * Render sibling blocks at indentation `ind`. Group siblings are separated
 * by a blank line; list / quote items are not.
 */
function renderNodes(
  nodes: HMBlockNode[],
  ind: string,
  childrenType: ChildrenType,
  headingDepth: number,
  opts: Required<BlocksToMarkdownOptions>,
  out: string[],
): void {
  const listy = LIST_TYPES.has(childrenType || '')
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!
    if (i > 0 && !listy) out.push('')
    const marker = markerFor(childrenType, i)
    const wroteHeading = renderNode(node, ind, marker, headingDepth, opts, out)
    // A heading's children sit at its own indentation, so a following
    // non-heading sibling needs an explicit close.
    const next = nodes[i + 1]
    if (wroteHeading && next && next.block.type !== 'Heading') {
      out.push(ind + `<!-- end:${node.block.id} -->`)
    }
  }
}

/**
 * Render one block and its children. Returns true when the block was
 * written as a heading whose children share its indentation.
 */
function renderNode(
  node: HMBlockNode,
  ind: string,
  marker: string,
  headingDepth: number,
  opts: Required<BlocksToMarkdownOptions>,
  out: string[],
): boolean {
  const block = node.block as {
    type: string
    id: string
    text?: string
    link?: string
    annotations?: HMAnnotation[]
    attributes?: Record<string, unknown>
  }
  const children = node.children || []
  const type = block.type
  const text = block.text || ''
  const link = block.link || ''
  const attributes = block.attributes || {}
  const childrenType = attributes.childrenType as ChildrenType

  // Tables render their whole subtree (TableColumn/TableRow/cell blocks) as
  // one GFM table — never recurse generically into their children.
  if (type === 'Table') {
    const extra = extraAttributes(type, attributes, false)
    const contentInd = ind + ' '.repeat(marker.length)
    const table = tableToMarkdown(node, contentInd, (t, a) => renderInline(t, a, {atLineStart: false}))
    // A table with no columns has no GFM form; the comment alone carries it.
    out.push(ind + marker + blockComment(block.id, table ? undefined : 'Table', extra))
    if (table) out.push(...table.split('\n'))
    return false
  }

  const extra = extraAttributes(type, attributes, children.length > 0)
  const comment = blockComment(block.id, NATIVE_TYPES.has(type) ? undefined : type, extra)
  const contentInd = ind + ' '.repeat(marker.length)
  let wroteHeading = false
  let childInd = marker ? contentInd : ind + '  '
  let childHeadingDepth = 0
  let shorthand = false

  switch (type) {
    case 'Paragraph': {
      if (!text && children.length && LIST_TYPES.has(childrenType || '') && !marker) {
        // Invisible list container: a standalone comment, children follow
        // at the same indentation as marker lines.
        out.push(ind + comment)
        shorthand = true
        childInd = ind
      } else if (!text) {
        out.push(ind + marker + comment)
      } else {
        out.push(ind + marker + renderInline(text, block.annotations, {atLineStart: true}) + ' ' + comment)
      }
      break
    }
    case 'Heading': {
      const level = Math.min(headingDepth + 1, 6)
      out.push(
        ind +
          marker +
          '#'.repeat(level) +
          ' ' +
          renderInline(text, block.annotations, {atLineStart: false}) +
          ' ' +
          comment,
      )
      if (level < 6) {
        wroteHeading = !marker
        childInd = contentInd
        childHeadingDepth = headingDepth + 1
      } else {
        childInd = contentInd + '  '
      }
      break
    }
    case 'Code': {
      const lang = (attributes.language as string) || ''
      let fenceLen = 3
      for (const m of text.matchAll(/`+/g)) fenceLen = Math.max(fenceLen, m[0].length + 1)
      const fence = '`'.repeat(fenceLen)
      out.push(ind + marker + fence + lang + ' ' + comment)
      for (const line of text.split('\n')) out.push(line ? contentInd + line : '')
      out.push(contentInd + fence)
      break
    }
    case 'Math': {
      out.push(ind + marker + '$$ ' + comment)
      for (const line of text.split('\n')) out.push(line ? contentInd + line : '')
      out.push(contentInd + '$$')
      break
    }
    case 'Image': {
      const alt = renderInline(text, block.annotations, {atLineStart: false})
      out.push(ind + marker + `![${alt}](${renderUrl(formatMediaUrl(link, opts.ipfsGateway))}) ` + comment)
      break
    }
    default: {
      // A typed block: its visible form is whatever markdown can show.
      const url = renderUrl(formatMediaUrl(link, opts.ipfsGateway))
      let visible = ''
      if (text && link) visible = `[${renderInline(text, block.annotations, {atLineStart: false})}](${url})`
      else if (link) visible = `<${formatMediaUrl(link, opts.ipfsGateway)}>`
      else if (text) visible = renderInline(text, block.annotations, {atLineStart: true})
      out.push(ind + marker + (visible ? visible + ' ' : '') + comment)
      if (!visible && children.length && LIST_TYPES.has(childrenType || '') && !marker) {
        // Invisible container (e.g. a Slot holding a list): children follow
        // as marker lines at the same indentation.
        shorthand = true
        childInd = ind
      }
    }
  }

  if (children.length) {
    if (!shorthand && !wroteHeading && !LIST_TYPES.has(childrenType || '')) out.push('')
    renderNodes(children, childInd, childrenType, childHeadingDepth, opts, out)
  }
  return wroteHeading
}

/** Attributes that go into the comment's `attrs:` because no syntax carries them. */
function extraAttributes(
  type: string,
  attributes: Record<string, unknown>,
  hasChildren: boolean,
): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null) continue
    if (isNativeAttribute(type, key, value, hasChildren)) continue
    extra[key] = value
  }
  return extra
}

/** Wrap a URL in `<…>` when it could not otherwise sit inside `(…)`. */
function renderUrl(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url}>` : url
}

// ─── Table emission ──────────────────────────────────────────────────────────
//
// HM tables are a Table block whose children are TableColumn blocks (sibling
// order = column display order) followed by TableRow blocks whose children are
// Paragraph cells carrying `attributes.columnId`. Emission normalizes exactly
// like the renderers: cells resolve to columns by columnId (orphans dropped,
// missing cells empty), and only row 0 may be the header row.
//
// The emitted dialect keeps CRDT identity through a markdown round trip:
//
//   <!-- id:TABLEID -->
//   | Name <!-- col:c1 --> | Age <!-- col:c2 --> <!-- id:headerRowId --> |
//   | --- | --- |
//   | Alice | 30 <!-- id:r1 --> |
//
// Row id comments live INSIDE the row's last cell, never after the final
// pipe: strict GFM counts trailing content as an extra cell, and a header
// row whose cell count disagrees with the delimiter row makes the whole
// table unparseable to standard renderers (GitHub, remark-gfm). In-cell
// comments are invisible to HTML renderers and GFM-safe everywhere.
//
// Cell block ids are intentionally absent: a row has at most one cell per
// column, so cells are re-identified as (row id, column id) during diffing.
// Headerless HM tables emit an all-empty header row (GFM requires one); the
// parser reads all-empty headers back as "no header row".

type NormalizedTableRow = {
  id: string
  isHeader: boolean
  cells: Map<string, {text: string; annotations?: HMAnnotation[]}>
}

type NormalizedTable = {
  columns: {id: string; attributes?: Record<string, unknown>}[]
  rows: NormalizedTableRow[]
}

/** Normalize a Table block node the way the renderers do. */
function normalizeTableNode(node: HMBlockNode): NormalizedTable {
  const columns: {id: string; attributes?: Record<string, unknown>}[] = []
  const rows: NormalizedTableRow[] = []

  for (const child of node.children || []) {
    const block = child.block as {
      type?: string
      id: string
      attributes?: Record<string, unknown>
    }
    if (block?.type === 'TableColumn') {
      const attributes = extraAttributes('TableColumn', block.attributes || {}, false)
      columns.push(Object.keys(attributes).length ? {id: block.id, attributes} : {id: block.id})
    } else if (block?.type === 'TableRow') {
      const cells = new Map<string, {text: string; annotations?: HMAnnotation[]}>()
      for (const cellNode of child.children || []) {
        const cell = cellNode.block as {
          text?: string
          annotations?: HMAnnotation[]
          attributes?: Record<string, unknown>
        }
        const columnId = cell?.attributes?.columnId
        if (typeof columnId === 'string' && columnId && !cells.has(columnId)) {
          cells.set(columnId, {text: cell.text || '', annotations: cell.annotations})
        }
      }
      rows.push({
        id: block.id,
        // Position-0 invariant: only the first row may be the header row.
        isHeader: rows.length === 0 && block.attributes?.isHeader === true,
        cells,
      })
    }
  }

  return {columns, rows}
}

/** Escape cell text for GFM: pipes and newlines cannot appear raw in a cell. */
function escapeCellText(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\n/g, '<br>')
}

/** Assemble the table markdown lines from pre-rendered cell texts.
 *
 * Row id comments go inside the last cell so every line's cell count matches
 * the delimiter row — required for strict-GFM renderers to recognize the
 * table at all. */
function assembleTableMarkdown(
  columns: {id: string; attributes?: Record<string, unknown>}[],
  header: {rowId?: string; cellTexts: string[]},
  bodyRows: {rowId: string; cellTexts: string[]}[],
  ind: string,
): string {
  const lines: string[] = []

  const headerCells = columns.map((col, idx) => {
    const text = header.cellTexts[idx] || ''
    const attrs = col.attributes && Object.keys(col.attributes).length ? ` attrs:${commentJson(col.attributes)}` : ''
    return (text ? text + ' ' : '') + `<!-- col:${col.id}${attrs} -->`
  })
  if (header.rowId) {
    headerCells[headerCells.length - 1] += ' ' + idComment(header.rowId)
  }
  lines.push(ind + '| ' + headerCells.join(' | ') + ' |')
  lines.push(ind + '|' + columns.map(() => ' --- ').join('|') + '|')

  for (const row of bodyRows) {
    const cells = [...row.cellTexts]
    const last = cells.length - 1
    cells[last] = (cells[last] ? cells[last] + ' ' : '') + idComment(row.rowId)
    lines.push(ind + '| ' + cells.join(' | ') + ' |')
  }

  return lines.join('\n')
}

/**
 * Emit a Table block node as GFM markdown with identity comments.
 * `renderCell` renders a cell's text + annotations to inline markdown.
 */
function tableToMarkdown(
  node: HMBlockNode,
  ind: string,
  renderCell: (text: string, annotations: HMAnnotation[] | undefined) => string,
): string {
  const {columns, rows} = normalizeTableNode(node)
  // A table without columns renders as nothing everywhere — drop it rather
  // than emit a dangling id comment that would attach to the next block.
  if (columns.length === 0) return ''

  const renderRowCells = (row: NormalizedTableRow | undefined): string[] =>
    columns.map((col) => {
      const cell = row?.cells.get(col.id)
      return cell ? escapeCellText(renderCell(cell.text, cell.annotations)) : ''
    })

  const headerRow = rows[0]?.isHeader ? rows[0] : undefined
  const bodyRows = (headerRow ? rows.slice(1) : rows).map((row) => ({
    rowId: row.id,
    cellTexts: renderRowCells(row),
  }))

  return assembleTableMarkdown(columns, {rowId: headerRow?.id, cellTexts: renderRowCells(headerRow)}, bodyRows, ind)
}

/** Async twin of tableToMarkdown for the resolved emitter. */
async function tableToResolvedMarkdown(
  node: HMBlockNode,
  depth: number,
  renderCell: (text: string, annotations: HMAnnotation[] | undefined) => Promise<string>,
): Promise<string> {
  const {columns, rows} = normalizeTableNode(node)
  if (columns.length === 0) return ''

  const renderRowCells = (row: NormalizedTableRow | undefined): Promise<string[]> =>
    Promise.all(
      columns.map(async (col) => {
        const cell = row?.cells.get(col.id)
        return cell ? escapeCellText(await renderCell(cell.text, cell.annotations)) : ''
      }),
    )

  const headerRow = rows[0]?.isHeader ? rows[0] : undefined
  const bodyRows = await Promise.all(
    (headerRow ? rows.slice(1) : rows).map(async (row) => ({
      rowId: row.id,
      cellTexts: await renderRowCells(row),
    })),
  )

  return (
    resolvedIndent(depth) +
    resolvedIdComment(node.block.id) +
    '\n' +
    assembleTableMarkdown(
      columns,
      {rowId: headerRow?.id, cellTexts: await renderRowCells(headerRow)},
      bodyRows,
      resolvedIndent(depth),
    )
  )
}

// ─── Inline rendering ────────────────────────────────────────────────────────
//
// Annotations become markdown markers. Because HM annotations may overlap
// arbitrarily while markdown markers must nest, the text is split at every
// annotation boundary and markers are closed and reopened around each run
// as needed. The parser merges the pieces back (mergeAdjacentAnnotations).
//
// Code spans are literal, so they always sit innermost; an Embed annotation
// is atomic (`<hm://…>`) and replaces its placeholder text.

type Span = {
  start: number
  end: number
  type: string
  link?: string
  attributes?: Record<string, unknown>
  key: string
}

type RenderInlineOptions = {
  /** Escape characters that would start a block (heading, list, table…) at position 0. */
  atLineStart: boolean
}

const SPAN_STYLE: Record<string, string> = {
  TextColor: 'color',
  BackgroundColor: 'background-color',
  TextSize: 'font-size',
  TextFamily: 'font-family',
}

function encodeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Escape text so the inline parser reads it back verbatim. */
function escapeInline(s: string, atLineStart: boolean): string {
  let out = s.replace(/[\\`*_~\[\]<]/g, (c) => '\\' + c).replace(/\n/g, '<br>')
  if (atLineStart) {
    out = out.replace(/^(#|[-+>|$]|\d+[.)])/, (m) => (m.length === 1 ? '\\' + m : m.slice(0, -1) + '\\' + m.slice(-1)))
    // Leading whitespace would read as indentation.
    if (/^\s/.test(out)) out = '\\' + out
  }
  return out
}

/** Trailing whitespace would be lost to the separator before the id comment: escape its last character. */
function escapeTrailingWhitespace(s: string): string {
  return /\s$/.test(s) ? s.slice(0, -1) + '\\' + s.slice(-1) : s
}

function spansFromAnnotations(text: string, annotations: HMAnnotation[] | undefined): Span[] {
  const spans: Span[] = []
  for (const ann of annotations || []) {
    const a = ann as {
      type: string
      starts?: number[]
      ends?: number[]
      link?: string
      attributes?: Record<string, unknown>
    }
    const starts = a.starts || []
    const ends = a.ends || []
    const link = a.link || undefined
    const attributes = a.attributes && Object.keys(a.attributes).length ? a.attributes : undefined
    const key = a.type + ' ' + (link ?? '') + ' ' + (attributes ? commentJson(attributes) : '')
    for (let i = 0; i < starts.length; i++) {
      const start = Math.max(0, starts[i]!)
      const end = Math.min(text.length, ends[i] ?? -1)
      if (end <= start) continue
      spans.push({start, end, type: a.type, link, attributes, key})
    }
  }
  // Merge touching / overlapping spans of the same kind.
  spans.sort((x, y) => x.key.localeCompare(y.key) || x.start - y.start || x.end - y.end)
  const merged: Span[] = []
  for (const s of spans) {
    const last = merged[merged.length - 1]
    if (last && last.key === s.key && s.start <= last.end) last.end = Math.max(last.end, s.end)
    else merged.push({...s})
  }
  return merged
}

/** Innermost-first ordering priority: code and embeds must be innermost. */
function spanPriority(s: Span): number {
  if (s.type === 'Embed') return 2
  if (s.type === 'Code') return 1
  return 0
}

/** Render text + annotations as inline markdown. */
function renderInline(text: string, annotations: HMAnnotation[] | undefined, options: RenderInlineOptions): string {
  const spans = spansFromAnnotations(text, annotations)
  if (spans.length === 0) return escapeTrailingWhitespace(escapeInline(text, options.atLineStart))

  const boundaries = new Set<number>([0, text.length])
  for (const s of spans) {
    boundaries.add(s.start)
    boundaries.add(s.end)
  }
  const points = [...boundaries].sort((a, b) => a - b)

  type Open = {span: Span; close: string}
  const stack: Open[] = []
  let out = ''

  for (let p = 0; p < points.length - 1; p++) {
    const pos = points[p]!
    const next = points[p + 1]!
    const active = spans.filter((s) => s.start <= pos && s.end >= next)

    // Close everything that is not active for this run, reopening survivors.
    const survivors: Span[] = []
    let firstInactive = stack.findIndex((o) => !active.includes(o.span))
    if (firstInactive === -1) firstInactive = stack.length
    while (stack.length > firstInactive) {
      const top = stack.pop()!
      out += top.close
      if (active.includes(top.span)) survivors.unshift(top.span)
    }
    const opening = [...survivors, ...active.filter((s) => !stack.some((o) => o.span === s) && !survivors.includes(s))]
    opening.sort(
      (a, b) => spanPriority(a) - spanPriority(b) || b.end - a.end || a.start - b.start || a.type.localeCompare(b.type),
    )
    // Code / Embed must be innermost even if they were already open.
    const inner = stack.filter((o) => spanPriority(o.span) > 0)
    if (opening.length && inner.length) {
      for (const o of inner.reverse()) {
        out += o.close
        stack.splice(stack.indexOf(o), 1)
        opening.push(o.span)
      }
      opening.sort(
        (a, b) =>
          spanPriority(a) - spanPriority(b) || b.end - a.end || a.start - b.start || a.type.localeCompare(b.type),
      )
    }
    for (const s of opening) {
      const chunk = text.slice(pos, next)
      const [open, close] = markersFor(s, chunk, text)
      out += open
      stack.push({span: s, close})
    }

    const top = stack[stack.length - 1]
    const chunk = text.slice(pos, next)
    if (top?.span.type === 'Embed') {
      // atomic: the marker carries the link, the placeholder text is dropped
    } else if (top?.span.type === 'Code') {
      out += chunk.replace(/\n/g, '<br>')
    } else {
      out += escapeInline(chunk, options.atLineStart && out === '')
    }
  }
  while (stack.length) out += stack.pop()!.close
  return escapeTrailingWhitespace(out)
}

/** Open/close markers for a span, given the chunk it is about to wrap. */
function markersFor(s: Span, chunk: string, fullText: string): [string, string] {
  switch (s.type) {
    case 'Bold':
      return ['**', '**']
    case 'Italic':
      return ['_', '_']
    case 'Strike':
      return ['~~', '~~']
    case 'Underline':
      return ['<u>', '</u>']
    case 'Range':
      return ['<mark>', '</mark>']
    case 'Link':
      return ['[', `](${renderUrl(s.link || '')})`]
    case 'Embed':
      return [`<${s.link || ''}>`, '']
    case 'Code': {
      // Fence longer than any backtick run in the whole span, and a space pad
      // when the chunk starts/ends with a backtick or a space.
      let fenceLen = 1
      for (const m of fullText.slice(s.start, s.end).matchAll(/`+/g)) fenceLen = Math.max(fenceLen, m[0].length + 1)
      const fence = '`'.repeat(fenceLen)
      const pad = /^[` ]|[` ]$/.test(chunk) ? ' ' : ''
      return [fence + pad, pad + fence]
    }
    default: {
      const prop = SPAN_STYLE[s.type]
      if (prop) {
        const value = String((s.attributes as {value?: unknown} | undefined)?.value ?? '')
        return [`<span style="${prop}:${encodeHtmlAttr(value)}">`, '</span>']
      }
      return ['', '']
    }
  }
}

/** Kept for the table emitter. */
function applyAnnotations(text: string, annotations: HMAnnotation[] | undefined): string {
  return renderInline(text, annotations, {atLineStart: false})
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format media URL (handle ipfs:// URLs).
 */
function formatMediaUrl(url: string, useGateway: boolean): string {
  if (useGateway && url.startsWith('ipfs://')) {
    const cid = url.slice(7)
    return `https://ipfs.io/ipfs/${cid}`
  }
  return url
}

/**
 * Create indentation string.
 */
function indent(depth: number): string {
  return '  '.repeat(depth)
}

/**
 * Convert a title string into a URL-safe slug.
 *
 * - Lowercases the string
 * - Replaces non-alphanumeric characters with hyphens
 * - Trims leading/trailing hyphens
 * - Truncates to 60 characters
 */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Build a draft filename from a slug and nanoid.
 * Format: `<slug>_<nanoid>.md` — human-readable + collision-safe.
 * If the slug is empty, the filename is just `<nanoid>.md`.
 */
export function draftFilename(slug: string, id: string): string {
  if (!slug) return `${id}.md`
  return `${slug}_${id}.md`
}

/**
 * Extract the draft ID (nanoid) from a draft filename.
 *
 * Handles both formats:
 * - `<slug>_<nanoid>.md` → returns the nanoid part
 * - `<nanoid>.md` → returns the nanoid (legacy/no-slug)
 * - `<nanoid>.json` → returns the nanoid (legacy JSON)
 */
export function parseDraftFilename(filename: string): {id: string; ext: string} {
  const lastDot = filename.lastIndexOf('.')
  const ext = lastDot >= 0 ? filename.slice(lastDot) : ''
  const base = lastDot >= 0 ? filename.slice(0, lastDot) : filename

  const lastUnderscore = base.lastIndexOf('_')
  if (lastUnderscore >= 0 && ext === '.md') {
    // <slug>_<nanoid>.md format
    return {id: base.slice(lastUnderscore + 1), ext}
  }

  // <nanoid>.md or <nanoid>.json (legacy)
  return {id: base, ext}
}

/** Options for Seed-client-backed markdown rendering that resolves embeds and mentions. */
export type ResolvedMarkdownOptions = {
  client: Pick<SeedClient, 'request'>
  maxDepth?: number
}

type ResolveContext = {
  client: Pick<SeedClient, 'request'>
  maxDepth: number
  currentDepth: number
  cache: Map<string, ResolvedReference>
}

type ResolvedReference = {
  label: string
  type: 'account' | 'document' | 'comment' | 'unknown'
  content?: HMBlockNode[]
  version?: string
  latestVersion?: string
  author?: string
}

/** Convert a document to markdown, resolving inline mentions and block embeds through a Seed client. */
export async function documentToResolvedMarkdown(doc: HMDocument, options: ResolvedMarkdownOptions): Promise<string> {
  const ctx: ResolveContext = {
    client: options.client,
    maxDepth: options.maxDepth ?? 2,
    currentDepth: 0,
    cache: new Map(),
  }
  return documentToResolvedMarkdownWithContext(doc, ctx)
}

/** Convert comment content to markdown, resolving inline mentions and block embeds through a Seed client. */
export async function commentToResolvedMarkdown(comment: HMComment, options: ResolvedMarkdownOptions): Promise<string> {
  return contentToResolvedMarkdown(comment.content || [], options)
}

/** Convert Seed block content to markdown, resolving inline mentions and block embeds through a Seed client. */
export async function contentToResolvedMarkdown(
  content: HMBlockNode[],
  options: ResolvedMarkdownOptions,
): Promise<string> {
  const ctx: ResolveContext = {
    client: options.client,
    maxDepth: options.maxDepth ?? 2,
    currentDepth: 0,
    cache: new Map(),
  }
  return blockNodesToResolvedMarkdown(content, ctx)
}

async function documentToResolvedMarkdownWithContext(doc: HMDocument, ctx: ResolveContext): Promise<string> {
  const lines = [emitFrontmatter(doc.metadata || {})]
  const body = await blockNodesToResolvedMarkdown(doc.content || [], ctx)
  if (body) lines.push(body)
  return lines.join('\n')
}

async function blockNodesToResolvedMarkdown(nodes: HMBlockNode[], ctx: ResolveContext): Promise<string> {
  const lines: string[] = []
  for (const node of nodes) {
    const blockMd = await resolvedBlockNodeToMarkdown(node, 0, ctx)
    if (blockMd) lines.push(blockMd)
  }
  return lines.join('\n\n')
}

async function resolvedBlockNodeToMarkdown(node: HMBlockNode, depth: number, ctx: ResolveContext): Promise<string> {
  const block = node.block
  const children = node.children || []

  // Tables render their whole subtree as one GFM table (see tableToMarkdown).
  if (block.type === 'Table') {
    return tableToResolvedMarkdown(node, depth, (text, annotations) => applyResolvedAnnotations(text, annotations, ctx))
  }

  const childrenType = (block as {attributes?: {childrenType?: string}}).attributes?.childrenType
  const isListContainer =
    block.type === 'Paragraph' &&
    !block.text &&
    (childrenType === 'Ordered' || childrenType === 'Unordered' || childrenType === 'Blockquote')

  let result = isListContainer ? resolvedIdComment(block.id) : await resolvedBlockToMarkdown(block, depth, ctx)
  for (const child of children) {
    const childMd = await resolvedBlockNodeToMarkdown(child, depth + 1, ctx)
    if (!childMd) continue
    if (childrenType === 'Ordered') result += '\n' + resolvedIndent(depth + 1) + '1. ' + childMd.trim()
    else if (childrenType === 'Unordered') result += '\n' + resolvedIndent(depth + 1) + '- ' + childMd.trim()
    else if (childrenType === 'Blockquote') result += '\n' + resolvedIndent(depth + 1) + '> ' + childMd.trim()
    else result += '\n\n' + childMd
  }
  return result
}

async function resolvedBlockToMarkdown(block: HMBlock, depth: number, ctx: ResolveContext): Promise<string> {
  const ind = resolvedIndent(depth)
  const b = block as {
    type: string
    id: string
    text?: string
    link?: string
    annotations?: HMAnnotation[]
    attributes?: Record<string, unknown>
  }
  const text = b.text || ''
  const link = b.link || ''
  const annotations = b.annotations
  const id = b.id

  switch (block.type) {
    case 'Paragraph':
      return appendResolvedIdToFirstLine(ind + (await applyResolvedAnnotations(text, annotations, ctx)), id)
    case 'Heading': {
      const hashes = '#'.repeat(Math.min(depth + 1, 6))
      return appendResolvedIdToFirstLine(`${hashes} ${await applyResolvedAnnotations(text, annotations, ctx)}`, id)
    }
    case 'Code': {
      const lang = (b.attributes?.language as string) || ''
      return ind + '```' + lang + ' ' + resolvedIdComment(id) + '\n' + ind + text + '\n' + ind + '```'
    }
    case 'Math':
      return ind + '$$ ' + resolvedIdComment(id) + '\n' + ind + text + '\n' + ind + '$$'
    case 'Image':
      return ind + `![${text || 'image'}](${formatResolvedMediaUrl(link)}) ${resolvedIdComment(id)}`
    case 'Video':
      return ind + `[Video](${formatResolvedMediaUrl(link)}) ${resolvedIdComment(id)}`
    case 'File': {
      const fileName = (b.attributes?.name as string) || 'file'
      return ind + `[${fileName}](${formatResolvedMediaUrl(link)}) ${resolvedIdComment(id)}`
    }
    case 'Embed':
      return appendResolvedIdToFirstLine(await resolveBlockEmbed(block, depth, ctx), id)
    case 'WebEmbed':
      return ind + `[Web Embed](${link}) ${resolvedIdComment(id)}`
    case 'Button':
      return ind + `[${text || 'Button'}](${link}) ${resolvedIdComment(id)}`
    case 'Query':
      return appendResolvedIdToFirstLine(await resolveQuery(block, depth, ctx), id)
    case 'Nostr':
      return ind + `[Nostr: ${link}](${link}) ${resolvedIdComment(id)}`
    default:
      return text ? appendResolvedIdToFirstLine(ind + text, id) : ''
  }
}

async function resolveBlockEmbed(block: HMBlock, depth: number, ctx: ResolveContext): Promise<string> {
  const ind = resolvedIndent(depth)
  const link = (block as {link?: string}).link || ''
  if (ctx.currentDepth >= ctx.maxDepth) return ind + `> [Embed: ${link}](${link})`

  const id = unpackHmId(link)
  if (!id) return ind + `> [Embed: ${link}](${link})`

  try {
    const resolved = await resolveEmbeddedResource(link, ctx)
    if (!resolved.content?.length) return ind + `> [Embed: ${resolved.label}](${link})`

    const content = selectEmbeddedContent(resolved.content, id)
    if (!content.length) return ind + `> [Embed: ${resolved.label}](${link})`

    const lines: string[] = []
    const metadata = [`embed: ${link}`, `title: ${resolved.label}`]
    if (id.version) metadata.push(`version: ${id.version}`)
    if (id.blockRef) metadata.push(`block: ${id.blockRef}${formatBlockRange(id)}`)
    lines.push(ind + `<!-- ${metadata.join('; ')} -->`)

    const nestedCtx = {...ctx, currentDepth: ctx.currentDepth + 1}
    for (const node of content) {
      const blockMd = await resolvedBlockNodeToMarkdown(node, depth, nestedCtx)
      if (!blockMd) continue
      lines.push(blockMd)
    }
    lines.push(ind + `<!-- /embed: ${link} -->`)
    return lines.join('\n')
  } catch {
    return ind + `> [Embed: ${link}](${link})`
  }
}

async function resolveQuery(block: HMBlock, depth: number, ctx: ResolveContext): Promise<string> {
  const ind = resolvedIndent(depth)

  try {
    type SortTerm = 'Path' | 'Title' | 'CreateTime' | 'UpdateTime' | 'DisplayTime'
    const attrs = (block as {attributes?: Record<string, unknown>}).attributes
    const queryConfig = attrs?.query as
      | {
          includes?: Array<{space: string; path?: string; mode?: string}>
          sort?: Array<{term: SortTerm; reverse?: boolean}>
          limit?: number
        }
      | undefined

    let includes: Array<{space: string; path?: string; mode: 'Children' | 'AllDescendants'}>
    let sort: Array<{term: SortTerm; reverse: boolean}> | undefined
    let limit: number | undefined

    if (queryConfig?.includes) {
      includes = queryConfig.includes.map((inc) => ({
        space: inc.space,
        path: inc.path,
        mode: (inc.mode as 'Children' | 'AllDescendants') || 'Children',
      }))
      sort = queryConfig.sort?.map((s) => ({term: s.term, reverse: s.reverse ?? false}))
      limit = queryConfig.limit
    } else {
      const space = (attrs?.space as string) || ''
      if (!space) return ind + '<!-- Query: no space specified -->'
      limit = typeof attrs?.limit === 'number' ? attrs.limit : undefined
      includes = [
        {
          space,
          path: attrs?.path as string | undefined,
          mode: (attrs?.mode as 'Children' | 'AllDescendants') || 'Children',
        },
      ]
    }

    const results = await ctx.client.request('Query', {
      includes,
      sort: sort || [{term: 'UpdateTime', reverse: true}],
      limit: limit || 10,
    })

    if (!results?.results?.length) return ind + '<!-- Query: no results -->'

    return results.results
      .map((doc: {metadata?: HMMetadata | null; id: UnpackedHypermediaId}) => {
        const name = doc.metadata?.name || doc.id.path?.join('/') || doc.id.uid
        return ind + `- [${name}](${doc.id.id})`
      })
      .join('\n')
  } catch (error) {
    return ind + `<!-- Query error: ${error instanceof Error ? error.message : String(error)} -->`
  }
}

function selectEmbeddedContent(content: HMBlockNode[], id: UnpackedHypermediaId): HMBlockNode[] {
  if (!id.blockRef) return content
  const target = findBlockById(content, id.blockRef)
  if (!target) return []
  if (id.blockRange && 'start' in id.blockRange && typeof id.blockRange.start === 'number') {
    return [sliceBlockText(target, id.blockRange.start, id.blockRange.end ?? id.blockRange.start)]
  }
  if (id.blockRange && 'expanded' in id.blockRange && !id.blockRange.expanded) return [{...target, children: []}]
  return [target]
}

function sliceBlockText(node: HMBlockNode, start: number, end: number): HMBlockNode {
  const block = node.block as HMBlock & {text?: string}
  if (typeof block.text !== 'string') return {...node, children: []}
  return {...node, block: {...block, text: block.text.slice(start, end)} as HMBlock, children: []}
}

async function applyResolvedAnnotations(
  text: string,
  annotations: HMAnnotation[] | undefined,
  ctx: ResolveContext,
): Promise<string> {
  if (!annotations?.length) return text
  type Marker = {pos: number; type: 'open' | 'close'; annotation: HMAnnotation}
  const markers: Marker[] = []
  for (const ann of annotations) {
    const starts = ann.starts || []
    const ends = ann.ends || []
    for (let i = 0; i < starts.length; i++) {
      markers.push({pos: starts[i]!, type: 'open', annotation: ann})
      if (ends[i] !== undefined) markers.push({pos: ends[i]!, type: 'close', annotation: ann})
    }
  }
  markers.sort((a, b) => (a.pos !== b.pos ? a.pos - b.pos : a.type === 'open' ? -1 : 1))

  let result = ''
  let lastPos = 0
  for (const marker of markers) {
    result += text.slice(lastPos, marker.pos)
    lastPos = marker.pos
    result += await getResolvedAnnotationMarker(marker.annotation, marker.type, ctx)
  }
  result += text.slice(lastPos)
  return result.replace(/\uFFFC/g, '')
}

async function getResolvedAnnotationMarker(
  ann: HMAnnotation,
  type: 'open' | 'close',
  ctx: ResolveContext,
): Promise<string> {
  switch (ann.type) {
    case 'Bold':
      return '**'
    case 'Italic':
      return '_'
    case 'Strike':
      return '~~'
    case 'Code':
      return '`'
    case 'Underline':
      return type === 'open' ? '<u>' : '</u>'
    case 'Link':
      return type === 'open' ? '[' : `](${ann.link || ''})`
    case 'Embed':
      return resolveInlineEmbed(ann, type, ctx)
    default:
      return ''
  }
}

async function resolveInlineEmbed(ann: HMAnnotation, type: 'open' | 'close', ctx: ResolveContext): Promise<string> {
  const link = 'link' in ann ? (ann.link as string) || '' : ''
  if (type === 'close') return `](${link})`
  if (!link) return '[↗ embed'

  try {
    const resolved = await resolveReference(link, ctx)
    const prefix = resolved.type === 'account' ? '@' : ''
    return `[${prefix}${resolved.label}`
  } catch {
    return `[↗ ${fallbackLabel(link)}`
  }
}

async function resolveEmbeddedResource(link: string, ctx: ResolveContext): Promise<ResolvedReference> {
  const cacheKey = `embed:${link}`
  const cached = ctx.cache.get(cacheKey)
  if (cached) return cached
  const id = unpackHmId(link)
  if (!id) throw new Error('Invalid HM link')

  const resource = await ctx.client.request('Resource', id)
  let resolved: ResolvedReference
  if (resource.type === 'document') {
    resolved = {
      label: resource.document.metadata?.name || fallbackDocLabel(id),
      type: 'document',
      content: resource.document.content || [],
      version: id.version || resource.document.version,
      latestVersion: resource.document.version,
    }
  } else if (resource.type === 'comment') {
    let authorName = fallbackUid(resource.comment.author)
    try {
      const account = await ctx.client.request('Account', resource.comment.author)
      if (account.type === 'account' && account.metadata?.name) authorName = account.metadata.name
    } catch {
      // ignore
    }
    resolved = {
      label: `Comment by ${authorName}`,
      type: 'comment',
      content: resource.comment.content || [],
      version: id.version || resource.comment.version,
      latestVersion: resource.comment.version,
      author: resource.comment.author,
    }
  } else {
    resolved = {label: fallbackLabel(link), type: 'unknown'}
  }
  ctx.cache.set(cacheKey, resolved)
  return resolved
}

async function resolveReference(link: string, ctx: ResolveContext): Promise<ResolvedReference> {
  const cached = ctx.cache.get(link)
  if (cached) return cached
  const id = unpackHmId(link)
  if (!id) throw new Error('Invalid HM link')

  let resolved: ResolvedReference
  const profileAccountUid = id.path?.[0] === ':profile' ? id.path[1] || id.uid : !id.path?.length ? id.uid : null
  if (profileAccountUid) {
    try {
      const account = await ctx.client.request('Account', profileAccountUid)
      if (account.type === 'account') {
        resolved = {label: account.metadata?.name || fallbackUid(profileAccountUid), type: 'account'}
        ctx.cache.set(link, resolved)
        return resolved
      }
    } catch {
      // fall through to Resource, because profiles may also be represented as documents
    }
  }

  const resource = await ctx.client.request('Resource', id)
  if (resource.type === 'document') {
    resolved = {
      label: resource.document.metadata?.name || fallbackDocLabel(id),
      type: 'document',
      content: resource.document.content || [],
      version: id.version || resource.document.version,
      latestVersion: resource.document.version,
    }
  } else if (resource.type === 'comment') {
    let authorName = fallbackUid(resource.comment.author)
    try {
      const account = await ctx.client.request('Account', resource.comment.author)
      if (account.type === 'account' && account.metadata?.name) authorName = account.metadata.name
    } catch {
      // ignore
    }
    resolved = {
      label: `Comment by ${authorName}`,
      type: 'comment',
      content: resource.comment.content || [],
      version: id.version || resource.comment.version,
      latestVersion: resource.comment.version,
      author: resource.comment.author,
    }
  } else {
    resolved = {label: fallbackLabel(link), type: 'unknown'}
  }
  ctx.cache.set(link, resolved)
  return resolved
}

function findBlockById(content: HMBlockNode[], blockId: string): HMBlockNode | null {
  for (const node of content) {
    if (node.block.id === blockId) return node
    const found = findBlockById(node.children || [], blockId)
    if (found) return found
  }
  return null
}

function resolvedIdComment(id: string): string {
  return `<!-- id:${id} -->`
}

function appendResolvedIdToFirstLine(md: string, id: string): string {
  const newline = md.indexOf('\n')
  if (newline === -1) return md ? `${md} ${resolvedIdComment(id)}` : resolvedIdComment(id)
  return `${md.slice(0, newline)} ${resolvedIdComment(id)}${md.slice(newline)}`
}

function formatResolvedMediaUrl(url: string): string {
  if (url.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${url.slice(7)}`
  return url
}

function formatBlockRange(id: UnpackedHypermediaId): string {
  const range = id.blockRange
  if (!range) return ''
  if ('expanded' in range && range.expanded) return '+'
  if ('start' in range) return `[${range.start}:${range.end}]`
  return ''
}

function fallbackDocLabel(id: UnpackedHypermediaId): string {
  return id.path?.length ? id.path.join('/') : fallbackUid(id.uid)
}

function fallbackLabel(link: string): string {
  const id = unpackHmId(link)
  if (id) return fallbackDocLabel(id)
  return link
}

function fallbackUid(uid: string): string {
  return uid.length > 12 ? `${uid.slice(0, 12)}...` : uid
}

function resolvedIndent(depth: number): string {
  return '  '.repeat(depth)
}
