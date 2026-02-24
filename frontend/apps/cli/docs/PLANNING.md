# Seed CLI Planning Document

## Overview

A Bun+TypeScript CLI for interacting with Seed Hypermedia servers via HTTP API. Default server:
`https://dev.hyper.media`

## Architecture

### Server Communication

The CLI communicates via `/api/*` routes exposed by Seed web servers:

```
GET /api/{key}?{serialized_input}
```

Where `key` is one of the 19 API endpoints defined in `@shm/shared`.

### Available API Endpoints

| Key                       | Purpose                       | Input                          |
| ------------------------- | ----------------------------- | ------------------------------ |
| `Resource`                | Fetch document/comment/entity | `UnpackedHypermediaId`         |
| `ResourceMetadata`        | Get metadata only             | `UnpackedHypermediaId`         |
| `Account`                 | Fetch account info            | `string` (uid)                 |
| `Comment`                 | Fetch single comment          | `string` (id)                  |
| `AccountContacts`         | List account contacts         | `string` (uid)                 |
| `Search`                  | Full-text search              | `{query, accountUid?, ...}`    |
| `Query`                   | Directory listing             | `{includes, sort?, limit?}`    |
| `ListComments`            | Comments on target            | `{targetId}`                   |
| `ListDiscussions`         | Threaded discussions          | `{targetId, commentId?}`       |
| `ListCommentsByReference` | Comments by ref               | `{targetId}`                   |
| `GetCommentReplyCount`    | Reply count                   | `{id}`                         |
| `ListEvents`              | Activity feed                 | `{pageSize?, pageToken?, ...}` |
| `ListAccounts`            | All known accounts            | `{}`                           |
| `GetCID`                  | Raw IPFS block                | `{cid}`                        |
| `ListCommentsByAuthor`    | Author's comments             | `{authorId}`                   |
| `ListCitations`           | Mentions/backlinks            | `{targetId}`                   |
| `ListChanges`             | Document history              | `{targetId}`                   |
| `ListCapabilities`        | Access control                | `{targetId}`                   |
| `InteractionSummary`      | Doc interaction stats         | `{id}`                         |

### Hypermedia ID Format

```
hm://{uid}/{path}?v={version}#{blockRef}

Examples:
  hm://z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
  hm://z6MkhaX.../blog/post-1
  hm://z6MkhaX.../blog/post-1?v=bafy...
  hm://z6MkhaX.../blog/post-1#block123
```

### Write Operations (Phase 2)

Write ops require signing and use separate endpoints:

- `POST /hm/api/document-update` - Create/update documents
- `POST /api/PublishBlobs` - Publish signed comment + attachment blobs

Payload format: CBOR-encoded with signed blobs

## CLI Commands

### Phase 1: Read Operations

```bash
# Resource fetching
seed-cli get <hm-id>              # Fetch document/entity
seed-cli get --metadata <hm-id>   # Metadata only

# Account operations
seed-cli account <uid>            # Account info
seed-cli accounts                 # List all accounts
seed-cli contacts <uid>           # Account contacts

# Search & Query
seed-cli search <query> [--account <uid>]
seed-cli query <hm-id> [--mode children|descendants] [--limit N]
seed-cli children <hm-id>         # Shorthand for query --mode=children

# Comments
seed-cli comments <hm-id>         # List comments on target
seed-cli discussions <hm-id>      # Threaded discussions
seed-cli comment <comment-id>     # Single comment

# History & Activity
seed-cli changes <hm-id>          # Document history
seed-cli citations <hm-id>        # Backlinks/mentions
seed-cli activity [--author <uid>] [--limit N]

# Access Control
seed-cli capabilities <hm-id>     # List capabilities

# Utilities
seed-cli cid <cid>                # Raw IPFS block
seed-cli stats <hm-id>            # Interaction summary
```

### Phase 2: Write Operations

```bash
# Identity management
seed-cli identity init            # Generate keypair
seed-cli identity show            # Show public key
seed-cli identity link <session>  # Link to daemon

# Document operations
seed-cli publish <file> --to <hm-id>  # Publish markdown
seed-cli update <hm-id> <file>        # Update document

# Comments
seed-cli comment create <hm-id> <text>
seed-cli comment reply <comment-id> <text>
```

### Global Options

```bash
--server <url>    # Server URL (default: https://dev.hyper.media)
--json            # JSON output (default)
--yaml            # YAML output
--table           # Table output
--quiet           # Minimal output
--verbose         # Debug info
```

## Project Structure

```
frontend/apps/cli/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts              # Entry point
│   ├── cli.ts                # Command definitions
│   ├── client.ts             # HTTP client wrapper
│   ├── output.ts             # Output formatters
│   ├── config.ts             # Config management
│   ├── commands/
│   │   ├── get.ts
│   │   ├── account.ts
│   │   ├── search.ts
│   │   ├── query.ts
│   │   ├── comments.ts
│   │   ├── changes.ts
│   │   ├── activity.ts
│   │   └── ...
│   └── utils/
│       ├── hm-id.ts          # ID parsing (from @shm/shared)
│       └── serialize.ts      # Query string serialization
└── README.md
```

## Dependencies

```json
{
  "dependencies": {
    "@shm/shared": "workspace:*",
    "commander": "^12.0.0",
    "chalk": "^5.3.0",
    "yaml": "^2.3.0"
  },
  "devDependencies": {
    "bun-types": "latest",
    "typescript": "^5.0.0"
  }
}
```

## Implementation Notes

### Query String Serialization

Uses `@shm/shared/input-querystring` for consistent serialization:

```typescript
import {serializeQueryString} from '@shm/shared/input-querystring'

const params = serializeQueryString(input, schema)
const url = `${server}/api/${key}?${params}`
```

### Type Safety

Leverage `HMRequest` discriminated union from `@shm/shared`:

```typescript
async function apiRequest<K extends HMRequest['key']>(
  key: K,
  input: Extract<HMRequest, {key: K}>['input'],
): Promise<Extract<HMRequest, {key: K}>['output']>
```

### Error Handling

API responses:

- Success: `200 OK` with JSON body
- Not found: `404` or `{type: 'not-found'}`
- Redirect: `{type: 'redirect', redirectTarget}`
- Tombstone: `{type: 'tombstone'}`
- Error: `{error: string}` or `500`

## Identity & Signing

### Key Derivation (Ed25519 via BIP-39)

The CLI uses Ed25519 keys derived from BIP-39 mnemonics, matching the Go daemon implementation.

```typescript
// Derivation flow (from tests/key-derivation.ts):
// 1. Mnemonic + passphrase → BIP39 seed (64 bytes)
// 2. SLIP-10 derivation with path m/44'/104109'/0'
// 3. Ed25519 key generation from derived seed
// 4. Encode public key: multicodec prefix (0xed 0x01) + base58btc

import * as bip39 from 'bip39'
import SLIP10 from '@exodus/slip10'
import {base58btc} from 'multiformats/bases/base58'
import * as ed25519 from '@noble/ed25519'

const KEY_DERIVATION_PATH = "m/44'/104109'/0'" // 104109 = 'hm' Unicode
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01])

function deriveKeyPairFromMnemonic(mnemonic: string, passphrase = '') {
  const seed = bip39.mnemonicToSeedSync(mnemonic, passphrase)
  const masterKey = SLIP10.fromSeed(seed)
  const derivedKey = masterKey.derive(KEY_DERIVATION_PATH)
  const privateKey = derivedKey.key
  const publicKey = ed25519.getPublicKey(privateKey)
  const publicKeyWithPrefix = new Uint8Array([...ED25519_MULTICODEC_PREFIX, ...publicKey])
  const accountId = base58btc.encode(publicKeyWithPrefix)
  return {privateKey, publicKey, accountId}
}
```

### Blob Structure

All data stored as IPLD DAG-CBOR blobs. Three main blob types:

**1. Change Blob (document mutations)**

```typescript
type Change = {
  type: 'Change'
  signer: Uint8Array // Public key with multicodec prefix
  sig: Uint8Array // Ed25519 signature (64 bytes)
  ts: bigint // Timestamp (0n for genesis)
  genesis?: CID // Genesis change CID (except for genesis itself)
  deps?: CID[] // Parent change CIDs
  depth?: number // DAG depth
  body?: {
    ops: HMDocumentOperation[]
    opCount: number
  }
}
```

**2. Ref Blob (version pointers)**

```typescript
type Ref = {
  type: 'Ref'
  signer: Uint8Array
  sig: Uint8Array
  ts: bigint
  genesisBlob: CID // Points to genesis change
  heads: CID[] // Current head changes
  generation: number // Ref generation number
  space?: Uint8Array // If different from signer
  path?: string // Document path
  capability?: Uint8Array // Delegation capability
}
```

**3. Comment Blob**

```typescript
type Comment = {
  type: 'Comment'
  signer: Uint8Array
  sig: Uint8Array
  ts: bigint
  body: HMPublishableBlock[]
  space: Uint8Array // Target document space
  path: string // Target document path
  version: CID[] // Target document version
  replyParent?: CID // Parent comment (for threads)
  threadRoot?: CID // Root of thread
}
```

### Signing Flow

```typescript
// 1. Create unsigned blob with empty signature
const unsigned = {
  type: 'Change',
  signer: publicKeyWithPrefix,
  sig: new Uint8Array(64), // Empty placeholder
  // ... other fields
}

// 2. CBOR encode and sign
const cborData = cborEncode(unsigned)
const signature = await ed25519.sign(cborData, privateKey)

// 3. Replace signature
const signed = {...unsigned, sig: signature}

// 4. Encode final blob and compute CID
const block = await Block.encode({
  value: signed,
  codec: cborCodec,
  hasher: sha256,
})
// block.cid = CID, block.bytes = Uint8Array
```

### Account Creation Flow

```
1. Generate/restore mnemonic
2. Derive keypair from mnemonic
3. Create genesis change (empty change, ts=0)
4. Create home change (with name, icon)
5. Create ref pointing to home change
6. POST all blobs to /hm/api/create-account
```

## Write API Endpoints

### `/hm/api/store-blob` (preferred)

```
POST /hm/api/debug.store-blob
Content-Type: application/cbor
Body: <raw CBOR blob>

Response: {cid: string}
```

### `/hm/api/create-account`

```
POST /hm/api/create-account
Content-Type: application/cbor
Body: CBOR({
  genesis: {data: Uint8Array, cid: string},
  home: {data: Uint8Array, cid: string},
  ref: Uint8Array,
  icon?: {data: Uint8Array, cid: string}
})
```

### `/hm/api/document-update`

```
POST /hm/api/document-update
Content-Type: application/cbor
Body: CBOR({
  change: {data: Uint8Array, cid: string},
  ref: {data: Uint8Array, cid: string},
  icon?: {data: Uint8Array, cid: string}
})
```

### `/api/PublishBlobs`

```
POST /api/PublishBlobs
Content-Type: application/cbor
Body: CBOR({
  blobs: Array<{cid?: string, data: Uint8Array}>
})
```

## Development Phases

### Phase 1 (MVP)

- [x] Project setup with Bun
- [ ] HTTP client wrapper
- [ ] Basic commands: get, account, search
- [ ] JSON output
- [ ] Config file support

### Phase 2 (Full Read)

- [ ] All read commands
- [ ] Multiple output formats
- [ ] Pagination support
- [ ] Interactive mode

### Phase 3 (Write)

- [ ] Key derivation from mnemonic
- [ ] Local key storage (secure)
- [ ] Account creation (genesis + home + ref)
- [ ] Document publishing
- [ ] Comment creation

### Phase 4 (Polish)

- [ ] Shell completions
- [ ] Man pages
- [ ] Error messages
- [ ] Performance optimization
