/**
 * Markdown → Seed block tree parser.
 *
 * Converts markdown content into a tree of Seed Hypermedia blocks
 * with proper hierarchy: headings contain their content as children,
 * lists use childrenType attributes, and inline formatting becomes
 * annotations.
 *
 * Supports:
 *   - YAML frontmatter (--- delimited) for metadata extraction
 *   - ![alt](url) image syntax for Image blocks
 *   - $$ delimited math blocks
 *   - Block ID preservation via <!-- id:XXXXXXXX --> HTML comments
 *   - `title:` as backward-compatible alias for `name:` in frontmatter
 */

import {parse as parseYaml} from 'yaml'
import type {HMBlockNode, HMMetadata} from './hm-types'
import type {DocumentOperation} from './change'

// ─── Types ───────────────────────────────────────────────────────────────────

export type Annotation = {
  type: string
  starts: number[]
  ends: number[]
  link?: string
}

export type SeedBlock = {
  type: string
  id: string
  text: string
  annotations: Annotation[]
  childrenType?: string
  language?: string
  link?: string
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

/**
 * Parses inline markdown formatting into plain text + annotation spans.
 * Supports: **bold**, *italic*, `code`, [text](url)
 */
export function parseInlineFormatting(raw: string): InlineParseResult {
  const annotations: Annotation[] = []
  let text = ''
  let i = 0

  while (i < raw.length) {
    // Escaped character
    if (raw[i] === '\\' && i + 1 < raw.length) {
      text += raw[i + 1]
      i += 2
      continue
    }

    // Inline image: ![alt](url) — skip the ! so it's not parsed as a link
    // Block-level images are handled by the tokenizer; inline occurrences
    // are treated as plain text with the URL since Seed has no inline image type.
    if (raw[i] === '!' && i + 1 < raw.length && raw[i + 1] === '[') {
      const closeBracket = findClosingBracket(raw, i + 1)
      if (closeBracket !== -1 && closeBracket + 1 < raw.length && raw[closeBracket + 1] === '(') {
        const closeParen = raw.indexOf(')', closeBracket + 2)
        if (closeParen !== -1) {
          // Emit alt text as plain text (no inline image annotation in Seed)
          const altText = raw.slice(i + 2, closeBracket)
          if (altText) {
            text += altText
          }
          i = closeParen + 1
          continue
        }
      }
    }

    // Link: [text](url)
    if (raw[i] === '[') {
      const closeBracket = findClosingBracket(raw, i)
      if (closeBracket !== -1 && closeBracket + 1 < raw.length && raw[closeBracket + 1] === '(') {
        const closeParen = raw.indexOf(')', closeBracket + 2)
        if (closeParen !== -1) {
          const linkText = raw.slice(i + 1, closeBracket)
          const url = raw.slice(closeBracket + 2, closeParen)
          const parsed = parseInlineFormatting(linkText)
          const start = text.length
          text += parsed.text
          const end = text.length

          // Shift nested annotations
          for (const ann of parsed.annotations) {
            annotations.push({
              ...ann,
              starts: ann.starts.map((s) => s + start),
              ends: ann.ends.map((e) => e + start),
            })
          }

          annotations.push({
            type: 'Link',
            starts: [start],
            ends: [end],
            link: url,
          })

          i = closeParen + 1
          continue
        }
      }
    }

    // Bold: **text**
    if (raw[i] === '*' && raw[i + 1] === '*') {
      const end = raw.indexOf('**', i + 2)
      if (end !== -1) {
        const inner = raw.slice(i + 2, end)
        const parsed = parseInlineFormatting(inner)
        const start = text.length
        text += parsed.text

        for (const ann of parsed.annotations) {
          annotations.push({
            ...ann,
            starts: ann.starts.map((s) => s + start),
            ends: ann.ends.map((e) => e + start),
          })
        }

        annotations.push({
          type: 'Bold',
          starts: [start],
          ends: [text.length],
        })

        i = end + 2
        continue
      }
    }

    // Italic: *text* (but not **)
    if (raw[i] === '*' && raw[i + 1] !== '*') {
      const end = findSingleDelimiter(raw, '*', i + 1)
      if (end !== -1) {
        const inner = raw.slice(i + 1, end)
        const parsed = parseInlineFormatting(inner)
        const start = text.length
        text += parsed.text

        for (const ann of parsed.annotations) {
          annotations.push({
            ...ann,
            starts: ann.starts.map((s) => s + start),
            ends: ann.ends.map((e) => e + start),
          })
        }

        annotations.push({
          type: 'Italic',
          starts: [start],
          ends: [text.length],
        })

        i = end + 1
        continue
      }
    }

    // Inline code: `text`
    if (raw[i] === '`') {
      const end = raw.indexOf('`', i + 1)
      if (end !== -1) {
        const start = text.length
        text += raw.slice(i + 1, end)

        annotations.push({
          type: 'Code',
          starts: [start],
          ends: [text.length],
        })

        i = end + 1
        continue
      }
    }

    text += raw[i]
    i++
  }

  return {text, annotations}
}

function findClosingBracket(s: string, openPos: number): number {
  let depth = 0
  for (let i = openPos; i < s.length; i++) {
    if (s[i] === '[') depth++
    if (s[i] === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

function findSingleDelimiter(s: string, delim: string, start: number): number {
  for (let i = start; i < s.length; i++) {
    if (s[i] === delim && s[i + 1] !== delim && (i === 0 || s[i - 1] !== delim)) {
      return i
    }
  }
  return -1
}

// ─── Block ID helpers ────────────────────────────────────────────────────────

/** Regex matching a trailing ` <!-- id:XXXXXXXX -->` HTML comment. */
const BLOCK_ID_RE = /\s*<!--\s*id:([A-Za-z0-9_-]+)\s*-->\s*$/

/**
 * Strip a trailing block ID comment from a string.
 * Returns the cleaned string and the captured ID (or undefined).
 */
function stripBlockId(s: string): {text: string; id?: string} {
  const m = s.match(BLOCK_ID_RE)
  if (m) {
    return {text: s.slice(0, m.index!).trimEnd(), id: m[1]}
  }
  return {text: s}
}

/** Check if a line is a standalone block ID comment (nothing else). */
const STANDALONE_ID_RE = /^\s*<!--\s*id:([A-Za-z0-9_-]+)\s*-->\s*$/

// ─── Markdown block parser ───────────────────────────────────────────────────

type RawBlock =
  | {kind: 'heading'; level: number; text: string; id?: string}
  | {kind: 'paragraph'; text: string; id?: string}
  | {kind: 'code'; language: string; text: string; id?: string}
  | {kind: 'image'; alt: string; url: string; id?: string}
  | {kind: 'math'; text: string; id?: string}
  | {kind: 'ul'; items: {text: string; id?: string}[]; containerId?: string}
  | {kind: 'ol'; items: {text: string; id?: string}[]; containerId?: string}
  | {kind: 'table'; text: string; id?: string}

/**
 * Parses raw markdown into a flat list of block tokens.
 *
 * Recognizes `<!-- id:XXXXXXXX -->` HTML comments:
 *   - Trailing on content lines → captured as block ID
 *   - On code/math fence openers → captured as block ID
 *   - On list items → captured as item ID
 *   - Standalone lines → saved as container ID for the next list
 */
function tokenize(markdown: string): RawBlock[] {
  const lines = markdown.split('\n')
  const blocks: RawBlock[] = []
  let i = 0
  /** Pending container ID from a standalone <!-- id:... --> line. */
  let pendingContainerId: string | undefined

  while (i < lines.length) {
    const line = lines[i]!

    // Blank line — skip
    if (line.trim() === '') {
      i++
      continue
    }

    // Standalone block ID comment (for list containers)
    const standaloneMatch = line.match(STANDALONE_ID_RE)
    if (standaloneMatch) {
      pendingContainerId = standaloneMatch[1]
      i++
      continue
    }

    // Fenced code block: ```lang <!-- id:XXX -->
    if (line.trim().startsWith('```')) {
      const fenceContent = line.trim().slice(3).trim()
      const {text: language, id} = stripBlockId(fenceContent)
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        codeLines.push(lines[i]!)
        i++
      }
      i++ // skip closing ```
      blocks.push({kind: 'code', language, text: codeLines.join('\n'), id})
      pendingContainerId = undefined
      continue
    }

    // Math block: $$ <!-- id:XXX -->
    if (line.trim().startsWith('$$')) {
      const fenceContent = line.trim().slice(2).trim()
      const {id} = stripBlockId(fenceContent)
      const mathLines: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith('$$')) {
        mathLines.push(lines[i]!)
        i++
      }
      i++ // skip closing $$
      blocks.push({kind: 'math', text: mathLines.join('\n'), id})
      pendingContainerId = undefined
      continue
    }

    // Heading: # text <!-- id:XXX -->
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      const {text, id} = stripBlockId(headingMatch[2]!)
      blocks.push({kind: 'heading', level: headingMatch[1]!.length, text, id})
      i++
      pendingContainerId = undefined
      continue
    }

    // Standalone image: ![alt](url) <!-- id:XXX -->
    const imageMatch = line.trim().match(/^!\[([^\]]*)\]\(([^)]+)\)(.*)$/)
    if (imageMatch) {
      let url = imageMatch[2]!
      const trailing = imageMatch[3] || ''
      const {id} = stripBlockId(trailing)
      if (url && !url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)) {
        url = `file://${url}`
      }
      blocks.push({kind: 'image', alt: imageMatch[1]!, url, id})
      i++
      pendingContainerId = undefined
      continue
    }

    // Table (starts with | and has at least a separator line)
    if (line.trim().startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i]!.trim().startsWith('|')) {
        tableLines.push(lines[i]!)
        i++
      }
      blocks.push({kind: 'table', text: tableLines.join('\n')})
      pendingContainerId = undefined
      continue
    }

    // Unordered list: - item <!-- id:XXX -->
    if (/^[-*+]\s+/.test(line.trim())) {
      const items: {text: string; id?: string}[] = []
      while (i < lines.length && /^[-*+]\s+/.test(lines[i]!.trim())) {
        const raw = lines[i]!.trim().replace(/^[-*+]\s+/, '')
        const {text, id} = stripBlockId(raw)
        items.push({text, id})
        i++
      }
      blocks.push({kind: 'ul', items, containerId: pendingContainerId})
      pendingContainerId = undefined
      continue
    }

    // Ordered list: 1. item <!-- id:XXX -->
    if (/^\d+\.\s+/.test(line.trim())) {
      const items: {text: string; id?: string}[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!.trim())) {
        const raw = lines[i]!.trim().replace(/^\d+\.\s+/, '')
        const {text, id} = stripBlockId(raw)
        items.push({text, id})
        i++
      }
      blocks.push({kind: 'ol', items, containerId: pendingContainerId})
      pendingContainerId = undefined
      continue
    }

    // Paragraph — collect consecutive non-blank, non-special lines
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !lines[i]!.trim().startsWith('```') &&
      !lines[i]!.trim().startsWith('$$') &&
      !lines[i]!.trim().startsWith('#') &&
      !lines[i]!.trim().startsWith('|') &&
      !lines[i]!.match(STANDALONE_ID_RE) &&
      !/^!\[([^\]]*)\]\(([^)]+)\)/.test(lines[i]!.trim()) &&
      !/^[-*+]\s+/.test(lines[i]!.trim()) &&
      !/^\d+\.\s+/.test(lines[i]!.trim())
    ) {
      paraLines.push(lines[i]!)
      i++
    }
    if (paraLines.length > 0) {
      // Block ID is on the first line of the paragraph
      const firstLine = paraLines[0]!
      const {text: cleanFirst, id} = stripBlockId(firstLine)
      paraLines[0] = cleanFirst
      blocks.push({kind: 'paragraph', text: paraLines.join('\n'), id})
      pendingContainerId = undefined
    }
  }

  return blocks
}

// ─── Tree builder ────────────────────────────────────────────────────────────

function makeBlockNode(block: SeedBlock, children: BlockNode[] = []): BlockNode {
  return {block, children}
}

function createParagraphNode(rawText: string, id?: string): BlockNode {
  const {text, annotations} = parseInlineFormatting(rawText)
  return makeBlockNode({
    type: 'Paragraph',
    id: id || generateBlockId(),
    text,
    annotations,
  })
}

function createHeadingNode(rawText: string, id?: string): BlockNode {
  const {text, annotations} = parseInlineFormatting(rawText)
  return makeBlockNode(
    {
      type: 'Heading',
      id: id || generateBlockId(),
      text,
      annotations,
      childrenType: 'Group',
    },
    [],
  )
}

function createCodeNode(text: string, language: string, id?: string): BlockNode {
  return makeBlockNode({
    type: 'Code',
    id: id || generateBlockId(),
    text,
    annotations: [],
    language: language || undefined,
  })
}

function createMathNode(text: string, id?: string): BlockNode {
  return makeBlockNode({
    type: 'Math',
    id: id || generateBlockId(),
    text,
    annotations: [],
  })
}

function createImageNode(alt: string, url: string, id?: string): BlockNode {
  return makeBlockNode({
    type: 'Image',
    id: id || generateBlockId(),
    text: alt,
    annotations: [],
    link: url,
  })
}

function createListNode(
  items: {text: string; id?: string}[],
  listType: 'Unordered' | 'Ordered',
  containerId?: string,
): BlockNode[] {
  // Each list item is a child paragraph under a parent with childrenType.
  // The container is an invisible Paragraph with childrenType set.
  const children = items.map((item) => createParagraphNode(item.text, item.id))
  const container = makeBlockNode(
    {
      type: 'Paragraph',
      id: containerId || generateBlockId(),
      text: '',
      annotations: [],
      childrenType: listType,
    },
    children,
  )
  return [container]
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

/** String-typed metadata keys that map 1:1 from frontmatter to HMMetadata. */
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
] as const

/** Boolean-typed metadata keys. */
const METADATA_BOOLEAN_KEYS = ['showOutline', 'showActivity'] as const

/** Enum-typed metadata keys (stored as strings). */
const METADATA_ENUM_KEYS = ['seedExperimentalHomeOrder', 'contentWidth'] as const

/**
 * Strip YAML frontmatter (--- delimited) from markdown content.
 * Returns the remaining content and any parsed metadata.
 *
 * Frontmatter keys map 1:1 to HMMetadata field names (e.g. `name:`,
 * `displayAuthor:`, `displayPublishTime:`, `cover:`, etc.).
 *
 * Also accepts `title:` as a backward-compatible alias for `name:`.
 */
export function parseFrontmatter(markdown: string): {
  content: string
  metadata: HMMetadata
} {
  const trimmed = markdown.trimStart()
  if (!trimmed.startsWith('---')) {
    return {content: markdown, metadata: {}}
  }

  // Find the closing ---
  const endIndex = trimmed.indexOf('\n---', 3)
  if (endIndex === -1) {
    return {content: markdown, metadata: {}}
  }

  const yamlBlock = trimmed.slice(3, endIndex).trim()
  const rest = trimmed.slice(endIndex + 4) // skip past \n---

  const metadata: HMMetadata = {}
  try {
    const parsed = parseYaml(yamlBlock) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') {
      return {content: rest, metadata}
    }

    // String fields
    for (const key of METADATA_STRING_KEYS) {
      const val = coerceString(parsed[key])
      if (val !== undefined) (metadata as Record<string, unknown>)[key] = val
    }

    // Accept `title:` as backward-compat alias for `name:`
    if (!metadata.name && parsed['title']) {
      const val = coerceString(parsed['title'])
      if (val !== undefined) metadata.name = val
    }

    // Boolean fields
    for (const key of METADATA_BOOLEAN_KEYS) {
      if (parsed[key] != null) (metadata as Record<string, unknown>)[key] = Boolean(parsed[key])
    }

    // Enum-like fields (stored as strings)
    for (const key of METADATA_ENUM_KEYS) {
      const val = coerceString(parsed[key])
      if (val !== undefined) (metadata as Record<string, unknown>)[key] = val
    }

    // Nested theme object
    if (parsed['theme'] && typeof parsed['theme'] === 'object') {
      const themeInput = parsed['theme'] as Record<string, unknown>
      const theme: {headerLayout?: 'Center' | ''} = {}
      const hl = themeInput['headerLayout']
      if (hl === 'Center' || hl === '') theme.headerLayout = hl
      if (Object.keys(theme).length > 0) metadata.theme = theme
    }
  } catch {
    // Invalid YAML — ignore frontmatter, return content as-is
    return {content: markdown, metadata: {}}
  }

  return {content: rest, metadata}
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Builds a hierarchical block tree from markdown.
 *
 * The hierarchy is determined by heading levels:
 * - H1 headings are root-level blocks; lower headings and content become children
 * - H2 headings become children of the preceding H1, etc.
 * - Content before the first heading goes to root level
 *
 * YAML frontmatter (--- delimited) is parsed for document metadata
 * (all HMMetadata fields) and stripped from the content before tokenizing.
 *
 * Block IDs from `<!-- id:XXXXXXXX -->` HTML comments are preserved.
 * When no ID is present, random 8-char IDs are generated.
 */
export function parseMarkdown(markdown: string): {
  tree: HMBlockNode[]
  metadata: HMMetadata
} {
  const {content, metadata} = parseFrontmatter(markdown)
  const tokens = tokenize(content)
  const rootNodes: BlockNode[] = []

  // heading stack: [{level, node}] — tracks current hierarchy
  const headingStack: {level: number; node: BlockNode}[] = []

  function addToCurrentParent(node: BlockNode | BlockNode[]) {
    const nodes = Array.isArray(node) ? node : [node]
    if (headingStack.length === 0) {
      rootNodes.push(...nodes)
    } else {
      const parent = headingStack[headingStack.length - 1]!.node
      parent.children.push(...nodes)
    }
  }

  for (const token of tokens) {
    switch (token.kind) {
      case 'heading': {
        const headingNode = createHeadingNode(token.text, token.id)

        // Pop headings from stack that are at same level or deeper
        while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= token.level) {
          headingStack.pop()
        }

        // Add heading to its parent (or root)
        addToCurrentParent(headingNode)

        // Push onto stack
        headingStack.push({level: token.level, node: headingNode})
        break
      }

      case 'paragraph':
        addToCurrentParent(createParagraphNode(token.text, token.id))
        break

      case 'code':
        addToCurrentParent(createCodeNode(token.text, token.language, token.id))
        break

      case 'math':
        addToCurrentParent(createMathNode(token.text, token.id))
        break

      case 'image':
        addToCurrentParent(createImageNode(token.alt, token.url, token.id))
        break

      case 'table':
        // Render tables as code blocks (Seed has no native table type)
        addToCurrentParent(createCodeNode(token.text, '', token.id))
        break

      case 'ul':
        addToCurrentParent(createListNode(token.items, 'Unordered', token.containerId))
        break

      case 'ol':
        addToCurrentParent(createListNode(token.items, 'Ordered', token.containerId))
        break
    }
  }

  return {tree: markdownBlockNodesToHMBlockNodes(rootNodes), metadata}
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
    const attributes: Record<string, unknown> = {}

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
