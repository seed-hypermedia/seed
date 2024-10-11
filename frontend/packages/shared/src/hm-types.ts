import {PlainMessage} from '@bufbuild/protobuf'
import {Block as EditorBlock, hmBlockSchema} from '@shm/desktop/src/editor'
import type {
  Block,
  BlockNode,
  Comment,
  DeletedEntity,
  Document,
  UnpackedHypermediaId,
} from '@shm/shared'
import * as z from 'zod'

export const HMBlockChildrenTypeSchema = z.union([
  z.literal('Group'),
  z.literal('Ordered'),
  z.literal('Unordered'),
  z.literal('Blockquote'),
])
export type HMBlockChildrenType = z.infer<typeof HMBlockChildrenTypeSchema>

export const HMEmbedViewSchema = z.union([
  z.literal('Content'),
  z.literal('Card'),
])
export type HMEmbedView = z.infer<typeof HMEmbedViewSchema>

export type EditorTextStyles = {
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  code?: true
  // color?: string
  // backgroundColor?: string
}

export type EditorToggledStyle = {
  [K in keyof EditorTextStyles]-?: Required<EditorTextStyles>[K] extends true
    ? K
    : never
}[keyof EditorTextStyles]

export type EditorColorStyle = {
  [K in keyof EditorTextStyles]-?: Required<EditorTextStyles>[K] extends string
    ? K
    : never
}[keyof EditorTextStyles]

export type ServerBlockNode = PlainMessage<BlockNode>
export type ServerBlock = PlainMessage<Block>

export type ServerDocument = PlainMessage<Document>

export type HMDeletedEntity = PlainMessage<DeletedEntity>

export type HMEntityContent = {
  id: UnpackedHypermediaId
  document?: HMDocument | null
}

const baseAnnotationProperties = {
  starts: z.array(z.number()),
  ends: z.array(z.number()),
  attributes: z.object({}).optional(),
  link: z.literal('').optional(),
}

export const BoldAnnotationSchema = z
  .object({
    type: z.literal('Bold'),
    ...baseAnnotationProperties,
  })
  .strict()

export const ItalicAnnotationSchema = z
  .object({
    type: z.literal('Italic'),
    ...baseAnnotationProperties,
  })
  .strict()

export const UnderlineAnnotationSchema = z
  .object({
    type: z.literal('Underline'),
    ...baseAnnotationProperties,
  })
  .strict()

export const StrikeAnnotationSchema = z
  .object({
    type: z.literal('Strike'),
    ...baseAnnotationProperties,
  })
  .strict()

export const CodeAnnotationSchema = z
  .object({
    type: z.literal('Code'),
    ...baseAnnotationProperties,
  })
  .strict()

export const LinkAnnotationSchema = z
  .object({
    type: z.literal('Link'),
    ...baseAnnotationProperties,
    link: z.string(),
  })
  .strict()

export const InlineEmbedAnnotationSchema = z
  .object({
    type: z.literal('Embed'),
    ...baseAnnotationProperties,
    link: z.string(),
  })
  .strict()

export const HMAnnotationSchema = z.discriminatedUnion('type', [
  BoldAnnotationSchema,
  ItalicAnnotationSchema,
  UnderlineAnnotationSchema,
  StrikeAnnotationSchema,
  CodeAnnotationSchema,
  LinkAnnotationSchema,
  InlineEmbedAnnotationSchema,
])
export type HMAnnotation = z.infer<typeof HMAnnotationSchema>

export type BoldAnnotation = z.infer<typeof BoldAnnotationSchema>
export type ItalicAnnotation = z.infer<typeof ItalicAnnotationSchema>
export type UnderlineAnnotation = z.infer<typeof UnderlineAnnotationSchema>
export type StrikeAnnotation = z.infer<typeof StrikeAnnotationSchema>
export type CodeAnnotation = z.infer<typeof CodeAnnotationSchema>
export type LinkAnnotation = z.infer<typeof LinkAnnotationSchema>
export type InlineEmbedAnnotation = z.infer<typeof InlineEmbedAnnotationSchema>

// export type ColorAnnotation = BaseAnnotation & {
//   type: 'color'
//   attributes: {
//     color: string
//   }
// }

// export type RangeAnnotation = BaseAnnotation & {
//   type: 'range'
// }

export const HMAnnotationsSchema = z.array(HMAnnotationSchema)
export type HMAnnotations = z.infer<typeof HMAnnotationsSchema>

const blockBaseProperties = {
  id: z.string(),
  revision: z.string().optional(),
  attributes: z.object({}).optional(), // EMPTY ATTRIBUTES, override in specific block schemas
  annotations: z.array(z.never()).optional(), // EMPTY ANNOTATIONS, override in specific block schemas
  text: z.literal('').optional(), // EMPTY TEXT, override in specific block schemas
  link: z.literal('').optional(), // EMPTY LINK, override in specific block schemas
} as const

const textBlockProperties = {
  text: z.string(),
  annotations: HMAnnotationsSchema,
} as const

const parentBlockAttributes = {
  childrenType: HMBlockChildrenTypeSchema.optional(),
  start: z.string().optional(), // integer encoded as string
}

export const HMBlockParagraphSchema = z
  .object({
    type: z.literal('Paragraph'),
    ...blockBaseProperties,
    ...textBlockProperties,
    attributes: z.object(parentBlockAttributes),
  })
  .strict()

export const HMBlockHeadingSchema = z
  .object({
    type: z.literal('Heading'),
    ...blockBaseProperties,
    ...textBlockProperties,
    attributes: z.object(parentBlockAttributes),
  })
  .strict()

export const HMBlockCodeSchema = z
  .object({
    type: z.literal('Code'),
    ...blockBaseProperties,
    attributes: z
      .object({
        ...parentBlockAttributes,
        language: z.string().optional(),
      })
      .strict(),
    text: z.string(),
  })
  .strict()

export const HMBlockMathSchema = z
  .object({
    type: z.literal('Math'),
    ...blockBaseProperties,
    attributes: z.object(parentBlockAttributes).strict(),
    text: z.string(),
  })
  .strict()

export const HMBlockImageSchema = z
  .object({
    type: z.literal('Image'),
    ...blockBaseProperties,
    ...textBlockProperties,
    attributes: z
      .object({
        ...parentBlockAttributes,
        width: z.string().optional(),
        name: z.string().optional(),
      })
      .strict(),
    link: z.string(),
  })
  .strict()

export const HMBlockVideoSchema = z
  .object({
    type: z.literal('Video'),
    ...blockBaseProperties,
    attributes: z
      .object({
        ...parentBlockAttributes,
        width: z.string().optional(),
        name: z.string().optional(),
      })
      .strict(),
    link: z.string(),
  })
  .strict()

export const HMBlockFileSchema = z
  .object({
    type: z.literal('File'),
    ...blockBaseProperties,
    attributes: z
      .object({
        ...parentBlockAttributes,
        name: z.string().optional(),
        size: z.string().optional(), // number of bytes, as a string
      })
      .strict(),
    link: z.string(),
  })
  .strict()

export const HMBlockEmbedSchema = z
  .object({
    type: z.literal('Embed'),
    ...blockBaseProperties,
    link: z.string(), // should be a hm:// URL
    attributes: z
      .object({
        ...parentBlockAttributes,
        view: HMEmbedViewSchema.optional(),
      })
      .strict(),
  })
  .strict()

export const HMBlockWebEmbedSchema = z
  .object({
    type: z.literal('WebEmbed'),
    ...blockBaseProperties,
    link: z.string(), // should be a HTTP(S) URL
  })
  .strict()

export const HMBlockSchema = z.discriminatedUnion('type', [
  HMBlockParagraphSchema,
  HMBlockHeadingSchema,
  HMBlockCodeSchema,
  HMBlockMathSchema,
  HMBlockImageSchema,
  HMBlockVideoSchema,
  HMBlockFileSchema,
  HMBlockEmbedSchema,
  HMBlockWebEmbedSchema,
])

export type HMBlockParagraph = z.infer<typeof HMBlockParagraphSchema>
export type HMBlockHeading = z.infer<typeof HMBlockHeadingSchema>
export type HMBlockCode = z.infer<typeof HMBlockCodeSchema>
export type HMBlockMath = z.infer<typeof HMBlockMathSchema>
export type HMBlockImage = z.infer<typeof HMBlockImageSchema>
export type HMBlockVideo = z.infer<typeof HMBlockVideoSchema>
export type HMBlockFile = z.infer<typeof HMBlockFileSchema>
export type HMBlockEmbed = z.infer<typeof HMBlockEmbedSchema>
export type HMBlockWebEmbed = z.infer<typeof HMBlockWebEmbedSchema>
export type HMBlock = z.infer<typeof HMBlockSchema>

const baseBlockNodeSchema = z.object({
  block: HMBlockSchema,
})
export type HMBlockNode = z.infer<typeof baseBlockNodeSchema> & {
  children?: HMBlockNode[]
}
export const HMBlockNodeSchema: z.ZodType<HMBlockNode> =
  baseBlockNodeSchema.extend({
    children: z.lazy(() => z.array(HMBlockNodeSchema).optional()),
  })

export const HMDocumentMetadataSchema = z
  .object({
    name: z.string().optional(),
    thumbnail: z.string().optional(),
    cover: z.string().optional(),
    siteUrl: z.string().optional(),
  })
  .strict()
export type HMMetadata = z.infer<typeof HMDocumentMetadataSchema>
export const HMTimestampSchema = z
  .object({
    seconds: z.bigint(),
    nanos: z.number(),
  })
  .strict()

export const HMDocumentSchema = z
  .object({
    content: z.array(HMBlockNodeSchema),
    version: z.string(),
    account: z.string(),
    authors: z.array(z.string()),
    path: z.string(),
    createTime: HMTimestampSchema,
    updateTime: HMTimestampSchema,
    metadata: HMDocumentMetadataSchema,
  })
  .strict()

export type HMDocument = z.infer<typeof HMDocumentSchema>

export type HMCommentDraft = {
  blocks: HMBlockNode[]
  // targetDocId: string
  // targetDocVersion: string
  // targetCommentId: string | null
  // publishTime: number | null
  // commentId: string
  account: string
}

export type HMDraft = {
  content: Array<EditorBlock<typeof hmBlockSchema>>
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

export type HMBlockType = HMBlock['type']
