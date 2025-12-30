import {GRPCClient} from '.'
import {isSurrogate} from './client/unicode'
import {HMBlock, HMBlockNode, UnpackedHypermediaId} from './hm-types'
import {unpackHmId} from './utils/entity-id-url'
import {hmIdPathToEntityQueryPath} from './utils/path-api'

interface ConversionContext {
  grpcClient: GRPCClient
  visitedDocs: Set<string>
  currentDepth: number
  maxDepth: number
  resolveInlineEmbeds: boolean
  lineBreaks: boolean
}

interface DocumentToTextOptions {
  maxDepth?: number
  resolveInlineEmbeds?: boolean
  lineBreaks?: boolean
  debug?: boolean
}

/**
 * Converts a hypermedia document (with all its embeds) to plain text.
 * Resolves inline embeds by fetching document names and replacing invisible characters.
 * Recursively processes embedded documents up to maxDepth.
 */
export async function documentToText({
  documentId,
  grpcClient,
  options = {},
}: {
  documentId: UnpackedHypermediaId
  grpcClient: GRPCClient
  options: DocumentToTextOptions
}): Promise<string> {
  const context: ConversionContext = {
    grpcClient,
    visitedDocs: new Set(),
    currentDepth: 0,
    maxDepth: options.maxDepth ?? 10,
    resolveInlineEmbeds: options.resolveInlineEmbeds ?? true,
    lineBreaks: options.lineBreaks ?? true,
  }

  // Fetch the root document
  const docKey = `${documentId.uid}/${documentId.path?.join('/') || ''}`
  if (context.visitedDocs.has(docKey)) {
    return `[Circular Reference: ${docKey}]`
  }
  context.visitedDocs.add(docKey)

  try {
    const document = await grpcClient.documents.getDocument({
      account: documentId.uid,
      path: hmIdPathToEntityQueryPath(documentId.path),
      version: documentId.version || undefined,
    })

    if (!document.content) {
      return ''
    }

    return await blockNodesToText(document.content as HMBlockNode[], context)
  } catch (error) {
    console.error('Error fetching document:', error)
    return `[Error loading document: ${docKey}]`
  }
}

/**
 * Recursively converts an array of block nodes to text
 */
async function blockNodesToText(
  nodes: HMBlockNode[],
  context: ConversionContext,
): Promise<string> {
  const textParts: string[] = []

  for (const node of nodes) {
    if (!node.block) continue

    // Process the block itself
    const blockText = await blockToText(node.block, context)
    if (blockText) {
      textParts.push(blockText)
    }

    // Process children recursively
    if (node.children && node.children.length > 0) {
      const childrenText = await blockNodesToText(node.children, context)
      if (childrenText) {
        textParts.push(childrenText)
      }
    }
  }

  // Use line breaks or space based on option
  const separator = context.lineBreaks ? '\n\n' : ' '
  return textParts.join(separator)
}

/**
 * Converts a single block to text based on its type
 */
async function blockToText(
  block: HMBlock,
  context: ConversionContext,
): Promise<string> {
  switch (block.type) {
    case 'Paragraph':
    case 'Heading':
      return await processTextBlock(block, context)

    case 'Code':
    case 'Math':
      // Return literal text for code and math blocks
      return (block as any).text || ''

    case 'Image':
    case 'Video':
    case 'File':
      // Include caption if present
      return await processTextBlock(block, context)

    case 'Embed':
      return await processEmbedBlock(block, context)

    case 'Button':
      // Button label comes from attributes.name
      // attributes is a Protobuf Struct, need to convert to JSON
      const buttonAttrs = (block as any).attributes
      const attrs = buttonAttrs?.toJson
        ? buttonAttrs.toJson({emitDefaultValues: true, enumAsInteger: false})
        : buttonAttrs
      return attrs?.name || (block as any).text || ''

    case 'Query':
      // Skip query blocks (could optionally resolve results)
      return ''

    case 'WebEmbed':
      // Return the URL or any text
      return (block as any).text || (block as any).link || ''

    case 'Nostr':
      // Return any text or the link
      return (block as any).text || (block as any).link || ''

    default:
      // Unknown block type, try to extract text
      return (block as any).text || ''
  }
}

/**
 * Processes a text block (Paragraph, Heading, etc.) with annotations
 */
async function processTextBlock(
  block: HMBlock,
  context: ConversionContext,
): Promise<string> {
  const blockText = (block as any).text || ''

  if (!blockText) {
    return ''
  }

  // If no annotations or inline embeds are disabled, return plain text
  const annotations = (block as any).annotations || []
  if (annotations.length === 0 || !context.resolveInlineEmbeds) {
    return blockText
  }

  // Process annotations to resolve inline embeds
  return await processAnnotations(blockText, annotations, context)
}

/**
 * Processes text with standoff annotations, replacing inline embeds with document names
 */
async function processAnnotations(
  text: string,
  annotations: any[],
  context: ConversionContext,
): Promise<string> {
  // Build a map of positions to inline embed links
  const embedMap = new Map<number, string>()

  for (const annotation of annotations) {
    if (annotation.type === 'Embed' && annotation.link) {
      // Find all positions where this embed annotation applies
      for (let i = 0; i < annotation.starts.length; i++) {
        const start = annotation.starts[i]
        embedMap.set(start, annotation.link)
      }
    }
  }

  if (embedMap.size === 0) {
    return text
  }

  // Walk through the text and replace embed positions with document names
  let result = ''
  let pos = 0
  let i = 0

  while (i < text.length) {
    // Check for surrogate pairs
    const ul = isSurrogate(text, i) ? 2 : 1

    // Check if current position has an inline embed
    if (embedMap.has(pos)) {
      const link = embedMap.get(pos)!
      const docName = await resolveInlineEmbed(link, context)
      result += `[${docName}]`
    } else {
      // Add the current character(s)
      result += text.substr(i, ul)
    }

    pos++
    i += ul
  }

  return result
}

/**
 * Resolves an inline embed link to a document name
 */
async function resolveInlineEmbed(
  link: string,
  context: ConversionContext,
): Promise<string> {
  const id = unpackHmId(link)

  if (!id) {
    return 'Unknown Reference'
  }

  const docKey = `${id.uid}/${id.path?.join('/') || ''}`

  // Check if we've already visited this document
  if (context.visitedDocs.has(docKey)) {
    return 'Circular Reference'
  }

  try {
    const document = await context.grpcClient.documents.getDocument({
      account: id.uid,
      path: hmIdPathToEntityQueryPath(id.path),
      version: id.version || undefined,
    })

    return (document.metadata as any)?.name || 'Untitled Document'
  } catch (error) {
    console.error('Error resolving inline embed:', error)
    return 'Unresolved Reference'
  }
}

/**
 * Processes an embed block by recursively fetching and converting the embedded document
 * Handles blockRef (specific block) and blockRange (fragment) references
 */
async function processEmbedBlock(
  block: HMBlock,
  context: ConversionContext,
): Promise<string> {
  const link = (block as any).link

  if (!link) {
    return ''
  }

  const id = unpackHmId(link)

  if (!id) {
    return '[Invalid Embed]'
  }

  // Check depth limit
  if (context.currentDepth >= context.maxDepth) {
    return `[Max depth reached: ${id.uid}/${id.path?.join('/') || ''}]`
  }

  const docKey = `${id.uid}/${id.path?.join('/') || ''}`

  // Check for circular references
  if (context.visitedDocs.has(docKey)) {
    return `[Circular Reference: ${docKey}]`
  }

  context.visitedDocs.add(docKey)
  context.currentDepth++

  try {
    const document = await context.grpcClient.documents.getDocument({
      account: id.uid,
      path: hmIdPathToEntityQueryPath(id.path),
      version: id.version || undefined,
    })

    if (!document.content) {
      return ''
    }

    const content = document.content as HMBlockNode[]

    // Handle blockRef with optional blockRange
    if (id.blockRef) {
      const targetBlock = findBlockById(content, id.blockRef)
      if (targetBlock) {
        // If there's a blockRange, apply it to the children of the target block
        if (id.blockRange && targetBlock.children) {
          const rangeBlocks = extractBlockRange(
            targetBlock.children,
            id.blockRange,
          )
          if (rangeBlocks.length > 0) {
            const rangeText = await blockNodesToText(rangeBlocks, context)
            context.currentDepth--
            return rangeText
          }
        }

        // No range or range not found - return the block itself
        const blockText = await blockToText(targetBlock.block, context)
        context.currentDepth--
        return blockText
      }
      context.currentDepth--
      return '[Block not found]'
    }

    // No blockRef or blockRange - return entire document
    const embeddedText = await blockNodesToText(content, context)

    context.currentDepth--

    return embeddedText
  } catch (error) {
    console.error('Error processing embed block:', error)
    context.currentDepth--
    return `[Error loading embed: ${docKey}]`
  }
}

/**
 * Finds a block by its ID in the block tree
 */
function findBlockById(
  nodes: HMBlockNode[],
  blockId: string,
): HMBlockNode | null {
  for (const node of nodes) {
    if (node.block?.id === blockId) {
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
 * Extracts blocks within a range
 */
function extractBlockRange(nodes: HMBlockNode[], range: any): HMBlockNode[] {
  // Handle expanded range (just a single block with children expanded)
  if ('expanded' in range && range.expanded) {
    // For expanded range, we return all blocks (same as no range)
    return nodes
  }

  // Handle exact range (start and end indices)
  if ('start' in range && 'end' in range) {
    const flatBlocks = flattenBlocks(nodes)
    const start = range.start
    const end = range.end
    return flatBlocks.slice(start, end + 1)
  }

  return nodes
}

/**
 * Flattens the block tree to a list (for range extraction)
 */
function flattenBlocks(nodes: HMBlockNode[]): HMBlockNode[] {
  const result: HMBlockNode[] = []
  for (const node of nodes) {
    result.push(node)
    if (node.children) {
      result.push(...flattenBlocks(node.children))
    }
  }
  return result
}
