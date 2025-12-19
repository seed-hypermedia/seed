# GitHub Action for Seed Hypermedia Publications

## Feasibility Assessment: **YES, this is feasible**

Based on codebase exploration, all necessary components exist and can be adapted for a GitHub Action workflow.

---

## Executive Summary

Create a GitHub Action that:
1. Extracts markdown from staged/new files in a commit
2. Converts markdown → Hypermedia blocks → DocumentChanges
3. Signs the changes using a secret key stored in GitHub Secrets
4. Pushes signed blobs to hyper.media or custom gateway
5. Injects the hypermedia link back into markdown
6. Proceeds with normal SSG build (Next.js/Astro)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     GitHub Action Workflow                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Trigger: Push to main/PR merge                              │
│                                                                  │
│  2. Extract markdown files from commit                          │
│     └─ git diff --name-only HEAD~1 HEAD -- "*.md"               │
│                                                                  │
│  3. For each markdown file:                                     │
│     ├─ Parse markdown → EditorBlocks → HMBlocks                 │
│     ├─ Generate DocumentChanges                                  │
│     ├─ Create Change blob (CBOR encoded)                        │
│     ├─ Sign blob with secret key                                │
│     ├─ Create Ref blob (points to change)                       │
│     └─ Sign Ref blob                                            │
│                                                                  │
│  4. Push blobs to gateway                                       │
│     └─ POST /hm/api/document-update (CBOR body)                 │
│                                                                  │
│  5. Get hypermedia URL: hm://<account>/<path>                   │
│                                                                  │
│  6. Inject link into markdown (start/end configurable)          │
│                                                                  │
│  7. Continue with SSG build                                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Components to Implement

### 1. Key Management

**Storage**: GitHub Secrets
- `HM_PRIVATE_KEY`: Base64-encoded private key OR mnemonic phrase
- `HM_GATEWAY_URL`: Target gateway (default: `https://hyper.media`)

**Key Formats Supported**:
- Ed25519 (preferred, 32-byte seed)
- ECDSA P-256 (compatible with Web Crypto)

**Account Derivation**:
```typescript
// From backend/core/crypto.go
// Principal = multicodec_prefix + public_key_bytes
// Account ID = Base58BTC(Principal)
// Example: z6Mkv1LjkRosErBhmqrkmb5sDxXNs6EzBDSD8ktywpYLLGuC
```

### 2. Markdown → Hypermedia Conversion

**Reusable Code**: `frontend/packages/editor/src/blocknote/core/extensions/Markdown/`

```typescript
// Pipeline (from MarkdownToBlocks.ts)
unified()
  .use(remarkParse)
  .use(remarkCodeClass)
  .use(remarkImageWidth)
  .use(remarkRehype)
  .use(rehypeStringify)
  .process(markdown)
  → EditorBlocks
  → HMBlocks (via editorBlockToHMBlock)
```

**Supported Elements**:
- Paragraphs, Headings (h1-h6)
- Code blocks with language
- Images, Videos, Files
- Links, Bold, Italic, Code spans
- Blockquotes, Lists
- Math blocks (`$$...$$`)

### 3. DocumentChange Creation

**From**: `frontend/packages/shared/src/utils/document-changes.ts`

For new documents (genesis):
```typescript
const changes: DocumentChange[] = [
  // Set document metadata
  { setAttribute: { path: ['name'], value: title } },
  { setAttribute: { path: ['summary'], value: description } },

  // Move/create blocks
  { moveBlock: { blockId, parent: '', leftSibling: '' } },

  // Replace block content
  { replaceBlock: { id, type, text, annotations, attributes } },
]
```

### 4. Blob Creation & Signing

**Change Blob Structure** (from `backend/blob/blob_change.go`):
```typescript
interface ChangeBlob {
  type: 'Change'
  signer: Uint8Array      // Principal (multicodec + pubkey)
  sig: Uint8Array         // 64-byte signature (zeros for signing)
  ts: number              // Unix milliseconds
  genesis?: CID           // undefined for genesis
  deps?: CID[]            // empty for genesis
  depth?: number          // 0 for genesis
  body: {
    opCount: number
    ops: Operation[]
  }
}
```

**Signing Process** (from `backend/blob/blob.go`):
```typescript
// 1. Create blob with sig = zeros(64)
// 2. CBOR encode entire blob
// 3. Sign CBOR bytes
// 4. Replace zeros with actual signature
// 5. CID = CIDv1(DagCbor, BLAKE2B_256(final_cbor))
```

**Libraries Needed**:
- `cbor-x` or `@ipld/dag-cbor` for CBOR encoding
- `multiformats` for CID generation
- `@noble/ed25519` or Web Crypto for signing
- `blake2b` for hashing

### 5. Ref Blob Creation

**Ref Blob Structure** (from `backend/blob/blob_ref.go`):
```typescript
interface RefBlob {
  type: 'Ref'
  signer: Uint8Array
  sig: Uint8Array
  ts: number
  space: Uint8Array       // Account principal
  path: string            // Document path
  genesis: CID            // Genesis change CID
  heads: CID[]            // Latest change CIDs
  generation: number      // 0 for new docs
}
```

### 6. Gateway API

**Endpoint**: `POST /hm/api/document-update`
**Content-Type**: `application/cbor`

**Payload** (from `frontend/apps/web/app/routes/hm.api.document-update.tsx`):
```typescript
interface UpdateDocumentPayload {
  change: {
    cid: string
    data: Uint8Array
  }
  ref: {
    cid: string
    data: Uint8Array
  }
  icon?: {
    cid: string
    data: Uint8Array
  } | null
}
```

**Alternative**: `POST /hm/api/create-account` for first-time account creation

---

## Implementation Plan

### Phase 1: Core Library (`@seed-hypermedia/publish`)

Create standalone npm package with:

```
packages/publish/
├── src/
│   ├── keys.ts           # Key generation, derivation, signing
│   ├── markdown.ts       # MD → HMBlocks conversion
│   ├── changes.ts        # DocumentChange generation
│   ├── blobs.ts          # Blob creation, CBOR encoding
│   ├── gateway.ts        # API client for publishing
│   └── index.ts          # Main publish function
├── package.json
└── tsconfig.json
```

**Key Functions**:
```typescript
// Generate/load account
function loadAccount(secret: string): Account

// Convert markdown to hypermedia
function markdownToHMBlocks(md: string): HMBlockNode[]

// Create signed document
function createDocument(opts: {
  account: Account
  path: string
  blocks: HMBlockNode[]
  metadata: { name: string; summary?: string }
}): SignedDocument

// Publish to gateway
function publishDocument(doc: SignedDocument, gateway: string): Promise<string>
```

### Phase 2: GitHub Action

```yaml
# .github/workflows/publish-hypermedia.yml
name: Publish to Hypermedia

on:
  push:
    branches: [main]
    paths: ['content/**/*.md', 'posts/**/*.md']

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2  # For diff

      - uses: seed-hypermedia/publish-action@v1
        with:
          private-key: ${{ secrets.HM_PRIVATE_KEY }}
          gateway: ${{ secrets.HM_GATEWAY_URL }}
          content-dir: content/
          link-position: start  # or 'end'
          link-format: '> [View on Hypermedia]({url})'

      - name: Build site
        run: npm run build
```

**Action Inputs**:
| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `private-key` | Yes | - | Ed25519 private key or mnemonic |
| `gateway` | No | `https://hyper.media` | Gateway URL |
| `content-dir` | No | `.` | Directory with markdown files |
| `link-position` | No | `end` | Where to inject link (`start`/`end`) |
| `link-format` | No | `[Hypermedia]({url})` | Link format template |
| `path-prefix` | No | `/blog` | Path prefix for documents |

### Phase 3: SSG Integrations

**Next.js Plugin**:
```typescript
// next.config.js
const withHypermedia = require('@seed-hypermedia/next')

module.exports = withHypermedia({
  hypermedia: {
    contentDir: 'content/',
    pathPrefix: '/blog',
  }
})
```

**Astro Integration**:
```typescript
// astro.config.mjs
import hypermedia from '@seed-hypermedia/astro'

export default defineConfig({
  integrations: [
    hypermedia({
      contentDir: 'src/content/',
      pathPrefix: '/articles',
    })
  ]
})
```

---

## Security Considerations

1. **Private Key Protection**
   - Never log or expose keys
   - Use GitHub's encrypted secrets
   - Consider using mnemonic phrases for easier backup

2. **Signature Verification**
   - Gateway verifies all signatures
   - Invalid signatures rejected at blob storage

3. **Content Integrity**
   - CIDs ensure content integrity
   - Changes are immutable once published

---

## Existing Code to Reuse

| Component | Location | Reusability |
|-----------|----------|-------------|
| Markdown parsing | `frontend/packages/editor/src/blocknote/core/extensions/Markdown/` | Extract and adapt |
| EditorBlock→HMBlock | `frontend/packages/shared/src/client/editorblock-to-hmblock.ts` | Direct reuse |
| Block types | `frontend/packages/shared/src/hm-types.ts` | Direct reuse |
| Signing utils | `frontend/apps/web/app/api.ts` | Adapt for Node.js |
| CBOR encoding | Already uses `cbor-x` | Direct reuse |

---

## Open Questions

1. **First-time account setup**: Should the action auto-create accounts, or require pre-registration?
   - Recommendation: Support both via `/hm/api/create-account`

2. **Document versioning**: How to handle updates to existing documents?
   - Need to track previous versions (store in `.hypermedia/` cache)

3. **Media handling**: How to handle images/files in markdown?
   - Option A: Upload to IPFS via gateway
   - Option B: Leave as HTTP URLs (supported)

4. **Path mapping**: How to map file paths to hypermedia paths?
   - `content/blog/my-post.md` → `hm://<account>/blog/my-post`

---

## Next Steps

1. [ ] Create `@seed-hypermedia/publish` package structure
2. [ ] Extract markdown parsing code
3. [ ] Implement CBOR blob encoding (matching Go backend)
4. [ ] Implement signing with Ed25519/P-256
5. [ ] Create gateway client
6. [ ] Build GitHub Action wrapper
7. [ ] Create Next.js/Astro integrations
8. [ ] Write documentation and examples

---

## Estimated Effort

- Core library: 3-4 days
- GitHub Action: 1-2 days
- SSG integrations: 2-3 days
- Testing & docs: 2-3 days

**Total**: ~2 weeks for MVP
