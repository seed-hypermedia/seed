import {PlainMessage} from '@bufbuild/protobuf'
import * as z from 'zod'
import {
  type Account,
  type Block,
  type BlockNode,
  type DeletedEntity,
  type Document,
  type DocumentChangeInfo,
} from './client/grpc-types'

export const BlockRangeSchema = z.object({
  // a block range should either have start+end
  start: z.number().optional(),
  end: z.number().optional(),
  // or have expanded bool
  expanded: z.boolean().optional(),
})
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
  z.literal('Comments'),
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

export type HMResourceFetchResult = {
  id: UnpackedHypermediaId
  document?: HMDocument | null
  redirectTarget?: UnpackedHypermediaId | null
  isTombstone?: boolean
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

// @ts-expect-error - Complex recursive type incompatibility with Zod inference
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
  targetDocId: z.string().optional(),
  replyCommentId: z.string().optional(),
  quotingBlockId: z.string().optional(),
  context: z.enum(['accessory', 'feed', 'document-content']).optional(),
  lastUpdateTime: z.number().optional(),
})

export type HMCommentDraft = z.infer<typeof HMCommentDraftSchema>

export const HMListedCommentDraftSchema = z.object({
  id: z.string(),
  targetDocId: z.string(),
  replyCommentId: z.string().optional(),
  quotingBlockId: z.string().optional(),
  context: z.enum(['accessory', 'feed', 'document-content']).optional(),
  lastUpdateTime: z.number(),
})

export type HMListedCommentDraft = z.infer<typeof HMListedCommentDraftSchema>

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
  updateTime: HMTimestampSchema,
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

export const HMBreadcrumbSchema = z.object({
  name: z.string(),
  path: z.string(),
  isMissing: z.boolean().optional(),
})
export type HMBreadcrumb = z.infer<typeof HMBreadcrumbSchema>

export type HMAccount = Omit<PlainMessage<Account>, 'metadata'> & {
  metadata?: HMMetadata
}

export const HMCommentGroupSchema = z.object({
  comments: z.array(HMCommentSchema),
  moreCommentsCount: z.number(),
  id: z.string(),
  type: z.literal('commentGroup'),
})
export type HMCommentGroup = z.infer<typeof HMCommentGroupSchema>

export const HMExternalCommentGroupSchema = z.object({
  comments: z.array(HMCommentSchema),
  moreCommentsCount: z.number(),
  id: z.string(),
  target: z.lazy(() => HMMetadataPayloadSchema),
  type: z.literal('externalCommentGroup'),
})
export type HMExternalCommentGroup = z.infer<
  typeof HMExternalCommentGroupSchema
>

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

export const HMActivitySummarySchema = z.object({
  latestCommentTime: HMTimestampSchema.optional(),
  latestCommentId: z.string(),
  commentCount: z.number(),
  latestChangeTime: HMTimestampSchema,
  isUnread: z.boolean(),
})
export type HMActivitySummary = z.infer<typeof HMActivitySummarySchema>

export const HMGenerationInfoSchema = z.object({
  genesis: z.string(),
  generation: z.bigint(),
})
export type HMGenerationInfo = z.infer<typeof HMGenerationInfoSchema>

export const HMRedirectInfoSchema = z.object({
  type: z.literal('redirect'),
  target: z.string(),
})
export type HMRedirectInfo = z.infer<typeof HMRedirectInfoSchema>

export const HMDocumentInfoSchema = z.object({
  type: z.literal('document'),
  id: unpackedHmIdSchema,
  path: z.array(z.string()),
  authors: z.array(z.string()),
  createTime: HMTimestampSchema,
  updateTime: HMTimestampSchema,
  sortTime: z.instanceof(Date),
  genesis: z.string(),
  version: z.string(),
  breadcrumbs: z.array(HMBreadcrumbSchema),
  activitySummary: HMActivitySummarySchema,
  generationInfo: HMGenerationInfoSchema,
  redirectInfo: HMRedirectInfoSchema.optional(),
  metadata: HMDocumentMetadataSchema,
})
export type HMDocumentInfo = z.infer<typeof HMDocumentInfoSchema>

export type HMChangeGroup = {
  id: string
  type: 'changeGroup'
  changes: HMChangeSummary[]
}

export const HMQueryResultSchema = z.object({
  in: unpackedHmIdSchema,
  results: z.array(HMDocumentInfoSchema),
  mode: z
    .union([z.literal('Children'), z.literal('AllDescendants')])
    .optional(),
})
export type HMQueryResult = z.infer<typeof HMQueryResultSchema>

export const HMRoleSchema = z.enum(['writer', 'agent', 'none', 'owner'])
export type HMRole = z.infer<typeof HMRoleSchema>

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
    hasSite: z.boolean().optional(),
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

export const HMLoadedQuerySchema = z.object({
  type: z.literal('Query'),
  id: z.string(),
  query: HMQuerySchema,
  results: z.array(HMDocumentInfoSchema).optional(),
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
  view?: 'Content' | 'Card' | 'Comments'
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
  link: z.string().optional(),
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

export const HMResourceDocumentSchema = z.object({
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

export const HMResourceTombstoneSchema = z.object({
  type: z.literal('tombstone'),
  id: unpackedHmIdSchema,
})
export type HMResourceTombstone = z.infer<typeof HMResourceTombstoneSchema>

export const HMResourceSchema = z.discriminatedUnion('type', [
  HMResourceDocumentSchema,
  HMResourceCommentSchema,
  // todo: Contact, Capability
  HMResourceRedirectSchema, // what if there is a profile ALIAS? how is that different from a home doc redirect?
  HMResourceNotFoundSchema,
  HMResourceTombstoneSchema,
])
export type HMResource = z.infer<typeof HMResourceSchema>

export const HMResolvedResourceSchema = z.discriminatedUnion('type', [
  HMResourceDocumentSchema,
  HMResourceCommentSchema,
  HMResourceTombstoneSchema,
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

export const ParsedFragmentSchema = BlockRangeSchema.extend({
  blockId: z.string(),
})
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
  comments: HMComment[]
  authors: HMAccountsMetadata
}

export const HMPeerConnectionRequestSchema = z.object({
  a: z.array(z.string()), // addrs
  d: z.string(), // peer/device ID
})

export type HMPeerConnectionRequest = z.infer<
  typeof HMPeerConnectionRequestSchema
>

// Contact record schema (matches gRPC Contact type)
export const HMContactRecordSchema = z.object({
  id: z.string(),
  subject: z.string(),
  name: z.string(),
  account: z.string(),
  createTime: HMTimestampSchema.optional(),
  updateTime: HMTimestampSchema.optional(),
})
export type HMContactRecord = z.infer<typeof HMContactRecordSchema>

export const HMContactSchema = z.object({
  metadata: HMDocumentMetadataSchema,
  contacts: z.array(HMContactRecordSchema).optional(),
  subjectContacts: z.array(HMContactRecordSchema).optional(),
})
export type HMContact = z.infer<typeof HMContactSchema>

export const HMContactItemSchema = z.object({
  id: unpackedHmIdSchema,
  metadata: HMDocumentMetadataSchema.optional(),
})
export type HMContactItem = z.infer<typeof HMContactItemSchema>

// AccountContacts request: get contacts for a specific account
export const HMAccountContactsRequestSchema = z.object({
  key: z.literal('AccountContacts'),
  input: z.string(), // account UID
  output: z.array(HMContactRecordSchema),
})
export type HMAccountContactsRequest = z.infer<
  typeof HMAccountContactsRequestSchema
>

export const HMCapabilitySchema = z.object({
  id: z.string(),
  accountUid: z.string(),
  role: HMRoleSchema,
  capabilityId: z.string().optional(),
  grantId: unpackedHmIdSchema,
  label: z.string().optional(),
  createTime: HMTimestampSchema,
})
export type HMCapability = z.infer<typeof HMCapabilitySchema>

export const siteDiscoverRequestSchema = z.object({
  uid: z.string(),
  path: z.array(z.string()),
  version: z.string().optional(),
  media: z.boolean().optional(),
})

export type SiteDiscoverRequest = z.infer<typeof siteDiscoverRequestSchema>

// export const HMFeedPayloadSchema = z.object({
//   events: z.array(HMFeedEventSchema),
//   nextPageToken: z.string(),
// })
// export type HMFeedPayload = z.infer<typeof HMFeedPayloadSchema>

export const HMHostConfigSchema = z.object({
  peerId: z.string(),
  registeredAccountUid: z.string(),
  protocolId: z.string(),
  addrs: z.array(z.string()),
  hostname: z.string(),
  isGateway: z.boolean(),
})
export type HMHostConfig = z.infer<typeof HMHostConfigSchema>

export const HMResourceRequestSchema = z.object({
  key: z.literal('Resource'),
  input: unpackedHmIdSchema,
  output: HMResourceSchema,
})
export type HMResourceRequest = z.infer<typeof HMResourceRequestSchema>

export const HMResourceMetadataRequestSchema = z.object({
  key: z.literal('ResourceMetadata'),
  input: unpackedHmIdSchema,
  output: HMMetadataPayloadSchema,
})
export type HMResourceMetadataRequest = z.infer<
  typeof HMResourceMetadataRequestSchema
>

export const HMAccountRequestSchema = z.object({
  key: z.literal('Account'),
  input: z.string(),
  output: HMMetadataPayloadSchema,
})
export type HMAccountRequest = z.infer<typeof HMAccountRequestSchema>

export const HMBatchAccountsRequestSchema = z.object({
  key: z.literal('BatchAccounts'),
  input: z.array(z.string()),
  output: z.record(z.string(), HMMetadataPayloadSchema),
})
export type HMBatchAccountsRequest = z.infer<
  typeof HMBatchAccountsRequestSchema
>

export const HMSearchInputSchema = z.object({
  query: z.string(),
  accountUid: z.string().optional(),
  includeBody: z.boolean().optional(),
  contextSize: z.number().optional(),
  perspectiveAccountUid: z.string().optional(),
})
export type HMSearchInput = z.infer<typeof HMSearchInputSchema>

export const HMSearchResultItemSchema = z.object({
  id: unpackedHmIdSchema,
  metadata: HMDocumentMetadataSchema.optional(),
  title: z.string(),
  icon: z.string(),
  parentNames: z.array(z.string()),
  versionTime: z.any().optional(),
  searchQuery: z.string(),
  type: z.enum(['document', 'contact']),
})

export const HMSearchPayloadSchema = z.object({
  entities: z.array(HMSearchResultItemSchema),
  searchQuery: z.string(),
})
export type HMSearchPayload = z.infer<typeof HMSearchPayloadSchema>

export const HMSearchRequestSchema = z.object({
  key: z.literal('Search'),
  input: HMSearchInputSchema,
  output: HMSearchPayloadSchema,
})
export type HMSearchRequest = z.infer<typeof HMSearchRequestSchema>

export const HMQueryRequestSchema = z.object({
  key: z.literal('Query'),
  input: HMQuerySchema,
  output: HMQueryResultSchema.nullable(),
})
export type HMQueryRequest = z.infer<typeof HMQueryRequestSchema>

// Comments API request schemas
export const HMListCommentsInputSchema = z.object({
  targetId: unpackedHmIdSchema,
})
export type HMListCommentsInput = z.infer<typeof HMListCommentsInputSchema>

export const HMListCommentsOutputSchema = z.object({
  comments: z.array(HMCommentSchema),
  authors: z.record(z.string(), HMMetadataPayloadSchema),
})
export type HMListCommentsOutput = z.infer<typeof HMListCommentsOutputSchema>

export const HMListCommentsRequestSchema = z.object({
  key: z.literal('ListComments'),
  input: HMListCommentsInputSchema,
  output: HMListCommentsOutputSchema,
})
export type HMListCommentsRequest = z.infer<typeof HMListCommentsRequestSchema>

export const HMListDiscussionsInputSchema = z.object({
  targetId: unpackedHmIdSchema,
  commentId: z.string().optional(),
})
export type HMListDiscussionsInput = z.infer<
  typeof HMListDiscussionsInputSchema
>

export const HMListDiscussionsOutputSchema = z.object({
  discussions: z.array(HMCommentGroupSchema),
  authors: z.record(z.string(), HMMetadataPayloadSchema),
  citingDiscussions: z.array(HMExternalCommentGroupSchema),
})
export type HMListDiscussionsOutput = z.infer<
  typeof HMListDiscussionsOutputSchema
>

export const HMListDiscussionsRequestSchema = z.object({
  key: z.literal('ListDiscussions'),
  input: HMListDiscussionsInputSchema,
  output: HMListDiscussionsOutputSchema,
})
export type HMListDiscussionsRequest = z.infer<
  typeof HMListDiscussionsRequestSchema
>

export const HMListCommentsByReferenceInputSchema = z.object({
  targetId: unpackedHmIdSchema,
})
export type HMListCommentsByReferenceInput = z.infer<
  typeof HMListCommentsByReferenceInputSchema
>

export const HMListCommentsByReferenceRequestSchema = z.object({
  key: z.literal('ListCommentsByReference'),
  input: HMListCommentsByReferenceInputSchema,
  output: HMListCommentsOutputSchema,
})
export type HMListCommentsByReferenceRequest = z.infer<
  typeof HMListCommentsByReferenceRequestSchema
>

export const HMGetCommentReplyCountInputSchema = z.object({
  id: z.string(),
})
export type HMGetCommentReplyCountInput = z.infer<
  typeof HMGetCommentReplyCountInputSchema
>

export const HMGetCommentReplyCountRequestSchema = z.object({
  key: z.literal('GetCommentReplyCount'),
  input: HMGetCommentReplyCountInputSchema,
  output: z.number(),
})
export type HMGetCommentReplyCountRequest = z.infer<
  typeof HMGetCommentReplyCountRequestSchema
>

// Activity API request schemas
export const HMListEventsInputSchema = z.object({
  pageSize: z.number().optional(),
  pageToken: z.string().optional(),
  trustedOnly: z.boolean().optional(),
  filterAuthors: z.array(z.string()).optional(),
  filterEventType: z.array(z.string()).optional(),
  filterResource: z.string().optional(),
  currentAccount: z.string().optional(),
})
export type HMListEventsInput = z.infer<typeof HMListEventsInputSchema>

// LoadedEvent schema - passthrough since it's a complex union type
export const HMLoadedEventSchema = z.object({}).passthrough()

export const HMListEventsOutputSchema = z.object({
  events: z.array(HMLoadedEventSchema),
  nextPageToken: z.string(),
})
export type HMListEventsOutput = z.infer<typeof HMListEventsOutputSchema>

export const HMListEventsRequestSchema = z.object({
  key: z.literal('ListEvents'),
  input: HMListEventsInputSchema,
  output: HMListEventsOutputSchema,
})
export type HMListEventsRequest = z.infer<typeof HMListEventsRequestSchema>

export const HMRequestSchema = z.discriminatedUnion('key', [
  HMResourceRequestSchema,
  HMResourceMetadataRequestSchema,
  HMAccountRequestSchema,
  HMBatchAccountsRequestSchema,
  HMSearchRequestSchema,
  HMQueryRequestSchema,
  HMAccountContactsRequestSchema,
  HMListCommentsRequestSchema,
  HMListDiscussionsRequestSchema,
  HMListCommentsByReferenceRequestSchema,
  HMGetCommentReplyCountRequestSchema,
  HMListEventsRequestSchema,
])

export type HMRequest = z.infer<typeof HMRequestSchema>
