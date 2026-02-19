/**
 * Markdown to Seed block tree parser.
 *
 * Converts markdown content into a tree of Seed Hypermedia blocks
 * with proper hierarchy: headings contain their content as children,
 * lists use childrenType attributes, and inline formatting becomes
 * annotations.
 */

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
}

export type BlockNode = {
  block: SeedBlock
  children: BlockNode[]
}

// ─── Block ID generation ─────────────────────────────────────────────────────

const ID_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'

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

    // Link: [text](url)
    if (raw[i] === '[') {
      const closeBracket = findClosingBracket(raw, i)
      if (
        closeBracket !== -1 &&
        closeBracket + 1 < raw.length &&
        raw[closeBracket + 1] === '('
      ) {
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
    if (
      s[i] === delim &&
      s[i + 1] !== delim &&
      (i === 0 || s[i - 1] !== delim)
    ) {
      return i
    }
  }
  return -1
}

// ─── Markdown block parser ───────────────────────────────────────────────────

type RawBlock =
  | {kind: 'heading'; level: number; text: string}
  | {kind: 'paragraph'; text: string}
  | {kind: 'code'; language: string; text: string}
  | {kind: 'ul'; items: string[]}
  | {kind: 'ol'; items: string[]}
  | {kind: 'table'; text: string}

/**
 * Parses raw markdown into a flat list of block tokens.
 */
function tokenize(markdown: string): RawBlock[] {
  const lines = markdown.split('\n')
  const blocks: RawBlock[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // Blank line — skip
    if (line.trim() === '') {
      i++
      continue
    }

    // Fenced code block
    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      blocks.push({kind: 'code', language, text: codeLines.join('\n')})
      continue
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      blocks.push({
        kind: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2],
      })
      i++
      continue
    }

    // Table (starts with | and has at least a separator line)
    if (line.trim().startsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i])
        i++
      }
      blocks.push({kind: 'table', text: tableLines.join('\n')})
      continue
    }

    // Unordered list
    if (/^[-*+]\s+/.test(line.trim())) {
      const items: string[] = []
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''))
        i++
      }
      blocks.push({kind: 'ul', items})
      continue
    }

    // Ordered list
    if (/^\d+\.\s+/.test(line.trim())) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ''))
        i++
      }
      blocks.push({kind: 'ol', items})
      continue
    }

    // Paragraph — collect consecutive non-blank, non-special lines
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('|') &&
      !/^[-*+]\s+/.test(lines[i].trim()) &&
      !/^\d+\.\s+/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length > 0) {
      blocks.push({kind: 'paragraph', text: paraLines.join('\n')})
    }
  }

  return blocks
}

// ─── Tree builder ────────────────────────────────────────────────────────────

function makeBlockNode(
  block: SeedBlock,
  children: BlockNode[] = [],
): BlockNode {
  return {block, children}
}

function createParagraphNode(rawText: string): BlockNode {
  const {text, annotations} = parseInlineFormatting(rawText)
  return makeBlockNode({
    type: 'Paragraph',
    id: generateBlockId(),
    text,
    annotations,
  })
}

function createHeadingNode(rawText: string): BlockNode {
  const {text, annotations} = parseInlineFormatting(rawText)
  return makeBlockNode(
    {
      type: 'Heading',
      id: generateBlockId(),
      text,
      annotations,
      childrenType: 'Group',
    },
    [],
  )
}

function createCodeNode(text: string, language: string): BlockNode {
  return makeBlockNode({
    type: 'Code',
    id: generateBlockId(),
    text,
    annotations: [],
    language: language || undefined,
  })
}

function createListNode(
  items: string[],
  listType: 'Unordered' | 'Ordered',
): BlockNode[] {
  // Each list item is a child paragraph under a parent with childrenType
  // If there's preceding context, the caller handles setting childrenType.
  // For standalone lists, we create a container paragraph.
  const children = items.map((item) => createParagraphNode(item))
  const container = makeBlockNode(
    {
      type: 'Paragraph',
      id: generateBlockId(),
      text: '',
      annotations: [],
      childrenType: listType,
    },
    children,
  )
  return [container]
}

/**
 * Builds a hierarchical block tree from markdown.
 *
 * The hierarchy is determined by heading levels:
 * - The document title (H1) is extracted separately
 * - H2 headings are root-level blocks; content under them becomes children
 * - H3 headings become children of the preceding H2, etc.
 * - Content before the first heading goes to root level
 */
export function parseMarkdown(markdown: string): {
  title: string
  tree: BlockNode[]
} {
  const tokens = tokenize(markdown)
  const rootNodes: BlockNode[] = []
  let title = ''

  // heading stack: [{level, node}] — tracks current hierarchy
  const headingStack: {level: number; node: BlockNode}[] = []

  function addToCurrentParent(node: BlockNode | BlockNode[]) {
    const nodes = Array.isArray(node) ? node : [node]
    if (headingStack.length === 0) {
      rootNodes.push(...nodes)
    } else {
      const parent = headingStack[headingStack.length - 1].node
      parent.children.push(...nodes)
    }
  }

  for (const token of tokens) {
    switch (token.kind) {
      case 'heading': {
        if (token.level === 1 && !title) {
          // Extract H1 as document title
          title = token.text
          break
        }

        const headingNode = createHeadingNode(token.text)

        // Pop headings from stack that are at same level or deeper
        while (
          headingStack.length > 0 &&
          headingStack[headingStack.length - 1].level >= token.level
        ) {
          headingStack.pop()
        }

        // Add heading to its parent (or root)
        addToCurrentParent(headingNode)

        // Push onto stack
        headingStack.push({level: token.level, node: headingNode})
        break
      }

      case 'paragraph':
        addToCurrentParent(createParagraphNode(token.text))
        break

      case 'code':
        addToCurrentParent(createCodeNode(token.text, token.language))
        break

      case 'table':
        // Render tables as code blocks (Seed has no native table type)
        addToCurrentParent(createCodeNode(token.text, ''))
        break

      case 'ul':
        addToCurrentParent(createListNode(token.items, 'Unordered'))
        break

      case 'ol':
        addToCurrentParent(createListNode(token.items, 'Ordered'))
        break
    }
  }

  return {title, tree: rootNodes}
}

// ─── Operations builder ──────────────────────────────────────────────────────

import type {DocumentOperation} from './signing'

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
export function flattenToOperations(
  tree: BlockNode[],
  parentId: string = '',
): DocumentOperation[] {
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
      block.language = node.block.language
    }

    if (node.block.childrenType !== undefined) {
      block.childrenType = node.block.childrenType
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
