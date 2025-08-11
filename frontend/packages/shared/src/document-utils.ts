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

function sanitizeBlockNodes(nodes: any[]): any[] {
  if (!Array.isArray(nodes)) return []
  return nodes.map(sanitizeBlockNode).filter(Boolean)
}

function sanitizeDocumentStructure(docJSON: any) {
  const content = sanitizeBlockNodes(docJSON?.content)

  const hasDetached = !!docJSON?.detachedBlocks
  const detachedBlocks = hasDetached
    ? Object.fromEntries(
        Object.entries(docJSON.detachedBlocks)
          .map(([key, blockNode]) => [key, sanitizeBlockNode(blockNode)])
          .filter(([, node]) => node != null),
      )
    : undefined

  const next: any = {
    ...docJSON,
    content,
  }

  if (hasDetached) next.detachedBlocks = detachedBlocks
  return next
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
    throw error
  }
}

export function prepareHMComment(apiComment: Comment): HMComment {
  const commentJSON = apiComment.toJson() as any
  documentMetadataParseAdjustments(commentJSON.metadata)
  const comment = HMCommentSchema.parse(commentJSON)
  return comment
}
