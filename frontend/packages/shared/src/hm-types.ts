import {PlainMessage} from '@bufbuild/protobuf'
import type {
  Account,
  ActivitySummary,
  Block,
  BlockNode,
  Breadcrumb,
  Comment,
  DeletedEntity,
  Document,
  DocumentChangeInfo,
  DocumentInfo,
  EditorBlock,
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

export const HMQueryStyleSchema = z.union([
  z.literal('Card'),
  z.literal('List'),
])

export type HMQueryStyle = z.infer<typeof HMQueryStyleSchema>

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
    link: z.string().optional(), // this should be required but we have seen some data that is missing it
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

export const HMAnnotationsSchema = z.array(HMAnnotationSchema).optional()
export type HMAnnotations = z.infer<typeof HMAnnotationsSchema>

const blockBaseProperties = {
  id: z.string(),
  revision: z.string().optional(),
  attributes: z.object({}).optional().default({}), // EMPTY ATTRIBUTES, override in specific block schemas
  annotations: z.array(z.never()).optional(), // EMPTY ANNOTATIONS, override in specific block schemas
  text: z.literal('').optional(), // EMPTY TEXT, override in specific block schemas
  link: z.literal('').optional(), // EMPTY LINK, override in specific block schemas
} as const

const textBlockProperties = {
  text: z.string().default(''),
  annotations: HMAnnotationsSchema,
} as const

const parentBlockAttributes = {
  childrenType: HMBlockChildrenTypeSchema.optional(),
}

export const HMBlockParagraphSchema = z
  .object({
    type: z.literal('Paragraph'),
    ...blockBaseProperties,
    ...textBlockProperties,
    attributes: z.object(parentBlockAttributes).optional().default({}),
  })
  .strict()

export const HMBlockHeadingSchema = z
  .object({
    type: z.literal('Heading'),
    ...blockBaseProperties,
    ...textBlockProperties,
    attributes: z.object(parentBlockAttributes).optional().default({}),
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
      .optional()
      .default({}),
    text: z.string().default(''),
  })
  .strict()

export const HMBlockMathSchema = z
  .object({
    type: z.literal('Math'),
    ...blockBaseProperties,
    attributes: z.object(parentBlockAttributes).optional().default({}),
    text: z.string().default(''),
  })
  .strict()

export function toNumber(value: any): number | null {
  // If it's already a number, return it directly
  if (typeof value == 'number' && !isNaN(value)) {
    return value
  }

  // If it's a string, try to convert it
  if (typeof value == 'string') {
    const converted = Number(value)
    if (!isNaN(converted)) {
      return converted
    }
  }
  console.warn(
    'Value must be a number or a string that can be converted to a number',
    value,
  )
  return null
}

export const HMBlockImageSchema = z
  .object({
    type: z.literal('Image'),
    ...blockBaseProperties,
    ...textBlockProperties,
    attributes: z
      .object({
        ...parentBlockAttributes,
        width: z.number().optional(),
        name: z.string().optional(),
      })
      .optional()
      .default({}),
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
        width: z.number().optional(),
        name: z.string().optional(),
      })
      .optional()
      .default({}),
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
        size: z.number().optional().transform(toNumber), // number of bytes, as a string
        name: z.string().optional(),
      })
      .optional()
      .default({}),
    link: z.string(),
  })
  .strict()

export const HMBlockButtonSchema = z
  .object({
    type: z.literal('Button'),
    ...blockBaseProperties,
    attributes: z
      .object({
        ...parentBlockAttributes,
        name: z.string().optional(),
        alignment: z.string().optional(), // button alignment, as a string
      })
      .optional()
      .default({}),
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
      .optional()
      .default({}),
  })
  .strict()

export const HMBlockWebEmbedSchema = z
  .object({
    type: z.literal('WebEmbed'),
    ...blockBaseProperties,
    link: z.string(), // should be a HTTP(S) URL
  })
  .strict()

export const HMBlockNostrSchema = z
  .object({
    type: z.literal('Nostr'),
    ...blockBaseProperties,
    link: z.string(), // should be a nostr:// URL
  })
  .strict()

export const HMQueryInclusionSchema = z.object({
  space: z.string(),
  path: z.string().optional(),
  mode: z.union([z.literal('Children'), z.literal('AllDescendants')]),
})

export const HMQuerySortSchema = z.object({
  reverse: z.boolean().default(false),
  term: z.union([
    z.literal('Path'),
    z.literal('Title'),
    z.literal('CreateTime'),
    z.literal('UpdateTime'),
  ]),
})
export type HMQuerySort = z.infer<typeof HMQuerySortSchema>

export const HMQuerySchema = z.object({
  includes: z.array(HMQueryInclusionSchema),
  sort: z.array(HMQuerySortSchema).optional(),
  limit: z.number().optional(),
})

export type HMQuery = z.infer<typeof HMQuerySchema>

export const HMBlockQuerySchema = z
  .object({
    type: z.literal('Query'),
    ...blockBaseProperties,
    attributes: z.object({
      ...parentBlockAttributes,
      style: HMQueryStyleSchema.optional().default('Card'),
      columnCount: z.number().optional().default(3),
      query: HMQuerySchema,
      banner: z.boolean().optional().default(false),
    }),
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
  HMBlockButtonSchema,
  HMBlockEmbedSchema,
  HMBlockWebEmbedSchema,
  HMBlockNostrSchema,
  HMBlockQuerySchema,
])

export type HMBlockParagraph = z.infer<typeof HMBlockParagraphSchema>
export type HMBlockHeading = z.infer<typeof HMBlockHeadingSchema>
export type HMBlockCode = z.infer<typeof HMBlockCodeSchema>
export type HMBlockMath = z.infer<typeof HMBlockMathSchema>
export type HMBlockImage = z.infer<typeof HMBlockImageSchema>
export type HMBlockVideo = z.infer<typeof HMBlockVideoSchema>
export type HMBlockFile = z.infer<typeof HMBlockFileSchema>
export type HMBlockButton = z.infer<typeof HMBlockButtonSchema>
export type HMBlockEmbed = z.infer<typeof HMBlockEmbedSchema>
export type HMBlockWebEmbed = z.infer<typeof HMBlockWebEmbedSchema>
export type HMBlockQuery = z.infer<typeof HMBlockQuerySchema>
export type HMBlock = z.infer<typeof HMBlockSchema>
export type HMBlockNostr = z.infer<typeof HMBlockNostrSchema>

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

export const HMDocumentMetadataSchema = z.object({
  name: z.string().optional(),
  icon: z.string().optional(),
  thumbnail: z.string().optional(), // DEPRECATED
  cover: z.string().optional(),
  siteUrl: z.string().optional(),
  layout: z
    .union([z.literal('Seed/Experimental/Newspaper'), z.literal('')])
    .optional(),
  displayPublishTime: z.string().optional(),
  seedExperimentalLogo: z.string().optional(),
  seedExperimentalHomeOrder: z
    .union([z.literal('UpdatedFirst'), z.literal('CreatedFirst')])
    .optional(),
  showOutline: z.boolean().optional(),
})

export type HMMetadata = z.infer<typeof HMDocumentMetadataSchema>

export type HMAccountsMetadata = Record<
  string, // account uid
  HMMetadataPayload
>

export const HMTimestampSchema = z
  .object({
    seconds: z.bigint(),
    nanos: z.number(),
  })
  .strict()

export const HMDocumentSchema = z.object({
  content: z.array(HMBlockNodeSchema).default([]),
  version: z.string().default(''),
  account: z.string().default(''),
  authors: z.array(z.string()),
  path: z.string().default(''),
  createTime: z.union([HMTimestampSchema, z.string()]).default(''),
  updateTime: z.union([HMTimestampSchema, z.string()]).default(''),
  metadata: HMDocumentMetadataSchema,
  genesis: z.string(),
})
// .strict() // avoid errors when the backend sends extra fields (most recently "header" and "footer")

export type HMLibraryDocument = HMDocumentInfo & {
  type: 'document'
  latestComment?: HMComment | null
}
export type HMDocument = z.infer<typeof HMDocumentSchema>

type DraftChangeInfo = {
  author: string
  id: string
  deps: Array<string>
  isDraft: boolean
}

export type HMChangeInfo = PlainMessage<DocumentChangeInfo> | DraftChangeInfo

export const HMCommentDraftSchema = z.object({
  blocks: z.array(HMBlockNodeSchema),
  account: z.string(),
})

export type HMCommentDraft = z.infer<typeof HMCommentDraftSchema>

export type HMDraft = {
  content: Array<EditorBlock>
  metadata: HMMetadata
  members: any //HMDocument['members']
  deps: Array<string>
  signingAccount: string
  previousId: UnpackedHypermediaId | null // null if new document. Used to handle drafts that are moving
  lastUpdateTime: number // ms
}

export type HMComment = Omit<PlainMessage<Comment>, 'content'> & {
  content: HMBlockNode[]
}

export type HMBreadcrumb = PlainMessage<Breadcrumb>

export type HMActivitySummary = PlainMessage<ActivitySummary>

export type HMAccount = Omit<PlainMessage<Account>, 'metadata'> & {
  metadata?: HMMetadata
}

export type HMCommentGroup = {
  comments: HMComment[]
  moreCommentsCount: number
  id: string
  type: 'commentGroup'
}

export type HMDraftChange = {
  id: string
  type: 'draftChange'
  author: string
  deps: string[]
  isDraft: boolean
  lastUpdateTime?: number
}

export type HMChangeSummary = PlainMessage<DocumentChangeInfo> & {
  type: 'change'
}

export type HMBlockType = HMBlock['type']

export type HMDocumentInfo = Omit<
  PlainMessage<DocumentInfo>,
  'path' | 'metadata'
> & {
  type: 'document'
  path: string[]
  metadata: HMMetadata
}

export type HMChangeGroup = {
  id: string
  type: 'changeGroup'
  changes: HMChangeSummary[]
}

export type HMQueryResult = {
  in: UnpackedHypermediaId
  results: HMDocumentInfo[]
  mode?: 'Children' | 'AllDescendants'
}

export type HMRole = 'owner' | 'writer' | 'none'

export type HMListedDraft = {
  id: UnpackedHypermediaId
  metadata: HMMetadata
  lastUpdateTime: number
}

export type HMInvoice = {
  payload: string
  hash: string
  amount: number
  share: Record<string, number>
  description?: string
}

export type HMWallet = {
  balance: number
  id: string
  address: string
  name: string
  type: string
}

export type HMMetadataPayload = {
  id: UnpackedHypermediaId
  metadata?: HMMetadata
}
