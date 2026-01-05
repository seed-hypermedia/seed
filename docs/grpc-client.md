# gRPC Client Architecture

The Seed Hypermedia frontend communicates with the Go backend daemon via gRPC using Connect-RPC. This document covers the client setup, available services, and usage patterns.

## Overview

The gRPC client:
- Uses Connect-RPC for browser/Node.js compatibility
- Provides type-safe access to all backend services
- Is shared between desktop (Electron) and web (Remix) apps
- Generated from Protocol Buffer definitions

## Core Files

| File | Purpose |
|------|---------|
| `@shm/shared/src/grpc-client.ts` | GRPCClient factory |
| `@shm/shared/src/client/index.ts` | Service exports |
| `@shm/shared/src/client/.generated/` | Generated protobuf types |
| `backend/genproto/` | Protobuf source definitions |

## Client Setup

### Creating the Client

```typescript
import {createGrpcWebTransport} from '@connectrpc/connect-node'
import {createGRPCClient} from '@shm/shared/grpc-client'
import {DAEMON_HTTP_URL} from '@shm/shared/constants'

const transport = createGrpcWebTransport({
  baseUrl: DAEMON_HTTP_URL,  // e.g., 'http://localhost:56001'
  httpVersion: '1.1',
})

const grpcClient = createGRPCClient(transport)
```

### Client Type

```typescript
export type GRPCClient = {
  activityFeed: PromiseClient<typeof ActivityFeed>
  daemon: PromiseClient<typeof Daemon>
  comments: PromiseClient<typeof Comments>
  documents: PromiseClient<typeof Documents>
  entities: PromiseClient<typeof Entities>
  networking: PromiseClient<typeof Networking>
  accessControl: PromiseClient<typeof AccessControl>
  subscriptions: PromiseClient<typeof Subscriptions>
  wallets: PromiseClient<typeof Wallets>
  invoices: PromiseClient<typeof Invoices>
  resources: PromiseClient<typeof Resources>
}
```

## Available Services

### ActivityFeed

Event streaming and activity tracking.

```typescript
// List recent events
const response = await grpcClient.activityFeed.listEvents({
  pageSize: 10,
  pageToken: '',
  trustedOnly: false,
  filterAuthors: [],
  filterEventType: ['Ref', 'Comment', 'Capability'],
  filterResource: '',
})

// Events are returned as protobuf messages
for (const event of response.events) {
  if (event.data.case === 'newBlob') {
    console.log('New blob:', event.data.value.cid)
  }
}
```

### Documents

Document CRUD and querying.

```typescript
// Get a document
const doc = await grpcClient.documents.getDocument({
  account: 'z6Mk...',
  path: '/my-doc',
  version: undefined,  // Latest version
})

// Get account info
const account = await grpcClient.documents.getAccount({
  id: 'z6Mk...',
})

// List root documents (accounts)
const roots = await grpcClient.documents.listRootDocuments({
  pageSize: BigInt(100),
})

// List directory contents
const children = await grpcClient.documents.listDirectory({
  account: 'z6Mk...',
  directoryPath: '/parent',
})

// List document changes
const changes = await grpcClient.documents.listDocumentChanges({
  account: 'z6Mk...',
  path: '/my-doc',
  version: doc.version,
  pageSize: BigInt(50),
})

// Get contact
const contact = await grpcClient.documents.getContact({
  id: 'z6Mk.../tsid123',
})

// List contacts
const contacts = await grpcClient.documents.listContacts({
  filter: {
    case: 'account',
    value: 'z6Mk...',
  },
})
```

### Comments

Comment management.

```typescript
// Get a single comment
const comment = await grpcClient.comments.getComment({
  id: 'bafyreid...',  // CID
})

// Get reply count
const replyCount = await grpcClient.comments.getCommentReplyCount({
  id: 'bafyreid...',
})

// List comments by author
const authorComments = await grpcClient.comments.listCommentsByAuthor({
  author: 'z6Mk...',
  pageSize: BigInt(50),
})
```

### Entities

Entity search and mentions.

```typescript
// Search entities
const results = await grpcClient.entities.searchEntities({
  query: 'search term',
  includeBody: true,
  contextSize: 100,
  accountUid: 'z6Mk...',  // Optional: limit to account
  loggedAccountUid: 'z6Mk...',  // Current user perspective
})

// List entity mentions (citations)
const mentions = await grpcClient.entities.listEntityMentions({
  id: 'hm://z6Mk.../path',
  pageSize: BigInt(100),
})
```

### AccessControl

Capability management.

```typescript
// Get a capability
const cap = await grpcClient.accessControl.getCapability({
  id: 'bafyreid...',
})

// List capabilities for a document
const caps = await grpcClient.accessControl.listCapabilities({
  account: 'z6Mk...',
  path: '/my-doc',
  pageSize: BigInt(50),
})
```

### Networking

P2P networking operations.

```typescript
// Get peer info
const peerInfo = await grpcClient.networking.getPeerInfo({})

// Connect to peer
await grpcClient.networking.connect({
  addrs: ['/ip4/1.2.3.4/tcp/4001/p2p/QmPeer...'],
})
```

### Daemon

Daemon status and control.

```typescript
// Get daemon info
const info = await grpcClient.daemon.getInfo({})

// Force sync
await grpcClient.daemon.forceSync({
  id: 'hm://z6Mk...',
})
```

### Subscriptions

Content subscription management.

```typescript
// Subscribe to entity
await grpcClient.subscriptions.subscribe({
  id: 'hm://z6Mk...',
})

// List subscriptions
const subs = await grpcClient.subscriptions.listSubscriptions({})
```

### Wallets

Lightning wallet operations.

```typescript
// List wallets
const wallets = await grpcClient.wallets.listWallets({})

// Get wallet balance
const balance = await grpcClient.wallets.getWalletBalance({
  id: 'wallet-id',
})
```

### Invoices

Lightning invoice management.

```typescript
// Create invoice
const invoice = await grpcClient.invoices.createInvoice({
  account: 'z6Mk...',
  amountSats: BigInt(1000),
})

// Pay invoice
await grpcClient.invoices.payInvoice({
  paymentRequest: 'lnbc...',
})
```

### Resources

Resource discovery and fetching.

```typescript
// Discover resource
const progress = await grpcClient.resources.discoverEntity({
  id: 'hm://z6Mk...',
})
```

## Response Handling

### Converting to Plain Objects

Protobuf messages can be converted to plain objects:

```typescript
import {toPlainMessage} from '@bufbuild/protobuf'

const comment = await grpcClient.comments.getComment({id: cid})
const plain = toPlainMessage(comment)

// Now plain is a regular JS object
console.log(plain.author, plain.content)
```

### JSON Conversion

For serialization:

```typescript
const jsonData = comment.toJson({emitDefaultValues: true})
```

## Pagination

Many list operations support pagination:

```typescript
let pageToken: string | undefined

while (true) {
  const response = await grpcClient.documents.listRootDocuments({
    pageSize: BigInt(50),
    pageToken,
  })

  for (const doc of response.documents) {
    // Process document
  }

  if (!response.nextPageToken) break
  pageToken = response.nextPageToken
}
```

## BigInt Handling

Some protobuf fields use BigInt:

```typescript
// Page sizes are BigInt
const response = await grpcClient.comments.listCommentsByAuthor({
  author: uid,
  pageSize: BigInt(100),  // or use BIG_INT constant
})

// Convert reply count
const count = Number(response.replyCount)
```

The `BIG_INT` constant provides a safe large value:

```typescript
import {BIG_INT} from '@shm/shared/constants'

const response = await grpcClient.documents.listRootDocuments({
  pageSize: BIG_INT,
})
```

## Error Handling

gRPC errors include status codes:

```typescript
import {ConnectError} from '@connectrpc/connect'

try {
  await grpcClient.comments.getComment({id: 'invalid'})
} catch (error) {
  if (error instanceof ConnectError) {
    if (error.code === 'not_found') {
      console.log('Comment not found')
    } else if (error.code === 'permission_denied') {
      console.log('Access denied')
    }
  }
}
```

## Transport Configuration

### Web (Browser)

```typescript
import {createGrpcWebTransport} from '@connectrpc/connect-web'

const transport = createGrpcWebTransport({
  baseUrl: 'https://api.example.com',
})
```

### Node.js (Server/Electron)

```typescript
import {createGrpcWebTransport} from '@connectrpc/connect-node'

const transport = createGrpcWebTransport({
  baseUrl: 'http://localhost:56001',
  httpVersion: '1.1',
})
```

### With Interceptors

```typescript
const loggingInterceptor = (next) => async (req) => {
  console.log('Request:', req.method.name)
  const response = await next(req)
  console.log('Response received')
  return response
}

const transport = createGrpcWebTransport({
  baseUrl: DAEMON_HTTP_URL,
  interceptors: [loggingInterceptor],
})
```

## Common Patterns

### Account Resolution with Aliases

```typescript
async function resolveAccount(client: GRPCClient, uid: string) {
  const account = await client.documents.getAccount({id: uid})
  const plain = toPlainMessage(account)

  // Follow alias if present
  if (plain.aliasAccount) {
    return resolveAccount(client, plain.aliasAccount)
  }

  return plain
}
```

### Document Path Handling

Paths use different formats for IDs vs API:

```typescript
// UnpackedHypermediaId path: ['doc', 'subdoc']
// API path: '/doc/subdoc'

function hmIdPathToEntityQueryPath(path: string[] | null): string {
  if (!path || path.length === 0) return ''
  return '/' + path.join('/')
}

function entityQueryPathToHmIdPath(path: string): string[] | null {
  if (!path || path === '') return null
  return path.split('/').filter(Boolean)
}
```

### Metadata Parsing

Document metadata needs validation:

```typescript
import {HMDocumentMetadataSchema} from '@shm/shared'

const rawMetadata = doc.metadata?.toJson()
const parsed = HMDocumentMetadataSchema.safeParse(rawMetadata)

if (parsed.success) {
  console.log(parsed.data.name, parsed.data.icon)
} else {
  console.error('Invalid metadata:', parsed.error)
}
```

## Protobuf Generation

Protobuf types are generated from `.proto` files in `backend/genproto/`:

```bash
# Generate TypeScript types
yarn workspace @shm/shared generate:proto
```

Generated files are in `@shm/shared/src/client/.generated/`.

## Constants

```typescript
// Default daemon URL
export const DAEMON_HTTP_URL = process.env.DAEMON_HTTP_URL || 'http://localhost:56001'

// Large page size for "all" queries
export const BIG_INT = BigInt(999999)
```
