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

// Import schemas needed by stay-behind code from @seed-hypermedia/client
import {
  BlockRangeSchema,
  HMAccountsMetadataSchema,
  HMBlockChildrenTypeSchema,
  HMBlockNodeSchema,
  HMContactRecordSchema,
  HMDocumentInfoSchema,
  HMDocumentMetadataSchema,
  HMQuerySchema,
  HMResourceVisibilitySchema,
  HMRoleSchema,
  HMTimestampSchema,
  unpackedHmIdSchema,
  type HMAccountsMetadata,
  type HMBlockChildrenType,
  type HMComment,
  type HMDocument,
  type HMDocumentInfo,
  type HMMetadata,
  type HMMetadataPayload,
  type HMResourceVisibility,
  type HMTimestamp,
  type UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'

// ─── Types that stay in @shm/shared (not part of the publishable SDK) ────

export type HMExistingDraft = {
  id: string
}

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

export type EditorColorStyle = {
  [K in keyof EditorTextStyles]-?: Required<EditorTextStyles>[K] extends string ? K : never
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

export type HMDocumentOperation = HMDocumentOperationSetAttributes

export type HMDocumentOperationSetAttributes = {
  attrs: Array<{
    key: Array<string>
    value: string | number | boolean
  }>
  type: 'SetAttributes'
}

export type HMAccount = Omit<PlainMessage<Account>, 'metadata'> & {
  metadata?: HMMetadata
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

export type HMLibraryDocument = HMDocumentInfo & {
  type: 'document'
  latestComment?: HMComment | null
}

export type HMChangeGroup = {
  id: string
  type: 'changeGroup'
  changes: HMChangeSummary[]
}

// Base schema without refinement (needed for .extend())
const HMDraftMetaBaseSchema = z.object({
  id: z.string(),
  locationUid: z.string().optional(),
  locationPath: z.array(z.string()).optional(),
  editUid: z.string().optional(),
  editPath: z.array(z.string()).optional(),
  metadata: HMDocumentMetadataSchema,
  visibility: HMResourceVisibilitySchema.optional().default('PUBLIC'),
})

const draftLocationRefinement = (data: {editUid?: string; locationUid?: string}) => data.editUid || data.locationUid

// Refined schema for validation
export const HMDraftMetaSchema = HMDraftMetaBaseSchema.refine(draftLocationRefinement, {
  message: 'Either editUid or locationUid must be provided',
})

// TypeScript union type: editUid OR locationUid must be present
type HMDraftMetaBase = {
  id: string
  locationPath?: string[]
  editPath?: string[]
  metadata: HMMetadata
  visibility: HMResourceVisibility
}

export type HMDraftMeta = HMDraftMetaBase &
  ({editUid: string; locationUid?: string} | {editUid?: undefined; locationUid: string})

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

export type HMWallet = {
  balance: number
  id: string
  address: string
  name: string
  type: string
}

// Loaded document schemas

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
  z.discriminatedUnion('type', [HMLoadedTextContentNodeSchema, HMLoadedInlineEmbedNodeSchema, HMLoadedLinkNodeSchema]),
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

export type HMLoadedTextContentNode = z.infer<typeof HMLoadedTextContentNodeSchema>
export type HMLoadedLinkNode = z.infer<typeof HMLoadedLinkNodeSchema>
export type HMLoadedInlineEmbedNode = z.infer<typeof HMLoadedInlineEmbedNodeSchema>
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

// Discovery state (client-side only, not part of API response)
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

export type HMCommentsPayload = {
  comments: HMComment[]
  authors: HMAccountsMetadata
}

export const HMPeerConnectionRequestSchema = z.object({
  a: z.array(z.string()), // addrs
  d: z.string(), // peer/device ID
})

export type HMPeerConnectionRequest = z.infer<typeof HMPeerConnectionRequestSchema>

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

export const HMHostConfigSchema = z.object({
  peerId: z.string(),
  registeredAccountUid: z.string(),
  protocolId: z.string(),
  addrs: z.array(z.string()),
  hostname: z.string(),
  isGateway: z.boolean(),
})
export type HMHostConfig = z.infer<typeof HMHostConfigSchema>
