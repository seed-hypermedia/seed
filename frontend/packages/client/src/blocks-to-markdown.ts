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

import type {SeedClient} from './client'
import {unpackHmId} from './hm-types'
import type {
  HMBlockNode,
  HMBlock,
  HMAnnotation,
  HMComment,
  HMDocument,
  HMMetadata,
  UnpackedHypermediaId,
} from './hm-types'

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
  'childrenType',
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
        // Group children (default): blank-line separated so CommonMark
        // parsers read each child as a distinct paragraph/block. A single
        // newline would merge siblings into one soft-wrapped paragraph
        // on re-import.
        result += '\n\n' + childMd
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
      // CommonMark autolink: <url>. The ￼ placeholder inside the annotation
      // range is stripped by applyAnnotations' final pass, so the emitted
      // span becomes `<url>` with no literal text between brackets.
      const link = 'link' in ann ? (ann.link as string) || '' : ''
      return type === 'open' ? `<${link}` : '>'
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

/** Options for Seed-client-backed markdown rendering that resolves embeds and mentions. */
export type ResolvedMarkdownOptions = {
  client: Pick<SeedClient, 'request'>
  maxDepth?: number
}

type ResolveContext = {
  client: Pick<SeedClient, 'request'>
  maxDepth: number
  currentDepth: number
  cache: Map<string, ResolvedReference>
}

type ResolvedReference = {
  label: string
  type: 'account' | 'document' | 'comment' | 'unknown'
  content?: HMBlockNode[]
  version?: string
  latestVersion?: string
  author?: string
}

/** Convert a document to markdown, resolving inline mentions and block embeds through a Seed client. */
export async function documentToResolvedMarkdown(doc: HMDocument, options: ResolvedMarkdownOptions): Promise<string> {
  const ctx: ResolveContext = {
    client: options.client,
    maxDepth: options.maxDepth ?? 2,
    currentDepth: 0,
    cache: new Map(),
  }
  return documentToResolvedMarkdownWithContext(doc, ctx)
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
  const ctx: ResolveContext = {
    client: options.client,
    maxDepth: options.maxDepth ?? 2,
    currentDepth: 0,
    cache: new Map(),
  }
  return blockNodesToResolvedMarkdown(content, ctx)
}

async function documentToResolvedMarkdownWithContext(doc: HMDocument, ctx: ResolveContext): Promise<string> {
  const lines = [emitFrontmatter(doc.metadata || {})]
  const body = await blockNodesToResolvedMarkdown(doc.content || [], ctx)
  if (body) lines.push(body)
  return lines.join('\n')
}

async function blockNodesToResolvedMarkdown(nodes: HMBlockNode[], ctx: ResolveContext): Promise<string> {
  const lines: string[] = []
  for (const node of nodes) {
    const blockMd = await resolvedBlockNodeToMarkdown(node, 0, ctx)
    if (blockMd) lines.push(blockMd)
  }
  return lines.join('\n\n')
}

async function resolvedBlockNodeToMarkdown(node: HMBlockNode, depth: number, ctx: ResolveContext): Promise<string> {
  const block = node.block
  const children = node.children || []
  const childrenType = (block as {attributes?: {childrenType?: string}}).attributes?.childrenType
  const isListContainer =
    block.type === 'Paragraph' &&
    !block.text &&
    (childrenType === 'Ordered' || childrenType === 'Unordered' || childrenType === 'Blockquote')

  let result = isListContainer ? resolvedIdComment(block.id) : await resolvedBlockToMarkdown(block, depth, ctx)
  for (const child of children) {
    const childMd = await resolvedBlockNodeToMarkdown(child, depth + 1, ctx)
    if (!childMd) continue
    if (childrenType === 'Ordered') result += '\n' + resolvedIndent(depth + 1) + '1. ' + childMd.trim()
    else if (childrenType === 'Unordered') result += '\n' + resolvedIndent(depth + 1) + '- ' + childMd.trim()
    else if (childrenType === 'Blockquote') result += '\n' + resolvedIndent(depth + 1) + '> ' + childMd.trim()
    else result += '\n\n' + childMd
  }
  return result
}

async function resolvedBlockToMarkdown(block: HMBlock, depth: number, ctx: ResolveContext): Promise<string> {
  const ind = resolvedIndent(depth)
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
    case 'Paragraph':
      return appendResolvedIdToFirstLine(ind + (await applyResolvedAnnotations(text, annotations, ctx)), id)
    case 'Heading': {
      const hashes = '#'.repeat(Math.min(depth + 1, 6))
      return appendResolvedIdToFirstLine(`${hashes} ${await applyResolvedAnnotations(text, annotations, ctx)}`, id)
    }
    case 'Code': {
      const lang = (b.attributes?.language as string) || ''
      return ind + '```' + lang + ' ' + resolvedIdComment(id) + '\n' + ind + text + '\n' + ind + '```'
    }
    case 'Math':
      return ind + '$$ ' + resolvedIdComment(id) + '\n' + ind + text + '\n' + ind + '$$'
    case 'Image':
      return ind + `![${text || 'image'}](${formatResolvedMediaUrl(link)}) ${resolvedIdComment(id)}`
    case 'Video':
      return ind + `[Video](${formatResolvedMediaUrl(link)}) ${resolvedIdComment(id)}`
    case 'File': {
      const fileName = (b.attributes?.name as string) || 'file'
      return ind + `[${fileName}](${formatResolvedMediaUrl(link)}) ${resolvedIdComment(id)}`
    }
    case 'Embed':
      return appendResolvedIdToFirstLine(await resolveBlockEmbed(block, depth, ctx), id)
    case 'WebEmbed':
      return ind + `[Web Embed](${link}) ${resolvedIdComment(id)}`
    case 'Button':
      return ind + `[${text || 'Button'}](${link}) ${resolvedIdComment(id)}`
    case 'Query':
      return appendResolvedIdToFirstLine(await resolveQuery(block, depth, ctx), id)
    case 'Nostr':
      return ind + `[Nostr: ${link}](${link}) ${resolvedIdComment(id)}`
    default:
      return text ? appendResolvedIdToFirstLine(ind + text, id) : ''
  }
}

async function resolveBlockEmbed(block: HMBlock, depth: number, ctx: ResolveContext): Promise<string> {
  const ind = resolvedIndent(depth)
  const link = (block as {link?: string}).link || ''
  if (ctx.currentDepth >= ctx.maxDepth) return ind + `> [Embed: ${link}](${link})`

  const id = unpackHmId(link)
  if (!id) return ind + `> [Embed: ${link}](${link})`

  try {
    const resolved = await resolveEmbeddedResource(link, ctx)
    if (!resolved.content?.length) return ind + `> [Embed: ${resolved.label}](${link})`

    const content = selectEmbeddedContent(resolved.content, id)
    if (!content.length) return ind + `> [Embed: ${resolved.label}](${link})`

    const lines: string[] = []
    const metadata = [`embed: ${link}`, `title: ${resolved.label}`]
    if (id.version) metadata.push(`version: ${id.version}`)
    if (id.blockRef) metadata.push(`block: ${id.blockRef}${formatBlockRange(id)}`)
    lines.push(ind + `<!-- ${metadata.join('; ')} -->`)

    const nestedCtx = {...ctx, currentDepth: ctx.currentDepth + 1}
    for (const node of content) {
      const blockMd = await resolvedBlockNodeToMarkdown(node, depth, nestedCtx)
      if (!blockMd) continue
      lines.push(blockMd)
    }
    lines.push(ind + `<!-- /embed: ${link} -->`)
    return lines.join('\n')
  } catch {
    return ind + `> [Embed: ${link}](${link})`
  }
}

async function resolveQuery(block: HMBlock, depth: number, ctx: ResolveContext): Promise<string> {
  const ind = resolvedIndent(depth)

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
      if (!space) return ind + '<!-- Query: no space specified -->'
      limit = typeof attrs?.limit === 'number' ? attrs.limit : undefined
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

    if (!results?.results?.length) return ind + '<!-- Query: no results -->'

    return results.results
      .map((doc: {metadata?: HMMetadata | null; id: UnpackedHypermediaId}) => {
        const name = doc.metadata?.name || doc.id.path?.join('/') || doc.id.uid
        return ind + `- [${name}](${doc.id.id})`
      })
      .join('\n')
  } catch (error) {
    return ind + `<!-- Query error: ${error instanceof Error ? error.message : String(error)} -->`
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

function sliceBlockText(node: HMBlockNode, start: number, end: number): HMBlockNode {
  const block = node.block as HMBlock & {text?: string}
  if (typeof block.text !== 'string') return {...node, children: []}
  return {...node, block: {...block, text: block.text.slice(start, end)} as HMBlock, children: []}
}

async function applyResolvedAnnotations(
  text: string,
  annotations: HMAnnotation[] | undefined,
  ctx: ResolveContext,
): Promise<string> {
  if (!annotations?.length) return text
  type Marker = {pos: number; type: 'open' | 'close'; annotation: HMAnnotation}
  const markers: Marker[] = []
  for (const ann of annotations) {
    const starts = ann.starts || []
    const ends = ann.ends || []
    for (let i = 0; i < starts.length; i++) {
      markers.push({pos: starts[i]!, type: 'open', annotation: ann})
      if (ends[i] !== undefined) markers.push({pos: ends[i]!, type: 'close', annotation: ann})
    }
  }
  markers.sort((a, b) => (a.pos !== b.pos ? a.pos - b.pos : a.type === 'open' ? -1 : 1))

  let result = ''
  let lastPos = 0
  for (const marker of markers) {
    result += text.slice(lastPos, marker.pos)
    lastPos = marker.pos
    result += await getResolvedAnnotationMarker(marker.annotation, marker.type, ctx)
  }
  result += text.slice(lastPos)
  return result.replace(/\uFFFC/g, '')
}

async function getResolvedAnnotationMarker(
  ann: HMAnnotation,
  type: 'open' | 'close',
  ctx: ResolveContext,
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
      return type === 'open' ? '[' : `](${ann.link || ''})`
    case 'Embed':
      return resolveInlineEmbed(ann, type, ctx)
    default:
      return ''
  }
}

async function resolveInlineEmbed(ann: HMAnnotation, type: 'open' | 'close', ctx: ResolveContext): Promise<string> {
  const link = 'link' in ann ? (ann.link as string) || '' : ''
  if (type === 'close') return `](${link})`
  if (!link) return '[↗ embed'

  try {
    const resolved = await resolveReference(link, ctx)
    const prefix = resolved.type === 'account' ? '@' : ''
    return `[${prefix}${resolved.label}`
  } catch {
    return `[↗ ${fallbackLabel(link)}`
  }
}

async function resolveEmbeddedResource(link: string, ctx: ResolveContext): Promise<ResolvedReference> {
  const cacheKey = `embed:${link}`
  const cached = ctx.cache.get(cacheKey)
  if (cached) return cached
  const id = unpackHmId(link)
  if (!id) throw new Error('Invalid HM link')

  const resource = await ctx.client.request('Resource', id)
  let resolved: ResolvedReference
  if (resource.type === 'document') {
    resolved = {
      label: resource.document.metadata?.name || fallbackDocLabel(id),
      type: 'document',
      content: resource.document.content || [],
      version: id.version || resource.document.version,
      latestVersion: resource.document.version,
    }
  } else if (resource.type === 'comment') {
    let authorName = fallbackUid(resource.comment.author)
    try {
      const account = await ctx.client.request('Account', resource.comment.author)
      if (account.type === 'account' && account.metadata?.name) authorName = account.metadata.name
    } catch {
      // ignore
    }
    resolved = {
      label: `Comment by ${authorName}`,
      type: 'comment',
      content: resource.comment.content || [],
      version: id.version || resource.comment.version,
      latestVersion: resource.comment.version,
      author: resource.comment.author,
    }
  } else {
    resolved = {label: fallbackLabel(link), type: 'unknown'}
  }
  ctx.cache.set(cacheKey, resolved)
  return resolved
}

async function resolveReference(link: string, ctx: ResolveContext): Promise<ResolvedReference> {
  const cached = ctx.cache.get(link)
  if (cached) return cached
  const id = unpackHmId(link)
  if (!id) throw new Error('Invalid HM link')

  let resolved: ResolvedReference
  const profileAccountUid = id.path?.[0] === ':profile' ? id.path[1] || id.uid : !id.path?.length ? id.uid : null
  if (profileAccountUid) {
    try {
      const account = await ctx.client.request('Account', profileAccountUid)
      if (account.type === 'account') {
        resolved = {label: account.metadata?.name || fallbackUid(profileAccountUid), type: 'account'}
        ctx.cache.set(link, resolved)
        return resolved
      }
    } catch {
      // fall through to Resource, because profiles may also be represented as documents
    }
  }

  const resource = await ctx.client.request('Resource', id)
  if (resource.type === 'document') {
    resolved = {
      label: resource.document.metadata?.name || fallbackDocLabel(id),
      type: 'document',
      content: resource.document.content || [],
      version: id.version || resource.document.version,
      latestVersion: resource.document.version,
    }
  } else if (resource.type === 'comment') {
    let authorName = fallbackUid(resource.comment.author)
    try {
      const account = await ctx.client.request('Account', resource.comment.author)
      if (account.type === 'account' && account.metadata?.name) authorName = account.metadata.name
    } catch {
      // ignore
    }
    resolved = {
      label: `Comment by ${authorName}`,
      type: 'comment',
      content: resource.comment.content || [],
      version: id.version || resource.comment.version,
      latestVersion: resource.comment.version,
      author: resource.comment.author,
    }
  } else {
    resolved = {label: fallbackLabel(link), type: 'unknown'}
  }
  ctx.cache.set(link, resolved)
  return resolved
}

function findBlockById(content: HMBlockNode[], blockId: string): HMBlockNode | null {
  for (const node of content) {
    if (node.block.id === blockId) return node
    const found = findBlockById(node.children || [], blockId)
    if (found) return found
  }
  return null
}

function resolvedIdComment(id: string): string {
  return `<!-- id:${id} -->`
}

function appendResolvedIdToFirstLine(md: string, id: string): string {
  const newline = md.indexOf('\n')
  if (newline === -1) return md ? `${md} ${resolvedIdComment(id)}` : resolvedIdComment(id)
  return `${md.slice(0, newline)} ${resolvedIdComment(id)}${md.slice(newline)}`
}

function formatResolvedMediaUrl(url: string): string {
  if (url.startsWith('ipfs://')) return `https://ipfs.io/ipfs/${url.slice(7)}`
  return url
}

function formatBlockRange(id: UnpackedHypermediaId): string {
  const range = id.blockRange
  if (!range) return ''
  if ('expanded' in range && range.expanded) return '+'
  if ('start' in range) return `[${range.start}:${range.end}]`
  return ''
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

function resolvedIndent(depth: number): string {
  return '  '.repeat(depth)
}
