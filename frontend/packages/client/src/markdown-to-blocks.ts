/**
 * Markdown → Seed block tree parser.
 *
 * The inverse of `blocks-to-markdown.ts`. Together they form a lossless pair:
 * any document exported with `blocksToMarkdown` parses back to the same
 * document, and re-exporting that parse reproduces the same markdown.
 *
 * Structure:
 *   - Indentation carries nesting. A block's children sit two spaces deeper
 *     (or at the content column of a list/quote marker).
 *   - Heading children sit at the heading's own indentation, delimited by the
 *     next heading of the same or higher level, an `<!-- end:ID -->` line, or
 *     a dedent. Heading level is one more than the number of enclosing
 *     headings at the same indentation.
 *   - `- `, `1. ` and `> ` markers set the parent's `childrenType`
 *     (Unordered / Ordered / Blockquote). Unmarked children are `Group`.
 *   - A standalone `<!-- id:X -->` line is a block with no visible text (an
 *     invisible list container, a Slot, a Query, a Table…). A list or quote
 *     directly after it at the same indentation is its children.
 *
 * Identity and extras live in the trailing HTML comment:
 *   `<!-- id:X type:T attrs:{...} -->`
 * `type:` names a block type markdown cannot express (Video, File, Button,
 * Embed, WebEmbed, Nostr, Query, Slot, …); `attrs:` is a JSON object of
 * attributes with no native syntax.
 *
 * Plain, hand-written markdown (no comments) still parses sensibly: content
 * after a heading nests under it, soft-wrapped lines join with a space, and
 * ids are generated.
 */
import {parse as parseYaml} from 'yaml'
import type {DocumentOperation} from './change'
import type {HMBlockNode, HMMetadata} from './hm-types'

// ─── Types ───────────────────────────────────────────────────────────────────

export type Annotation = {
  type: string
  starts: number[]
  ends: number[]
  link?: string
  attributes?: Record<string, unknown>
}

export type SeedBlock = {
  type: string
  id: string
  text: string
  annotations: Annotation[]
  childrenType?: string
  language?: string
  link?: string
  /**
   * Additional block attributes beyond the legacy top-level ones above
   * (e.g. `columnId` on table cell Paragraphs, `isHeader` on TableRow /
   * TableColumn, `width` on TableColumn). Inlined at the top level of the
   * wire block, nested under `attributes` in HMBlockNode.
   */
  attributes?: Record<string, unknown>
}

export type BlockNode = {
  block: SeedBlock
  children: BlockNode[]
}

// ─── Block ID generation ─────────────────────────────────────────────────────

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

function generateBlockId(): string {
  let id = ''
  for (let i = 0; i < 8; i++) {
    id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]
  }
  return id
}

// ─── Inline formatting parser ────────────────────────────────────────────────

type InlineParseResult = {
  text: string
  annotations: Annotation[]
}

/** Style annotations carried by `<span style="prop:value">`. */
const SPAN_STYLE_TO_TYPE: Record<string, string> = {
  color: 'TextColor',
  'background-color': 'BackgroundColor',
  'font-size': 'TextSize',
  'font-family': 'TextFamily',
}

const SPAN_TYPES = new Set(Object.values(SPAN_STYLE_TO_TYPE))

function decodeHtmlAttr(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

type OpenSpan = {type: string; start: number; family?: string; link?: string; attributes?: Record<string, unknown>}

/**
 * Parses inline markdown formatting into plain text + annotation spans.
 *
 * Supports `**bold**`, `_italic_` / `*italic*`, `~~strike~~`, `` `code` ``,
 * `<u>`, `<mark>`, `<span style="…">`, `<br>`, `[text](url)`, `<url>`
 * autolinks (hm:// → Embed, else Link) and backslash escapes. Markers are
 * matched with a stack, so well-nested output from the emitter parses
 * exactly; mis-nested hand-written input degrades gracefully.
 */
export function parseInlineFormatting(raw: string): InlineParseResult {
  const annotations: Annotation[] = []
  const stack: OpenSpan[] = []
  let text = ''
  let i = 0

  const close = (span: OpenSpan) => {
    if (text.length > span.start) {
      const ann: Annotation = {type: span.type, starts: [span.start], ends: [text.length]}
      if (span.link !== undefined) ann.link = span.link
      if (span.attributes) ann.attributes = span.attributes
      annotations.push(ann)
    }
  }

  /** Close `kind` if open (closing and reopening anything above it), else open it. */
  const toggle = (kind: string, family: string) => {
    const idx = findLastIndex(stack, (s) => s.type === kind && s.family === family)
    if (idx === -1) {
      stack.push({type: kind, start: text.length, family})
      return
    }
    const above = stack.splice(idx + 1)
    for (const s of above.reverse()) close(s)
    close(stack.pop()!)
    for (const s of above.reverse()) stack.push({...s, start: text.length})
  }

  const closeType = (pred: (s: OpenSpan) => boolean) => {
    const idx = findLastIndex(stack, pred)
    if (idx === -1) return
    const above = stack.splice(idx + 1)
    for (const s of above.reverse()) close(s)
    close(stack.pop()!)
    for (const s of above.reverse()) stack.push({...s, start: text.length})
  }

  while (i < raw.length) {
    const ch = raw[i]!

    // Escaped character
    if (ch === '\\' && i + 1 < raw.length) {
      text += raw[i + 1]
      i += 2
      continue
    }

    // Code span: a run of N backticks closed by the next run of exactly N.
    if (ch === '`') {
      let n = 0
      while (raw[i + n] === '`') n++
      const closer = findBacktickRun(raw, i + n, n)
      if (closer !== -1) {
        let inner = raw.slice(i + n, closer)
        // CommonMark: strip one space pad when both sides have it and the
        // content is not all spaces.
        if (inner.length >= 2 && inner.startsWith(' ') && inner.endsWith(' ') && inner.trim() !== '') {
          inner = inner.slice(1, -1)
        }
        inner = inner.replace(/<br\s*\/?>/g, '\n')
        const start = text.length
        text += inner
        if (inner.length) annotations.push({type: 'Code', starts: [start], ends: [text.length]})
        i = closer + n
        continue
      }
      text += raw.slice(i, i + n)
      i += n
      continue
    }

    // Emphasis runs: `**` bold, `*` italic; `__` bold, `_` italic.
    if (ch === '*' || ch === '_') {
      let n = 0
      while (raw[i + n] === ch) n++
      i += n
      while (n > 0) {
        if (n >= 2) {
          toggle('Bold', ch)
          n -= 2
        } else {
          toggle('Italic', ch)
          n -= 1
        }
      }
      continue
    }

    // Strike: ~~
    if (ch === '~' && raw[i + 1] === '~') {
      toggle('Strike', '~')
      i += 2
      continue
    }

    if (ch === '<') {
      // Line break
      const br = /^<br\s*\/?>/.exec(raw.slice(i))
      if (br) {
        text += '\n'
        i += br[0].length
        continue
      }
      // Underline / highlight tags
      const tag = /^<(\/?)(u|mark)>/.exec(raw.slice(i))
      if (tag) {
        const type = tag[2] === 'u' ? 'Underline' : 'Range'
        if (tag[1]) closeType((s) => s.type === type)
        else stack.push({type, start: text.length, family: 'html'})
        i += tag[0].length
        continue
      }
      // Style span
      const span = /^<span style="([a-z-]+):([^"]*)">/.exec(raw.slice(i))
      if (span && SPAN_STYLE_TO_TYPE[span[1]!]) {
        stack.push({
          type: SPAN_STYLE_TO_TYPE[span[1]!]!,
          start: text.length,
          family: 'html',
          attributes: {value: decodeHtmlAttr(span[2]!)},
        })
        i += span[0].length
        continue
      }
      if (raw.startsWith('</span>', i)) {
        closeType((s) => SPAN_TYPES.has(s.type))
        i += 7
        continue
      }
      // Autolink: <scheme:...>
      //   hm://… → Embed annotation on a U+FFFC placeholder (inline mention)
      //   anything else → Link annotation spanning the visible URL
      const end = raw.indexOf('>', i + 1)
      if (end !== -1) {
        const inner = raw.slice(i + 1, end)
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\S*$/.test(inner) && !/[\s<>]/.test(inner)) {
          const start = text.length
          if (inner.startsWith('hm://')) {
            text += '￼'
            annotations.push({type: 'Embed', starts: [start], ends: [text.length], link: inner})
          } else {
            text += inner
            annotations.push({type: 'Link', starts: [start], ends: [text.length], link: inner})
          }
          i = end + 1
          continue
        }
      }
    }

    // Inline image: ![alt](url) — Seed has no inline image type, keep the alt text.
    if (ch === '!' && raw[i + 1] === '[') {
      const link = readLink(raw, i + 1)
      if (link) {
        const parsed = parseInlineFormatting(link.label)
        appendParsed(parsed)
        i = link.end
        continue
      }
    }

    // Link: [text](url)
    if (ch === '[') {
      const link = readLink(raw, i)
      if (link) {
        const parsed = parseInlineFormatting(link.label)
        const start = text.length
        appendParsed(parsed)
        if (text.length > start) {
          annotations.push({type: 'Link', starts: [start], ends: [text.length], link: link.url})
        }
        i = link.end
        continue
      }
    }

    text += ch
    i++
  }

  // Unclosed markers: close them at the end of the text.
  while (stack.length) close(stack.pop()!)

  return {text, annotations: mergeAdjacentAnnotations(annotations)}

  function appendParsed(parsed: InlineParseResult) {
    const offset = text.length
    text += parsed.text
    for (const ann of parsed.annotations) {
      annotations.push({
        ...ann,
        starts: ann.starts.map((s) => s + offset),
        ends: ann.ends.map((e) => e + offset),
      })
    }
  }
}

function findLastIndex<T>(arr: T[], pred: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i
  return -1
}

/** Find the next run of exactly `n` backticks at or after `from`. */
function findBacktickRun(s: string, from: number, n: number): number {
  let i = from
  while (i < s.length) {
    if (s[i] === '`') {
      let k = 0
      while (s[i + k] === '`') k++
      if (k === n) return i
      i += k
    } else {
      i++
    }
  }
  return -1
}

/**
 * Read a `[label](url)` starting at `open` (the `[`). Brackets balance,
 * escapes and code spans are skipped, the url may be `<…>`-wrapped.
 */
function readLink(s: string, open: number): {label: string; url: string; end: number} | null {
  let depth = 0
  let i = open
  let close = -1
  while (i < s.length) {
    const c = s[i]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '`') {
      let n = 0
      while (s[i + n] === '`') n++
      const closer = findBacktickRun(s, i + n, n)
      i = closer === -1 ? i + n : closer + n
      continue
    }
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        close = i
        break
      }
    }
    i++
  }
  if (close === -1 || s[close + 1] !== '(') return null
  const label = s.slice(open + 1, close)
  let j = close + 2
  if (s[j] === '<') {
    const gt = s.indexOf('>', j + 1)
    if (gt === -1 || s[gt + 1] !== ')') return null
    return {label, url: s.slice(j + 1, gt), end: gt + 2}
  }
  let parens = 0
  while (j < s.length) {
    const c = s[j]
    if (c === '\\') {
      j += 2
      continue
    }
    if (c === '(') parens++
    else if (c === ')') {
      if (parens === 0) return {label, url: s.slice(close + 2, j), end: j + 1}
      parens--
    }
    j++
  }
  return null
}

function annotationKey(a: Annotation): string {
  return a.type + ' ' + (a.link ?? '') + ' ' + (a.attributes ? JSON.stringify(sortKeys(a.attributes)) : '')
}

/**
 * Merge annotations of the same kind whose ranges touch or overlap into one
 * contiguous range, and order the result deterministically. The emitter
 * splits annotations at every boundary to keep markers well nested, so this
 * is what makes `parse(emit(doc))` equal `doc`.
 */
export function mergeAdjacentAnnotations(annotations: Annotation[]): Annotation[] {
  const byKey = new Map<string, {proto: Annotation; ranges: {s: number; e: number}[]}>()
  for (const a of annotations) {
    const key = annotationKey(a)
    const entry = byKey.get(key) || {proto: a, ranges: []}
    for (let i = 0; i < a.starts.length; i++) {
      const s = a.starts[i]!
      const e = a.ends[i]
      if (e === undefined || e <= s) continue
      entry.ranges.push({s, e})
    }
    byKey.set(key, entry)
  }
  const out: Annotation[] = []
  for (const {proto, ranges} of Array.from(byKey.values())) {
    ranges.sort((a: {s: number; e: number}, b: {s: number; e: number}) => a.s - b.s || a.e - b.e)
    const merged: {s: number; e: number}[] = []
    for (const r of ranges) {
      const last = merged[merged.length - 1]
      if (last && r.s <= last.e) last.e = Math.max(last.e, r.e)
      else merged.push({...r})
    }
    for (const r of merged) {
      const ann: Annotation = {type: proto.type, starts: [r.s], ends: [r.e]}
      if (proto.link !== undefined) ann.link = proto.link
      if (proto.attributes) ann.attributes = proto.attributes
      out.push(ann)
    }
  }
  out.sort((a, b) => a.starts[0]! - b.starts[0]! || b.ends[0]! - a.ends[0]! || a.type.localeCompare(b.type))
  return out
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value as object).sort()) out[k] = sortKeys((value as Record<string, unknown>)[k])
    return out
  }
  return value
}

// ─── Block comment helpers ───────────────────────────────────────────────────

export type BlockComment = {id: string; type?: string; attrs?: Record<string, unknown>}

const COMMENT_BODY = /<!--\s*id:([A-Za-z0-9_-]+)(?:\s+type:([A-Za-z0-9_-]+))?(?:\s+attrs:(\{.*\}))?\s*-->/
/** Trailing ` <!-- id:X [type:T] [attrs:{…}] -->` at the end of a line (one separator space). */
const TRAILING_COMMENT_RE = new RegExp(' ?' + COMMENT_BODY.source + '\\s*$')
/** A line that is nothing but a block comment. */
const STANDALONE_COMMENT_RE = new RegExp('^\\s*' + COMMENT_BODY.source + '\\s*$')
/** `<!-- end:ID -->` closes the heading with that id. */
const END_RE = /^\s*<!--\s*end:([A-Za-z0-9_-]+)\s*-->\s*$/

function commentFromMatch(m: RegExpMatchArray): BlockComment {
  const c: BlockComment = {id: m[1]!}
  if (m[2]) c.type = m[2]
  if (m[3]) {
    try {
      const parsed = JSON.parse(m[3])
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) c.attrs = parsed
    } catch {
      // malformed attrs: ignore, keep the id
    }
  }
  return c
}

/** Strip a trailing block comment from a string. */
function stripBlockComment(s: string): {text: string; comment?: BlockComment} {
  const m = s.match(TRAILING_COMMENT_RE)
  if (m) return {text: s.slice(0, m.index!), comment: commentFromMatch(m)}
  return {text: s}
}

/** Kept for callers that only need the id. */
function stripBlockId(s: string): {text: string; id?: string} {
  const {text, comment} = stripBlockComment(s)
  return {text, id: comment?.id}
}

// ─── Line model ──────────────────────────────────────────────────────────────

type MarkerKind = 'Unordered' | 'Ordered' | 'Blockquote'

type LineInfo = {
  raw: string
  /** Leading spaces. */
  indent: number
  /** List / quote marker text (`- `, `3. `, `> `) or ''. */
  marker: string
  markerKind?: MarkerKind
  /** Column where the block's own content starts: indent + marker width. */
  contentCol: number
  /** The line after indentation and marker. */
  rest: string
  blank: boolean
}

const MARKER_RE = /^([-*+] |\d+[.)] |> )/

function analyzeLine(raw: string): LineInfo {
  // Only the leading run of blanks is indentation (a tab counts as two
  // columns); whitespace inside the content is content.
  const lead = /^[ \t]*/.exec(raw)![0]
  const indent = lead.replace(/\t/g, '  ').length
  let rest = raw.slice(lead.length)
  const blank = rest.trim() === ''
  let marker = ''
  let markerKind: MarkerKind | undefined
  const m = MARKER_RE.exec(rest)
  if (m && !blank) {
    marker = m[1]!
    markerKind = marker === '> ' ? 'Blockquote' : /^\d/.test(marker) ? 'Ordered' : 'Unordered'
    rest = rest.slice(marker.length)
  }
  return {raw, indent, marker, markerKind, contentCol: indent + marker.length, rest, blank}
}

// ─── Block builders ──────────────────────────────────────────────────────────

function makeBlockNode(block: SeedBlock, children: BlockNode[] = []): BlockNode {
  return {block, children}
}

function baseBlock(
  type: string,
  comment: BlockComment | undefined,
  text = '',
  annotations: Annotation[] = [],
): SeedBlock {
  const block: SeedBlock = {type, id: comment?.id || generateBlockId(), text, annotations}
  if (comment?.attrs && Object.keys(comment.attrs).length) block.attributes = {...comment.attrs}
  return block
}

function createParagraphNode(rawText: string, comment?: BlockComment): BlockNode {
  const {text, annotations} = parseInlineFormatting(rawText)
  return makeBlockNode(baseBlock('Paragraph', comment, text, annotations))
}

function createHeadingNode(rawText: string, comment?: BlockComment): BlockNode {
  const {text, annotations} = parseInlineFormatting(rawText)
  return makeBlockNode(baseBlock('Heading', comment, text, annotations))
}

function createCodeNode(text: string, language: string, comment?: BlockComment): BlockNode {
  const block = baseBlock('Code', comment, text)
  if (language) block.language = language
  return makeBlockNode(block)
}

function createMathNode(text: string, comment?: BlockComment): BlockNode {
  return makeBlockNode(baseBlock('Math', comment, text))
}

function createImageNode(alt: string, url: string, comment?: BlockComment): BlockNode {
  const {text, annotations} = parseInlineFormatting(alt)
  const block = baseBlock('Image', comment, text, annotations)
  block.link = url
  return makeBlockNode(block)
}

/** A block whose type came from `type:` in its comment; text/link from the visible part. */
function createTypedNode(visible: string, comment: BlockComment): BlockNode {
  const block = baseBlock(comment.type!, comment)
  const v = visible.trim()
  const linkOnly = /^<([a-zA-Z][a-zA-Z0-9+.-]*:[^\s<>]*)>$/.exec(v)
  const labeled = v.startsWith('[') ? readLink(v, 0) : null
  if (linkOnly) {
    block.link = linkOnly[1]!
  } else if (labeled && labeled.end === v.length) {
    const {text, annotations} = parseInlineFormatting(labeled.label)
    block.text = text
    block.annotations = annotations
    block.link = labeled.url
  } else if (v) {
    const {text, annotations} = parseInlineFormatting(v)
    block.text = text
    block.annotations = annotations
  }
  return makeBlockNode(block)
}

// ─── Table parser ────────────────────────────────────────────────────────────
//
// HM tables are three block types: a Table container whose children are
// TableColumn blocks (childless; their sibling order defines column display
// order) followed by TableRow blocks whose children are Paragraph cells. Each
// cell carries `attributes.columnId` referencing a TableColumn id — cell
// identity is (row, columnId), never grid position, which is what makes
// concurrent CRDT edits merge cleanly.
//
// The markdown dialect keeps that identity through the round trip:
//
//   <!-- id:TABLEID -->                      (standalone line before the table)
//   | Name <!-- col:c1 --> | Age <!-- col:c2 attrs:{"width":120} --> |
//   | --- | --- |
//   | Alice | 30 | <!-- id:r1 -->            (row id after the final pipe)
//
// Cell block ids never appear in markdown: they are re-derived from
// (row id, column id) against the previous document during update diffing.
// Plain GFM tables with no comments parse fine — all ids are generated.

/** Regex matching a `<!-- col:ID [attrs:{…}] -->` column comment inside a header cell. */
const COL_ID_RE = /<!--\s*col:([A-Za-z0-9_-]+)(?:\s+attrs:(\{.*?\}))?\s*-->/
/** Regex matching an `<!-- id:ID -->` comment anywhere inside a cell. */
const CELL_ID_RE = /<!--\s*id:([A-Za-z0-9_-]+)\s*-->/

type ParsedTableCell = {text: string; colId?: string; colAttrs?: Record<string, unknown>}
type ParsedTableRow = {cells: ParsedTableCell[]; id?: string}

/**
 * Split a GFM table line into trimmed cells, honoring `\|` escapes.
 *
 * Row block ids are read from an `<!-- id:… -->` comment inside any cell
 * (the emitter puts it in the last cell so strict-GFM cell counts stay
 * intact) or, for backward compatibility, trailing after the final pipe.
 * `<!-- col:… -->` comments are stripped from every cell and captured
 * per-cell (only header cells' col ids are used by the builder).
 */
function splitTableRow(line: string): ParsedTableRow {
  const {text, id: afterPipeId} = stripBlockId(line.trim())
  let s = text.trim()
  if (s.startsWith('|')) s = s.slice(1)
  const rawCells: string[] = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (s[i] === '|') {
      rawCells.push(cur.trim())
      cur = ''
    } else {
      cur += s[i]
    }
  }
  const last = cur.trim()
  // A trailing pipe leaves an empty final segment — not a cell.
  if (last !== '' || rawCells.length === 0) rawCells.push(last)

  let rowId = afterPipeId
  const cells = rawCells.map((raw): ParsedTableCell => {
    let cellText = raw
    const idMatch = cellText.match(CELL_ID_RE)
    if (idMatch) {
      rowId = idMatch[1]
      cellText = cellText.replace(idMatch[0], '')
    }
    let colId: string | undefined
    let colAttrs: Record<string, unknown> | undefined
    const colMatch = cellText.match(COL_ID_RE)
    if (colMatch) {
      colId = colMatch[1]
      if (colMatch[2]) {
        try {
          colAttrs = JSON.parse(colMatch[2])
        } catch {
          // ignore malformed column attrs
        }
      }
      cellText = cellText.replace(colMatch[0], '')
    }
    return {text: cellText.trim(), colId, colAttrs}
  })
  return {cells, id: rowId}
}

/** GFM header separator row: every cell is dashes with optional colons. */
function isSeparatorRow(cells: ParsedTableCell[]): boolean {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.text))
}

/** Parse a cell's inline formatting (the inline parser reads `<br>` as a newline). */
function createTableCellNode(rawText: string, columnId: string): BlockNode {
  const {text, annotations} = parseInlineFormatting(rawText)
  return makeBlockNode({
    type: 'Paragraph',
    id: generateBlockId(),
    text,
    annotations,
    attributes: {columnId},
  })
}

/**
 * Build a Table BlockNode from tokenized table lines.
 *
 * - Column count is the max cell count across all rows; columns without a
 *   `col:` comment get generated ids.
 * - An all-empty header row means a headerless table (HM tables may omit the
 *   header row; GFM cannot, so emptiness is the convention).
 * - Cells are created densely: every row gets one cell per column, so the
 *   written grid matches what the editor produces.
 */
function createTableNode(lines: string[], comment?: BlockComment): BlockNode {
  const rawRows = lines.map(splitTableRow)
  let headerRow: ParsedTableRow | undefined
  let bodyRows: ParsedTableRow[]
  if (rawRows.length >= 2 && isSeparatorRow(rawRows[1]!.cells)) {
    headerRow = rawRows[0]
    bodyRows = rawRows.slice(2).filter((r) => !isSeparatorRow(r.cells))
  } else {
    // No standard header separator — treat every non-separator line as a body row.
    bodyRows = rawRows.filter((r) => !isSeparatorRow(r.cells))
  }

  const headerCells = headerRow?.cells ?? []
  const colCount = Math.max(headerCells.length, ...bodyRows.map((r) => r.cells.length), 0)
  const columnIds: string[] = []
  for (let idx = 0; idx < colCount; idx++) {
    columnIds.push(headerCells[idx]?.colId || generateBlockId())
  }

  const columnNodes: BlockNode[] = columnIds.map((id, idx) => {
    const block: SeedBlock = {type: 'TableColumn', id, text: '', annotations: []}
    const attrs = headerCells[idx]?.colAttrs
    if (attrs && Object.keys(attrs).length) block.attributes = {...attrs}
    return makeBlockNode(block)
  })

  const rowNodes: BlockNode[] = []
  // An all-empty header row (ignoring col: comments) encodes a headerless table.
  const hasHeaderRow = headerCells.some((c) => c.text !== '')
  if (headerRow && hasHeaderRow) {
    const cells = columnIds.map((columnId, idx) => createTableCellNode(headerCells[idx]?.text ?? '', columnId))
    rowNodes.push(
      makeBlockNode(
        {
          type: 'TableRow',
          id: headerRow.id || generateBlockId(),
          text: '',
          annotations: [],
          attributes: {isHeader: true},
        },
        cells,
      ),
    )
  }
  for (const row of bodyRows) {
    const cells = columnIds.map((columnId, idx) => createTableCellNode(row.cells[idx]?.text ?? '', columnId))
    rowNodes.push(
      makeBlockNode(
        {
          type: 'TableRow',
          id: row.id || generateBlockId(),
          text: '',
          annotations: [],
        },
        cells,
      ),
    )
  }

  return makeBlockNode(baseBlock('Table', comment), [...columnNodes, ...rowNodes])
}

// ─── Frontmatter parser ──────────────────────────────────────────────────────

/**
 * Coerce a YAML-parsed value to a string.
 * Handles Date objects (from unquoted YAML dates like 2024-01-01)
 * and other non-string primitives.
 */
function coerceString(value: unknown): string | undefined {
  if (value == null) return undefined
  if (value instanceof Date) {
    // YAML parses unquoted dates (2024-01-01) as Date objects.
    // Convert to YYYY-MM-DD which is the expected format.
    return value.toISOString().split('T')[0]
  }
  if (typeof value === 'string') return value
  return String(value)
}

/** String-typed metadata keys, coerced to strings when hand-written YAML types them otherwise. */
const METADATA_STRING_KEYS = [
  'name',
  'summary',
  'displayAuthor',
  'displayPublishTime',
  'icon',
  'cover',
  'siteUrl',
  'layout',
  'seedExperimentalLogo',
  'importCategories',
  'importTags',
  'seedExperimentalHomeOrder',
  'contentWidth',
  'childrenType',
] as const

/** Boolean-typed metadata keys. */
const METADATA_BOOLEAN_KEYS = ['showOutline', 'showActivity'] as const

/**
 * Strip YAML frontmatter (--- delimited) from markdown content.
 * Returns the remaining content and the parsed metadata.
 *
 * Every frontmatter key maps 1:1 to a metadata key, including nested values
 * and keys this client does not know (schema-typed documents carry their
 * own). `title:` is accepted as a backward-compatible alias for `name:`.
 */
export function parseFrontmatter(markdown: string): {
  content: string
  metadata: HMMetadata
} {
  const trimmed = markdown.replace(/^﻿/, '')
  if (!trimmed.startsWith('---')) {
    return {content: markdown, metadata: {}}
  }
  const firstLineEnd = trimmed.indexOf('\n')
  if (firstLineEnd === -1 || trimmed.slice(0, firstLineEnd).trim() !== '---') {
    return {content: markdown, metadata: {}}
  }
  // Closing fence: a line that is exactly `---`.
  const closeRe = /\n---[ \t]*(?:\n|$)/g
  closeRe.lastIndex = firstLineEnd
  const closeMatch = closeRe.exec(trimmed)
  if (!closeMatch) {
    return {content: markdown, metadata: {}}
  }
  const yamlBlock = trimmed.slice(firstLineEnd + 1, closeMatch.index)
  const rest = trimmed.slice(closeMatch.index + closeMatch[0].length)

  const metadata: Record<string, unknown> = {}
  try {
    const parsed = yamlBlock.trim() === '' ? {} : (parseYaml(yamlBlock) as Record<string, unknown> | null)
    if (!parsed || typeof parsed !== 'object') {
      return {content: rest, metadata}
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined) continue
      if (key === 'title') continue
      metadata[key] = value
    }
    // Accept `title:` as backward-compat alias for `name:`
    if (metadata.name === undefined && parsed['title'] != null) {
      metadata.name = coerceString(parsed['title'])
    }
    for (const key of METADATA_STRING_KEYS) {
      if (metadata[key] !== undefined && typeof metadata[key] !== 'string') metadata[key] = coerceString(metadata[key])
    }
    for (const key of METADATA_BOOLEAN_KEYS) {
      if (metadata[key] !== undefined && typeof metadata[key] !== 'boolean') metadata[key] = Boolean(metadata[key])
    }
  } catch {
    // Invalid YAML — ignore frontmatter, return content as-is
    return {content: markdown, metadata: {}}
  }

  return {content: rest, metadata: metadata as HMMetadata}
}

// ─── Tree builder ────────────────────────────────────────────────────────────

type Frame = {
  /** The block whose children this frame collects; undefined for the root. */
  node?: BlockNode
  list: BlockNode[]
  /** Indentation at which this frame's children sit. */
  childIndent: number
  /** Set for heading frames: closes on a heading of this level or higher at childIndent. */
  headingLevel?: number
  /** Set for invisible-container shorthand: children are marker lines at childIndent. */
  shorthand?: MarkerKind
  /** Marker kind of the last child added, or undefined when it had none. */
  markerRun?: MarkerKind
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const isListType = (t: string | undefined): t is MarkerKind =>
  t === 'Unordered' || t === 'Ordered' || t === 'Blockquote'
const FENCE_RE = /^(`{3,})(.*)$/
const IMAGE_START_RE = /^!\[/

/** Does this (marker-stripped) line begin a block other than a plain paragraph? */
function startsSpecialBlock(rest: string): boolean {
  return (
    HEADING_RE.test(rest) ||
    FENCE_RE.test(rest) ||
    rest.startsWith('$$') ||
    IMAGE_START_RE.test(rest) ||
    rest.startsWith('|') ||
    STANDALONE_COMMENT_RE.test(rest) ||
    END_RE.test(rest)
  )
}

/**
 * Builds a hierarchical block tree from markdown.
 *
 * See the module header for the dialect. Frontmatter is parsed for document
 * metadata and stripped from the content before tokenizing. Block IDs from
 * `<!-- id:… -->` comments are preserved; absent ids are generated.
 */
export function parseMarkdown(markdown: string): {
  tree: BlockNode[]
  metadata: HMMetadata
} {
  const {content, metadata} = parseFrontmatter(markdown)
  const lines = content.split('\n')
  const infos = lines.map(analyzeLine)
  const root: Frame = {list: [], childIndent: 0}
  const stack: Frame[] = [root]
  const top = () => stack[stack.length - 1]!

  /** Pop frames the incoming line no longer belongs to. */
  function adjustStack(info: LineInfo, headingLevel: number | undefined) {
    while (stack.length > 1) {
      const frame = top()
      if (info.indent < frame.childIndent) {
        stack.pop()
        continue
      }
      if (info.indent === frame.childIndent) {
        if (frame.shorthand) {
          if (info.markerKind === frame.shorthand) break
          stack.pop()
          continue
        }
        if (frame.headingLevel !== undefined && headingLevel !== undefined && headingLevel <= frame.headingLevel) {
          stack.pop()
          continue
        }
        break
      }
      // Deeper than this frame's children: a child of the last block we
      // added (which pushed its own frame), or sloppy hand-written
      // indentation — either way it belongs in this frame.
      break
    }
  }

  function isImplicitListStart(frame: Frame, kind: MarkerKind): boolean {
    if (!frame.node) return true // root never holds list items directly
    const parentType = frame.node.block.childrenType
    if (parentType && parentType !== kind) return true
    return frame.list.length > 0 && frame.markerRun !== kind
  }

  function nextNonBlank(from: number): LineInfo | undefined {
    for (let j = from; j < infos.length; j++) if (!infos[j]!.blank) return infos[j]
    return undefined
  }

  let i = 0
  while (i < infos.length) {
    const info = infos[i]!
    if (info.blank) {
      i++
      continue
    }

    // <!-- end:ID --> closes the heading (or any block) with that id.
    const endMatch = END_RE.exec(info.rest)
    if (endMatch && !info.marker) {
      const idx = findLastIndex(stack, (f) => f.node?.block.id === endMatch[1])
      if (idx > 0) stack.length = idx
      i++
      continue
    }

    const headingMatch = HEADING_RE.exec(info.rest)
    adjustStack(info, headingMatch ? headingMatch[1]!.length : undefined)

    let frame = top()

    // A heading holding a merged list gets more, non-list content: wrap the
    // list back into an invisible container so the heading stays a Group.
    if (
      !info.markerKind &&
      !frame.shorthand &&
      frame.node?.block.type === 'Heading' &&
      frame.list.length > 0 &&
      isListType(frame.node.block.childrenType)
    ) {
      const container = makeBlockNode(
        {
          type: 'Paragraph',
          id: generateBlockId(),
          text: '',
          annotations: [],
          childrenType: frame.node.block.childrenType,
        },
        frame.list.splice(0),
      )
      frame.list.push(container)
      frame.node.block.childrenType = 'Group'
      frame.markerRun = undefined
    }

    // A marker line with no explicit structure around it (hand-written
    // markdown): nest under the preceding text paragraph, or start an
    // invisible container.
    if (info.markerKind && !frame.shorthand && isImplicitListStart(frame, info.markerKind)) {
      const prev = frame.list[frame.list.length - 1]
      const canNest =
        prev &&
        prev.block.type === 'Paragraph' &&
        prev.block.text !== '' &&
        prev.children.length === 0 &&
        !prev.block.childrenType
      let target: BlockNode
      if (canNest) {
        target = prev
      } else {
        target = makeBlockNode({type: 'Paragraph', id: generateBlockId(), text: '', annotations: []})
        frame.list.push(target)
        frame.markerRun = undefined
      }
      target.block.childrenType = info.markerKind
      // The target's own frame (pushed when it was added) is stale: replace it.
      if (stack.length > 1 && top().node === target) stack.pop()
      stack.push({node: target, list: target.children, childIndent: info.indent, shorthand: info.markerKind})
      frame = top()
    }

    const parsed = parseBlockAt(i)
    i = parsed.next
    const node = parsed.node

    frame.list.push(node)
    frame.markerRun = info.markerKind
    if (info.markerKind && frame.node && !frame.node.block.childrenType) {
      frame.node.block.childrenType = info.markerKind
    }

    // Push a frame for this block's children.
    if (headingMatch) {
      stack.push({node, list: node.children, childIndent: info.contentCol, headingLevel: headingMatch[1]!.length})
    } else if (parsed.standalone && !info.marker) {
      const following = nextNonBlank(i)
      if (following && following.indent === info.indent && following.markerKind) {
        stack.push({node, list: node.children, childIndent: info.indent, shorthand: following.markerKind})
      } else {
        stack.push({node, list: node.children, childIndent: info.indent + 2})
      }
    } else {
      stack.push({node, list: node.children, childIndent: info.marker ? info.contentCol : info.indent + 2})
    }
  }

  // Blocks that got children without a marker are Group parents.
  const finalize = (nodes: BlockNode[]) => {
    for (const n of nodes) {
      if (n.children.length && !n.block.childrenType && n.block.type !== 'Table' && n.block.type !== 'TableRow') {
        n.block.childrenType = 'Group'
      }
      finalize(n.children)
    }
  }
  finalize(root.list)

  return {tree: root.list, metadata}

  /**
   * Parse the block starting at line `start`. Returns the node and the index
   * of the first line after it. `standalone` marks a comment-only line.
   */
  function parseBlockAt(start: number): {node: BlockNode; next: number; standalone: boolean} {
    const info = infos[start]!
    const rest = info.rest

    // Standalone comment: an invisible block, or the id line of a table.
    const standalone = STANDALONE_COMMENT_RE.exec(rest)
    if (standalone) {
      const comment = commentFromMatch(standalone)
      const following = nextNonBlank(start + 1)
      if (following && following.indent >= info.indent && following.rest.startsWith('|') && !following.marker) {
        const tableLines: string[] = []
        let j = start + 1
        while (j < infos.length && infos[j]!.rest.startsWith('|') && !infos[j]!.blank) {
          tableLines.push(infos[j]!.rest)
          j++
        }
        return {node: createTableNode(tableLines, comment), next: j, standalone: false}
      }
      const type = comment.type || 'Paragraph'
      return {node: makeBlockNode(baseBlock(type, comment)), next: start + 1, standalone: true}
    }

    // Fenced code block: ```lang <!-- id:X -->
    const fence = FENCE_RE.exec(rest)
    if (fence) {
      const fenceLen = fence[1]!.length
      const {text: language, comment} = stripBlockComment(fence[2]!.trim())
      const bodyLines: string[] = []
      let j = start + 1
      while (j < infos.length) {
        const l = infos[j]!
        const closing = /^(`{3,})\s*$/.exec(l.raw.trim())
        if (closing && closing[1]!.length >= fenceLen && l.indent <= info.contentCol) break
        bodyLines.push(stripIndent(l.raw, info.contentCol))
        j++
      }
      j++ // closing fence
      return {node: createCodeNode(bodyLines.join('\n'), language.trim(), comment), next: j, standalone: false}
    }

    // Math block: $$ <!-- id:X -->
    if (rest.startsWith('$$')) {
      const {comment} = stripBlockComment(rest.slice(2).trim())
      const bodyLines: string[] = []
      let j = start + 1
      while (j < infos.length && infos[j]!.raw.trim() !== '$$') {
        bodyLines.push(stripIndent(infos[j]!.raw, info.contentCol))
        j++
      }
      j++
      return {node: createMathNode(bodyLines.join('\n'), comment), next: j, standalone: false}
    }

    // Heading: # text <!-- id:X -->
    const heading = HEADING_RE.exec(rest)
    if (heading) {
      const {text, comment} = stripBlockComment(heading[2]!)
      if (comment?.type) return {node: createTypedNode(text, comment), next: start + 1, standalone: false}
      return {node: createHeadingNode(text, comment), next: start + 1, standalone: false}
    }

    // Table without a preceding id line.
    if (rest.startsWith('|')) {
      const tableLines: string[] = []
      let j = start
      while (j < infos.length && infos[j]!.rest.startsWith('|') && !infos[j]!.blank) {
        tableLines.push(infos[j]!.rest)
        j++
      }
      return {node: createTableNode(tableLines), next: j, standalone: false}
    }

    // Everything else starts as a one-line block with an optional trailing comment.
    const {text: visible, comment} = stripBlockComment(rest)

    if (comment?.type) {
      return {node: createTypedNode(visible, comment), next: start + 1, standalone: false}
    }

    // Standalone image: ![alt](url) <!-- id:X -->
    if (IMAGE_START_RE.test(visible)) {
      const link = readLink(visible, 1)
      if (link && visible.slice(link.end).trim() === '') {
        let url = link.url
        if (url && !url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:/)) url = `file://${url}`
        return {node: createImageNode(link.label, url, comment), next: start + 1, standalone: false}
      }
    }

    // Paragraph. Hand-written soft-wrapped lines (no comment on the first
    // line) join with a space, as CommonMark does.
    let text = visible
    let j = start + 1
    if (!comment) {
      while (j < infos.length) {
        const l = infos[j]!
        if (l.blank || l.marker || l.indent !== info.contentCol || startsSpecialBlock(l.rest)) break
        const {text: more, comment: c} = stripBlockComment(l.rest)
        if (c) break
        text += ' ' + more
        j++
      }
    }
    return {node: createParagraphNode(text, comment), next: j, standalone: false}
  }
}

/** Remove up to `n` leading spaces from a line. */
function stripIndent(line: string, n: number): string {
  let k = 0
  while (k < n && line[k] === ' ') k++
  return line.slice(k)
}

/**
 * Convert the markdown parser's BlockNode tree into HMBlockNode tree.
 *
 * Maps flat SeedBlock properties (childrenType, language) into the
 * HMBlock attributes object, and annotations into the HMAnnotation shape.
 * The resulting tree can be fed into `hmBlocksToEditorContent()` to get
 * BlockNote editor blocks.
 */
export function markdownBlockNodesToHMBlockNodes(nodes: BlockNode[]): HMBlockNode[] {
  return nodes.map((node) => {
    const {block} = node
    const attributes: Record<string, unknown> = {...block.attributes}
    if (block.childrenType !== undefined) {
      attributes.childrenType = block.childrenType
    }
    if (block.language !== undefined) {
      attributes.language = block.language
    }
    const hmBlock: Record<string, unknown> = {
      type: block.type,
      id: block.id,
      text: block.text,
      annotations: block.annotations.map((a) => ({
        type: a.type,
        starts: a.starts,
        ends: a.ends,
        ...(a.link !== undefined ? {link: a.link} : {}),
        ...(a.attributes !== undefined ? {attributes: a.attributes} : {}),
      })),
      attributes,
    }
    if (block.link !== undefined) {
      hmBlock.link = block.link
    }
    return {
      block: hmBlock,
      children: node.children.length > 0 ? markdownBlockNodesToHMBlockNodes(node.children) : undefined,
    } as HMBlockNode
  })
}

// ─── Operations builder ──────────────────────────────────────────────────────

/**
 * Flattens a block tree into Seed document operations.
 *
 * For each block:
 * 1. ReplaceBlock — defines the block content
 * 2. MoveBlocks — positions the block under its parent
 *
 * Operations are ordered so that ReplaceBlock comes before MoveBlocks
 * for each level, and children are processed recursively.
 */
export function flattenToOperations(tree: BlockNode[], parentId: string = ''): DocumentOperation[] {
  const ops: DocumentOperation[] = []
  const blockIds: string[] = []

  for (const node of tree) {
    // Build the block object for ReplaceBlock.
    // Attributes are inlined at the top level of the block (not nested).
    const block: Record<string, unknown> = {
      ...node.block.attributes,
      type: node.block.type,
      id: node.block.id,
      text: node.block.text,
      annotations: node.block.annotations,
    }
    if (node.block.language !== undefined) {
      block['language'] = node.block.language
    }
    if (node.block.childrenType !== undefined) {
      block['childrenType'] = node.block.childrenType
    }
    if (node.block.link !== undefined) {
      block['link'] = node.block.link
    }

    ops.push({type: 'ReplaceBlock', block})
    blockIds.push(node.block.id)

    // Recurse into children
    if (node.children.length > 0) {
      ops.push(...flattenToOperations(node.children, node.block.id))
    }
  }

  // Position all blocks at this level under the parent
  if (blockIds.length > 0) {
    ops.push({type: 'MoveBlocks', blocks: blockIds, parent: parentId})
  }

  return ops
}
