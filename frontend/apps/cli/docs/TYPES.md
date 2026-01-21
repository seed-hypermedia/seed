# Seed Hypermedia Types Reference

## Hypermedia ID

The universal identifier for all Seed resources:

```typescript
type UnpackedHypermediaId = {
  id: string              // Full IRI: "hm://uid/path?v=ver#block"
  uid: string             // Account/space ID (base58 public key)
  path: string[] | null   // Document path segments
  version: string | null  // CID of specific version
  blockRef: string | null // Specific block ID
  blockRange: BlockRange | null
  hostname: string | null // For external references
  scheme: string | null   // URL scheme
  latest?: boolean
}

type BlockRange = {
  start?: number
  end?: number
  expanded?: boolean
}
```

## Resource Types

API responses for `Resource` endpoint:

```typescript
type HMResource =
  | {type: 'document', id, document: HMDocument}
  | {type: 'comment', id, comment: HMComment}
  | {type: 'redirect', id, redirectTarget: UnpackedHypermediaId}
  | {type: 'not-found', id}
  | {type: 'tombstone', id}
  | {type: 'error', id, message: string}
```

## Document Structure

```typescript
type HMDocument = {
  content: HMBlockNode[]
  version: string
  account: string
  authors: string[]
  path: string
  createTime: HMTimestamp
  updateTime: HMTimestamp
  metadata: HMMetadata
  genesis: string
  visibility: 'PUBLIC' | 'PRIVATE'
}

type HMBlockNode = {
  block: HMBlock
  children?: HMBlockNode[]
}

type HMMetadata = {
  name?: string
  summary?: string
  icon?: string
  cover?: string
  siteUrl?: string
  layout?: 'Seed/Experimental/Newspaper' | ''
  displayPublishTime?: string
  showOutline?: boolean
  showActivity?: boolean
  contentWidth?: 'S' | 'M' | 'L'
  theme?: {
    headerLayout?: 'Center' | ''
  }
}
```

## Block Types

### Text Blocks

```typescript
// Paragraph
type HMBlockParagraph = {
  type: 'Paragraph'
  id: string
  text: string
  annotations?: HMAnnotation[]
  attributes: {childrenType?: HMBlockChildrenType}
}

// Heading
type HMBlockHeading = {
  type: 'Heading'
  id: string
  text: string
  annotations?: HMAnnotation[]
  attributes: {childrenType?: HMBlockChildrenType}
}

// Code
type HMBlockCode = {
  type: 'Code'
  id: string
  text: string
  attributes: {language?: string, childrenType?: HMBlockChildrenType}
}

// Math (LaTeX)
type HMBlockMath = {
  type: 'Math'
  id: string
  text: string
  attributes: {childrenType?: HMBlockChildrenType}
}
```

### Media Blocks

```typescript
// Image
type HMBlockImage = {
  type: 'Image'
  id: string
  link: string  // IPFS URL
  text?: string // Alt text
  annotations?: HMAnnotation[]
  attributes: {
    width?: number
    name?: string
    childrenType?: HMBlockChildrenType
  }
}

// Video
type HMBlockVideo = {
  type: 'Video'
  id: string
  link: string
  attributes: {
    width?: number
    name?: string
    childrenType?: HMBlockChildrenType
  }
}

// File
type HMBlockFile = {
  type: 'File'
  id: string
  link: string
  attributes: {
    size?: number
    name?: string
    childrenType?: HMBlockChildrenType
  }
}
```

### Embed Blocks

```typescript
// Hypermedia Embed
type HMBlockEmbed = {
  type: 'Embed'
  id: string
  link: string  // hm:// URL
  attributes: {
    view?: 'Content' | 'Card' | 'Comments'
    childrenType?: HMBlockChildrenType
  }
}

// Web Embed
type HMBlockWebEmbed = {
  type: 'WebEmbed'
  id: string
  link: string  // HTTP(S) URL
}

// Nostr Embed
type HMBlockNostr = {
  type: 'Nostr'
  id: string
  link: string  // nostr:// URL
}
```

### Interactive Blocks

```typescript
// Button
type HMBlockButton = {
  type: 'Button'
  id: string
  link: string
  text?: string
  attributes: {
    alignment?: 'flex-start' | 'center' | 'flex-end'
    childrenType?: HMBlockChildrenType
  }
}

// Query (dynamic listing)
type HMBlockQuery = {
  type: 'Query'
  id: string
  attributes: {
    style?: 'Card' | 'List'
    columnCount?: number
    banner?: boolean
    query: HMQuery
    childrenType?: HMBlockChildrenType
  }
}

type HMQuery = {
  includes: Array<{
    space: string
    path?: string
    mode: 'Children' | 'AllDescendants'
  }>
  sort?: Array<{
    term: 'Path' | 'Title' | 'CreateTime' | 'UpdateTime' | 'DisplayTime'
    reverse?: boolean
  }>
  limit?: number
}
```

### Structural Blocks

```typescript
// Group (container)
type HMBlockGroup = {
  type: 'Group'
  id: string
}

// Navigation Link
type HMBlockLink = {
  type: 'Link'
  id: string
  link?: string
  text: string
}
```

## Text Annotations

```typescript
type HMAnnotation =
  | {type: 'Bold', starts: number[], ends: number[]}
  | {type: 'Italic', starts: number[], ends: number[]}
  | {type: 'Underline', starts: number[], ends: number[]}
  | {type: 'Strike', starts: number[], ends: number[]}
  | {type: 'Code', starts: number[], ends: number[]}
  | {type: 'Link', starts: number[], ends: number[], link: string}
  | {type: 'Embed', starts: number[], ends: number[], link: string}
  | {type: 'Range', starts: number[], ends: number[]}  // Highlight

type HMBlockChildrenType = 'Group' | 'Ordered' | 'Unordered' | 'Blockquote' | null
```

## Comments

```typescript
type HMComment = {
  id: string
  version: string
  author: string
  targetAccount: string
  targetPath?: string
  targetVersion: string
  replyParent?: string      // Parent comment (for threads)
  threadRoot?: string       // Root of thread
  capability?: string
  content: HMBlockNode[]
  createTime: HMTimestamp
  updateTime: HMTimestamp
  visibility: 'PUBLIC' | 'PRIVATE'
}

type HMCommentGroup = {
  id: string
  type: 'commentGroup'
  comments: HMComment[]
  moreCommentsCount: number
}
```

## Account/Contact

```typescript
type HMMetadataPayload = {
  id: UnpackedHypermediaId
  metadata: HMMetadata | null
  hasSite?: boolean
}

type HMAccountResult =
  | {type: 'account', id, metadata, hasSite?}
  | {type: 'account-not-found', uid: string}

type HMContactRecord = {
  id: string
  subject: string
  name: string
  account: string
  createTime?: HMTimestamp
  updateTime?: HMTimestamp
}
```

## Document Changes

```typescript
type HMDocumentChangeInfo = {
  author: HMMetadataPayload
  createTime: string
  deps: string[]  // Parent CIDs
  id: string      // Change CID
}

type HMListChangesOutput = {
  changes: Array<{
    id?: string
    author?: string
    deps?: string[]
    createTime?: string
  }>
  latestVersion?: string
}
```

## Capabilities (Access Control)

```typescript
type HMCapability = {
  id: string
  accountUid: string
  role: 'writer' | 'agent' | 'none' | 'owner'
  capabilityId?: string
  grantId: UnpackedHypermediaId
  label?: string
  createTime: HMTimestamp
}

type HMRawCapability = {
  id?: string
  issuer?: string
  delegate?: string
  account?: string
  path?: string
  role?: string
  noRecursive?: boolean
}
```

## Citations

```typescript
type HMCitation = {
  source: {
    type: 'c' | 'd'  // comment or document
    id: UnpackedHypermediaId
    author?: string
    time?: HMTimestamp
  }
  isExactVersion: boolean
  targetFragment: {blockId: string, start?, end?, expanded?} | null
  targetId: UnpackedHypermediaId
}

type HMRawMention = {
  source: string
  sourceType?: string
  sourceDocument?: string
  targetFragment?: string
  isExact?: boolean
}
```

## Activity Events

```typescript
type HMListEventsInput = {
  pageSize?: number
  pageToken?: string
  trustedOnly?: boolean
  filterAuthors?: string[]
  filterEventType?: string[]
  filterResource?: string
  currentAccount?: string
}

type HMListEventsOutput = {
  events: any[]  // Complex union type
  nextPageToken: string
}
```

## Search

```typescript
type HMSearchInput = {
  query: string
  accountUid?: string
  includeBody?: boolean
  contextSize?: number
  perspectiveAccountUid?: string
}

type HMSearchPayload = {
  entities: Array<{
    id: UnpackedHypermediaId
    metadata?: HMMetadata
    title: string
    icon: string
    parentNames: string[]
    searchQuery: string
    type: 'document' | 'contact'
  }>
  searchQuery: string
}
```

## Timestamps

```typescript
type HMTimestamp =
  | {seconds: bigint | number, nanos: number}
  | string  // ISO date string
```

## Interaction Summary

```typescript
type HMInteractionSummaryOutput = {
  citations: number
  comments: number
  changes: number
  children: number
  blocks: Record<string, {
    citations: number
    comments: number
  }>
}
```
