import {PlainMessage} from '@bufbuild/protobuf'
import * as z from 'zod'
import {
  Contact,
  type Account,
  type ActivitySummary,
  type Block,
  type BlockNode,
  type Breadcrumb,
  type DeletedEntity,
  type Document,
  type DocumentChangeInfo,
  type DocumentInfo,
} from './client/grpc-types'

export const ExactBlockRangeSchema = z.object({
  start: z.number(),
  end: z.number(),
})
export type ExactBlockRange = z.infer<typeof ExactBlockRangeSchema>

export const ExpandedBlockRangeSchema = z.object({
  expanded: z.boolean(),
})
export type ExpandedBlockRange = z.infer<typeof ExpandedBlockRangeSchema>

export const BlockRangeSchema = z.union([
  ExactBlockRangeSchema,
  ExpandedBlockRangeSchema,
])
export type BlockRange = z.infer<typeof BlockRangeSchema>

export const unpackedHmIdSchema = z.object({
  id: z.string(),
  uid: z.string(),
  path: z.array(z.string()).nullable(),
  version: z.string().nullable(),
  blockRef: z.string().nullable(),
  blockRange: BlockRangeSchema.nullable(),
  hostname: z.string().nullable(),
  scheme: z.string().nullable(),
  latest: z.boolean().nullable().optional(),
  // deprecated:
  targetDocUid: z.string().nullable().optional(),
  targetDocPath: z.array(z.string()).nullable().optional(),
})

export type UnpackedHypermediaId = z.infer<typeof unpackedHmIdSchema>

export const HMBlockChildrenTypeSchema = z
  .union([
    z.literal('Group'),
    z.literal('Ordered'),
    z.literal('Unordered'),
    z.literal('Blockquote'),
  ])
  .nullable() // null or missing childrenType means "Group"
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
  redirectTarget?: UnpackedHypermediaId | null
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

export const HighlightAnnotationSchema = z
  .object({
    type: z.literal('Range'),
    ...baseAnnotationProperties,
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
  HighlightAnnotationSchema,
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

export const HMBlockButtonAlignmentSchema = z
  .union([z.literal('flex-start'), z.literal('center'), z.literal('flex-end')])
  .optional()
export type HMBlockButtonAlignment = z.infer<
  typeof HMBlockButtonAlignmentSchema
>

export const HMBlockButtonSchema = z
  .object({
    type: z.literal('Button'),
    ...blockBaseProperties,
    attributes: z
      .object({
        ...parentBlockAttributes,
        name: z.string().optional(),
        alignment: HMBlockButtonAlignmentSchema,
      })
      .optional()
      .default({}),
    text: z.string().optional(),
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

export type HMPublishableAnnotation =
  | {
      type: 'Bold' | 'Italic' | 'Underline' | 'Strike' | 'Code'
      starts: number[]
      ends: number[]
    }
  | {
      type: 'Link'
      starts: number[]
      ends: number[]
      link: string
    }
  | {
      type: 'Embed'
      starts: number[]
      ends: number[]
      link: string
    }

export type HMPublishableBlockParagraph = {
  id: string
  type: 'Paragraph'
  text: string
  annotations: HMPublishableAnnotation[]
  childrenType?: HMBlockChildrenType
  children?: HMPublishableBlock[]
}

export type HMPublishableBlockHeading = {
  id: string
  type: 'Heading'
  text: string
  annotations: HMPublishableAnnotation[]
  childrenType?: HMBlockChildrenType
  children?: HMPublishableBlock[]
}

export type HMPublishableBlockCode = {
  id: string
  type: 'Code'
  text: string
  annotations: HMPublishableAnnotation[]
  language?: string
  childrenType?: HMBlockChildrenType
  children?: HMPublishableBlock[]
}

export type HMPublishableBlockMath = {
  id: string
  type: 'Math'
  text: string
  annotations: HMPublishableAnnotation[]
  childrenType?: HMBlockChildrenType
  children?: HMPublishableBlock[]
}

export type HMPublishableBlockImage = {
  id: string
  type: 'Image'
  text: string
  link: string
  annotations: HMPublishableAnnotation[]
  childrenType?: HMBlockChildrenType
  width?: number
  name?: string
  children?: HMPublishableBlock[]
}

export type HMPublishableBlockVideo = {
  id: string
  type: 'Video'
  text: ''
  link: string
  name?: string
  width?: number
  children?: HMPublishableBlock[]
}

export type HMPublishableBlockFile = {
  id: string
  type: 'File'
  link: string
  name?: string
  size: number | null
  children?: HMPublishableBlock[]
}

export type HMPublishableBlockButton = {
  id: string
  type: 'Button'
  text?: string | undefined
  link: string
  alignment?: 'center' | 'flex-start' | 'flex-end' | undefined
  children?: HMPublishableBlock[]
}

export type HMPublishableBlockEmbed = {
  id: string
  type: 'Embed'
  link: string
  view?: HMEmbedView | undefined
  children?: HMPublishableBlock[]
}

export type HMPublishableBlockWebEmbed = {
  id: string
  type: 'WebEmbed'
  link: string
  children?: HMPublishableBlock[]
}

export type HMPublishableBlock =
  | HMPublishableBlockParagraph
  | HMPublishableBlockHeading
  | HMPublishableBlockMath
  | HMPublishableBlockCode
  | HMPublishableBlockImage
  | HMPublishableBlockVideo
  | HMPublishableBlockFile
  | HMPublishableBlockButton
  | HMPublishableBlockEmbed
  | HMPublishableBlockWebEmbed

export type HMBlockNode = {
  children?: HMBlockNode[]
  block: HMBlock
}

export const HMTimestampSchema = z
  .object({
    seconds: z.bigint().or(z.number()),
    nanos: z.number(),
  })
  .strict()
  .or(z.string())

// @ts-expect-error
export const HMBlockNodeSchema: z.ZodType<HMBlockNode> = z.lazy(() =>
  z.object({
    children: z.array(HMBlockNodeSchema).optional(),
    block: HMBlockSchema,
  }),
)

export const HMDocumentMetadataSchema = z.object({
  name: z.string().optional(),
  summary: z.string().optional(),
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
  showActivity: z.boolean().optional(),
  contentWidth: z
    .union([z.literal('S'), z.literal('M'), z.literal('L')])
    .optional(),
  theme: z
    .object({
      headerLayout: z.union([z.literal('Center'), z.literal('')]).optional(),
    })
    .optional(),
})

export function hmMetadataJsonCorrection(metadata: any): any {
  if (typeof metadata.theme === 'string') {
    return {
      ...metadata,
      theme: {},
    }
  }
  return metadata
}

export type HMMetadata = z.infer<typeof HMDocumentMetadataSchema>

export type HMLibraryDocument = HMDocumentInfo & {
  type: 'document'
  latestComment?: HMComment | null
}

// type DraftChangeInfo = {
//   author: string
//   id: string
//   deps: Array<string>
//   isDraft: boolean
// }

export type HMDocumentChangeInfo = {
  author: HMMetadataPayload
  createTime: string
  deps: Array<string>
  id: string
}

export type HMChangeInfo = HMDocumentChangeInfo

export const HMCommentDraftSchema = z.object({
  blocks: z.array(HMBlockNodeSchema),
})

export type HMCommentDraft = z.infer<typeof HMCommentDraftSchema>

export const HMNavigationItemSchema = z.object({
  type: z.literal('Link'),
  id: z.string(),
  text: z.string(),
  link: z.string(),
})
export type HMNavigationItem = z.infer<typeof HMNavigationItemSchema>

export const HMDraftContentSchema = z.object({
  content: z.array(z.any()), // EditorBlock validation is handled elsewhere
  deps: z.array(z.string().min(1)).default([]),
  navigation: z.array(HMNavigationItemSchema).optional(),
})

export type HMDraftContent = z.infer<typeof HMDraftContentSchema>

export type HMDraft = HMDraftContent & HMListedDraft

export const HMCommentSchema = z.object({
  id: z.string(),
  version: z.string(),
  author: z.string(),
  targetAccount: z.string(),
  targetPath: z.string().optional(),
  targetVersion: z.string(),
  replyParent: z.string().optional(),
  threadRoot: z.string().optional(),
  threadRootVersion: z.string().optional(),
  capability: z.string().optional(),
  content: z.array(HMBlockNodeSchema),
  createTime: HMTimestampSchema,
})

export type HMComment = z.infer<typeof HMCommentSchema>

export type HMDocumentOperation = HMDocumentOperationSetAttributes // | HMDocumentOperationReplaceBlock | HMDocumentOperationMoveBlock

export type HMDocumentOperationSetAttributes = {
  attrs: Array<{
    key: Array<string>
    value: string | number | boolean
  }>
  type: 'SetAttributes'
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

export type HMRole = 'owner' | 'writer' | 'agent' | 'none'

export const HMDraftMetaSchema = z.object({
  id: z.string(),
  locationUid: z.string().optional(),
  locationPath: z.array(z.string()).optional(),
  editUid: z.string().optional(),
  editPath: z.array(z.string()).optional(),
  metadata: HMDocumentMetadataSchema,
})

export type HMDraftMeta = z.infer<typeof HMDraftMetaSchema>

export const HMListedDraftSchema = HMDraftMetaSchema.extend({
  lastUpdateTime: z.number(),
})

export type HMListedDraft = z.infer<typeof HMListedDraftSchema>

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

// Manual Export zone:

export const HMMetadataPayloadSchema = z
  .object({
    id: unpackedHmIdSchema,
    metadata: HMDocumentMetadataSchema.or(z.null()),
  })
  .strict()
export type HMMetadataPayload = z.infer<typeof HMMetadataPayloadSchema>

export const HMAccountsMetadataSchema = z.record(
  z.string(), // account uid
  HMMetadataPayloadSchema,
)
export type HMAccountsMetadata = z.infer<typeof HMAccountsMetadataSchema>

export const HMLoadedTextContentNodeSchema = z
  .object({
    type: z.literal('Text'),
    text: z.string(),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    strike: z.boolean().optional(),
    code: z.boolean().optional(),
  })
  .strict()

export const HMLoadedLinkNodeSchema = z
  .object({
    type: z.literal('Link'),
    link: z.string(),
    content: z.array(HMLoadedTextContentNodeSchema),
  })
  .strict()

export const HMLoadedInlineEmbedNodeSchema = z
  .object({
    type: z.literal('InlineEmbed'),
    ref: z.string(),
    id: z.union([z.custom<UnpackedHypermediaId>(), z.null()]),
    text: z.string().nullable(),
  })
  .strict()

export const HMLoadedTextSchema = z.array(
  z.discriminatedUnion('type', [
    HMLoadedTextContentNodeSchema,
    HMLoadedInlineEmbedNodeSchema,
    HMLoadedLinkNodeSchema,
  ]),
)

export const HMLoadedParagraphSchema = z
  .object({
    type: z.literal('Paragraph'),
    id: z.string(),
    content: HMLoadedTextSchema,
  })
  .strict()

export const HMLoadedHeadingSchema = z
  .object({
    type: z.literal('Heading'),
    id: z.string(),
    content: HMLoadedTextSchema,
  })
  .strict()

export const HMLoadedVideoSchema = z
  .object({
    type: z.literal('Video'),
    id: z.string(),
    link: z.string(),
    name: z.string().optional(),
    width: z.number().optional(),
  })
  .strict()

export const HMLoadedFileSchema = z
  .object({
    type: z.literal('File'),
    id: z.string(),
    link: z.string(),
    name: z.string().optional(),
    size: z.number().nullable(),
  })
  .strict()

export const HMLoadedImageSchema = z
  .object({
    type: z.literal('Image'),
    id: z.string(),
    link: z.string(),
    name: z.string().optional(),
    width: z.number().optional(),
  })
  .strict()

export const HMLoadedEmbedSchema = z
  .object({
    type: z.literal('Embed'),
    id: z.string(),
    link: z.string(),
    view: z.union([z.literal('Content'), z.literal('Card')]).optional(),
    authors: HMAccountsMetadataSchema,
    updateTime: HMTimestampSchema.nullable(),
    metadata: HMDocumentMetadataSchema.nullable(),
    content: z.array(z.lazy(() => HMLoadedBlockNodeSchema)).nullable(),
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
    z.literal('DisplayTime'),
  ]),
})
export type HMQuerySort = z.infer<typeof HMQuerySortSchema>

export const HMQuerySchema = z.object({
  includes: z.array(HMQueryInclusionSchema),
  sort: z.array(HMQuerySortSchema).optional(),
  limit: z.number().optional(),
})
export type HMQuery = z.infer<typeof HMQuerySchema>

export type HMTimestamp = z.infer<typeof HMTimestampSchema>

const HMLoadedQueryBlockResultSchema = z.object({
  type: z.literal('document'),
  path: z.array(z.string()),
  metadata: HMDocumentMetadataSchema.nullable(),
  account: z.string(),
  version: z.string(),
  createTime: HMTimestampSchema.optional(),
  updateTime: HMTimestampSchema.optional(),
  genesis: z.string(),
  authors: HMAccountsMetadataSchema,
  breadcrumbs: z.any(), // todo
  activitySummary: z.any(),
})
export type HMLoadedQueryBlockResult = z.infer<
  typeof HMLoadedQueryBlockResultSchema
>

export const HMLoadedQuerySchema = z.object({
  type: z.literal('Query'),
  id: z.string(),
  query: HMQuerySchema,
  results: z.array(HMLoadedQueryBlockResultSchema).nullable(),
})

export type HMLoadedQuery = z.infer<typeof HMLoadedQuerySchema>

export const HMLoadedBlockSchema: z.ZodType = z.discriminatedUnion('type', [
  HMLoadedParagraphSchema,
  HMLoadedHeadingSchema,
  HMLoadedEmbedSchema,
  HMLoadedVideoSchema,
  HMLoadedFileSchema,
  HMLoadedImageSchema,
  HMLoadedQuerySchema,
  z.object({type: z.literal('Unsupported'), id: z.string()}).strict(),
])

export const HMLoadedBlockNodeSchema: z.ZodType = z.lazy(() =>
  z
    .object({
      block: HMLoadedBlockSchema,
      children: z.array(z.lazy(() => HMLoadedBlockNodeSchema)),
      childrenType: HMBlockChildrenTypeSchema.optional(),
    })
    .strict(),
)

export const HMLoadedDocumentSchema = z
  .object({
    id: z.custom<UnpackedHypermediaId>(),
    version: z.string(),
    content: z.array(HMLoadedBlockNodeSchema),
    metadata: HMDocumentMetadataSchema,
    authors: HMAccountsMetadataSchema,
  })
  .strict()

export type HMLoadedTextContentNode = z.infer<
  typeof HMLoadedTextContentNodeSchema
>
export type HMLoadedLinkNode = z.infer<typeof HMLoadedLinkNodeSchema>
export type HMLoadedInlineEmbedNode = z.infer<
  typeof HMLoadedInlineEmbedNodeSchema
>
export type HMLoadedText = z.infer<typeof HMLoadedTextSchema>
export type HMLoadedParagraph = z.infer<typeof HMLoadedParagraphSchema>
export type HMLoadedHeading = z.infer<typeof HMLoadedHeadingSchema>
export type HMLoadedVideo = z.infer<typeof HMLoadedVideoSchema>
export type HMLoadedFile = z.infer<typeof HMLoadedFileSchema>
export type HMLoadedImage = z.infer<typeof HMLoadedImageSchema>
export type HMLoadedEmbed = {
  type: 'Embed'
  id: string
  link: string
  view?: 'Content' | 'Card'
  authors: HMAccountsMetadata
  updateTime: HMTimestamp | null
  metadata: HMMetadata | null
  content: HMLoadedBlockNode[] | null
}
export type HMLoadedBlock =
  | HMLoadedParagraph
  | HMLoadedHeading
  | HMLoadedEmbed
  | HMLoadedVideo
  | HMLoadedFile
  | HMLoadedImage
  | HMLoadedQuery
  | {type: 'Unsupported'; id: string}

export type HMLoadedBlockNode = {
  block: HMLoadedBlock
  children: HMLoadedBlockNode[]
  childrenType?: HMBlockChildrenType
}

export type HMLoadedDocument = {
  id: UnpackedHypermediaId
  version: string
  content: HMLoadedBlockNode[]
  metadata: HMMetadata
  authors: HMAccountsMetadata
}

// END MANUAL EXPORT ZONE

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

export const HMBlockGroupSchema = z.object({
  type: z.literal('Group'),
  id: z.string(),
})

export const HMBlockLinkSchema = z.object({
  type: z.literal('Link'),
  id: z.string(),
  link: z.string(),
  text: z.string(),
})

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
  HMBlockGroupSchema,
  HMBlockLinkSchema,
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

export const HMDocumentSchema = z.object({
  content: z.array(HMBlockNodeSchema).default([]),
  version: z.string().default(''),
  account: z.string().default(''),
  authors: z.array(z.string()),
  path: z.string().default(''),
  createTime: z.union([HMTimestampSchema, z.string()]).default(''),
  updateTime: z.union([HMTimestampSchema, z.string()]).default(''),
  metadata: HMDocumentMetadataSchema,
  detachedBlocks: z.record(z.string(), HMBlockNodeSchema).optional(),
  genesis: z.string(),
})
// .strict() // avoid errors when the backend sends extra fields (most recently "header" and "footer")
export type HMDocument = z.infer<typeof HMDocumentSchema>

export const HMResourceDocumentSchema = HMDocumentSchema.extend({
  type: z.literal('document'),
  document: HMDocumentSchema,
  id: unpackedHmIdSchema,
})
export type HMResourceDocument = z.infer<typeof HMResourceDocumentSchema>

export const HMResourceCommentSchema = z.object({
  type: z.literal('comment'),
  comment: HMCommentSchema,
  id: unpackedHmIdSchema,
})
export type HMResourceComment = z.infer<typeof HMResourceCommentSchema>

export const HMResourceRedirectSchema = z.object({
  type: z.literal('redirect'),
  id: unpackedHmIdSchema,
  redirectTarget: unpackedHmIdSchema,
})
export type HMResourceRedirect = z.infer<typeof HMResourceRedirectSchema>

export const HMResourceNotFoundSchema = z.object({
  type: z.literal('not-found'),
  id: unpackedHmIdSchema,
})
export type HMResourceNotFound = z.infer<typeof HMResourceNotFoundSchema>

export const HMResourceSchema = z.discriminatedUnion('type', [
  HMResourceDocumentSchema,
  HMResourceCommentSchema,
  HMResourceRedirectSchema,
  HMResourceNotFoundSchema,
])
export type HMResource = z.infer<typeof HMResourceSchema>

export const HMResolvedResourceSchema = z.discriminatedUnion('type', [
  HMResourceDocumentSchema,
  HMResourceCommentSchema,
])
export type HMResolvedResource = z.infer<typeof HMResolvedResourceSchema>

export const DeviceLinkSessionSchema = z.object({
  accountId: z.string(),
  secretToken: z.string(),
  addrInfo: z.object({
    peerId: z.string(),
    addrs: z.array(z.string()),
  }),
})

export type DeviceLinkSession = z.infer<typeof DeviceLinkSessionSchema>

export const ParsedFragmentSchema = z.discriminatedUnion('type', [
  ExpandedBlockRangeSchema.extend({
    type: z.literal('block'),
    blockId: z.string(),
  }),
  ExactBlockRangeSchema.extend({
    type: z.literal('block-range'),
    blockId: z.string(),
  }),
])
export type ParsedFragment = z.infer<typeof ParsedFragmentSchema>

const HMCitationCommentSourceSchema = z.object({
  type: z.literal('c'),
  id: unpackedHmIdSchema,
  author: z.string().optional(),
  time: HMTimestampSchema.optional(),
})
const HMCitationDocumentSourceSchema = z.object({
  type: z.literal('d'),
  id: unpackedHmIdSchema,
  author: z.string().optional(),
  time: HMTimestampSchema.optional(),
})

export const HMCitationSchema = z.object({
  source: z.discriminatedUnion('type', [
    HMCitationCommentSourceSchema,
    HMCitationDocumentSourceSchema,
  ]),
  isExactVersion: z.boolean(),
  targetFragment: ParsedFragmentSchema.nullable(),
  targetId: unpackedHmIdSchema,
})
export type HMCitation = z.infer<typeof HMCitationSchema>

export type HMDocumentCitation = HMCitation & {
  document: HMDocument | null
  author: HMMetadataPayload | null
}

export type HMCommentCitation = HMCitation & {
  comment: HMComment | null
  author: HMMetadataPayload | null
}

export type HMCitationsPayload = Array<HMDocumentCitation>

export type HMCommentsPayload = {
  allComments: HMComment[]
  commentGroups: HMCommentGroup[]
  commentAuthors: HMAccountsMetadata
}

export const HMPeerConnectionRequestSchema = z.object({
  a: z.array(z.string()), // addrs
  d: z.string(), // peer/device ID
})

export type HMPeerConnectionRequest = z.infer<
  typeof HMPeerConnectionRequestSchema
>

export type HMContact = {
  metadata: HMMetadata
  contacts: PlainMessage<Contact>[] | undefined
  subjectContacts: PlainMessage<Contact>[] | undefined
}

export type HMCapability = {
  id: string
  accountUid: string
  role: HMRole
  capabilityId?: string
  grantId: UnpackedHypermediaId
  label?: string | undefined
}

export const siteDiscoverRequestSchema = z.object({
  uid: z.string(),
  path: z.array(z.string()),
  version: z.string().optional(),
  media: z.boolean().optional(),
})

export type SiteDiscoverRequest = z.infer<typeof siteDiscoverRequestSchema>
