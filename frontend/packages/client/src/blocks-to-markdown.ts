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
 * `blocksToMarkdown` is synchronous and does not touch the network. The
 * `documentToResolvedMarkdown` family below is the same writer with what the
 * blocks point at added for the reader: the name behind a mention, and the
 * content of an embed or the results of a query between
 * `<!-- resolved: … -->` and `<!-- /resolved -->`, which the parser skips.
 * Both outputs parse back to the document they were written from.
 *
 * Round-trip: `parseMarkdown(blocksToMarkdown(doc))` reproduces `doc`, and
 * exporting that parse reproduces the same markdown. Use
 * `{ipfsGateway: false}` to keep `ipfs://` links verbatim.
 */

import {resolveId} from './hm-resolver'
import {stringify as stringifyYaml} from 'yaml'
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
import {normalizeQuerySort, unpackHmId} from './hm-types'

// ─── Options ─────────────────────────────────────────────────────────────────

export type BlocksToMarkdownOptions = {
  /** Format ipfs:// URLs as https gateway URLs. Default: true. */
  ipfsGateway?: boolean
  /**
   * The name to print for an inline mention of `link`. When set, a mention is written
   * `[@Name](hm://…)` instead of `<hm://…>`; the parser reads only the link, so any name
   * (the empty string included) parses to the same mention.
   */
  mentionLabel?: (link: string, kind?: string) => string
}

/** What a block points at, shown under it for the reader and skipped by the parser. */
type ResolvedLines = {label: string; lines: string[]}

type RenderOptions = {
  ipfsGateway: boolean
  mentionLabel?: (link: string, kind?: string) => string
  resolved?: (blockId: string) => ResolvedLines | undefined
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
  'attributesSchema',
  'childAttributesSchema',
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

/** Kept for the table emitter. */
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
  const opts: RenderOptions = {ipfsGateway: true, ...options}
  const out: string[] = [emitFrontmatter(doc.metadata || {}).replace(/\n$/, '')]
  renderNodes(doc.content || [], '', undefined, 0, opts, out)
  return out.join('\n') + '\n'
}

/** The label of a resolved range: one line that cannot end the comment it sits in. */
function resolvedLabel(label: string): string {
  return label.replace(/\s+/g, ' ').replace(/-{2,}/g, '-').replace(/>/g, '').trim()
}

/** Lines shown under a block for the reader. The parser drops everything between the two markers. */
function pushResolved(shown: ResolvedLines, ind: string, out: string[]): void {
  const label = resolvedLabel(shown.label)
  out.push(ind + `<!-- resolved${label ? `: ${label}` : ''} -->`)
  for (const line of shown.lines) out.push(line ? ind + line : '')
  out.push(ind + '<!-- /resolved -->')
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
  opts: RenderOptions,
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
  opts: RenderOptions,
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
    const table = tableToMarkdown(node, contentInd, (t, a) =>
      renderInline(t, a, {atLineStart: false, mentionLabel: opts.mentionLabel}),
    )
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
        out.push(
          ind +
            marker +
            renderInline(text, block.annotations, {atLineStart: true, mentionLabel: opts.mentionLabel}) +
            ' ' +
            comment,
        )
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
          renderInline(text, block.annotations, {atLineStart: false, mentionLabel: opts.mentionLabel}) +
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
      // A blank line between a heading and its content, as people write it.
      if (children.length) out.push('')
      break
    }
    case 'Code': {
      const lang = (attributes.language as string) || ''
      let fenceLen = 3
      for (const m of Array.from(text.matchAll(/`+/g))) fenceLen = Math.max(fenceLen, m[0].length + 1)
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
      const alt = renderInline(text, block.annotations, {atLineStart: false, mentionLabel: opts.mentionLabel})
      out.push(ind + marker + `![${alt}](${renderUrl(formatMediaUrl(link, opts.ipfsGateway))}) ` + comment)
      break
    }
    default: {
      // A typed block: its visible form is whatever markdown can show.
      const url = renderUrl(formatMediaUrl(link, opts.ipfsGateway))
      let visible = ''
      if (text && link)
        visible = `[${renderInline(text, block.annotations, {
          atLineStart: false,
          mentionLabel: opts.mentionLabel,
        })}](${url})`
      else if (link) visible = `<${formatMediaUrl(link, opts.ipfsGateway)}>`
      else if (text)
        visible = renderInline(text, block.annotations, {atLineStart: true, mentionLabel: opts.mentionLabel})
      out.push(ind + marker + (visible ? visible + ' ' : '') + comment)
      if (!visible && children.length && LIST_TYPES.has(childrenType || '') && !marker) {
        // Invisible container (e.g. a Slot holding a list): children follow
        // as marker lines at the same indentation.
        shorthand = true
        childInd = ind
      }
    }
  }

  const shown = opts.resolved?.(block.id)
  if (shown) pushResolved(shown, contentInd, out)

  if (children.length) {
    if (!shorthand && type !== 'Heading' && !LIST_TYPES.has(childrenType || '')) out.push('')
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
  /** See {@link BlocksToMarkdownOptions.mentionLabel}. */
  mentionLabel?: (link: string, kind?: string) => string
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
  const points = Array.from(boundaries).sort((a, b) => a - b)

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
      const [open, close] = markersFor(s, chunk, text, options)
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
function markersFor(s: Span, chunk: string, fullText: string, options: RenderInlineOptions): [string, string] {
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
    case 'Embed': {
      const link = s.link || ''
      // The parser reads `[@…](hm://…)` as a mention of the link, whatever the name says.
      if (options.mentionLabel && link.startsWith('hm://') && !/[\s()<>]/.test(link)) {
        const name = options.mentionLabel(link, s.attributes?.mentionKind as string | undefined).replace(/^@/, '')
        return [`[@${escapeInline(name, false)}](${link})`, '']
      }
      return [`<${link}>`, '']
    }
    case 'Code': {
      // Fence longer than any backtick run in the whole span, and a space pad
      // when the chunk starts/ends with a backtick or a space.
      let fenceLen = 1
      for (const m of Array.from(fullText.slice(s.start, s.end).matchAll(/`+/g)))
        fenceLen = Math.max(fenceLen, m[0].length + 1)
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

/** Options for Seed-client-backed markdown rendering that resolves embeds, queries and mentions. */
export type ResolvedMarkdownOptions = {
  client: Pick<SeedClient, 'request'>
  maxDepth?: number
  /** Format ipfs:// URLs as https gateway URLs. Default: true. */
  ipfsGateway?: boolean
}

type ResolveContext = {
  client: Pick<SeedClient, 'request'>
  maxDepth: number
  currentDepth: number
  ipfsGateway: boolean
  cache: Map<string, Promise<ResolvedReference>>
  /** Bounds how many requests are in flight: a document's references are resolved together. */
  limit: <T>(task: () => Promise<T>) => Promise<T>
}

type ResolvedReference = {
  label: string
  type: 'account' | 'document' | 'comment' | 'unknown'
  content?: HMBlockNode[]
  /** Where a sole query with no source looks: the document that holds it. */
  home?: QueryHome
  version?: string
  latestVersion?: string
  author?: string
}

type QueryHome = {space: string; path: unknown}

const MAX_RESOLVE_REQUESTS = 8

function requestLimiter(max: number): ResolveContext['limit'] {
  let active = 0
  const waiting: Array<() => void> = []
  return async (task) => {
    if (active >= max) await new Promise<void>((resolve) => waiting.push(resolve))
    active++
    try {
      return await task()
    } finally {
      active--
      waiting.shift()?.()
    }
  }
}

function resolveContext(options: ResolvedMarkdownOptions): ResolveContext {
  return {
    client: options.client,
    maxDepth: options.maxDepth ?? 2,
    currentDepth: 0,
    ipfsGateway: options.ipfsGateway ?? true,
    cache: new Map(),
    limit: requestLimiter(MAX_RESOLVE_REQUESTS),
  }
}

/**
 * Convert a document to markdown with what its blocks point at shown beside them: mentions carry
 * the name of their target, and each embed or query is followed by its content between
 * `<!-- resolved: … -->` and `<!-- /resolved -->`. The blocks themselves are written exactly as
 * `blocksToMarkdown` writes them, so the output parses back to the document.
 */
export async function documentToResolvedMarkdown(doc: HMDocument, options: ResolvedMarkdownOptions): Promise<string> {
  const out = [emitFrontmatter(doc.metadata || {}).replace(/\n$/, '')]
  out.push(...(await resolvedLines(doc.content || [], resolveContext(options), soleQueryHome(doc))))
  return out.join('\n') + '\n'
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
  return (await resolvedLines(content, resolveContext(options))).join('\n')
}

/** Like the collection view, a sole query with an empty source targets the document that holds it. */
function soleQueryHome(doc: Pick<HMDocument, 'account' | 'path' | 'content'>): QueryHome | undefined {
  const content = doc.content || []
  const root = content[0]
  if (!doc.account || content.length !== 1 || root?.block.type !== 'Query') return undefined
  const query = root.block.attributes?.query
  const include = query?.includes?.[0]
  if (query?.includes.length !== 1 || !include || include.space || include.path) return undefined
  return {space: doc.account, path: doc.path}
}

type ResolvableBlock = {
  type: string
  id: string
  link?: string
  annotations?: HMAnnotation[]
  attributes?: Record<string, unknown>
}

/**
 * The markdown lines of `nodes`, written by the lossless writer, with every reference in them
 * resolved first (together, not one after another).
 */
async function resolvedLines(nodes: HMBlockNode[], ctx: ResolveContext, home?: QueryHome): Promise<string[]> {
  const names = new Map<string, string>()
  const shown = new Map<string, ResolvedLines>()
  const tasks: Promise<void>[] = []
  const show = (id: string, lines: Promise<ResolvedLines | undefined>) =>
    tasks.push(
      lines.then((result) => {
        if (result) shown.set(id, result)
      }),
    )
  const visit = (list: HMBlockNode[]) => {
    for (const node of list) {
      const block = node.block as ResolvableBlock
      for (const ann of block.annotations || []) {
        if (ann.type !== 'Embed' || !ann.link) continue
        const link = ann.link
        const kind = ann.attributes?.mentionKind
        const key = `${kind} ${link}`
        if (names.has(key)) continue
        names.set(key, fallbackLabel(link))
        tasks.push(
          resolveReference(link, ctx, kind).then(
            (resolved) => {
              names.set(key, resolved.label)
            },
            () => {},
          ),
        )
      }
      if (block.type === 'Embed') show(block.id, embedLines(block, ctx))
      else if (block.type === 'Query') show(block.id, queryLines(block, ctx, home))
      visit(node.children || [])
    }
  }
  visit(nodes)
  await Promise.all(tasks)
  const out: string[] = []
  renderNodes(
    nodes,
    '',
    undefined,
    0,
    {
      ipfsGateway: ctx.ipfsGateway,
      mentionLabel: (link, kind) => names.get(`${kind} ${link}`) ?? fallbackLabel(link),
      resolved: (id) => shown.get(id),
    },
    out,
  )
  return out
}

/** What an embed shows: the content of its target, itself resolved, down to `maxDepth`. */
async function embedLines(block: ResolvableBlock, ctx: ResolveContext): Promise<ResolvedLines | undefined> {
  const link = block.link || ''
  const id = unpackHmId(link)
  if (!id || ctx.currentDepth >= ctx.maxDepth) return undefined
  try {
    const resolved = await resolveEmbeddedResource(link, ctx)
    const content = resolved.content?.length ? selectEmbeddedContent(resolved.content, id) : []
    const nested = {...ctx, currentDepth: ctx.currentDepth + 1}
    return {label: resolved.label, lines: content.length ? await resolvedLines(content, nested, resolved.home) : []}
  } catch {
    return {label: 'not available', lines: []}
  }
}

/** What a query shows: a link to each document it finds. */
async function queryLines(block: ResolvableBlock, ctx: ResolveContext, home?: QueryHome): Promise<ResolvedLines> {
  const note = (text: string): ResolvedLines => ({label: text, lines: []})
  try {
    const attrs = block.attributes
    const queryConfig = attrs?.query as
      | {
          includes?: Array<{space: string; path?: string; mode?: string}>
          sort?: Array<{term?: string; reverse?: boolean}>
          filters?: Array<{type: 'Author'; uid: string}>
          limit?: number
        }
      | undefined

    let includes: Array<{space: string; path?: string; mode: 'Children' | 'AllDescendants'}>
    let sort: Array<{term: string; reverse: boolean}> | undefined
    let filters: Array<{type: 'Author'; uid: string}> | undefined
    let limit: number | undefined

    if (queryConfig?.includes) {
      const sourced =
        home && queryConfig.includes.length === 1 && !queryConfig.includes[0]?.space
          ? [{...queryConfig.includes[0]!, space: home.space, path: home.path as string | undefined}]
          : queryConfig.includes
      if (!sourced[0]?.space) return note('query with no space')
      includes = sourced.map((inc) => ({
        space: inc.space,
        path: inc.path,
        mode: (inc.mode as 'Children' | 'AllDescendants') || 'Children',
      }))
      sort = normalizeQuerySort(queryConfig.sort)
      filters = queryConfig.filters
      limit = queryConfig.limit
    } else {
      const space = (attrs?.space as string) || ''
      if (!space) return note('query with no space')
      limit = typeof attrs?.limit === 'number' ? attrs.limit : undefined
      includes = [
        {
          space,
          path: attrs?.path as string | undefined,
          mode: (attrs?.mode as 'Children' | 'AllDescendants') || 'Children',
        },
      ]
    }

    const results = await ctx.limit(() =>
      ctx.client.request('Query', {
        includes,
        sort: sort?.length ? sort : [{term: 'updated', reverse: true}],
        filters,
        limit: limit || 10,
      }),
    )

    if (!results?.results?.length) return note('query results: none')

    return {
      label: 'query results',
      lines: results.results.map((doc: {metadata?: HMMetadata | null; id: UnpackedHypermediaId}) => {
        const name = doc.metadata?.name || doc.id.path?.join('/') || doc.id.uid
        return `- [${escapeInline(name, false)}](${doc.id.id})`
      }),
    }
  } catch (error) {
    return note(`query failed: ${error instanceof Error ? error.message : String(error)}`)
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

/** The quoted part of a block's text. Annotations do not survive the cut: their offsets would not fit. */
function sliceBlockText(node: HMBlockNode, start: number, end: number): HMBlockNode {
  const block = node.block as HMBlock & {text?: string}
  if (typeof block.text !== 'string') return {...node, children: []}
  return {...node, block: {...block, text: block.text.slice(start, end), annotations: []} as HMBlock, children: []}
}

async function resolveMarkdownReferenceId(link: string, ctx: ResolveContext) {
  return resolveId(link, {
    domainResolver: async (domain) => {
      const info = await ctx.limit(() => ctx.client.request('GetDomain', {domain}))
      return info.registeredAccountUid
        ? {registeredAccountUid: info.registeredAccountUid, isGateway: info.isGateway}
        : null
    },
  })
}

/** One lookup per key, shared by everything in the document that names the same target. */
function resolveOnce(ctx: ResolveContext, key: string, load: () => Promise<ResolvedReference>) {
  let pending = ctx.cache.get(key)
  if (!pending) {
    pending = load()
    ctx.cache.set(key, pending)
  }
  return pending
}

async function commentAuthorName(author: string, ctx: ResolveContext): Promise<string> {
  try {
    const account = await ctx.limit(() => ctx.client.request('Account', author))
    if (account.type === 'account' && account.metadata?.name) return account.metadata.name
  } catch {
    // The uid stands in for a name that cannot be read.
  }
  return fallbackUid(author)
}

async function referenceFromResource(
  link: string,
  id: UnpackedHypermediaId,
  ctx: ResolveContext,
): Promise<ResolvedReference> {
  const resource = await ctx.limit(() => ctx.client.request('Resource', id))
  if (resource.type === 'document') {
    return {
      label: resource.document.metadata?.name || fallbackDocLabel(id),
      type: 'document',
      content: resource.document.content || [],
      home: soleQueryHome(resource.document),
      version: id.version || resource.document.version,
      latestVersion: resource.document.version,
    }
  }
  if (resource.type === 'comment') {
    return {
      label: `Comment by ${await commentAuthorName(resource.comment.author, ctx)}`,
      type: 'comment',
      content: resource.comment.content || [],
      version: id.version || resource.comment.version,
      latestVersion: resource.comment.version,
      author: resource.comment.author,
    }
  }
  return {label: fallbackLabel(link), type: 'unknown'}
}

function resolveEmbeddedResource(link: string, ctx: ResolveContext): Promise<ResolvedReference> {
  return resolveOnce(ctx, `embed:${link}`, async () =>
    referenceFromResource(link, await resolveMarkdownReferenceId(link, ctx), ctx),
  )
}

function resolveReference(
  link: string,
  ctx: ResolveContext,
  mentionKind?: 'account' | 'document',
): Promise<ResolvedReference> {
  return resolveOnce(ctx, `${mentionKind || 'legacy'}:${link}`, async () => {
    const id = await resolveMarkdownReferenceId(link, ctx)
    const profileAccountUid = id.path?.[0] === ':profile' ? id.path[1] || id.uid : !id.path?.length ? id.uid : null
    if (profileAccountUid && mentionKind !== 'document') {
      try {
        const account = await ctx.limit(() => ctx.client.request('Account', profileAccountUid))
        if (account.type === 'account') {
          return {label: account.metadata?.name || fallbackUid(profileAccountUid), type: 'account'}
        }
      } catch {
        // fall through to Resource, because profiles may also be represented as documents
      }
    }
    return referenceFromResource(link, id, ctx)
  })
}

function findBlockById(content: HMBlockNode[], blockId: string): HMBlockNode | null {
  for (const node of content) {
    if (node.block.id === blockId) return node
    const found = findBlockById(node.children || [], blockId)
    if (found) return found
  }
  return null
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
