/**
 * Markdown formatter for Seed Hypermedia documents
 * Supports automatic resolution of embeds, mentions, and queries
 */

import type {BlockNode, Block, Annotation, Document, Metadata, Client} from './client'
import {unpackHmId} from './utils/hm-id'

export type MarkdownOptions = {
  includeMetadata?: boolean
  includeFrontmatter?: boolean
  resolve?: boolean // Enable automatic resolution of embeds/mentions/queries
  client?: Client // Required if resolve is true
  maxDepth?: number // Max embed recursion depth (default 2)
}

/**
 * Convert a document to markdown
 */
export async function documentToMarkdown(
  doc: Document,
  options?: MarkdownOptions
): Promise<string> {
  const lines: string[] = []
  const ctx: ResolveContext = {
    client: options?.client,
    resolve: options?.resolve ?? false,
    maxDepth: options?.maxDepth ?? 2,
    currentDepth: 0,
    cache: new Map(),
  }

  // Optional frontmatter
  if (options?.includeFrontmatter && doc.metadata) {
    lines.push('---')
    if (doc.metadata.name) lines.push(`title: "${doc.metadata.name}"`)
    if (doc.metadata.summary) lines.push(`summary: "${doc.metadata.summary}"`)
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
  for (const node of doc.content) {
    const blockMd = await blockNodeToMarkdown(node, 0, ctx)
    if (blockMd) {
      lines.push(blockMd)
    }
  }

  return lines.join('\n')
}

type ResolveContext = {
  client?: Client
  resolve: boolean
  maxDepth: number
  currentDepth: number
  cache: Map<string, {name?: string; content?: BlockNode[]}>
}

/**
 * Convert a block node (with children) to markdown
 */
async function blockNodeToMarkdown(
  node: BlockNode,
  depth: number,
  ctx: ResolveContext
): Promise<string> {
  const block = node.block
  const children = node.children || []

  let result = await blockToMarkdown(block, depth, ctx)

  // Handle children based on childrenType
  const childrenType = block.attributes?.childrenType as string | undefined

  for (const child of children) {
    const childMd = await blockNodeToMarkdown(child, depth + 1, ctx)
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
  depth: number,
  ctx: ResolveContext
): Promise<string> {
  const ind = indent(depth)

  switch (block.type) {
    case 'Paragraph':
      return ind + (await applyAnnotations(block.text || '', block.annotations, ctx))

    case 'Heading':
      // Use depth to determine heading level (max h6)
      const level = Math.min(depth + 1, 6)
      const hashes = '#'.repeat(level)
      return `${hashes} ${await applyAnnotations(block.text || '', block.annotations, ctx)}`

    case 'Code':
      const lang = block.attributes?.language || ''
      return ind + '```' + lang + '\n' + ind + (block.text || '') + '\n' + ind + '```'

    case 'Math':
      // LaTeX math block
      return ind + '$$\n' + ind + (block.text || '') + '\n' + ind + '$$'

    case 'Image':
      const altText = block.text || 'image'
      const imgUrl = formatMediaUrl(block.link || '')
      return ind + `![${altText}](${imgUrl})`

    case 'Video':
      const videoUrl = formatMediaUrl(block.link || '')
      return ind + `[Video](${videoUrl})`

    case 'File':
      const fileName = block.attributes?.name || 'file'
      const fileUrl = formatMediaUrl(block.link || '')
      return ind + `[${fileName}](${fileUrl})`

    case 'Embed':
      return await resolveBlockEmbed(block, depth, ctx)

    case 'WebEmbed':
      return ind + `[Web Embed](${block.link})`

    case 'Button':
      const buttonText = block.text || 'Button'
      return ind + `[${buttonText}](${block.link})`

    case 'Query':
      return await resolveQuery(block, depth, ctx)

    case 'Nostr':
      return ind + `[Nostr: ${block.link}](${block.link})`

    default:
      // Unknown block type
      if (block.text) {
        return ind + block.text
      }
      return ''
  }
}

/**
 * Resolve a block-level embed
 */
async function resolveBlockEmbed(
  block: Block,
  depth: number,
  ctx: ResolveContext
): Promise<string> {
  const ind = indent(depth)
  const link = block.link || ''

  if (!ctx.resolve || !ctx.client || ctx.currentDepth >= ctx.maxDepth) {
    return ind + `> [Embed: ${link}](${link})`
  }

  try {
    const unpacked = unpackHmId(link)
    if (!unpacked) {
      return ind + `> [Embed: ${link}](${link})`
    }

    // Check cache
    const cacheKey = link
    let cached = ctx.cache.get(cacheKey)

    if (!cached) {
      const result = await ctx.client.getResource(link)
      if (result.type === 'document') {
        cached = {
          name: result.document.metadata?.name,
          content: result.document.content,
        }
        ctx.cache.set(cacheKey, cached)
      } else {
        return ind + `> [Embed: ${link}](${link})`
      }
    }

    // Find specific block if blockRef specified
    let contentToRender = cached.content
    if (unpacked.blockRef && cached.content) {
      const targetBlock = findBlockById(cached.content, unpacked.blockRef)
      if (targetBlock) {
        contentToRender = [targetBlock]
      }
    }

    // Render embedded content
    if (contentToRender && contentToRender.length > 0) {
      const nestedCtx = {...ctx, currentDepth: ctx.currentDepth + 1}
      const lines: string[] = []

      // Add embed header with link
      if (cached.name && !unpacked.blockRef) {
        lines.push(ind + `> **[${cached.name}](${link})**`)
      }

      for (const node of contentToRender) {
        const blockMd = await blockNodeToMarkdown(node, depth, nestedCtx)
        if (blockMd) {
          // Quote the embedded content
          lines.push(
            blockMd
              .split('\n')
              .map((l) => ind + '> ' + l.trim())
              .join('\n')
          )
        }
      }

      return lines.join('\n')
    }

    return ind + `> [Embed: ${link}](${link})`
  } catch (e) {
    return ind + `> [Embed: ${link}](${link})`
  }
}

/**
 * Resolve a query block
 */
async function resolveQuery(
  block: Block,
  depth: number,
  ctx: ResolveContext
): Promise<string> {
  const ind = indent(depth)

  if (!ctx.resolve || !ctx.client) {
    return ind + `<!-- Query block -->`
  }

  try {
    const attrs = block.attributes as Record<string, unknown> | undefined
    const queryConfig = attrs?.query as {
      includes?: Array<{space: string; path?: string; mode?: string}>
      sort?: Array<{term: string; reverse?: boolean}>
      limit?: number
    } | undefined

    // Handle both old (flat) and new (nested query) formats
    let includes: Array<{space: string; path?: string; mode: 'Children' | 'AllDescendants'}>
    let sort: Array<{term: string; reverse?: boolean}> | undefined
    let limit: number | undefined

    if (queryConfig?.includes) {
      // New format with nested query object
      includes = queryConfig.includes.map((inc) => ({
        space: inc.space,
        path: inc.path,
        mode: (inc.mode as 'Children' | 'AllDescendants') || 'Children',
      }))
      sort = queryConfig.sort
      limit = queryConfig.limit
    } else {
      // Old flat format
      const space = (attrs?.space as string) || ''
      if (!space) {
        return ind + `<!-- Query: no space specified -->`
      }
      includes = [{
        space,
        path: attrs?.path as string | undefined,
        mode: (attrs?.mode as 'Children' | 'AllDescendants') || 'Children',
      }]
    }

    const results = await ctx.client.query(
      includes,
      sort || [{term: 'UpdateTime', reverse: true}],
      limit || 10
    )

    if (!results.results || results.results.length === 0) {
      return ind + `<!-- Query: no results -->`
    }

    const lines: string[] = []

    for (const doc of results.results) {
      const name = doc.metadata?.name || doc.id.path?.join('/') || doc.id.uid
      const id = doc.id.id
      lines.push(ind + `- [${name}](${id})`)
    }

    return lines.join('\n')
  } catch (e) {
    return ind + `<!-- Query error: ${(e as Error).message} -->`
  }
}

/**
 * Find a block by ID in content tree
 */
function findBlockById(content: BlockNode[], blockId: string): BlockNode | null {
  for (const node of content) {
    if (node.block.id === blockId) {
      return node
    }
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
  annotations: Annotation[] | undefined,
  ctx: ResolveContext
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
    // Add text before this marker
    result += text.slice(lastPos, marker.pos)
    lastPos = marker.pos

    // Add marker
    result += await getAnnotationMarker(marker.annotation, marker.type, ctx)
  }

  // Add remaining text
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
  type: 'open' | 'close',
  ctx: ResolveContext
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
      // Markdown doesn't have underline, use HTML
      return type === 'open' ? '<u>' : '</u>'
    case 'Link':
      if (type === 'open') {
        return '['
      } else {
        return `](${ann.link || ''})`
      }
    case 'Embed':
      // Inline embed - resolve to name if possible
      return await resolveInlineEmbed(ann, type, ctx)
    default:
      return ''
  }
}

/**
 * Resolve inline embed/mention to show name
 */
async function resolveInlineEmbed(
  ann: Annotation,
  type: 'open' | 'close',
  ctx: ResolveContext
): Promise<string> {
  const link = ann.link || ''

  if (type === 'open') {
    // Try to resolve name
    if (ctx.resolve && ctx.client && link) {
      try {
        const cacheKey = link
        let cached = ctx.cache.get(cacheKey)

        if (!cached) {
          const unpacked = unpackHmId(link)
          if (unpacked) {
            // Try to get metadata
            const result = await ctx.client.getResourceMetadata(link)
            cached = {name: result.metadata?.name}
            ctx.cache.set(cacheKey, cached)
          }
        }

        if (cached?.name) {
          return `[@${cached.name}`
        }
      } catch {
        // Fall through to default
      }
    }

    // Default: show UID snippet
    const pathPart = link.includes('/') ? link.split('/').pop() || 'embed' : link.replace('hm://', '').slice(0, 12)
    return `[↗ ${pathPart}`
  } else {
    return `](${link})`
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
 * Format metadata as a simple header
 */
export function metadataToMarkdown(metadata: Metadata | null): string {
  if (!metadata) return ''

  const lines: string[] = []

  if (metadata.name) {
    lines.push(`# ${metadata.name}`)
  }
  if (metadata.summary) {
    lines.push('')
    lines.push(`> ${metadata.summary}`)
  }

  return lines.join('\n')
}
