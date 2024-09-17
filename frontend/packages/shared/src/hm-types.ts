import {PlainMessage} from '@bufbuild/protobuf'
import {
  Block,
  EditorInlineContent,
  hmBlockSchema,
} from '@shm/desktop/src/editor'
import type {
  Comment,
  DeletedEntity,
  Document,
  UnpackedHypermediaId,
} from '@shm/shared'

export type HMChangeInfo = any // deprecated

export type HMAccount = any // deprecated

export type HMLink = any // deprecated

export type HMBlockChildrenType = 'group' | 'ol' | 'ul' | 'div' | 'blockquote'
export type HMEmbedDisplay = 'content' | 'card'

export type HMStyles = {
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  code?: true
  textColor?: string
  backgroundColor?: string
  // math?: true
}

export type ToggledStyle = {
  [K in keyof HMStyles]-?: Required<HMStyles>[K] extends true ? K : never
}[keyof HMStyles]

export type ColorStyle = {
  [K in keyof HMStyles]-?: Required<HMStyles>[K] extends string ? K : never
}[keyof HMStyles]

export type HMInlineContentText = {
  type: 'text'
  text: string
  styles: HMStyles
}

export type HMInlineContentLink = {
  type: 'link'
  href: string
  content: Array<HMInlineContentText>
  attributes: {
    [key: string]: any
  }
}

export type HMInlineContentEmbed = {
  type: 'inline-embed'
  ref: string
  text: string
}

export type PartialLink = Omit<HMInlineContentLink, 'content'> & {
  content: string | HMInlineContentLink['content']
}

export type HMInlineContent = EditorInlineContent
export type PartialInlineContent = HMInlineContentText | PartialLink

export type HMAnnotations = Array<HMTextAnnotation>

export type HMBlockBase = {
  id: string
  revision?: string
  text: string
  ref?: string
  annotations: HMAnnotations
  attributes?: {
    [key: string]: string | undefined
    childrenType?: HMBlockChildrenType
  }
}

export type HMBlockParagraph = HMBlockBase & {
  type: 'paragraph'
}

export type HMBlockCode = HMBlockBase & {
  type: 'codeBlock'
  attributes: HMBlockBase['attributes'] & {
    lang?: string
  }
}

export type HMBlockHeading = HMBlockBase & {
  type: 'heading'
  attributes: HMBlockBase['attributes']
}

export type HMBlockMath = HMBlockBase & {
  type: 'math'
}

export type HMBlockImage = HMBlockBase & {
  type: 'image'
  ref: string
}

export type HMBlockFile = HMBlockBase & {
  type: 'file'
  ref: string
  attributes: {
    name?: string
  }
}

export type HMBlockVideo = HMBlockBase & {
  type: 'video'
  ref: string
  attributes: {
    name?: string
  }
}

export type HMBlockWebEmbed = HMBlockBase & {
  type: 'web-embed'
  ref: string
}

export type HMBlockEmbed = HMBlockBase & {
  type: 'embed'
  ref: string
  attributes: {
    view?: 'content' | 'card'
  }
}

export type HMBlockCodeBlock = HMBlockBase & {
  type: 'codeBlock'
  attributes: {
    language?: string
  }
}

export type HMBlockNostr = HMBlockBase & {
  type: 'nostr'
  ref: string
  attributes: {
    name?: string
    text?: string
  }
}

export type HMBlock =
  | HMBlockParagraph
  | HMBlockHeading
  | HMBlockMath
  | HMBlockImage
  | HMBlockFile
  | HMBlockVideo
  | HMBlockWebEmbed
  | HMBlockEmbed
  | HMBlockCode
  | HMBlockCodeBlock
  | HMBlockNostr

export type HMBlockNode = {
  block: HMBlock
  children?: Array<HMBlockNode>
}

export type HMDocument = PlainMessage<Document>

export type HMDeletedEntity = PlainMessage<DeletedEntity>

export type HMEntityContent = {
  id: UnpackedHypermediaId
  document?: HMDocument | null
}

export type InlineEmbedAnnotation = BaseAnnotation & {
  type: 'inline-embed'
  ref: string // 'hm://... with #BlockRef
  attributes?: {
    [key: string]: string
  }
}

type BaseAnnotation = {
  starts: number[]
  ends: number[]
  // attributes: {}
}

export type BoldAnnotation = BaseAnnotation & {
  type: 'bold'
}

export type ItalicAnnotation = BaseAnnotation & {
  type: 'italic'
}

export type UnderlineAnnotation = BaseAnnotation & {
  type: 'underline'
}

export type StrikeAnnotation = BaseAnnotation & {
  type: 'strike'
}

export type CodeAnnotation = BaseAnnotation & {
  type: 'code'
}

export type LinkAnnotation = BaseAnnotation & {
  type: 'link'
  ref: string
}

export type ColorAnnotation = BaseAnnotation & {
  type: 'color'
  attributes: {
    color: string
  }
}

export type RangeAnnotation = BaseAnnotation & {
  type: 'range'
}

export type HMTextAnnotation =
  | LinkAnnotation
  | BoldAnnotation
  | ItalicAnnotation
  | CodeAnnotation
  | UnderlineAnnotation
  | ItalicAnnotation
  | ColorAnnotation
  | InlineEmbedAnnotation
  | RangeAnnotation

export type HMCommentDraft = {
  blocks: HMBlockNode[]
  // targetDocId: string
  // targetDocVersion: string
  // targetCommentId: string | null
  // publishTime: number | null
  // commentId: string
  account: string
}

// todo, adopt this type:
export type HMMetadata = {
  name?: string
  thumbnail?: string
  cover?: string
  accountType?: 'author' | 'publisher'
  siteUrl?: string
}

export type HMDraft = {
  content: Array<Block<typeof hmBlockSchema>>
  metadata: HMMetadata
  members: any //HMDocument['members']
  deps: Array<string>
  signingAccount: string
  previousId: UnpackedHypermediaId | null // null if new document. Used to handle drafts that are moving
  lastUpdateTime: number // ms
}

export type HMComment = PlainMessage<Comment>

export type HMCommentGroup = {
  comments: HMComment[]
  moreCommentsCount: number
  id: string
}
