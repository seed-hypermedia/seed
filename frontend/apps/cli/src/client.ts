/**
 * HTTP client for Seed Hypermedia API
 */

import {encode as cborEncode} from '@ipld/dag-cbor'
import {unpackHmId, type UnpackedHmId} from './utils/hm-id'

export type ClientConfig = {
  server: string
}

const DEFAULT_SERVER = 'https://hyper.media'

export function createClient(config?: Partial<ClientConfig>) {
  const server = config?.server || process.env.SEED_SERVER || DEFAULT_SERVER

  /**
   * Make API request to /api/{key}
   */
  async function request<T>(
    key: string,
    input?: Record<string, unknown>,
  ): Promise<T> {
    const params = input ? serializeQueryString(input) : ''
    const url = `${server}/api/${key}${params}`

    const response = await fetch(url)

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`API error (${response.status}): ${error}`)
    }

    const data = await response.json()
    // API wraps response in `json` key
    return data.json ?? data
  }

  /**
   * POST CBOR data to endpoint
   */
  async function postCbor<T>(path: string, data: unknown): Promise<T> {
    const cborData = cborEncode(data)
    const url = `${server}${path}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/cbor'},
      body: new Uint8Array(cborData) as unknown as BodyInit,
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`API error (${response.status}): ${error}`)
    }

    return response.json()
  }

  // API methods

  async function getResource(id: string) {
    return request<ResourceResponse>('Resource', {id})
  }

  async function getResourceMetadata(id: string) {
    return request<MetadataResponse>('ResourceMetadata', {id})
  }

  async function getAccount(uid: string) {
    return request<AccountResponse>('Account', {id: uid})
  }

  async function listAccounts() {
    return request<ListAccountsResponse>('ListAccounts', {})
  }

  async function search(query: string, accountUid?: string) {
    return request<SearchResponse>('Search', {query, accountUid})
  }

  async function query(
    includes: QueryInclude[],
    sort?: QuerySort[],
    limit?: number,
  ) {
    return request<QueryResponse>('Query', {includes, sort, limit})
  }

  async function listComments(targetId: string) {
    const unpacked = unpackHmId(targetId)
    if (!unpacked) throw new Error(`Invalid ID: ${targetId}`)
    return request<CommentsResponse>('ListComments', {targetId: unpacked})
  }

  async function listDiscussions(targetId: string, commentId?: string) {
    const unpacked = unpackHmId(targetId)
    if (!unpacked) throw new Error(`Invalid ID: ${targetId}`)
    return request<DiscussionsResponse>('ListDiscussions', {
      targetId: unpacked,
      commentId,
    })
  }

  async function getComment(id: string) {
    return request<CommentResponse>('Comment', {id})
  }

  async function listChanges(targetId: string) {
    if (!unpackHmId(targetId)) throw new Error(`Invalid ID: ${targetId}`)
    return request<ChangesResponse>('ListChanges', {targetId})
  }

  async function listCitations(targetId: string) {
    if (!unpackHmId(targetId)) throw new Error(`Invalid ID: ${targetId}`)
    return request<CitationsResponse>('ListCitations', {targetId})
  }

  async function listCapabilities(targetId: string) {
    if (!unpackHmId(targetId)) throw new Error(`Invalid ID: ${targetId}`)
    return request<CapabilitiesResponse>('ListCapabilities', {targetId})
  }

  async function getInteractionSummary(id: string) {
    if (!unpackHmId(id)) throw new Error(`Invalid ID: ${id}`)
    return request<InteractionSummaryResponse>('InteractionSummary', {id})
  }

  async function listEvents(options?: ListEventsInput) {
    return request<EventsResponse>('ListEvents', options || {})
  }

  async function getCID(cid: string) {
    return request<CIDResponse>('GetCID', {cid})
  }

  async function getAccountContacts(uid: string) {
    return request<ContactsResponse>('AccountContacts', {uid})
  }

  // Write operations

  async function storeBlob(data: Uint8Array) {
    return postCbor<StoreBlobResponse>('/hm/api/debug.store-blob', data)
  }

  async function createAccount(payload: CreateAccountPayload) {
    return postCbor<{message: string}>('/hm/api/create-account', payload)
  }

  async function updateDocument(payload: UpdateDocumentPayload) {
    return postCbor<{cids: string[]}>('/hm/api/document-update', payload)
  }

  async function createComment(payload: CreateCommentPayload) {
    return postCbor<CommentResponse>('/hm/api/comment', payload)
  }

  return {
    server,
    request,
    postCbor,
    // Read
    getResource,
    getResourceMetadata,
    getAccount,
    listAccounts,
    search,
    query,
    listComments,
    listDiscussions,
    getComment,
    listChanges,
    listCitations,
    listCapabilities,
    getInteractionSummary,
    listEvents,
    getCID,
    getAccountContacts,
    // Write
    storeBlob,
    createAccount,
    updateDocument,
    createComment,
  }
}

export type Client = ReturnType<typeof createClient>

// Query string serialization

function serializeQueryString(data: Record<string, unknown>): string {
  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue

    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      params.append(key, String(value))
    } else {
      // Serialize objects/arrays as JSON (including those with null values)
      params.append(key, JSON.stringify(value))
    }
  }

  const str = params.toString()
  return str ? `?${str}` : ''
}

// Response types

export type ResourceResponse =
  | {type: 'document'; id: UnpackedId; document: Document}
  | {type: 'comment'; id: UnpackedId; comment: Comment}
  | {type: 'redirect'; id: UnpackedId; redirectTarget: UnpackedId}
  | {type: 'not-found'; id: UnpackedId}
  | {type: 'tombstone'; id: UnpackedId}
  | {type: 'error'; id: UnpackedId; message: string}

export type MetadataResponse = {
  id: UnpackedId
  metadata: Metadata | null
  hasSite?: boolean
}

export type AccountResponse =
  | {
      type: 'account'
      id: UnpackedId
      metadata: Metadata | null
      hasSite?: boolean
    }
  | {type: 'account-not-found'; uid: string}

export type ListAccountsResponse = {
  accounts: Array<{
    id: UnpackedId
    metadata: Metadata | null
    hasSite?: boolean
  }>
}

export type SearchResponse = {
  entities: SearchEntity[]
  searchQuery: string
}

export type SearchEntity = {
  id: UnpackedId
  metadata?: Metadata
  title: string
  icon: string
  parentNames: string[]
  searchQuery: string
  type: 'document' | 'contact'
}

export type QueryResponse = {
  in: UnpackedId
  results: DocumentInfo[]
  mode?: 'Children' | 'AllDescendants'
}

export type CommentsResponse = {
  comments: Comment[]
  authors: Record<string, MetadataResponse>
}

export type DiscussionsResponse = {
  discussions: CommentGroup[]
  authors: Record<string, MetadataResponse>
  citingDiscussions: CommentGroup[]
}

export type CommentResponse = Comment

export type ChangesResponse = {
  changes: ChangeInfo[]
  latestVersion?: string
}

export type CitationsResponse = {
  citations: Citation[]
}

export type CapabilitiesResponse = {
  capabilities: Capability[]
}

export type InteractionSummaryResponse = {
  citations: number
  comments: number
  changes: number
  children: number
  blocks: Record<string, {citations: number; comments: number}>
}

export type EventsResponse = {
  events: unknown[]
  nextPageToken: string
}

export type CIDResponse = {
  value: unknown
}

export type ContactsResponse = Contact[]

export type StoreBlobResponse = {
  message: string
  cid: string
}

// Input types

export type QueryInclude = {
  space: string
  path?: string
  mode: 'Children' | 'AllDescendants'
}

export type QuerySort = {
  term: 'Path' | 'Title' | 'CreateTime' | 'UpdateTime' | 'DisplayTime'
  reverse?: boolean
}

export type ListEventsInput = {
  pageSize?: number
  pageToken?: string
  trustedOnly?: boolean
  filterAuthors?: string[]
  filterEventType?: string[]
  filterResource?: string
  currentAccount?: string
}

export type CreateAccountPayload = {
  genesis: {data: Uint8Array; cid: string}
  home: {data: Uint8Array; cid: string}
  ref: Uint8Array
  icon?: {data: Uint8Array; cid: string} | null
}

export type UpdateDocumentPayload = {
  change: {data: Uint8Array; cid: string}
  ref: {data: Uint8Array; cid: string}
  icon?: {data: Uint8Array; cid: string} | null
}

export type CreateCommentPayload = {
  comment: Uint8Array
  blobs: Array<{cid: string; data: Uint8Array}>
}

// Data types

export type UnpackedId = {
  id: string
  uid: string
  path: string[] | null
  version: string | null
  blockRef: string | null
  hostname: string | null
  scheme: string | null
  latest?: boolean
}

export type Metadata = {
  name?: string
  summary?: string
  icon?: string
  cover?: string
  siteUrl?: string
  layout?: string
  displayPublishTime?: string
  showOutline?: boolean
  showActivity?: boolean
  contentWidth?: 'S' | 'M' | 'L'
  theme?: {headerLayout?: 'Center' | ''}
}

export type Document = {
  content: BlockNode[]
  version: string
  account: string
  authors: string[]
  path: string
  createTime: Timestamp
  updateTime: Timestamp
  metadata: Metadata
  genesis: string
  visibility: 'PUBLIC' | 'PRIVATE'
}

export type DocumentInfo = {
  id: UnpackedId
  metadata: Metadata | null
  authors: string[]
  createTime: Timestamp
  updateTime: Timestamp
}

export type BlockNode = {
  block: Block
  children?: BlockNode[]
}

export type Block = {
  type: string
  id: string
  text?: string
  link?: string
  annotations?: Annotation[]
  attributes?: Record<string, unknown>
}

export type Annotation = {
  type: string
  starts: number[]
  ends: number[]
  link?: string
}

export type Comment = {
  id: string
  version: string
  author: string
  targetAccount: string
  targetPath?: string
  targetVersion: string
  replyParent?: string
  threadRoot?: string
  capability?: string
  content: BlockNode[]
  createTime: Timestamp
  updateTime: Timestamp
  visibility: 'PUBLIC' | 'PRIVATE'
}

export type CommentGroup = {
  id: string
  type: 'commentGroup'
  comments: Comment[]
  moreCommentsCount: number
}

export type ChangeInfo = {
  id?: string
  author?: string
  deps?: string[]
  createTime?: string
}

export type Citation = {
  source: string
  sourceType?: string
  sourceDocument?: string
  targetFragment?: string
  isExact?: boolean
}

export type Capability = {
  id?: string
  issuer?: string
  delegate?: string
  account?: string
  path?: string
  role?: string
  noRecursive?: boolean
}

export type Contact = {
  id: string
  subject: string
  name: string
  account: string
  createTime?: Timestamp
  updateTime?: Timestamp
}

export type Timestamp = {seconds: number; nanos: number} | string
