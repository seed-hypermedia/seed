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

function sanitizeBlockNode(node: any): any | null {
  if (!node || typeof node !== 'object') return null
  const block = node.block
  if (!block || typeof block !== 'object') return null

  const type = block.type

  if (REQUIRES_LINK_TYPES.has(type)) {
    if (typeof block.link !== 'string') return null
    if (type === 'Link' && typeof block.text !== 'string') block.text = ''
  }

  const children = Array.isArray(node.children) ? node.children : []
  const sanitizedChildren = sanitizeBlockNodes(children)

  return {
    ...node,
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
        sanitizeBlockNode(blockNode),
      ]),
    ),
  }

  return next
}

function sanitizeBlockNodes(nodes: any[]): any[] {
  if (!Array.isArray(nodes)) return []

  const sanitizeNode = (node: any): any | null => {
    if (!node || typeof node !== 'object') return null
    const block = node.block
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
      if (typeof block.link !== 'string') {
        return null
      }
      // Ensure required text for Link exists at least as empty string
      if (type === 'Link' && typeof block.text !== 'string') {
        block.text = ''
      }
    }

    // Sanitize annotations to ensure link annotations have the link field
    if (Array.isArray(block.annotations)) {
      block.annotations = block.annotations.filter((annotation: any) => {
        if (!annotation || typeof annotation !== 'object') return false

        // If it's a Link or Embed annotation, ensure it has a link field
        if (annotation.type === 'Link' || annotation.type === 'Embed') {
          if (typeof annotation.link !== 'string') {
            // For Link annotations, we can set an empty string as a fallback
            if (annotation.type === 'Link') {
              annotation.link = ''
              return true
            }
            // For Embed annotations, the link is required, so filter it out
            return false
          }
        }
        return true
      })
    }

    // Recurse into children
    const children = Array.isArray(node.children) ? node.children : []
    const newChildren = sanitizeBlockNodes(children)

    return newChildren === children
      ? node
      : {
          ...node,
          children: newChildren,
        }
  }

  return nodes.map(sanitizeNode).filter((n): n is NonNullable<typeof n> => !!n)
}

export function prepareHMDocument(apiDoc: Document): HMDocument {
  let docJSON = apiDoc.toJson() as any
  documentMetadataParseAdjustments(docJSON.metadata)
  docJSON = sanitizeDocumentStructure(docJSON)
  try {
    const document = HMDocumentSchema.parse(docJSON)
    return document
  } catch (error) {
    console.error('~~ Error parsing document', error, docJSON)
    console.error(JSON.stringify(docJSON, null, 2))
    throw error
  }
}

export function prepareHMComment(apiComment: Comment): HMComment {
  const commentJSON = apiComment.toJson() as any
  documentMetadataParseAdjustments(commentJSON.metadata)
  const comment = HMCommentSchema.parse(commentJSON)
  return comment
}
