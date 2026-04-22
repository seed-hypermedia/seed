import * as z from 'zod'

// Signing abstraction: each platform provides its own implementation
export type HMSigner = {
  getPublicKey: () => Promise<Uint8Array>
  sign: (data: Uint8Array) => Promise<Uint8Array>
}

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
  .union([z.literal('Group'), z.literal('Ordered'), z.literal('Unordered'), z.literal('Blockquote'), z.literal('Grid')])
  .nullable() // null or missing childrenType means "Group"
export type HMBlockChildrenType = z.infer<typeof HMBlockChildrenTypeSchema>

export const HMEmbedViewSchema = z.union([z.literal('Content'), z.literal('Card'), z.literal('Comments')])
export type HMEmbedView = z.infer<typeof HMEmbedViewSchema>

export const HMQueryStyleSchema = z.union([z.literal('Card'), z.literal('List')])

export type HMQueryStyle = z.infer<typeof HMQueryStyleSchema>

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
  columnCount: z.number().optional(),
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
  console.warn('Value must be a number or a string that can be converted to a number', value)
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
        autoplay: z.boolean().optional(),
        loop: z.boolean().optional(),
        muted: z.boolean().optional(),
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
export type HMBlockButtonAlignment = z.infer<typeof HMBlockButtonAlignmentSchema>

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
  layout: z.union([z.literal('Seed/Experimental/Newspaper'), z.literal('')]).optional(),
  displayPublishTime: z.string().optional(),
  displayAuthor: z.string().optional(),
  seedExperimentalLogo: z.string().optional(),
  seedExperimentalHomeOrder: z.union([z.literal('UpdatedFirst'), z.literal('CreatedFirst')]).optional(),
  showOutline: z.boolean().optional(),
  showActivity: z.boolean().optional(),
  contentWidth: z.union([z.literal('S'), z.literal('M'), z.literal('L')]).optional(),
  theme: z
    .object({
      headerLayout: z.union([z.literal('Center'), z.literal('')]).optional(),
    })
    .optional(),
  // Import taxonomy fields (comma-separated values from external sources like WordPress)
  importCategories: z.string().optional(),
  importTags: z.string().optional(),
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

export type HMResourceVisibility = 'PUBLIC' | 'PRIVATE'

const visibilityMap: Record<string | number, HMResourceVisibility> = {
  0: 'PUBLIC',
  1: 'PUBLIC',
  2: 'PRIVATE',
  RESOURCE_VISIBILITY_UNSPECIFIED: 'PUBLIC',
  RESOURCE_VISIBILITY_PUBLIC: 'PUBLIC',
  RESOURCE_VISIBILITY_PRIVATE: 'PRIVATE',
  UNSPECIFIED: 'PUBLIC',
  PUBLIC: 'PUBLIC',
  PRIVATE: 'PRIVATE',
}

export const HMResourceVisibilitySchema = z
  .union([z.string(), z.number()])
  .transform((val): HMResourceVisibility => visibilityMap[val] ?? 'PUBLIC')

export const HMCommentSchema = z.object({
  id: z.string(),
  version: z.string(),
  author: z.string(),
  targetAccount: z.string(),
  targetPath: z.string().optional(),
  targetVersion: z.string(),
  replyParent: z.string().optional(),
  replyParentVersion: z.string().optional(),
  threadRoot: z.string().optional(),
  threadRootVersion: z.string().optional(),
  capability: z.string().optional(),
  content: z.array(HMBlockNodeSchema),
  createTime: HMTimestampSchema,
  updateTime: HMTimestampSchema,
  visibility: HMResourceVisibilitySchema,
})

export type HMComment = z.infer<typeof HMCommentSchema>

export const HMBreadcrumbSchema = z.object({
  name: z.string(),
  path: z.string(),
  isMissing: z.boolean().optional(),
})
export type HMBreadcrumb = z.infer<typeof HMBreadcrumbSchema>

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
export type HMExternalCommentGroup = z.infer<typeof HMExternalCommentGroupSchema>

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
  generation: z.union([z.bigint(), z.coerce.bigint()]),
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
  visibility: HMResourceVisibilitySchema,
})
export type HMDocumentInfo = z.infer<typeof HMDocumentInfoSchema>

export type HMLibraryDocument = HMDocumentInfo & {
  type: 'document'
  latestComment?: HMComment | null
}

export const HMQueryResultSchema = z.object({
  in: unpackedHmIdSchema,
  results: z.array(HMDocumentInfoSchema),
  mode: z.union([z.literal('Children'), z.literal('AllDescendants')]).optional(),
})
export type HMQueryResult = z.infer<typeof HMQueryResultSchema>

export const HMRoleSchema = z.enum(['writer', 'agent', 'none', 'owner'])
export type HMRole = z.infer<typeof HMRoleSchema>

// Manual Export zone:

export const HMMetadataPayloadSchema = z
  .object({
    id: unpackedHmIdSchema,
    metadata: HMDocumentMetadataSchema.or(z.null()),
    hasSite: z.boolean().optional(),
  })
  .strict()
export type HMMetadataPayload = z.infer<typeof HMMetadataPayloadSchema>

export const HMAccountPayloadSchema = HMMetadataPayloadSchema.extend({
  type: z.literal('account'),
})
export type HMAccountPayload = z.infer<typeof HMAccountPayloadSchema>

export const HMAccountNotFoundSchema = z.object({
  type: z.literal('account-not-found'),
  uid: z.string(),
})
export type HMAccountNotFound = z.infer<typeof HMAccountNotFoundSchema>

export const HMAccountResultSchema = z.discriminatedUnion('type', [HMAccountPayloadSchema, HMAccountNotFoundSchema])
export type HMAccountResult = z.infer<typeof HMAccountResultSchema>

export const HMSiteMemberSchema = z.object({
  account: unpackedHmIdSchema,
  role: z.enum(['owner', 'writer', 'member']),
})
export type HMSiteMember = z.infer<typeof HMSiteMemberSchema>

export type HMAccount = {
  id: string
  // metadata?: PlainMessage<Struct> | undefined;
  // activitySummary?: PlainMessage<ActivitySummary> | undefined;
  isSubscribed: boolean
  aliasAccount: string
  // profile?: PlainMessage<Profile> | undefined;
  // homeDocumentInfo?: PlainMessage<DocumentInfo> | undefined;
  metadata?: HMMetadata
}

export const HMAccountsMetadataSchema = z.record(
  z.string(), // account uid
  HMMetadataPayloadSchema,
)
export type HMAccountsMetadata = z.infer<typeof HMAccountsMetadataSchema>

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
    z.literal('ActivityTime'),
  ]),
})
export type HMQuerySort = z.infer<typeof HMQuerySortSchema>

export const HMQuerySchema = z.object({
  includes: z.array(HMQueryInclusionSchema),
  sort: z.array(HMQuerySortSchema).optional(),
  limit: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? undefined : val),
    z.coerce.number().optional(),
  ),
})
export type HMQuery = z.infer<typeof HMQuerySchema>

export type HMTimestamp = z.infer<typeof HMTimestampSchema>

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

export const HMBlockKnownSchema = z.discriminatedUnion('type', [
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

export const HMBlockUnknownSchema = z
  .object({
    type: z.string(),
    id: z.string(),
    revision: z.string().optional(),
    attributes: z.record(z.any()).optional(),
    annotations: z.array(z.any()).optional(),
    text: z.string().optional(),
    link: z.string().optional(),
  })
  .passthrough()

export const HMBlockSchema = z.union([HMBlockKnownSchema, HMBlockUnknownSchema])

export const knownBlockTypes = new Set(HMBlockKnownSchema.optionsMap.keys())

export function isKnownBlockType(btype: string): boolean {
  return knownBlockTypes.has(btype)
}

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
export type HMBlock = z.infer<typeof HMBlockKnownSchema>
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
  generationInfo: HMGenerationInfoSchema.optional(),
  visibility: HMResourceVisibilitySchema,
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

export const HMResourceErrorSchema = z.object({
  type: z.literal('error'),
  id: unpackedHmIdSchema,
  message: z.string(),
})
export type HMResourceError = z.infer<typeof HMResourceErrorSchema>

export const HMResourceSchema = z.discriminatedUnion('type', [
  HMResourceDocumentSchema,
  HMResourceCommentSchema,
  // todo: Contact, Capability
  HMResourceRedirectSchema, // what if there is a profile ALIAS? how is that different from a home doc redirect?
  HMResourceNotFoundSchema,
  HMResourceTombstoneSchema,
  HMResourceErrorSchema,
])
export type HMResource = z.infer<typeof HMResourceSchema>

export const HMResolvedResourceSchema = z.discriminatedUnion('type', [
  HMResourceDocumentSchema,
  HMResourceCommentSchema,
  HMResourceTombstoneSchema,
])
export type HMResolvedResource = z.infer<typeof HMResolvedResourceSchema>

// Subscribe preferences for a contact.
export const HMContactSubscribeSchema = z.object({
  site: z.boolean().optional(),
  profile: z.boolean().optional(),
})
export type HMContactSubscribe = z.infer<typeof HMContactSubscribeSchema>

// Contact record schema (matches gRPC Contact type)
export const HMContactRecordSchema = z.object({
  id: z.string(),
  subject: z.string(),
  name: z.string(),
  account: z.string(),
  signer: z.string(),
  createTime: HMTimestampSchema.optional(),
  updateTime: HMTimestampSchema.optional(),
  subscribe: HMContactSubscribeSchema.optional(),
})
export type HMContactRecord = z.infer<typeof HMContactRecordSchema>

// AccountContacts request: get contacts for a specific account
export const HMAccountContactsRequestSchema = z.object({
  key: z.literal('AccountContacts'),
  input: z.string(), // account UID
  output: z.array(HMContactRecordSchema),
})
export type HMAccountContactsRequest = z.infer<typeof HMAccountContactsRequestSchema>

export type HMExistingDraft = {
  id: string
  metadata?: HMMetadata
}

// Comment draft schemas
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

// Wallet type
export type HMWallet = {
  balance: number
  id: string
  address: string
  name: string
  type: string
}

// Document change info type
export type HMDocumentChangeInfo = {
  author: HMMetadataPayload
  createTime: string
  deps: Array<string>
  id: string
}

// Host config schema
export const HMHostConfigSchema = z.object({
  peerId: z.string(),
  registeredAccountUid: z.string(),
  protocolId: z.string(),
  addrs: z.array(z.string()),
  hostname: z.string(),
  isGateway: z.boolean(),
})
export type HMHostConfig = z.infer<typeof HMHostConfigSchema>

export type EditorTextStyles = {
  bold?: true
  italic?: true
  underline?: true
  strike?: true
  code?: true
}

export type EditorToggledStyle = {
  [K in keyof EditorTextStyles]-?: Required<EditorTextStyles>[K] extends true ? K : never
}[keyof EditorTextStyles]

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

export const HMPeerConnectionRequestSchema = z.object({
  a: z.array(z.string()), // addrs
  d: z.string(), // peer/device ID
})

export type HMPeerConnectionRequest = z.infer<typeof HMPeerConnectionRequestSchema>

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
  source: z.discriminatedUnion('type', [HMCitationCommentSourceSchema, HMCitationDocumentSourceSchema]),
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

export type DiscoveryProgress = {
  blobsDiscovered: number
  blobsDownloaded: number
  blobsFailed: number
}

export type DiscoveryState = {
  isDiscovering: boolean
  startedAt: number
  entityId: string
  recursive?: boolean
  progress?: DiscoveryProgress
  isTombstone?: boolean
  isNotFound?: boolean
}

export type AggregatedDiscoveryState = {
  activeCount: number
  tombstoneCount: number
  notFoundCount: number
  blobsDiscovered: number
  blobsDownloaded: number
  blobsFailed: number
}

export const DeviceLinkSessionSchema = z.object({
  accountId: z.string(),
  secretToken: z.string(),
  addrInfo: z.object({
    peerId: z.string(),
    addrs: z.array(z.string()),
  }),
})

export type DeviceLinkSession = z.infer<typeof DeviceLinkSessionSchema>

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
  cursorPosition: z.number().optional(),
})

export type HMDraftContent = z.infer<typeof HMDraftContentSchema>

const HMDraftMetaBaseSchema = z.object({
  id: z.string(),
  locationUid: z.string().optional(),
  locationPath: z.array(z.string()).optional(),
  editUid: z.string().optional(),
  editPath: z.array(z.string()).optional(),
  metadata: HMDocumentMetadataSchema,
  visibility: HMResourceVisibilitySchema.optional().default('PUBLIC'),
  // deps and navigation live in the index entry for .md drafts
  // (for .json drafts they come from the content file for backwards compat)
  deps: z.array(z.string().min(1)).default([]),
  navigation: z.array(HMNavigationItemSchema).optional(),
})

const draftLocationRefinement = (data: {editUid?: string; locationUid?: string}) => data.editUid || data.locationUid

export const HMDraftMetaSchema = HMDraftMetaBaseSchema.refine(draftLocationRefinement, {
  message: 'Either editUid or locationUid must be provided',
})

// Drafts may have editUid (editing existing doc), locationUid (creating child),
// both, or neither (location chosen at publish time).
type HMDraftMetaBase = {
  id: string
  locationPath?: string[]
  editPath?: string[]
  metadata: HMMetadata
  visibility: HMResourceVisibility
  deps: string[]
  navigation?: HMNavigationItem[]
}

export type HMDraftMeta = HMDraftMetaBase & {
  editUid?: string
  locationUid?: string
}

// Schema with refinement for writing new drafts
export const HMListedDraftSchema = HMDraftMetaBaseSchema.extend({
  lastUpdateTime: z.number(),
}).refine(draftLocationRefinement, {
  message: 'Either editUid or locationUid must be provided',
})

// Looser schema for reading legacy drafts (no refinement)
export const HMListedDraftReadSchema = HMDraftMetaBaseSchema.extend({
  lastUpdateTime: z.number(),
})

export type HMListedDraft = HMDraftMeta & {
  lastUpdateTime: number
}

export type HMInvoice = {
  payload: string
  hash: string
  amount: number
  share: Record<string, number>
  description?: string
}

export type HMDraft = HMDraftContent & HMListedDraft

export type HMDeletedEntity = {
  id: string
  deleteTime?: HMTimestamp | undefined
  deletedReason: string
  metadata: string
}

export type HMResourceFetchResult = {
  id: UnpackedHypermediaId
  document?: HMDocument | null
  redirectTarget?: UnpackedHypermediaId | null
  isTombstone?: boolean
}

export type HMChangeSummary = {
  type: 'change'
  id: string
  author: string
  deps: string[]
  createTime?: HMTimestamp | undefined
}

export type HMChangeGroup = {
  id: string
  type: 'changeGroup'
  changes: HMChangeSummary[]
}

// SubjectContacts request: get contacts where this account is the subject
export const HMSubjectContactsRequestSchema = z.object({
  key: z.literal('SubjectContacts'),
  input: z.string(), // subject UID
  output: z.array(HMContactRecordSchema),
})
export type HMSubjectContactsRequest = z.infer<typeof HMSubjectContactsRequestSchema>

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
export type HMResourceMetadataRequest = z.infer<typeof HMResourceMetadataRequestSchema>

export const HMAccountRequestSchema = z.object({
  key: z.literal('Account'),
  input: z.string(),
  output: HMAccountResultSchema,
})
export type HMAccountRequest = z.infer<typeof HMAccountRequestSchema>

export const HMCommentRequestSchema = z.object({
  key: z.literal('Comment'),
  input: z.string(),
  output: HMCommentSchema,
})
export type HMCommentRequest = z.infer<typeof HMCommentRequestSchema>

export const HMSearchInputSchema = z.object({
  query: z.coerce.string(),
  accountUid: z.string().optional(),
  includeBody: z.boolean().optional(),
  contextSize: z.number().optional(),
  perspectiveAccountUid: z.string().optional(),
  searchType: z.number().optional(),
  pageSize: z.number().optional(),
  iriFilter: z.string().optional(),
  contentTypeFilter: z.array(z.number()).optional(),
})
export type HMSearchInput = z.infer<typeof HMSearchInputSchema>

export const HMSearchResultItemSchema = z.object({
  id: unpackedHmIdSchema,
  metadata: HMDocumentMetadataSchema.optional(),
  title: z.string(),
  icon: z.string(),
  parentNames: z.array(z.string()),
  versionTime: z.string().optional(),
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
export type HMListDiscussionsInput = z.infer<typeof HMListDiscussionsInputSchema>

export const HMListDiscussionsOutputSchema = z.object({
  discussions: z.array(HMCommentGroupSchema),
  authors: z.record(z.string(), HMMetadataPayloadSchema),
  citingDiscussions: z.array(HMExternalCommentGroupSchema),
})
export type HMListDiscussionsOutput = z.infer<typeof HMListDiscussionsOutputSchema>

export const HMListDiscussionsRequestSchema = z.object({
  key: z.literal('ListDiscussions'),
  input: HMListDiscussionsInputSchema,
  output: HMListDiscussionsOutputSchema,
})
export type HMListDiscussionsRequest = z.infer<typeof HMListDiscussionsRequestSchema>

export const HMListCommentsByReferenceInputSchema = z.object({
  targetId: unpackedHmIdSchema,
})
export type HMListCommentsByReferenceInput = z.infer<typeof HMListCommentsByReferenceInputSchema>

export const HMListCommentsByReferenceRequestSchema = z.object({
  key: z.literal('ListCommentsByReference'),
  input: HMListCommentsByReferenceInputSchema,
  output: HMListCommentsOutputSchema,
})
export type HMListCommentsByReferenceRequest = z.infer<typeof HMListCommentsByReferenceRequestSchema>

export const HMGetCommentReplyCountInputSchema = z.object({
  id: z.string(),
})
export type HMGetCommentReplyCountInput = z.infer<typeof HMGetCommentReplyCountInputSchema>

export const HMGetCommentReplyCountRequestSchema = z.object({
  key: z.literal('GetCommentReplyCount'),
  input: HMGetCommentReplyCountInputSchema,
  output: z.number(),
})
export type HMGetCommentReplyCountRequest = z.infer<typeof HMGetCommentReplyCountRequestSchema>

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

// ListAccounts - lists all known accounts/root documents
export const HMListAccountsOutputSchema = z.object({
  accounts: z.array(HMMetadataPayloadSchema),
})
export type HMListAccountsOutput = z.infer<typeof HMListAccountsOutputSchema>

export const HMListAccountsInputSchema = z.object({}).optional()
export type HMListAccountsInput = z.infer<typeof HMListAccountsInputSchema>

export const HMListAccountsRequestSchema = z.object({
  key: z.literal('ListAccounts'),
  input: HMListAccountsInputSchema,
  output: HMListAccountsOutputSchema,
})
export type HMListAccountsRequest = z.infer<typeof HMListAccountsRequestSchema>

// GetCID - fetch raw IPFS block data by CID
export const HMGetCIDOutputSchema = z.object({
  value: z.any(),
})
export type HMGetCIDOutput = z.infer<typeof HMGetCIDOutputSchema>

export const HMGetCIDInputSchema = z.object({
  cid: z.string(),
})
export type HMGetCIDInput = z.infer<typeof HMGetCIDInputSchema>

export const HMGetCIDRequestSchema = z.object({
  key: z.literal('GetCID'),
  input: HMGetCIDInputSchema,
  output: HMGetCIDOutputSchema,
})
export type HMGetCIDRequest = z.infer<typeof HMGetCIDRequestSchema>

// ListCommentsByAuthor - lists comments authored by a specific account
export const HMListCommentsByAuthorOutputSchema = z.object({
  comments: z.array(HMCommentSchema),
  authors: z.record(z.string(), HMMetadataPayloadSchema),
})
export type HMListCommentsByAuthorOutput = z.infer<typeof HMListCommentsByAuthorOutputSchema>

export const HMListCommentsByAuthorInputSchema = z.object({
  authorId: unpackedHmIdSchema,
})
export type HMListCommentsByAuthorInput = z.infer<typeof HMListCommentsByAuthorInputSchema>

export const HMListCommentsByAuthorRequestSchema = z.object({
  key: z.literal('ListCommentsByAuthor'),
  input: HMListCommentsByAuthorInputSchema,
  output: HMListCommentsByAuthorOutputSchema,
})
export type HMListCommentsByAuthorRequest = z.infer<typeof HMListCommentsByAuthorRequestSchema>

// ListCitations - lists mentions/citations of an entity (raw API response)
export const HMRawMentionSchema = z.object({
  source: z.string(),
  sourceType: z.string().optional(),
  sourceDocument: z.string().optional(),
  targetFragment: z.string().optional(),
  isExact: z.boolean().optional(),
})
export type HMRawMention = z.infer<typeof HMRawMentionSchema>

export const HMListCitationsOutputSchema = z.object({
  citations: z.array(HMRawMentionSchema),
})
export type HMListCitationsOutput = z.infer<typeof HMListCitationsOutputSchema>

export const HMListCitationsInputSchema = z.object({
  targetId: unpackedHmIdSchema,
})
export type HMListCitationsInput = z.infer<typeof HMListCitationsInputSchema>

export const HMListCitationsRequestSchema = z.object({
  key: z.literal('ListCitations'),
  input: HMListCitationsInputSchema,
  output: HMListCitationsOutputSchema,
})
export type HMListCitationsRequest = z.infer<typeof HMListCitationsRequestSchema>

// ListChanges - lists document changes/history
export const HMRawDocumentChangeSchema = z.object({
  id: z.string().optional(),
  author: z.string().optional(),
  deps: z.array(z.string()).optional(),
  createTime: z.string().optional(),
})
export type HMRawDocumentChange = z.infer<typeof HMRawDocumentChangeSchema>

export const HMListChangesOutputSchema = z.object({
  changes: z.array(HMRawDocumentChangeSchema),
  latestVersion: z.string().optional(),
})
export type HMListChangesOutput = z.infer<typeof HMListChangesOutputSchema>

export const HMListChangesInputSchema = z.object({
  targetId: unpackedHmIdSchema,
})
export type HMListChangesInput = z.infer<typeof HMListChangesInputSchema>

export const HMListChangesRequestSchema = z.object({
  key: z.literal('ListChanges'),
  input: HMListChangesInputSchema,
  output: HMListChangesOutputSchema,
})
export type HMListChangesRequest = z.infer<typeof HMListChangesRequestSchema>

// ListCapabilities - lists access control capabilities (raw API response)
export const HMRawCapabilitySchema = z.object({
  id: z.string().optional(),
  issuer: z.string().optional(),
  delegate: z.string().optional(),
  account: z.string().optional(),
  path: z.string().optional(),
  role: z.string().optional(),
  noRecursive: z.boolean().optional(),
  label: z.string().optional(),
  createTime: z.string().optional(),
})
export type HMRawCapability = z.infer<typeof HMRawCapabilitySchema>

export const HMListCapabilitiesOutputSchema = z.object({
  capabilities: z.array(HMRawCapabilitySchema),
})
export type HMListCapabilitiesOutput = z.infer<typeof HMListCapabilitiesOutputSchema>

export const HMListCapabilitiesInputSchema = z.object({
  targetId: unpackedHmIdSchema,
})
export type HMListCapabilitiesInput = z.infer<typeof HMListCapabilitiesInputSchema>

export const HMListCapabilitiesRequestSchema = z.object({
  key: z.literal('ListCapabilities'),
  input: HMListCapabilitiesInputSchema,
  output: HMListCapabilitiesOutputSchema,
})
export type HMListCapabilitiesRequest = z.infer<typeof HMListCapabilitiesRequestSchema>

// InteractionSummary - gets interaction summary for a document
export const HMInteractionSummaryInputSchema = z.object({
  id: unpackedHmIdSchema,
})
export type HMInteractionSummaryInput = z.infer<typeof HMInteractionSummaryInputSchema>

export const HMInteractionSummaryOutputSchema = z.object({
  citations: z.number(),
  comments: z.number(),
  changes: z.number(),
  children: z.number(),
  authorUids: z.array(z.string()).default([]),
  blocks: z.record(
    z.string(),
    z.object({
      citations: z.number(),
      comments: z.number(),
    }),
  ),
})
export type HMInteractionSummaryOutput = z.infer<typeof HMInteractionSummaryOutputSchema>

export const HMInteractionSummaryRequestSchema = z.object({
  key: z.literal('InteractionSummary'),
  input: HMInteractionSummaryInputSchema,
  output: HMInteractionSummaryOutputSchema,
})
export type HMInteractionSummaryRequest = z.infer<typeof HMInteractionSummaryRequestSchema>

// PublishBlobs - store blobs via gRPC StoreBlobs
export const HMPublishBlobsOutputSchema = z.object({
  cids: z.array(z.string()),
})
export type HMPublishBlobsOutput = z.infer<typeof HMPublishBlobsOutputSchema>

export const HMPublishBlobsInputSchema = z.object({
  blobs: z.array(
    z.object({
      cid: z.string().optional(),
      data: z.custom<Uint8Array>((val) => ArrayBuffer.isView(val) && 'byteLength' in val, {
        message: 'Expected Uint8Array or compatible binary data',
      }),
    }),
  ),
})
export type HMPublishBlobsInput = z.infer<typeof HMPublishBlobsInputSchema>

export const HMPublishBlobsRequestSchema = z.object({
  key: z.literal('PublishBlobs'),
  input: HMPublishBlobsInputSchema,
  output: HMPublishBlobsOutputSchema,
})
export type HMPublishBlobsRequest = z.infer<typeof HMPublishBlobsRequestSchema>

// PrepareDocumentChange - call gRPC PrepareChange, returns unsigned CBOR bytes for client signing

const ProtoAnnotationSchema = z.object({
  type: z.string(),
  link: z.string().optional(),
  attributes: z.record(z.string(), z.any()).optional(),
  starts: z.array(z.number()).optional(),
  ends: z.array(z.number()).optional(),
})

const ProtoBlockSchema = z.object({
  id: z.string().optional(),
  type: z.string().optional(),
  text: z.string().optional(),
  link: z.string().optional(),
  attributes: z.record(z.string(), z.any()).optional(),
  annotations: z.array(ProtoAnnotationSchema).optional(),
  revision: z.string().optional(),
})

const ProtoSetAttributeValueSchema = z.union([
  z.object({case: z.literal('stringValue'), value: z.string()}),
  z.object({case: z.literal('intValue'), value: z.union([z.bigint(), z.coerce.bigint()])}),
  z.object({case: z.literal('boolValue'), value: z.boolean()}),
  z.object({case: z.literal('nullValue'), value: z.object({})}),
  z.object({case: z.undefined(), value: z.undefined().optional()}),
])

const ProtoDocumentChangeSchema = z.object({
  op: z.union([
    z.object({case: z.literal('setMetadata'), value: z.object({key: z.string(), value: z.string()})}),
    z.object({
      case: z.literal('moveBlock'),
      value: z.object({blockId: z.string(), parent: z.string(), leftSibling: z.string()}),
    }),
    z.object({case: z.literal('replaceBlock'), value: ProtoBlockSchema}),
    z.object({case: z.literal('deleteBlock'), value: z.string()}),
    z.object({
      case: z.literal('setAttribute'),
      value: z.object({blockId: z.string(), key: z.array(z.string()), value: ProtoSetAttributeValueSchema}),
    }),
    z.object({case: z.undefined(), value: z.undefined().optional()}),
  ]),
})

export const HMPrepareDocumentChangeInputSchema = z.object({
  account: z.string(),
  path: z.string().optional(),
  baseVersion: z.string().optional(),
  changes: z.array(ProtoDocumentChangeSchema),
  capability: z.string().optional(),
  visibility: z.number().int().optional(),
})
export type HMPrepareDocumentChangeInput = z.infer<typeof HMPrepareDocumentChangeInputSchema>

export const HMPrepareDocumentChangeOutputSchema = z.object({
  unsignedChange: z.custom<Uint8Array>((val) => ArrayBuffer.isView(val) && 'byteLength' in val, {
    message: 'Expected Uint8Array or compatible binary data',
  }),
})
export type HMPrepareDocumentChangeOutput = z.infer<typeof HMPrepareDocumentChangeOutputSchema>

export const HMPrepareDocumentChangeRequestSchema = z.object({
  key: z.literal('PrepareDocumentChange'),
  input: HMPrepareDocumentChangeInputSchema,
  output: HMPrepareDocumentChangeOutputSchema,
})
export type HMPrepareDocumentChangeRequest = z.infer<typeof HMPrepareDocumentChangeRequestSchema>

// ListCommentVersions - lists all versions of a comment (edit history)
export const HMListCommentVersionsInputSchema = z.object({
  id: z.string(),
})
export type HMListCommentVersionsInput = z.infer<typeof HMListCommentVersionsInputSchema>

export const HMListCommentVersionsOutputSchema = z.object({
  versions: z.array(HMCommentSchema),
})
export type HMListCommentVersionsOutput = z.infer<typeof HMListCommentVersionsOutputSchema>

export const HMListCommentVersionsRequestSchema = z.object({
  key: z.literal('ListCommentVersions'),
  input: HMListCommentVersionsInputSchema,
  output: HMListCommentVersionsOutputSchema,
})
export type HMListCommentVersionsRequest = z.infer<typeof HMListCommentVersionsRequestSchema>

// GetDomain - resolve a domain to its cached account UID and status
export const HMDomainInfoSchema = z.object({
  domain: z.string(),
  lastCheck: z.date().nullable(),
  status: z.string(),
  lastSuccess: z.date().nullable(),
  registeredAccountUid: z.string().nullable(),
  peerId: z.string().nullable(),
  lastError: z.string().nullable(),
})
export type HMDomainInfo = z.infer<typeof HMDomainInfoSchema>

export const HMGetDomainInputSchema = z.object({
  domain: z.string(),
  /** If true, forces a fresh HTTP check instead of returning cached data. */
  forceCheck: z.boolean().optional(),
})
export type HMGetDomainInput = z.infer<typeof HMGetDomainInputSchema>

export const HMGetDomainRequestSchema = z.object({
  key: z.literal('GetDomain'),
  input: HMGetDomainInputSchema,
  output: HMDomainInfoSchema,
})
export type HMGetDomainRequest = z.infer<typeof HMGetDomainRequestSchema>

// ListDomains - list all tracked domains
export const HMListDomainsInputSchema = z.object({})
export type HMListDomainsInput = z.infer<typeof HMListDomainsInputSchema>

export const HMListDomainsOutputSchema = z.object({
  domains: z.array(HMDomainInfoSchema),
})
export type HMListDomainsOutput = z.infer<typeof HMListDomainsOutputSchema>

export const HMListDomainsRequestSchema = z.object({
  key: z.literal('ListDomains'),
  input: HMListDomainsInputSchema,
  output: HMListDomainsOutputSchema,
})
export type HMListDomainsRequest = z.infer<typeof HMListDomainsRequestSchema>

// GET request union — all read-only API endpoints
export const HMGetRequestSchema = z.discriminatedUnion('key', [
  HMResourceRequestSchema,
  HMResourceMetadataRequestSchema,
  HMAccountRequestSchema,
  HMCommentRequestSchema,
  HMSearchRequestSchema,
  HMQueryRequestSchema,
  HMAccountContactsRequestSchema,
  HMSubjectContactsRequestSchema,
  HMListCommentsRequestSchema,
  HMListDiscussionsRequestSchema,
  HMListCommentsByReferenceRequestSchema,
  HMGetCommentReplyCountRequestSchema,
  HMListEventsRequestSchema,
  HMListAccountsRequestSchema,
  HMGetCIDRequestSchema,
  HMListCommentsByAuthorRequestSchema,
  HMListCitationsRequestSchema,
  HMListChangesRequestSchema,
  HMListCapabilitiesRequestSchema,
  HMInteractionSummaryRequestSchema,
  HMListCommentVersionsRequestSchema,
  HMGetDomainRequestSchema,
  HMListDomainsRequestSchema,
])
export type HMGetRequest = z.infer<typeof HMGetRequestSchema>

// POST (action) union — all write/mutation API endpoints
export const HMActionSchema = z.discriminatedUnion('key', [
  HMPublishBlobsRequestSchema,
  HMPrepareDocumentChangeRequestSchema,
])
export type HMAction = z.infer<typeof HMActionSchema>

// Combined schema — kept for backward compatibility
export const HMRequestSchema = z.discriminatedUnion('key', [
  HMResourceRequestSchema,
  HMResourceMetadataRequestSchema,
  HMAccountRequestSchema,
  HMCommentRequestSchema,
  HMSearchRequestSchema,
  HMQueryRequestSchema,
  HMAccountContactsRequestSchema,
  HMSubjectContactsRequestSchema,
  HMListCommentsRequestSchema,
  HMListDiscussionsRequestSchema,
  HMListCommentsByReferenceRequestSchema,
  HMGetCommentReplyCountRequestSchema,
  HMListEventsRequestSchema,
  HMListAccountsRequestSchema,
  HMGetCIDRequestSchema,
  HMListCommentsByAuthorRequestSchema,
  HMListCitationsRequestSchema,
  HMListChangesRequestSchema,
  HMListCapabilitiesRequestSchema,
  HMInteractionSummaryRequestSchema,
  HMListCommentVersionsRequestSchema,
  HMGetDomainRequestSchema,
  HMListDomainsRequestSchema,
  HMPublishBlobsRequestSchema,
  HMPrepareDocumentChangeRequestSchema,
])

export type HMRequest = z.infer<typeof HMRequestSchema>

// ─── HM ID packing utilities ────────────────────────────────────────────────

export const HYPERMEDIA_SCHEME = 'hm'

export function packBaseId(uid: string, path?: string[] | null) {
  const filteredPath = path?.filter((p) => p !== '') || []
  const restPath = filteredPath.length ? `/${filteredPath.join('/')}` : ''
  return `${HYPERMEDIA_SCHEME}://${uid}${restPath}`
}

export function packHmId(hmId: UnpackedHypermediaId): string {
  const {path, version, latest, blockRef, blockRange, uid} = hmId
  if (!uid) throw new Error('uid is required')
  let responseUrl = packBaseId(uid, path)
  responseUrl += getHMQueryString({
    version,
    latest,
  })
  if (blockRef) {
    responseUrl += `#${blockRef}${serializeBlockRange(blockRange)}`
  }
  return responseUrl
}

export function getHMQueryString({
  version,
  latest,
  panel,
}: {
  version?: string | null
  latest?: boolean | null
  panel?: string | null
}) {
  const query: Record<string, string | null> = {}
  if (version) {
    query.v = version
  }
  if (latest && version) {
    query.l = null
  }
  if (panel) {
    query.panel = panel
  }
  return serializeHmQueryString(query)
}

export function serializeBlockRange(range: BlockRange | null | undefined): string {
  let res = ''
  if (range) {
    if ('expanded' in range && range.expanded) {
      res += '+'
    } else if ('start' in range) {
      res += `[${range.start}:${range.end}]`
    }
  }

  return res
}

/** Simple query string serializer for HM URLs (supports null values as bare keys). */
function serializeHmQueryString(query: Record<string, string | null>) {
  const queryString = Object.entries(query)
    .map(([key, value]) => (value === null ? key : `${key}=${value}`))
    .join('&')
  if (!queryString) return ''
  return `?${queryString}`
}

// ─── Path conversion utilities ──────────────────────────────────────────────

export function hmIdPathToEntityQueryPath(path: string[] | null) {
  const filteredPath = path?.filter((term) => !!term)
  return filteredPath?.length ? `/${filteredPath.join('/')}` : ''
}

export function entityQueryPathToHmIdPath(path: string | null | undefined): string[] {
  if (!path) return []
  if (path === '/') return []
  return path.split('/').filter(Boolean)
}

// ─── HM ID unpacking utilities ──────────────────────────────────────────────
//
// These functions were moved from @shm/shared to break the cyclic dependency
// between client and shared. The shared package re-exports them for backward
// compatibility.

/** Parsed URL components from parseCustomURL. */
type ParsedURL = {
  scheme: string | null
  path: string[]
  query: Record<string, string>
  fragment: string | null
}

/** Split a URL into scheme, path segments, query params, and fragment. */
export function parseCustomURL(url: string): ParsedURL | null {
  if (!url) return null
  const [scheme, rest] = url.split('://')
  if (!rest) return null
  const [pathAndQuery, fragment = null] = rest.split('#')
  const [path, queryString] = pathAndQuery?.split('?') || []
  const query = new URLSearchParams(queryString)
  const queryObject = Object.fromEntries(query.entries())
  return {
    scheme: scheme || null,
    path: path?.split('/') || [],
    query: queryObject,
    fragment,
  }
}

/** Parse a URL fragment like `blockId`, `blockId+`, or `blockId[start:end]`. */
export function parseFragment(input: string | null): ParsedFragment | null {
  if (!input) return null
  const regex = /^([^\+\[]+)((\+)|\[(\d+)\:(\d+)\])?$/
  const match = input.match(regex)
  if (match) {
    const blockId = match[1] || ''
    const expanded = match[3]
    const rangeStart = match[4]
    const rangeEnd = match[5]

    if (expanded === '+') {
      return {blockId, expanded: true}
    } else if (typeof rangeStart !== 'undefined' && typeof rangeEnd !== 'undefined') {
      return {blockId, start: parseInt(rangeStart), end: parseInt(rangeEnd)}
    } else {
      return {blockId, expanded: false}
    }
  } else {
    return {blockId: input, expanded: false}
  }
}

/** Special static paths that should not be treated as Hypermedia document UIDs. */
const STATIC_HM_PATHS = new Set(['download', 'connect', 'register', 'device-link', 'profile', 'contact'])

/** Parse a hypermedia URL string into an UnpackedHypermediaId. */
export function unpackHmId(hypermediaId?: string): UnpackedHypermediaId | null {
  if (!hypermediaId) return null
  const parsed = parseCustomURL(hypermediaId)
  if (!parsed) return null
  let uid
  let path: string[]
  let hostname = null
  if (parsed.scheme === 'https' || parsed.scheme === 'http') {
    if (parsed.path[1] !== 'hm') return null
    hostname = parsed.path[0]
    uid = parsed.path[2]
    if (uid && STATIC_HM_PATHS.has(uid)) return null
    path = parsed.path.slice(3)
  } else if (parsed.scheme === HYPERMEDIA_SCHEME || parsed.scheme === 'hm') {
    uid = parsed.path[0]
    path = parsed.path.slice(1)
  } else {
    return null
  }
  const version = parsed.query.v || null
  const fragment = parseFragment(parsed.fragment)

  const latest = parsed.query.l === null || parsed.query.l === '' || !version

  let blockRange = null
  if (fragment) {
    if ('start' in fragment) {
      blockRange = {start: fragment.start, end: fragment.end}
    } else if ('expanded' in fragment) {
      blockRange = {expanded: fragment.expanded}
    }
  }
  return {
    id: packBaseId(uid || '', path),
    uid: uid || '',
    path: path || null,
    version,
    blockRef: fragment ? fragment.blockId : null,
    blockRange,
    hostname: hostname || null,
    latest,
    scheme: parsed.scheme,
  }
}

// ─── Unicode utilities ──────────────────────────────────────────────────────
//
// Moved from @shm/shared to break the cyclic dependency. Used for measuring
// text length in code points (needed for annotation offsets in TEI/PDF parsing).

/** Count Unicode code points in a string, correctly handling surrogate pairs. */
export function codePointLength(entry: string) {
  let count = 0
  if (!entry) return 0
  for (let i = 0; i < entry.length; i++) {
    count++
    if (isSurrogate(entry, i)) {
      i++
    }
  }
  return count
}

/** Check if a UTF-16 code unit at index i is the start of a surrogate pair. */
export function isSurrogate(s: string, i: number) {
  const code = s.charCodeAt(i)
  return 0xd800 <= code && code <= 0xdbff
}
