import {Fragment, Node as PMNode, Schema} from '@tiptap/pm/model'

// The elements ProseMirror's parser treats as blocks.
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'canvas',
  'dd',
  'div',
  'dl',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'li',
  'noscript',
  'ol',
  'output',
  'p',
  'pre',
  'section',
  'table',
  'tfoot',
  'ul',
])

// ProseMirror wraps HTML starting with these in a table before parsing it.
// Parsed on their own they would lose their tags, so such HTML is left alone.
const TABLE_PART_TAGS = new Set(['thead', 'tbody', 'tfoot', 'caption', 'colgroup', 'col', 'tr', 'td', 'th'])

const WHITESPACE_ONLY = /^[ \t\r\n\f]*$/

// Removes the line breaks between top-level block elements of pasted HTML.
export function stripBlockWhitespaces(html: string): string {
  if (html.includes('data-pm-slice')) return html
  const firstTag = /<([a-z][^>\s]*)/i.exec(html)?.[1]?.toLowerCase()
  if (firstTag && TABLE_PART_TAGS.has(firstTag)) return html

  const doc = new DOMParser().parseFromString(html, 'text/html')
  const separators = Array.from(doc.body.childNodes).filter(
    (node) => node.nodeType === Node.TEXT_NODE && WHITESPACE_ONLY.test(node.nodeValue ?? '') && separatesBlocks(node),
  )
  if (!separators.length) return html
  separators.forEach((node) => node.remove())
  return doc.head.innerHTML + doc.body.innerHTML
}

// Whether a whitespace text node sits next to a block element and has nothing inline on either side.
function separatesBlocks(node: ChildNode): boolean {
  const before = contentSibling(node, 'previousSibling')
  const after = contentSibling(node, 'nextSibling')
  if (!before && !after) return false
  return [before, after].every((sibling) => !sibling || isBlockElement(sibling))
}

function contentSibling(node: ChildNode, direction: 'previousSibling' | 'nextSibling'): ChildNode | null {
  let sibling = node[direction]
  while (
    sibling &&
    (sibling.nodeType === Node.COMMENT_NODE ||
      (sibling.nodeType === Node.TEXT_NODE && WHITESPACE_ONLY.test(sibling.nodeValue ?? '')))
  ) {
    sibling = sibling[direction]
  }
  return sibling
}

function isBlockElement(node: ChildNode): boolean {
  return node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName.toLowerCase())
}

type Section = {heading: PMNode; level: number; content: PMNode[]}

/**
 * Moves the blocks that follow each pasted heading into that heading's children, up to the next heading of the same
 * or a higher level.
 */
export function nestBlocksUnderHeadings(fragment: Fragment, schema: Schema): Fragment {
  const blocks = wrapInlineRuns(fragment, schema)
  if (!blocks) return fragment

  const root: PMNode[] = []
  const open: Section[] = []
  const append = (node: PMNode) => (open.length ? open[open.length - 1]!.content : root).push(node)
  const closeSection = () => append(buildSection(open.pop()!, schema))

  blocks.forEach((node) => {
    const level = headingLevel(node)
    if (level === null) {
      append(node)
      return
    }
    while (open.length && open[open.length - 1]!.level >= level) closeSection()
    open.push({heading: node, level, content: []})
  })
  while (open.length) closeSection()

  return Fragment.from(root)
}

/**
 * Wraps each run of top-level inline nodes in a paragraph block, as ProseMirror would when inserting them, so that
 * they can be moved into a section.
 */
function wrapInlineRuns(fragment: Fragment, schema: Schema): PMNode[] | null {
  const blocks: PMNode[] = []
  let inline: PMNode[] = []
  const flushInline = () => {
    if (!inline.length) return
    blocks.push(schema.nodes['blockNode']!.create(null, schema.nodes['paragraph']!.create(null, inline)))
    inline = []
  }

  let valid = true
  fragment.forEach((node) => {
    if (node.isInline) {
      inline.push(node)
      return
    }
    flushInline()
    if (node.type.name === 'blockNode') blocks.push(node)
    else valid = false
  })
  flushInline()

  return valid ? blocks : null
}

function headingLevel(node: PMNode): number | null {
  if (node.type.name !== 'blockNode' || node.firstChild?.type.name !== 'heading') return null
  return Number(node.firstChild.attrs.level)
}

// Puts a section's blocks in its heading's children, after any children the heading already has.
function buildSection({heading, content}: Section, schema: Schema): PMNode {
  if (!content.length) return heading

  const headingContent = heading.firstChild!
  const existing = heading.childCount > 1 ? heading.lastChild : null
  let children = content
  if (existing?.attrs.listType === 'Group') {
    children = [...nodesOf(existing.content), ...content]
  } else if (existing) {
    // The heading's list can't share its children with plain blocks, so it moves under an empty paragraph.
    const list = schema.nodes['blockNode']!.create(null, [schema.nodes['paragraph']!.create(), existing])
    children = [list, ...content]
  }
  const group = schema.nodes['blockChildren']!.create({listType: 'Group'}, children)
  return heading.type.create(heading.attrs, [headingContent, group])
}

function nodesOf(fragment: Fragment): PMNode[] {
  const nodes: PMNode[] = []
  fragment.forEach((node) => nodes.push(node))
  return nodes
}
