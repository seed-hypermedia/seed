/**
 * Server-side markdown converter for Seed Hypermedia documents
 * Enables HTTP GET with .md extension to return raw markdown
 */

import type {BlockNode, Block, Annotation, HMDocument} from '@shm/shared/hm-types'

export type MarkdownOptions = {
  includeMetadata?: boolean
  includeFrontmatter?: boolean
}

/**
 * Convert a document to markdown
 */
export function documentToMarkdown(
  doc: HMDocument,
  options?: MarkdownOptions
): string {
  const lines: string[] = []

  // Optional frontmatter
  if (options?.includeFrontmatter && doc.metadata) {
    lines.push('---')
    if (doc.metadata.name) lines.push(`title: "${escapeYaml(doc.metadata.name)}"`)
    if (doc.metadata.summary) lines.push(`summary: "${escapeYaml(doc.metadata.summary)}"`)
    if (doc.authors?.length) lines.push(`authors: [${doc.authors.join(', ')}]`)
    lines.push(`version: ${doc.version}`)
    lines.push('---')
    lines.push('')
  }

  // Title from metadata
  if (options?.includeMetadata && doc.metadata?.name) {
    lines.push(`# ${doc.metadata.name}`)
    lines.push('')
  }

  // Content blocks
  for (const node of doc.content || []) {
    const blockMd = blockNodeToMarkdown(node, 0)
    if (blockMd) {
      lines.push(blockMd)
    }
  }

  return lines.join('\n')
}

/**
 * Convert a block node (with children) to markdown
 */
function blockNodeToMarkdown(
  node: BlockNode,
  depth: number
): string {
  const block = node.block
  const children = node.children || []

  let result = blockToMarkdown(block, depth)

  // Handle children based on childrenType
  const childrenType = block.attributes?.childrenType as string | undefined

  for (const child of children) {
    const childMd = blockNodeToMarkdown(child, depth + 1)
    if (childMd) {
      if (childrenType === 'Ordered') {
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
 * Convert a single block to markdown
 */
function blockToMarkdown(
  block: Block,
  depth: number
): string {
  const ind = indent(depth)

  switch (block.type) {
    case 'Paragraph':
      return ind + applyAnnotations(block.text || '', block.annotations)

    case 'Heading':
      // Use depth to determine heading level (max h6)
      const level = Math.min(depth + 1, 6)
      const hashes = '#'.repeat(level)
      return `${hashes} ${applyAnnotations(block.text || '', block.annotations)}`

    case 'Code':
      const lang = (block.attributes?.language as string) || ''
      return ind + '```' + lang + '\n' + ind + (block.text || '') + '\n' + ind + '```'

    case 'Math':
      return ind + '$$\n' + ind + (block.text || '') + '\n' + ind + '$$'

    case 'Image':
      const altText = block.text || 'image'
      const imgUrl = formatMediaUrl(block.link || '')
      return ind + `![${altText}](${imgUrl})`

    case 'Video':
      const videoUrl = formatMediaUrl(block.link || '')
      return ind + `[Video](${videoUrl})`

    case 'File':
      const fileName = (block.attributes?.name as string) || 'file'
      const fileUrl = formatMediaUrl(block.link || '')
      return ind + `[${fileName}](${fileUrl})`

    case 'Embed':
      return ind + `> [Embed: ${block.link}](${block.link})`

    case 'WebEmbed':
      return ind + `[Web Embed](${block.link})`

    case 'Button':
      const buttonText = block.text || 'Button'
      return ind + `[${buttonText}](${block.link})`

    case 'Query':
      return ind + `<!-- Query block -->`

    case 'Nostr':
      return ind + `[Nostr: ${block.link}](${block.link})`

    default:
      if (block.text) {
        return ind + block.text
      }
      return ''
  }
}

/**
 * Apply text annotations (bold, italic, links, etc.)
 */
function applyAnnotations(
  text: string,
  annotations: Annotation[] | undefined
): string {
  if (!annotations || annotations.length === 0) {
    return text
  }

  // Build a list of markers with positions
  type Marker = {pos: number; type: 'open' | 'close'; annotation: Annotation}
  const markers: Marker[] = []

  for (const ann of annotations) {
    const starts = ann.starts || []
    const ends = ann.ends || []

    for (let i = 0; i < starts.length; i++) {
      markers.push({pos: starts[i], type: 'open', annotation: ann})
      if (ends[i] !== undefined) {
        markers.push({pos: ends[i], type: 'close', annotation: ann})
      }
    }
  }

  // Sort by position (opens before closes at same position)
  markers.sort((a, b) => {
    if (a.pos !== b.pos) return a.pos - b.pos
    return a.type === 'open' ? -1 : 1
  })

  // Build result string
  let result = ''
  let lastPos = 0

  for (const marker of markers) {
    result += text.slice(lastPos, marker.pos)
    lastPos = marker.pos
    result += getAnnotationMarker(marker.annotation, marker.type)
  }

  result += text.slice(lastPos)

  // Remove object replacement characters (used for inline embeds)
  result = result.replace(/\uFFFC/g, '')

  return result
}

/**
 * Get markdown marker for annotation
 */
function getAnnotationMarker(
  ann: Annotation,
  type: 'open' | 'close'
): string {
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
    case 'Embed':
      if (type === 'open') {
        return `[@`
      } else {
        return `](${ann.link || ''})`
      }
    default:
      return ''
  }
}

/**
 * Format media URL (handle ipfs:// URLs)
 */
function formatMediaUrl(url: string): string {
  if (url.startsWith('ipfs://')) {
    const cid = url.slice(7)
    return `https://ipfs.io/ipfs/${cid}`
  }
  return url
}

/**
 * Create indentation string
 */
function indent(depth: number): string {
  return '  '.repeat(depth)
}

/**
 * Escape string for YAML frontmatter
 */
function escapeYaml(str: string): string {
  return str.replace(/"/g, '\\"').replace(/\n/g, '\\n')
}
