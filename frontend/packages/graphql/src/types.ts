/**
 * GraphQL Client Types
 *
 * Type definitions for the normalized GraphQL client cache structure.
 */

/**
 * Normalized cache structure for an HM account.
 * Each account contains a Profile and a key-value store of resources.
 */
export interface NormalizedAccount {
  /** Account ID (the '123' in hm://123/foo/bar) */
  id: string
  /** Profile resource for this account */
  profile: NormalizedProfile | null
  /** Key-value store of resources (key = path like 'foo/bar') */
  resources: Map<string, NormalizedResource>
}

/**
 * Profile resource type
 */
export interface NormalizedProfile {
  accountId: string
  name: string | null
  homeDocument: NormalizedDocument | null
}

/**
 * Base resource type
 */
export interface NormalizedResourceBase {
  iri: string
  version: string | null
}

/**
 * Document resource
 */
export interface NormalizedDocument extends NormalizedResourceBase {
  __typename: 'Document'
  account: string
  path: string
  name: string
  content: BlocksContent
}

/**
 * Comment resource
 */
export interface NormalizedComment extends NormalizedResourceBase {
  __typename: 'Comment'
  id: string
  authorId: string
  author: NormalizedProfile
  targetAccount: string
  targetPath: string
  replyParent: string | null
  content: BlocksContent
}

/**
 * Union of all resource types
 */
export type NormalizedResource = NormalizedDocument | NormalizedComment

/**
 * Flattened block content structure
 */
export interface BlocksContent {
  blocks: BlockNode[]
  rootBlockIds: string[]
}

/**
 * Block node with references instead of nested children
 */
export interface BlockNode {
  block: Block
  childrenIds: string[]
  childrenType: string | null
}

/**
 * Base block type
 */
export interface BaseBlock {
  id: string
  type: string
}

/**
 * Text block types
 */
export interface ParagraphBlock extends BaseBlock {
  type: 'Paragraph'
  text: string
  annotations: Annotation[]
}

export interface HeadingBlock extends BaseBlock {
  type: 'Heading'
  text: string
  annotations: Annotation[]
}

export interface CodeBlock extends BaseBlock {
  type: 'Code'
  text: string
  language: string | null
}

export interface MathBlock extends BaseBlock {
  type: 'Math'
  text: string
}

/**
 * Media block types
 */
export interface ImageBlock extends BaseBlock {
  type: 'Image'
  link: string
  text: string
  width: number | null
  name: string | null
}

export interface VideoBlock extends BaseBlock {
  type: 'Video'
  link: string
  width: number | null
  name: string | null
}

export interface FileBlock extends BaseBlock {
  type: 'File'
  link: string
  size: number | null
  name: string | null
}

/**
 * Interactive block types
 */
export interface ButtonBlock extends BaseBlock {
  type: 'Button'
  link: string
  text: string | null
  alignment: string | null
}

export interface EmbedBlock extends BaseBlock {
  type: 'Embed'
  link: string
  view: string | null
  resource: NormalizedResource | null
}

export interface WebEmbedBlock extends BaseBlock {
  type: 'WebEmbed'
  link: string
}

export interface NostrBlock extends BaseBlock {
  type: 'Nostr'
  link: string
}

/**
 * Union of all block types
 */
export type Block =
  | ParagraphBlock
  | HeadingBlock
  | CodeBlock
  | MathBlock
  | ImageBlock
  | VideoBlock
  | FileBlock
  | ButtonBlock
  | EmbedBlock
  | WebEmbedBlock
  | NostrBlock

/**
 * Annotation types for text formatting
 */
export interface BaseAnnotation {
  type: string
  starts: number[]
  ends: number[]
}

export interface LinkAnnotation extends BaseAnnotation {
  type: 'Link'
  link: string | null
}

export interface BoldAnnotation extends BaseAnnotation {
  type: 'Bold'
}

export interface ItalicAnnotation extends BaseAnnotation {
  type: 'Italic'
}

export interface UnderlineAnnotation extends BaseAnnotation {
  type: 'Underline'
}

export interface StrikeAnnotation extends BaseAnnotation {
  type: 'Strike'
}

export interface CodeAnnotation extends BaseAnnotation {
  type: 'Code'
}

/**
 * Union of all annotation types
 */
export type Annotation =
  | LinkAnnotation
  | BoldAnnotation
  | ItalicAnnotation
  | UnderlineAnnotation
  | StrikeAnnotation
  | CodeAnnotation

/**
 * Parse an HM IRI into its components
 */
export function parseHmIri(iri: string): {
  account: string
  path: string
  version?: string
} | null {
  const match = iri.match(/^hm:\/\/([^/]+)\/(.+?)(?:\?v=(.+))?$/)
  if (!match || !match[1] || !match[2]) return null

  return {
    account: match[1],
    path: match[2],
    version: match[3],
  }
}

/**
 * Build an HM IRI from components
 */
export function buildHmIri(
  account: string,
  path: string,
  version?: string,
): string {
  let iri = `hm://${account}/${path}`
  if (version) {
    iri += `?v=${version}`
  }
  return iri
}
