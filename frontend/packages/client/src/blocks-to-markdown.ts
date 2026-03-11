/**
 * Seed block tree → Markdown formatter.
 *
 * Converts HMDocument/HMBlockNode trees to markdown with:
 *   - YAML frontmatter (always emitted, all HMMetadata fields)
 *   - Block IDs preserved as HTML comments (<!-- id:XXXXXXXX -->)
 *   - Inline annotations rendered as markdown formatting
 *
 * This module is purely synchronous and does NOT resolve embeds, mentions,
 * or queries over the network. For resolved output, use the CLI's wrapper
 * which adds a SeedClient-backed resolve layer on top.
 *
 * Round-trip compatible: output can be piped back through `parseMarkdown()`
 * to recreate the same document with block IDs preserved.
 */

import type {HMBlockNode, HMBlock, HMAnnotation, HMDocument, HMMetadata} from './hm-types'

// ─── Options ─────────────────────────────────────────────────────────────────

export type BlocksToMarkdownOptions = {
  /** Format ipfs:// URLs as https gateway URLs. Default: true. */
  ipfsGateway?: boolean
}

// ─── Frontmatter ─────────────────────────────────────────────────────────────

/** HMMetadata keys that are strings (emitted as YAML scalars). */
const FM_STRING_KEYS: (keyof HMMetadata)[] = [
  'name',
  'summary',
  'displayAuthor',
  'displayPublishTime',
  'icon',
  'cover',
  'siteUrl',
  'layout',
  'seedExperimentalLogo',
  'seedExperimentalHomeOrder',
  'contentWidth',
  'importCategories',
  'importTags',
]

/** HMMetadata keys that are booleans (emitted as YAML true/false). */
const FM_BOOLEAN_KEYS: (keyof HMMetadata)[] = ['showOutline', 'showActivity']

/**
 * Emit YAML frontmatter from HMMetadata.
 * Only includes fields that have defined, non-empty values.
 * System fields (authors, version, genesis, account) are NOT emitted.
 */
export function emitFrontmatter(metadata: HMMetadata): string {
  const lines: string[] = []

  // String fields
  for (const key of FM_STRING_KEYS) {
    const val = metadata[key]
    if (val !== undefined && val !== '') {
      lines.push(`${key}: ${JSON.stringify(val)}`)
    }
  }

  // Boolean fields
  for (const key of FM_BOOLEAN_KEYS) {
    const val = metadata[key]
    if (val !== undefined) {
      lines.push(`${key}: ${val}`)
    }
  }

  // Nested theme object
  if (metadata.theme && typeof metadata.theme === 'object') {
    const entries: string[] = []
    if (metadata.theme.headerLayout !== undefined) {
      entries.push(`  headerLayout: ${JSON.stringify(metadata.theme.headerLayout)}`)
    }
    if (entries.length > 0) {
      lines.push('theme:')
      lines.push(...entries)
    }
  }

  if (lines.length === 0) return '---\n---\n'
  return '---\n' + lines.join('\n') + '\n---\n'
}

// ─── Block ID helpers ────────────────────────────────────────────────────────

/** Format a block ID as an inline HTML comment. */
function idComment(id: string): string {
  return `<!-- id:${id} -->`
}

/**
 * Append a block ID comment to the first line of a markdown string.
 * If the string is empty, returns just the comment.
 */
function appendIdToFirstLine(md: string, id: string): string {
  const newline = md.indexOf('\n')
  if (newline === -1) {
    // Single line
    return md ? `${md} ${idComment(id)}` : idComment(id)
  }
  // Multi-line: append to first line only
  return `${md.slice(0, newline)} ${idComment(id)}${md.slice(newline)}`
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
  const lines: string[] = []

  // Always emit frontmatter
  lines.push(emitFrontmatter(doc.metadata || {}))

  // Content blocks
  for (const node of doc.content) {
    const blockMd = blockNodeToMarkdown(node, 0, opts)
    if (blockMd) {
      lines.push(blockMd)
    }
  }

  return lines.join('\n')
}

/**
 * Convert a block node (with children) to markdown.
 *
 * Children are rendered based on `childrenType`:
 *   - Ordered/Unordered/Blockquote → prefixed list items
 *   - Group (default) → nested blocks
 *
 * Container blocks (empty text with childrenType like "Unordered")
 * get a standalone block ID comment on their own line before the
 * list content, since they have no visible text line to attach to.
 */
function blockNodeToMarkdown(node: HMBlockNode, depth: number, opts: Required<BlocksToMarkdownOptions>): string {
  const block = node.block
  const children = node.children || []
  const childrenType = (block as {attributes?: {childrenType?: string}}).attributes?.childrenType

  // Check if this is an invisible list container (empty paragraph with childrenType)
  const isListContainer =
    block.type === 'Paragraph' &&
    !block.text &&
    (childrenType === 'Ordered' || childrenType === 'Unordered' || childrenType === 'Blockquote')

  let result: string

  if (isListContainer) {
    // Standalone ID comment for the invisible container
    result = idComment(block.id)
  } else {
    result = blockToMarkdown(block, depth, opts)
  }

  // Render children
  for (const child of children) {
    const childMd = blockNodeToMarkdown(child, depth + 1, opts)
    if (childMd) {
      if (childrenType === 'Ordered') {
        // List items already have their block ID from blockToMarkdown
        result += '\n' + indent(depth + 1) + '1. ' + childMd.trim()
      } else if (childrenType === 'Unordered') {
        result += '\n' + indent(depth + 1) + '- ' + childMd.trim()
      } else if (childrenType === 'Blockquote') {
        result += '\n' + indent(depth + 1) + '> ' + childMd.trim()
      } else {
        result += '\n' + childMd
      }
    }
  }

  return result
}

/**
 * Convert a single block to markdown with its block ID embedded.
 */
function blockToMarkdown(block: HMBlock, depth: number, opts: Required<BlocksToMarkdownOptions>): string {
  const ind = indent(depth)
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
    case 'Paragraph': {
      const rendered = ind + applyAnnotations(text, annotations)
      return appendIdToFirstLine(rendered, id)
    }

    case 'Heading': {
      const level = Math.min(depth + 1, 6)
      const hashes = '#'.repeat(level)
      const rendered = `${hashes} ${applyAnnotations(text, annotations)}`
      return appendIdToFirstLine(rendered, id)
    }

    case 'Code': {
      const lang = (b.attributes?.language as string) || ''
      // ID on the opening fence line
      return ind + '```' + lang + ' ' + idComment(id) + '\n' + ind + text + '\n' + ind + '```'
    }

    case 'Math': {
      // ID on the $$ opener line
      return ind + '$$ ' + idComment(id) + '\n' + ind + text + '\n' + ind + '$$'
    }

    case 'Image': {
      const altText = text || 'image'
      const imgUrl = formatMediaUrl(link, opts.ipfsGateway)
      return ind + `![${altText}](${imgUrl}) ${idComment(id)}`
    }

    case 'Video': {
      const videoUrl = formatMediaUrl(link, opts.ipfsGateway)
      return ind + `[Video](${videoUrl}) ${idComment(id)}`
    }

    case 'File': {
      const fileName = (b.attributes?.name as string) || 'file'
      const fileUrl = formatMediaUrl(link, opts.ipfsGateway)
      return ind + `[${fileName}](${fileUrl}) ${idComment(id)}`
    }

    case 'Embed': {
      // Unresolved embed — render as blockquote link placeholder
      return ind + `> [Embed: ${link}](${link}) ${idComment(id)}`
    }

    case 'WebEmbed': {
      return ind + `[Web Embed](${link}) ${idComment(id)}`
    }

    case 'Button': {
      const buttonText = text || 'Button'
      return ind + `[${buttonText}](${link}) ${idComment(id)}`
    }

    case 'Query': {
      // Unresolved query — render as HTML comment placeholder
      return ind + `<!-- Query block --> ${idComment(id)}`
    }

    case 'Nostr': {
      return ind + `[Nostr: ${link}](${link}) ${idComment(id)}`
    }

    default: {
      if (text) {
        return appendIdToFirstLine(ind + text, id)
      }
      return ''
    }
  }
}

// ─── Annotation rendering ────────────────────────────────────────────────────

/**
 * Apply text annotations (bold, italic, links, etc.) to produce markdown.
 */
function applyAnnotations(text: string, annotations: HMAnnotation[] | undefined): string {
  if (!annotations || annotations.length === 0) {
    return text
  }

  type Marker = {pos: number; type: 'open' | 'close'; annotation: HMAnnotation}
  const markers: Marker[] = []

  for (const ann of annotations) {
    const starts = ann.starts || []
    const ends = ann.ends || []

    for (let i = 0; i < starts.length; i++) {
      markers.push({pos: starts[i]!, type: 'open', annotation: ann})
      if (ends[i] !== undefined) {
        markers.push({pos: ends[i]!, type: 'close', annotation: ann})
      }
    }
  }

  markers.sort((a, b) => {
    if (a.pos !== b.pos) return a.pos - b.pos
    return a.type === 'open' ? -1 : 1
  })

  let result = ''
  let lastPos = 0

  for (const marker of markers) {
    result += text.slice(lastPos, marker.pos)
    lastPos = marker.pos
    result += getAnnotationMarker(marker.annotation, marker.type)
  }

  result += text.slice(lastPos)
  result = result.replace(/\uFFFC/g, '')

  return result
}

/**
 * Get markdown marker for an annotation open/close.
 */
function getAnnotationMarker(ann: HMAnnotation, type: 'open' | 'close'): string {
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
      if (type === 'open') {
        return '['
      } else {
        return `](${ann.link || ''})`
      }
    case 'Embed': {
      const link = 'link' in ann ? (ann.link as string) || '' : ''
      if (type === 'open') {
        const pathPart = link.includes('/') ? link.split('/').pop() || 'embed' : link.replace('hm://', '').slice(0, 12)
        return `[↗ ${pathPart}`
      } else {
        return `](${link})`
      }
    }
    default:
      return ''
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
 * Create indentation string.
 */
function indent(depth: number): string {
  return '  '.repeat(depth)
}
