import {Comment, Document} from './client'
import {
  HMComment,
  HMCommentSchema,
  HMDocument,
  HMDocumentSchema,
} from './hm-types'
import {documentMetadataParseAdjustments} from './models/entity'

const REQUIRES_LINK_TYPES = new Set([
  'Link',
  'Image',
  'Video',
  'File',
  'WebEmbed',
  'Nostr',
  'Embed',
  'Button',
])

function sanitizeBlockNode(
  node: any,
  isNavigationChild: boolean = false,
): any | null {
  if (!node || typeof node !== 'object') return null
  const block = node.block
  if (!block || typeof block !== 'object') return null

  const type = block.type
  let sanitizedBlock = block

  if (REQUIRES_LINK_TYPES.has(type)) {
    // Special handling for navigation Link blocks - provide defaults instead of dropping
    if (type === 'Link' && isNavigationChild) {
      if (typeof block.link !== 'string' || typeof block.text !== 'string') {
        sanitizedBlock = {
          ...block,
          link: typeof block.link === 'string' ? block.link : '',
          text: typeof block.text === 'string' ? block.text : '',
        }
      }
    } else {
      // For non-navigation blocks, require link field
      if (typeof block.link !== 'string') return null
      if (type === 'Link' && typeof block.text !== 'string') {
        // Create a new block object with the text field added
        sanitizedBlock = {...block, text: ''}
      }
    }
  }

  const children = Array.isArray(node.children) ? node.children : []
  const sanitizedChildren = sanitizeBlockNodes(children, isNavigationChild)

  return {
    ...node,
    block: sanitizedBlock,
    ...(sanitizedChildren.length ? {children: sanitizedChildren} : {}),
  }
}

function sanitizeDocumentStructure(docJSON: any) {
  const content = sanitizeBlockNodes(docJSON?.content)

  const detachedBlocks = docJSON?.detachedBlocks || {}

  const next: any = {
    ...docJSON,
    content,
    detachedBlocks: Object.fromEntries(
      Object.entries(detachedBlocks).map(([key, blockNode]) => [
        key,
        // Pass true for isNavigationChild when processing navigation block's children
        sanitizeBlockNode(blockNode, key === 'navigation'),
      ]),
    ),
  }

  return next
}

function sanitizeBlockNodes(
  nodes: any[],
  isNavigationChild: boolean = false,
): any[] {
  if (!Array.isArray(nodes)) return []

  const sanitizeNode = (node: any): any | null => {
    if (!node || typeof node !== 'object') return null
    let block = node.block
    if (!block || typeof block !== 'object') return null

    const type = block.type

    // Drop clearly invalid blocks that require a link
    const requiresLinkTypes = new Set([
      'Link',
      'Image',
      'Video',
      'File',
      'WebEmbed',
      'Nostr',
      'Embed',
      'Button',
    ])

    if (requiresLinkTypes.has(type)) {
      // Special handling for navigation Link blocks - provide defaults instead of dropping
      if (type === 'Link' && isNavigationChild) {
        if (typeof block.link !== 'string' || typeof block.text !== 'string') {
          block = {
            ...block,
            link: typeof block.link === 'string' ? block.link : '',
            text: typeof block.text === 'string' ? block.text : '',
          }
        }
      } else {
        // For non-navigation blocks, require link field
        if (typeof block.link !== 'string') {
          return null
        }
        // Ensure required text for Link exists at least as empty string
        if (type === 'Link' && typeof block.text !== 'string') {
          block = {...block, text: ''}
        }
      }
    }

    // Sanitize annotations to ensure link annotations have the link field
    if (Array.isArray(block.annotations)) {
      const sanitizedAnnotations = block.annotations
        .map((annotation: any) => {
          if (!annotation || typeof annotation !== 'object') return null

          // If it's a Link or Embed annotation, ensure it has a link field
          if (annotation.type === 'Link' || annotation.type === 'Embed') {
            if (typeof annotation.link !== 'string') {
              // For Link annotations, we can set an empty string as a fallback
              if (annotation.type === 'Link') {
                return {...annotation, link: ''}
              }
              // For Embed annotations, the link is required, so filter it out
              return null
            }
          }
          return annotation
        })
        .filter((a: any) => a !== null)

      // Only create a new block if annotations changed
      if (
        sanitizedAnnotations.length !== block.annotations.length ||
        sanitizedAnnotations.some(
          (a: any, i: number) => a !== block.annotations[i],
        )
      ) {
        block = {...block, annotations: sanitizedAnnotations}
      }
    }

    // Recurse into children
    const children = Array.isArray(node.children) ? node.children : []
    const newChildren = sanitizeBlockNodes(children, isNavigationChild)

    // Return updated node with potentially modified block and children
    const hasBlockChanges = block !== node.block
    const hasChildrenChanges = newChildren !== children

    if (!hasBlockChanges && !hasChildrenChanges) {
      return node
    }

    return {
      ...node,
      ...(hasBlockChanges ? {block} : {}),
      ...(hasChildrenChanges ? {children: newChildren} : {}),
    }
  }

  return nodes.map(sanitizeNode).filter((n): n is NonNullable<typeof n> => !!n)
}

export function prepareHMDocument(apiDoc: Document): HMDocument {
  let docJSON = apiDoc.toJson({
    emitDefaultValues: true,
    enumAsInteger: false,
  }) as any
  documentMetadataParseAdjustments(docJSON.metadata)
  docJSON = sanitizeDocumentStructure(docJSON)
  try {
    const document = HMDocumentSchema.parse(docJSON)
    return document
  } catch (error) {
    console.error(
      '~~ Error parsing document, returning unvalidated document',
      error,
    )
    console.error(JSON.stringify(docJSON, null, 2))
    // Return the document as-is even if schema validation fails
    // This prevents the entire website from crashing due to parsing errors
    return docJSON as HMDocument
  }
}

export function prepareHMComment(apiComment: Comment): HMComment {
  const commentJSON = apiComment.toJson({
    emitDefaultValues: true,
    enumAsInteger: false,
  }) as any
  documentMetadataParseAdjustments(commentJSON.metadata)
  try {
    const comment = HMCommentSchema.parse(commentJSON)
    return comment
  } catch (error) {
    console.error(
      '~~ Error parsing comment, returning unvalidated comment',
      error,
    )
    console.error(JSON.stringify(commentJSON, null, 2))
    // Return the document as-is even if schema validation fails
    // This prevents the entire website from crashing due to parsing errors
    return commentJSON as HMComment
  }
}
