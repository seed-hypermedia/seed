# Seed HTTP API Reference

## Base URL

Default: `https://dev.hyper.media`

## Authentication

Read operations: None required
Write operations: Signed CBOR blobs (see Write Operations section)

## Request Format

```
GET /api/{key}?{serialized_params}
```

Query parameters are serialized using the input schema for each endpoint.

## Response Format

```typescript
// Success
HTTP 200
Content-Type: application/json
{...validated output}

// Error
HTTP 4xx/5xx
Content-Type: application/json
{error: "error message"}
```

---

## Read Endpoints

### Resource

Fetch any hypermedia resource (document, comment, etc.)

```
GET /api/Resource?id={hm_id}
```

**Input:**
```typescript
{id: "hm://uid/path?v=version#block"}
```

**Output:**
```typescript
| {type: 'document', id, document}
| {type: 'comment', id, comment}
| {type: 'redirect', id, redirectTarget}
| {type: 'not-found', id}
| {type: 'tombstone', id}
| {type: 'error', id, message}
```

**Example:**
```bash
curl "https://dev.hyper.media/api/Resource?id=hm%3A%2F%2Fz6Mkh..."
```

---

### ResourceMetadata

Fetch metadata only (lighter than full Resource).

```
GET /api/ResourceMetadata?id={hm_id}
```

**Output:**
```typescript
{
  id: UnpackedHypermediaId,
  metadata: HMMetadata | null,
  hasSite?: boolean
}
```

---

### Account

Fetch account information with optional alias resolution.

```
GET /api/Account?uid={uid}
```

**Input:**
```typescript
{uid: "z6Mkh..."}  // base58 account UID
```

**Output:**
```typescript
| {type: 'account', id, metadata, hasSite?}
| {type: 'account-not-found', uid}
```

---

### ListAccounts

List all known accounts/spaces.

```
GET /api/ListAccounts
```

**Output:**
```typescript
{
  accounts: Array<{
    id: UnpackedHypermediaId,
    metadata: HMMetadata | null,
    hasSite?: boolean
  }>
}
```

---

### Query

List documents in a space/path.

```
GET /api/Query?includes=[...]&sort=[...]&limit=N
```

**Input:**
```typescript
{
  includes: Array<{
    space: string,    // Account UID
    path?: string,    // Path prefix
    mode: 'Children' | 'AllDescendants'
  }>,
  sort?: Array<{
    term: 'Path' | 'Title' | 'CreateTime' | 'UpdateTime' | 'DisplayTime',
    reverse?: boolean
  }>,
  limit?: number
}
```

**Output:**
```typescript
{
  in: UnpackedHypermediaId,
  results: Array<HMDocumentInfo>,
  mode?: 'Children' | 'AllDescendants'
}
```

**Example:**
```bash
# List children of root
curl "https://dev.hyper.media/api/Query?includes=%5B%7B%22space%22%3A%22z6Mkh...%22%2C%22mode%22%3A%22Children%22%7D%5D"
```

---

### Search

Full-text search across documents.

```
GET /api/Search?query=...&accountUid=...
```

**Input:**
```typescript
{
  query: string,
  accountUid?: string,        // Limit to account
  includeBody?: boolean,      // Include body snippets
  contextSize?: number,       // Snippet context size
  perspectiveAccountUid?: string
}
```

**Output:**
```typescript
{
  entities: Array<{
    id: UnpackedHypermediaId,
    metadata?: HMMetadata,
    title: string,
    icon: string,
    parentNames: string[],
    searchQuery: string,
    type: 'document' | 'contact'
  }>,
  searchQuery: string
}
```

---

### ListComments

List comments targeting a document.

```
GET /api/ListComments?targetId={...}
```

**Input:**
```typescript
{targetId: UnpackedHypermediaId}
```

**Output:**
```typescript
{
  comments: HMComment[],
  authors: Record<string, HMMetadataPayload>
}
```

---

### ListDiscussions

Get threaded discussions for a document.

```
GET /api/ListDiscussions?targetId={...}&commentId=...
```

**Input:**
```typescript
{
  targetId: UnpackedHypermediaId,
  commentId?: string  // Filter to specific thread
}
```

**Output:**
```typescript
{
  discussions: Array<{
    id: string,
    type: 'commentGroup',
    comments: HMComment[],
    moreCommentsCount: number
  }>,
  authors: Record<string, HMMetadataPayload>,
  citingDiscussions: Array<{...}>  // External discussions
}
```

---

### Comment

Fetch a single comment by ID.

```
GET /api/Comment?id={comment_id}
```

**Output:** `HMComment`

---

### GetCommentReplyCount

Get reply count for a comment.

```
GET /api/GetCommentReplyCount?id={comment_id}
```

**Output:** `number`

---

### ListCommentsByAuthor

List all comments by an author.

```
GET /api/ListCommentsByAuthor?authorId={...}
```

**Input:**
```typescript
{authorId: UnpackedHypermediaId}
```

**Output:**
```typescript
{
  comments: HMComment[],
  authors: Record<string, HMMetadataPayload>
}
```

---

### ListCommentsByReference

List comments referencing an entity.

```
GET /api/ListCommentsByReference?targetId={...}
```

**Output:** Same as ListComments

---

### AccountContacts

List contacts for an account.

```
GET /api/AccountContacts?uid={account_uid}
```

**Output:**
```typescript
Array<{
  id: string,
  subject: string,
  name: string,
  account: string,
  createTime?: HMTimestamp,
  updateTime?: HMTimestamp
}>
```

---

### ListChanges

Get document change history.

```
GET /api/ListChanges?targetId={...}
```

**Output:**
```typescript
{
  changes: Array<{
    id?: string,
    author?: string,
    deps?: string[],
    createTime?: string
  }>,
  latestVersion?: string
}
```

---

### ListCitations

Get backlinks/mentions of an entity.

```
GET /api/ListCitations?targetId={...}
```

**Output:**
```typescript
{
  citations: Array<{
    source: string,
    sourceType?: string,
    sourceDocument?: string,
    targetFragment?: string,
    isExact?: boolean
  }>
}
```

---

### ListCapabilities

List access control capabilities.

```
GET /api/ListCapabilities?targetId={...}
```

**Output:**
```typescript
{
  capabilities: Array<{
    id?: string,
    issuer?: string,
    delegate?: string,
    account?: string,
    path?: string,
    role?: string,
    noRecursive?: boolean
  }>
}
```

---

### InteractionSummary

Get interaction statistics for a document.

```
GET /api/InteractionSummary?id={...}
```

**Output:**
```typescript
{
  citations: number,
  comments: number,
  changes: number,
  children: number,
  blocks: Record<string, {
    citations: number,
    comments: number
  }>
}
```

---

### ListEvents

Activity feed with filtering.

```
GET /api/ListEvents?pageSize=N&pageToken=...
```

**Input:**
```typescript
{
  pageSize?: number,
  pageToken?: string,
  trustedOnly?: boolean,
  filterAuthors?: string[],
  filterEventType?: string[],
  filterResource?: string,
  currentAccount?: string
}
```

**Output:**
```typescript
{
  events: Array<LoadedEvent>,
  nextPageToken: string
}
```

---

### GetCID

Fetch raw IPFS block data.

```
GET /api/GetCID?cid={cid}
```

**Output:**
```typescript
{value: any}  // Decoded IPLD block
```

---

## Write Endpoints

### Store Blob (Generic)

Store any valid IPLD blob. Preferred for advanced operations.

```
POST /hm/api/debug.store-blob
Content-Type: application/cbor
```

**Payload:** Raw CBOR-encoded blob bytes

**Response:**
```typescript
{message: 'Success', cid: string}
```

---

### Create Account

Create a new account with genesis, home document, and ref.

```
POST /hm/api/create-account
Content-Type: application/cbor
```

**Payload (CBOR):**
```typescript
{
  genesis: {data: Uint8Array, cid: string},   // Genesis change blob
  home: {data: Uint8Array, cid: string},      // Home document change
  ref: Uint8Array,                             // Ref blob bytes
  icon?: {data: Uint8Array, cid: string}      // Optional icon
}
```

**Response:**
```typescript
{message: 'Success'}
```

---

### Document Update

```
POST /hm/api/document-update
Content-Type: application/cbor
```

**Payload (CBOR):**
```typescript
{
  change: {data: Uint8Array, cid: string},
  ref: {data: Uint8Array, cid: string},
  icon?: {data: Uint8Array, cid: string}
}
```

**Response:**
```typescript
{cids: string[]}
```

---

### Comment Create

```
POST /hm/api/comment
Content-Type: application/cbor
```

**Payload (CBOR):**
```typescript
{
  comment: Uint8Array,  // Signed comment blob
  blobs: Array<{cid: string, data: Uint8Array}>
}
```

---

## Signing

### Ed25519 via BIP-39 Mnemonic (CLI/Desktop/Mobile)

The CLI uses Ed25519 keys derived from BIP-39 mnemonics:

```typescript
import * as bip39 from 'bip39'
import SLIP10 from '@exodus/slip10'
import * as ed25519 from '@noble/ed25519'
import {base58btc} from 'multiformats/bases/base58'

// Derivation path: m/44'/104109'/0' (104109 = 'hm')
const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase)
const derivedKey = SLIP10.fromSeed(seed).derive("m/44'/104109'/0'")
const privateKey = derivedKey.key
const publicKey = ed25519.getPublicKey(privateKey)

// Public key format: multicodec prefix + key bytes
const ED25519_PREFIX = new Uint8Array([0xed, 0x01])
const publicKeyWithPrefix = new Uint8Array([...ED25519_PREFIX, ...publicKey])
const accountId = base58btc.encode(publicKeyWithPrefix)  // starts with 'z6Mk'

// Sign CBOR data
const signature = await ed25519.sign(cborEncodedData, privateKey)
```

### ECDSA P-256 (Web Browser)

Web browsers use WebCrypto P-256 for ephemeral web identities:

```typescript
const keyPair = await crypto.subtle.generateKey(
  {name: 'ECDSA', namedCurve: 'P-256'},
  false,
  ['sign', 'verify']
)

const signature = await crypto.subtle.sign(
  {name: 'ECDSA', hash: {name: 'SHA-256'}},
  keyPair.privateKey,
  cborEncodedData
)
```

P-256 public key format: `[128, 36, prefix, ...x]` (compressed)

---

## Error Codes

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 400 | Invalid request / missing params |
| 404 | Resource not found / unknown API key |
| 500 | Server error |

Special response types:
- `{type: 'not-found'}` - Resource doesn't exist
- `{type: 'redirect', redirectTarget}` - Follow redirect
- `{type: 'tombstone'}` - Resource was deleted
- `{type: 'error', message}` - Application error
