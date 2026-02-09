/**
 * Server-side markdown converter for Seed Hypermedia documents
 * Enables HTTP GET with .md extension to return raw markdown
 */

import type {BlockNode, Block, Annotation, HMDocument, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {hmId, parseHMUrl} from '@shm/shared'
import {grpcClient} from './client.server'
import {resolveResource} from './loaders'

export type MarkdownOptions = {
  includeMetadata?: boolean
  includeFrontmatter?: boolean
}

/**
 * Cache for resolved account names to avoid repeated lookups
 */
const accountNameCache = new Map<string, string>()

/**
 * Cache for resolved embed content to avoid repeated fetches
 */
const embedContentCache = new Map<string, string>()

/**
 * Resolve account display name from account ID
 */
async function resolveAccountName(accountId: string): Promise<string> {
  if (accountNameCache.has(accountId)) {
    return accountNameCache.get(accountId)!
  }
  
  try {
    const account = await grpcClient.documents.getAccount({
      id: accountId,
    })
    
    const name = account.metadata?.name || accountId.slice(0, 8) + '...'
    accountNameCache.set(accountId, name)
    return name
  } catch (e) {
    console.error('Failed to resolve account name for', accountId, e)
    // Fallback to shortened account ID
    const fallbackName = accountId.slice(0, 8) + '...'
    accountNameCache.set(accountId, fallbackName)
    return fallbackName
  }
}

/**
 * Convert a document to markdown
 */
export async function documentToMarkdown(
  doc: HMDocument,
  options?: MarkdownOptions
): Promise<string> {
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
    const blockMd = await blockNodeToMarkdown(node, 0)
    if (blockMd) {
      lines.push(blockMd)
    }
  }

  return lines.join('\n')
}

/**
 * Convert a block node (with children) to markdown
 */
async function blockNodeToMarkdown(
  node: BlockNode,
  depth: number
): Promise<string> {
  const block = node.block
  const children = node.children || []

  let result = await blockToMarkdown(block, depth)

  // Handle children based on childrenType
  const childrenType = block.attributes?.childrenType as string | undefined

  for (const child of children) {
    const childMd = await blockNodeToMarkdown(child, depth + 1)
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
async function blockToMarkdown(
  block: Block,
  depth: number
): Promise<string> {
  const ind = indent(depth)

  switch (block.type) {
    case 'Paragraph':
      return ind + await applyAnnotations(block.text || '', block.annotations)

    case 'Heading':
      // Use depth to determine heading level (max h6)
      const level = Math.min(depth + 1, 6)
      const hashes = '#'.repeat(level)
      return `${hashes} ${await applyAnnotations(block.text || '', block.annotations)}`

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
      return await resolveEmbedBlock(block, ind)

    case 'WebEmbed':
      return ind + `[Web Embed](${block.link})`

    case 'Button':
      const buttonText = block.text || 'Button'
      return ind + `[${buttonText}](${block.link})`

    case 'Query':
      return await resolveQueryBlock(block, ind)

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
 * Resolve an embed block by loading the target document and inlining content
 */
async function resolveEmbedBlock(block: Block, indent: string): Promise<string> {
  if (!block.link) {
    return indent + `> [Embed: No URL]`
  }
  
  // Check cache first for performance
  if (embedContentCache.has(block.link)) {
    return indent + embedContentCache.get(block.link)!
  }
  
  try {
    // Parse the embed URL to get the resource ID
    const parsed = parseHMUrl(block.link)
    if (!parsed) {
      const result = `> [Embed: ${block.link}](${block.link})`
      embedContentCache.set(block.link, result)
      return indent + result
    }
    
    // Use the existing resolveResource function for consistency
    const resourceId = hmId(parsed.uid, {
      path: parsed.path,
      version: parsed.version,
      latest: parsed.latest,
      blockRef: parsed.blockRef,
    })
    
    const resource = await resolveResource(resourceId)
    
    if (resource.type !== 'document' || !resource.document) {
      const result = `> [Embed: ${block.link}](${block.link})`
      embedContentCache.set(block.link, result)
      return indent + result
    }
    
    // Extract relevant content based on blockRef if present
    let content = ''
    if (parsed.blockRef) {
      // Find the specific block referenced
      const targetBlock = findBlockById(resource.document.content || [], parsed.blockRef)
      if (targetBlock) {
        content = targetBlock.text || ''
      }
    } else {
      // Use the document title or first block
      const title = resource.document.metadata?.name
      if (title) {
        content = title
      } else if (resource.document.content?.[0]?.block?.text) {
        content = resource.document.content[0].block.text
      }
    }
    
    let result: string
    if (content) {
      // Format as blockquote with proper indentation
      result = `> ${content.split('\n').join('\n> ')}`
    } else {
      result = `> [Embed: ${block.link}](${block.link})`
    }
    
    embedContentCache.set(block.link, result)
    return indent + result
    
  } catch (e) {
    console.error('Failed to resolve embed:', block.link, e)
    const result = `> [Embed: ${block.link}](${block.link})`
    embedContentCache.set(block.link, result)
    return indent + result
  }
}

/**
 * Resolve a query block by executing the query and generating a list of links
 * TODO: Full implementation would need query execution logic
 */
async function resolveQueryBlock(block: Block, indent: string): Promise<string> {
  try {
    // Extract query information
    const queryText = block.text || ''
    const queryAttrs = block.attributes || {}
    
    // For now, return a descriptive comment showing the query
    // In a full implementation, this would:
    // 1. Parse the query text/attributes
    // 2. Execute the query against the document index
    // 3. Format results as a list of markdown links
    
    if (queryText.trim()) {
      return indent + `<!-- Query: "${queryText}" -->\n${indent}<!-- TODO: Execute query and generate links -->`
    } else {
      return indent + `<!-- Empty query block -->`
    }
  } catch (e) {
    console.error('Failed to resolve query:', block, e)
    return indent + `<!-- Query block error -->`
  }
}

/**
 * Helper function to find a block by ID in a document's content
 */
function findBlockById(content: any[], blockId: string): any | null {
  for (const node of content) {
    if (node.block?.id === blockId) {
      return node.block
    }
    // Recursively search children
    if (node.children) {
      const found = findBlockById(node.children, blockId)
      if (found) return found
    }
  }
  return null
}

/**
 * Apply text annotations (bold, italic, links, etc.)
 */
async function applyAnnotations(
  text: string,
  annotations: Annotation[] | undefined
): Promise<string> {
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
    result += await getAnnotationMarker(marker.annotation, marker.type)
  }

  result += text.slice(lastPos)

  // Remove object replacement characters (used for inline embeds)
  result = result.replace(/\uFFFC/g, '')

  return result
}

/**
 * Get markdown marker for annotation
 */
async function getAnnotationMarker(
  ann: Annotation,
  type: 'open' | 'close'
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
      if (type === 'open') {
        // Check if this is a mention (hm:// link to an account with no path)
        if (ann.link) {
          const parsed = parseHMUrl(ann.link)
          if (parsed?.uid && (!parsed.path || parsed.path.length === 0)) {
            try {
              const name = await resolveAccountName(parsed.uid)
              return `[@${name}](${ann.link})`
            } catch (e) {
              // fallback to link syntax
            }
          }
        }
        return '['
      } else {
        // If we already emitted the full mention markdown in 'open', skip close
        if (ann.link) {
          const parsed = parseHMUrl(ann.link)
          if (parsed?.uid && (!parsed.path || parsed.path.length === 0)) {
            return ''
          }
        }
        return `](${ann.link || ''})`
      }
    case 'Embed':
      if (type === 'open') {
        return '['
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
