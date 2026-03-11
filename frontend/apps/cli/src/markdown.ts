/**
 * CLI markdown formatter with network resolution support.
 *
 * This is a thin wrapper around @seed-hypermedia/client's pure
 * `blocksToMarkdown()` that adds optional resolution of embeds,
 * mentions, and queries via a SeedClient.
 *
 * For non-resolved output, use `blocksToMarkdown()` from the client
 * SDK directly.
 */

import type {HMBlockNode, HMBlock, HMAnnotation, HMDocument, HMMetadata} from '@seed-hypermedia/client/hm-types'
import type {SeedClient} from '@seed-hypermedia/client'
import {emitFrontmatter} from '@seed-hypermedia/client'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'

export type MarkdownOptions = {
  resolve?: boolean // Enable automatic resolution of embeds/mentions/queries
  client?: SeedClient // Required if resolve is true
  maxDepth?: number // Max embed recursion depth (default 2)
}

// Re-export the pure conversion for non-resolved use
export {blocksToMarkdown} from '@seed-hypermedia/client'

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Convert a document to markdown with frontmatter, block IDs, and
 * optional resolution of embeds/mentions/queries.
 *
 * When `resolve` is false (default), this delegates to the pure
 * `blocksToMarkdown()` from the client SDK.
 *
 * When `resolve` is true, embeds and queries are fetched via the
 * provided SeedClient and their content is inlined.
 */
export async function documentToMarkdown(doc: HMDocument, options?: MarkdownOptions): Promise<string> {
  const resolve = options?.resolve ?? false

  // Fast path: no resolution needed → use pure sync conversion
  if (!resolve || !options?.client) {
    // Inline the pure conversion to avoid async overhead
    const {blocksToMarkdown} = await import('@seed-hypermedia/client')
    return blocksToMarkdown(doc)
  }

  // Slow path: resolve embeds/mentions/queries
  const lines: string[] = []
  const ctx: ResolveContext = {
    client: options.client,
    resolve: true,
    maxDepth: options.maxDepth ?? 2,
    currentDepth: 0,
    cache: new Map(),
  }

  // Always emit frontmatter
  lines.push(emitFrontmatter(doc.metadata || {}))

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
  client: SeedClient
  resolve: boolean
  maxDepth: number
  currentDepth: number
  cache: Map<string, {name?: string; content?: HMBlockNode[]}>
}

// ── Block ID helpers ─────────────────────────────────────────────────────────

function idComment(id: string): string {
  return `<!-- id:${id} -->`
}

function appendIdToFirstLine(md: string, id: string): string {
  const newline = md.indexOf('\n')
  if (newline === -1) {
    return md ? `${md} ${idComment(id)}` : idComment(id)
  }
  return `${md.slice(0, newline)} ${idComment(id)}${md.slice(newline)}`
}

// ── Block rendering with resolution ──────────────────────────────────────────

async function blockNodeToMarkdown(node: HMBlockNode, depth: number, ctx: ResolveContext): Promise<string> {
  const block = node.block
  const children = node.children || []
  const childrenType = (block as {attributes?: {childrenType?: string}}).attributes?.childrenType

  const isListContainer =
    block.type === 'Paragraph' &&
    !block.text &&
    (childrenType === 'Ordered' || childrenType === 'Unordered' || childrenType === 'Blockquote')

  let result: string

  if (isListContainer) {
    result = idComment(block.id)
  } else {
    result = await blockToMarkdown(block, depth, ctx)
  }

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

async function blockToMarkdown(block: HMBlock, depth: number, ctx: ResolveContext): Promise<string> {
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
      const rendered = ind + (await applyAnnotations(text, annotations, ctx))
      return appendIdToFirstLine(rendered, id)
    }

    case 'Heading': {
      const level = Math.min(depth + 1, 6)
      const hashes = '#'.repeat(level)
      const rendered = `${hashes} ${await applyAnnotations(text, annotations, ctx)}`
      return appendIdToFirstLine(rendered, id)
    }

    case 'Code': {
      const lang = (b.attributes?.language as string) || ''
      return ind + '```' + lang + ' ' + idComment(id) + '\n' + ind + text + '\n' + ind + '```'
    }

    case 'Math': {
      return ind + '$$ ' + idComment(id) + '\n' + ind + text + '\n' + ind + '$$'
    }

    case 'Image': {
      const altText = text || 'image'
      const imgUrl = formatMediaUrl(link)
      return ind + `![${altText}](${imgUrl}) ${idComment(id)}`
    }

    case 'Video': {
      const videoUrl = formatMediaUrl(link)
      return ind + `[Video](${videoUrl}) ${idComment(id)}`
    }

    case 'File': {
      const fileName = (b.attributes?.name as string) || 'file'
      const fileUrl = formatMediaUrl(link)
      return ind + `[${fileName}](${fileUrl}) ${idComment(id)}`
    }

    case 'Embed': {
      const rendered = await resolveBlockEmbed(block, depth, ctx)
      return appendIdToFirstLine(rendered, id)
    }

    case 'WebEmbed': {
      return ind + `[Web Embed](${link}) ${idComment(id)}`
    }

    case 'Button': {
      const buttonText = text || 'Button'
      return ind + `[${buttonText}](${link}) ${idComment(id)}`
    }

    case 'Query': {
      const rendered = await resolveQuery(block, depth, ctx)
      return appendIdToFirstLine(rendered, id)
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

// ── Embed/query resolution ───────────────────────────────────────────────────

async function resolveBlockEmbed(block: HMBlock, depth: number, ctx: ResolveContext): Promise<string> {
  const ind = indent(depth)
  const link = (block as {link?: string}).link || ''

  if (ctx.currentDepth >= ctx.maxDepth) {
    return ind + `> [Embed: ${link}](${link})`
  }

  try {
    const unpacked = unpackHmId(link)
    if (!unpacked) {
      return ind + `> [Embed: ${link}](${link})`
    }

    const cacheKey = link
    let cached = ctx.cache.get(cacheKey)

    if (!cached) {
      const result = await ctx.client.request('Resource', unpacked)
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

    let contentToRender = cached.content
    if (unpacked.blockRef && cached.content) {
      const targetBlock = findBlockById(cached.content, unpacked.blockRef as string)
      if (targetBlock) {
        contentToRender = [targetBlock]
      }
    }

    if (contentToRender && contentToRender.length > 0) {
      const nestedCtx = {...ctx, currentDepth: ctx.currentDepth + 1}
      const lines: string[] = []

      if (cached.name && !unpacked.blockRef) {
        lines.push(ind + `> **[${cached.name}](${link})**`)
      }

      for (const node of contentToRender) {
        const blockMd = await blockNodeToMarkdown(node, depth, nestedCtx)
        if (blockMd) {
          lines.push(
            blockMd
              .split('\n')
              .map((l) => ind + '> ' + l.trim())
              .join('\n'),
          )
        }
      }

      return lines.join('\n')
    }

    return ind + `> [Embed: ${link}](${link})`
  } catch {
    return ind + `> [Embed: ${link}](${link})`
  }
}

async function resolveQuery(block: HMBlock, depth: number, ctx: ResolveContext): Promise<string> {
  const ind = indent(depth)

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
      if (!space) {
        return ind + `<!-- Query: no space specified -->`
      }
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

    if (!results || !results.results || results.results.length === 0) {
      return ind + `<!-- Query: no results -->`
    }

    const lines: string[] = []

    for (const doc of results.results) {
      const name = doc.metadata?.name || doc.id.path?.join('/') || doc.id.uid
      const docId = doc.id.id
      lines.push(ind + `- [${name}](${docId})`)
    }

    return lines.join('\n')
  } catch (e) {
    return ind + `<!-- Query error: ${(e as Error).message} -->`
  }
}

// ── Annotation rendering with embed resolution ──────────────────────────────

async function applyAnnotations(
  text: string,
  annotations: HMAnnotation[] | undefined,
  ctx: ResolveContext,
): Promise<string> {
  if (!annotations || annotations.length === 0) {
    return text
  }

  type Marker = {pos: number; type: 'open' | 'close'; annotation: HMAnnotation}
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

  markers.sort((a, b) => {
    if (a.pos !== b.pos) return a.pos - b.pos
    return a.type === 'open' ? -1 : 1
  })

  let result = ''
  let lastPos = 0

  for (const marker of markers) {
    result += text.slice(lastPos, marker.pos)
    lastPos = marker.pos
    result += await getAnnotationMarker(marker.annotation, marker.type, ctx)
  }

  result += text.slice(lastPos)
  result = result.replace(/\uFFFC/g, '')

  return result
}

async function getAnnotationMarker(ann: HMAnnotation, type: 'open' | 'close', ctx: ResolveContext): Promise<string> {
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
      return await resolveInlineEmbed(ann, type, ctx)
    default:
      return ''
  }
}

async function resolveInlineEmbed(ann: HMAnnotation, type: 'open' | 'close', ctx: ResolveContext): Promise<string> {
  const link = 'link' in ann ? (ann.link as string) || '' : ''

  if (type === 'open') {
    if (link) {
      try {
        const cacheKey = link
        let cached = ctx.cache.get(cacheKey)

        if (!cached) {
          const unpacked = unpackHmId(link)
          if (unpacked) {
            const result = await ctx.client.request('ResourceMetadata', unpacked)
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

    const pathPart = link.includes('/') ? link.split('/').pop() || 'embed' : link.replace('hm://', '').slice(0, 12)
    return `[↗ ${pathPart}`
  } else {
    return `](${link})`
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function findBlockById(content: HMBlockNode[], blockId: string): HMBlockNode | null {
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

function formatMediaUrl(url: string): string {
  if (url.startsWith('ipfs://')) {
    const cid = url.slice(7)
    return `https://ipfs.io/ipfs/${cid}`
  }
  return url
}

function indent(depth: number): string {
  return '  '.repeat(depth)
}

// Re-export types for backward compatibility
export type {HMDocument, HMMetadata}
