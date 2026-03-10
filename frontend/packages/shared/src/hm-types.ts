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
  HMAccountContactsRequestSchema,
  HMAccountResultSchema,
  HMAccountsMetadataSchema,
  HMBlockChildrenTypeSchema,
  HMBlockNodeSchema,
  HMCommentGroupSchema,
  HMCommentSchema,
  HMContactRecordSchema,
  HMDocumentInfoSchema,
  HMDocumentMetadataSchema,
  HMExternalCommentGroupSchema,
  HMMetadataPayloadSchema,
  HMQueryResultSchema,
  HMQuerySchema,
  HMResourceSchema,
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
  query: z.string(),
  accountUid: z.string().optional(),
  includeBody: z.boolean().optional(),
  contextSize: z.number().optional(),
  perspectiveAccountUid: z.string().optional(),
  searchType: z.number().optional(),
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

export const HMRequestSchema = z.discriminatedUnion('key', [
  HMResourceRequestSchema,
  HMResourceMetadataRequestSchema,
  HMAccountRequestSchema,
  HMCommentRequestSchema,
  HMSearchRequestSchema,
  HMQueryRequestSchema,
  HMAccountContactsRequestSchema,
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
])

export type HMRequest = z.infer<typeof HMRequestSchema>
