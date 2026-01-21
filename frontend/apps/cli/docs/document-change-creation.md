# Document Change Creation: Go Backend Analysis & TypeScript Implementation Guide

## Overview

This document explains how `CreateDocumentChange` works in the Go backend and provides a guide for reimplementing this functionality in TypeScript for browser-based document editing.

---

## Part 1: What the Go Backend Does

### Entry Point: `CreateDocumentChange` RPC Handler

**File:** [documents.go:169-299](backend/api/documents/v3alpha/documents.go#L169-L299)

When JS calls `CreateDocumentChange`, the Go backend performs these steps:

### Phase 1: Validation & Setup (lines 171-204)

```go
// Decode account principal from request
ns, err := core.DecodePrincipal(in.Account)

// Create IRI (resource identifier) from account + path
iri, err := makeIRI(ns, in.Path)

// Validations:
// - Account must not be empty
// - SigningKeyName must not be empty
// - At least one change required in Changes array
// - Private documents must have simple paths (/document-name, no nesting)
```

### Phase 2: Authorization (lines 206-219)

```go
// Get signing KeyPair from key store
kp, err := srv.keys.GetKey(ctx, in.SigningKeyName)

// Check write access for the key on target document path
if err := srv.checkWriteAccess(ctx, ns, in.Path, kp); err != nil { ... }

// For home documents (empty path), ensure profile genesis exists
if in.Path == "" && ns.Equal(kp.Principal()) {
    if err := srv.ensureProfileGenesis(ctx, kp); err != nil { ... }
}
```

### Phase 3: Load or Create Document (lines 221-250)

```go
// Parse BaseVersion to get previous change CIDs (heads)
heads, err := docmodel.Version(in.BaseVersion).Parse()

// Load document from blob storage at those heads
doc, err := srv.loadDocument(ctx, ns, in.Path, heads, true)

// If document doesn't exist but is new (path != "" and no changes yet),
// creates new empty document with new CRDT and clock

// Validate BaseVersion semantics:
// - Home documents with 1 change (genesis) don't need BaseVersion
// - Newly created documents don't need BaseVersion
// - Otherwise, must provide BaseVersion
```

### Phase 4: Apply Mutations (lines 252-254)

```go
// Apply all incoming DocumentChange operations to the document model
if err := applyChanges(doc, in.Changes); err != nil { ... }
```

The `applyChanges` function ([documents.go:1642-1671](backend/api/documents/v3alpha/documents.go#L1642-L1671)) handles these operation types:
- `SetMetadata` - Set document metadata key/value
- `MoveBlock` - Move block under parent, after left sibling
- `DeleteBlock` - Delete a block
- `ReplaceBlock` - Replace block content
- `SetAttribute` - Set block or document attribute

### Phase 5: Create Change Blob (lines 256-270)

```go
var docChange blob.Encoded[*blob.Change]
if in.Timestamp != nil {
    docChange, err = doc.SignChangeAt(kp, in.Timestamp.AsTime())
} else {
    docChange, err = doc.SignChange(kp)
}
newBlobs = append(newBlobs, docChange)
```

**This is the critical step.** The `SignChange` method does heavy lifting:

1. **`cleanupPatch()`** ([docmodel.go:403-514](backend/api/documents/v3alpha/docmodel/docmodel.go#L403-L514)):
   - Extracts all mutations into a `ChangeBody`
   - **Compresses contiguous moves** - batches sequential move operations to reduce encoded size
   - Collects delete operations
   - Collects metadata attribute changes
   - Filters out blocks that were created and deleted in same change
   - Sorts dirty blocks by ID for determinism

2. **`prepareChange()`** ([crdt.go:593-620](backend/api/documents/v3alpha/docmodel/crdt.go#L593-L620)):
   ```go
   // Get genesis CID (first change of document, or undefined for genesis)
   var genesis cid.Cid
   if len(e.cids) > 0 {
       genesis = e.cids[0]
   }

   // Get current heads (leaf changes) from document state
   deps := maps.Keys(e.heads)

   // Calculate depth as max(dependency depths) + 1
   var depth int
   for _, dep := range deps {
       depth = max(depth, e.changes[e.applied[dep]].Depth)
   }
   depth++

   // Sort dependencies deterministically
   slices.SortFunc(deps, func(a, b cid.Cid) int {
       return strings.Compare(a.KeyString(), b.KeyString())
   })

   // Create and sign the change blob
   hb, err = blob.NewChange(signer, genesis, deps, depth, body, ts)
   ```

3. **`blob.NewChange()`** ([blob_change.go:47-72](backend/blob/blob_change.go#L47-L72)):
   ```go
   cc := &Change{
       BaseBlob: BaseBlob{
           Type:   TypeChange,      // "Change"
           Signer: kp.Principal(),  // Public key bytes
           Ts:     ts,              // Timestamp (milliseconds)
       },
       Genesis: genesis,  // CID of first change (empty for genesis)
       Deps:    deps,     // Parent change CIDs (empty for genesis)
       Depth:   depth,    // Change depth in DAG (0 for genesis)
       Body:    body,     // ChangeBody with operations
   }

   // Sign the blob
   if err := Sign(kp, cc, &cc.BaseBlob.Sig); err != nil { ... }

   // Encode to CBOR and compute CID
   return encodeBlob(cc)
   ```

4. **Signing** ([blob.go:144-161](backend/blob/blob.go#L144-L161)):
   ```go
   // Fill signature field with zeros
   *sig = make([]byte, kp.SignatureSize())  // 64 bytes for Ed25519

   // Serialize entire struct to CBOR bytes
   unsignedBytes, err := cbornode.DumpObject(v)

   // Sign the CBOR bytes with keypair
   *sig, err = kp.Sign(unsignedBytes)
   ```

5. **Encoding** ([blob.go:218-227](backend/blob/blob.go#L218-L227)):
   ```go
   // Serialize signed blob to CBOR
   data, err := cbornode.DumpObject(v)

   // Create IPFS block with DagCbor codec
   blk := ipfs.NewBlock(uint64(multicodec.DagCbor), data)

   // Return Encoded with CID, raw bytes, and decoded struct
   return Encoded[T]{CID: blk.Cid(), Data: blk.RawData(), Decoded: v}
   ```

### Phase 6: Create Ref Blob (lines 272-283)

```go
var visibility blob.Visibility
if in.Visibility == documents.ResourceVisibility_RESOURCE_VISIBILITY_PRIVATE {
    visibility = blob.VisibilityPrivate
} else {
    visibility = blob.VisibilityPublic
}

ref, err := doc.Ref(kp, visibility)
newBlobs = append(newBlobs, ref)
```

**`doc.Ref()`** ([docmodel.go:378-401](backend/api/documents/v3alpha/docmodel/docmodel.go#L378-L401)):
```go
// Get genesis CID (first change)
genesis := dm.crdt.cids[0]

// Get the single head CID (current leaf change we just created)
headCID := dm.crdt.cids[len(dm.crdt.cids)-1]
head := dm.crdt.changes[len(dm.crdt.cids)-1]

// Extract space and path from document IRI
space, path, err := dm.crdt.id.SpacePath()

// If generation not set, use timestamp of new change
if !dm.Generation.IsSet() {
    dm.Generation = maybe.New(head.Ts.UnixMilli())
}

return blob.NewRef(kp, dm.Generation.Value(), genesis, space, path,
    []cid.Cid{headCID}, head.Ts, visibility)
```

**`blob.NewRef()`** ([blob_ref.go:52-76](backend/blob/blob_ref.go#L52-L76)):
```go
ru := &Ref{
    BaseBlob: BaseBlob{
        Type:   TypeRef,           // "Ref"
        Signer: kp.Principal(),
        Ts:     ts,
    },
    Path:        path,
    GenesisBlob: genesis,
    Heads:       heads,            // Single-element array with new change CID
    Generation:  generation,
    Visibility:  visibility,
}

// Optimization: only store space if different from signer
if !kp.Principal().Equal(space) {
    ru.Space_ = space
}

if err := Sign(kp, ru, &ru.BaseBlob.Sig); err != nil { ... }
return encodeBlob(ru)
```

### Phase 7: Persist Blobs (lines 285-287)

```go
if err := srv.idx.PutMany(ctx, newBlobs); err != nil { ... }
```

This stores both the change blob and ref blob to the blob index. The backend then does additional indexing:
- Tracks change dependencies in `blob_links` table
- Updates `document_generations` table with heads, authors, metadata
- Updates full-text search indexes
- Marks visibility (public/private)

### Phase 8: Return Result (lines 289-298)

```go
out, err := srv.GetDocument(ctx, &documents.GetDocumentRequest{
    Account: in.Account,
    Path:    in.Path,
    Version: docChange.CID.String(),
})
return out, nil
```

---

## Part 2: Data Required from the Backend

To create a document change in TypeScript, you need:

### Required Data

| Data | Source | Currently Exposed? |
|------|--------|-------------------|
| **Genesis CID** | First change of document | Yes - from `GetDocument` response |
| **Current Heads (deps)** | Leaf changes in DAG | Yes - `GetDocument.version` field |
| **Depth** | max(dep depths) + 1 | **No** - must be fetched |
| **Generation** | Document generation number | Partially - available in some contexts |
| **Space (account)** | Owner's public key | Yes |
| **Path** | Document path | Yes |
| **Visibility** | Public/Private | Yes |

### Critical Missing Data: Change Depth

The backend tracks each change's depth to maintain causal ordering. When creating a new change, you need:
```
depth = max(depths of all dependency changes) + 1
```

Currently, the change depth is **not exposed** in any API response. Options:

1. **Add depth to GetDocument response** - Most straightforward
2. **Create a new API endpoint** - Return depth info for given version
3. **Store depth locally** - Track depth for changes you've seen
4. **Fetch and decode change blobs** - Parse the raw CBOR to extract depth

### Existing TypeScript Foundation

The web app already has partial implementations in [api.ts](frontend/apps/web/app/api.ts):

- `createDocumentGenesisChange()` - Creates genesis change (line 399)
- `createHomeDocumentChange()` - Creates subsequent changes (line 418)
- `createRef()` - Creates ref blobs (line 452)

These take `depth` as a parameter but don't fetch it.

---

## Part 3: TypeScript Implementation Guide

### Step 1: Define Types

```typescript
import {CID} from 'multiformats'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {sha256} from 'multiformats/hashes/sha2'
import * as Block from 'multiformats/block'

// Operation types matching Go backend
type OpType = 'SetKey' | 'SetAttributes' | 'MoveBlocks' | 'ReplaceBlock' | 'DeleteBlocks'

interface OpSetAttributes {
  type: 'SetAttributes'
  block?: string  // Empty for document-level attributes
  attrs: Array<{key: string[], value: any}>
}

interface OpMoveBlocks {
  type: 'MoveBlocks'
  parent?: string  // Empty = root
  blocks: string[]
  ref?: number[]   // RGA CRDT ref ID (empty = start of list)
}

interface OpReplaceBlock {
  type: 'ReplaceBlock'
  block: {
    id: string
    type: string
    text?: string
    link?: string
    annotations?: Annotation[]
    [key: string]: any  // Other attributes inlined
  }
}

interface OpDeleteBlocks {
  type: 'DeleteBlocks'
  blocks: string[]
}

type Operation = OpSetAttributes | OpMoveBlocks | OpReplaceBlock | OpDeleteBlocks

interface ChangeBody {
  opCount: number
  ops: Operation[]
}

interface UnsignedChange {
  type: 'Change'
  signer: Uint8Array
  sig: Uint8Array
  ts: bigint  // Unix milliseconds
  genesis?: CID
  deps?: CID[]
  depth?: number
  body?: ChangeBody
}

interface UnsignedRef {
  type: 'Ref'
  signer: Uint8Array
  sig: Uint8Array
  ts: bigint
  space?: Uint8Array  // Only if different from signer
  path?: string
  genesisBlob: CID
  heads: CID[]
  generation: number
  visibility?: 'public' | 'private'
}
```

### Step 2: Fetch Required Data

```typescript
interface DocumentState {
  genesis: CID
  heads: CID[]        // Current version as array of CIDs
  headDepths: number[] // Depth of each head (NEW - needs API)
  generation: number
  space: Uint8Array
  path: string
}

async function getDocumentState(
  account: string,
  path: string
): Promise<DocumentState> {
  // Existing: Get document
  const doc = await grpcClient.getDocument({account, path})

  // Parse version string "cid1.cid2" into CID array
  const heads = doc.version.split('.').map(v => CID.parse(v))

  // TODO: Need API to get depths
  // Option A: Add to GetDocument response
  // Option B: New endpoint: GetChangeInfo({cids: heads})
  // Option C: Fetch raw blobs and decode
  const headDepths = await getChangeDepths(heads)

  return {
    genesis: CID.parse(doc.genesis),
    heads,
    headDepths,
    generation: doc.generation,
    space: base58btc.decode(account),
    path,
  }
}

// Proposed new API or workaround
async function getChangeDepths(cids: CID[]): Promise<number[]> {
  // Option A: If backend exposes depth in GetDocument
  // return doc.headDepths

  // Option B: New RPC
  // const info = await grpcClient.getChangeInfo({cids: cids.map(c => c.toString())})
  // return info.depths

  // Option C: Fetch raw blobs and decode CBOR
  return Promise.all(cids.map(async (cid) => {
    const res = await fetch(getDaemonFileUrl(cid.toString()))
    const data = await res.arrayBuffer()
    const decoded = cborDecode(new Uint8Array(data)) as {depth: number}
    return decoded.depth
  }))
}
```

### Step 3: Create Operations

```typescript
function createSetAttributeOp(
  blockId: string | null,
  key: string[],
  value: any
): OpSetAttributes {
  return {
    type: 'SetAttributes',
    block: blockId || undefined,
    attrs: [{key, value}],
  }
}

function createMoveBlockOp(
  blockId: string,
  parent: string | null,
  leftSibling: string | null
): OpMoveBlocks {
  // Note: The Go backend uses RGA CRDT ref IDs, not block IDs
  // This is a simplification - full impl needs CRDT state
  return {
    type: 'MoveBlocks',
    parent: parent || undefined,
    blocks: [blockId],
    ref: undefined, // Would need CRDT opID
  }
}

function createReplaceBlockOp(block: Block): OpReplaceBlock {
  return {
    type: 'ReplaceBlock',
    block: {
      id: block.id,
      type: block.type,
      text: block.text,
      link: block.link,
      annotations: block.annotations,
      ...block.attributes,
    },
  }
}

function createDeleteBlocksOp(blockIds: string[]): OpDeleteBlocks {
  return {
    type: 'DeleteBlocks',
    blocks: blockIds,
  }
}
```

### Step 4: Sign and Encode Change

```typescript
const cborCodec = {
  code: 0x71, // dag-cbor
  encode: (input: any) => cborEncode(input),
  name: 'DAG-CBOR',
}

async function signAndEncodeChange(
  unsignedChange: UnsignedChange,
  keyPair: CryptoKeyPair
): Promise<{cid: CID, data: Uint8Array}> {
  // 1. Fill signature with zeros (64 bytes for ECDSA/Ed25519)
  unsignedChange.sig = new Uint8Array(64)

  // 2. Encode to CBOR
  const unsignedBytes = cborEncode(unsignedChange)

  // 3. Sign the bytes
  const signature = await crypto.subtle.sign(
    {name: 'ECDSA', hash: {name: 'SHA-256'}},
    keyPair.privateKey,
    unsignedBytes
  )

  // 4. Replace zeros with actual signature
  unsignedChange.sig = new Uint8Array(signature)

  // 5. Re-encode with signature
  const block = await Block.encode({
    value: unsignedChange,
    codec: cborCodec,
    hasher: sha256,
  })

  return {
    cid: block.cid,
    data: block.bytes,
  }
}
```

### Step 5: Create Full Document Change

```typescript
async function createDocumentChange({
  state,
  operations,
  keyPair,
  visibility = 'public',
}: {
  state: DocumentState
  operations: Operation[]
  keyPair: CryptoKeyPair
  visibility?: 'public' | 'private'
}): Promise<{change: Uint8Array, ref: Uint8Array, changeCid: CID}> {
  const signerKey = await preparePublicKey(keyPair.publicKey)
  const ts = BigInt(Date.now())

  // Calculate depth from dependencies
  const depth = Math.max(...state.headDepths) + 1

  // Sort deps deterministically
  const sortedDeps = [...state.heads].sort((a, b) =>
    a.toString().localeCompare(b.toString())
  )

  // Create change blob
  const unsignedChange: UnsignedChange = {
    type: 'Change',
    signer: signerKey,
    sig: new Uint8Array(64),
    ts,
    genesis: state.genesis,
    deps: sortedDeps,
    depth,
    body: {
      opCount: operations.length,
      ops: operations,
    },
  }

  const {cid: changeCid, data: changeData} =
    await signAndEncodeChange(unsignedChange, keyPair)

  // Create ref blob pointing to new change
  const unsignedRef: UnsignedRef = {
    type: 'Ref',
    signer: signerKey,
    sig: new Uint8Array(64),
    ts,
    genesisBlob: state.genesis,
    heads: [changeCid],
    generation: state.generation,
    visibility,
    path: state.path,
  }

  // Only include space if different from signer
  if (!uint8Equals(state.space, signerKey)) {
    unsignedRef.space = state.space
  }

  const {data: refData} = await signAndEncodeChange(unsignedRef, keyPair)

  return {
    change: changeData,
    ref: refData,
    changeCid,
  }
}
```

### Step 6: Submit to Backend

```typescript
async function submitDocumentChange(
  change: Uint8Array,
  ref: Uint8Array
): Promise<void> {
  // POST blobs to daemon
  // The backend has an endpoint for receiving raw blobs
  await Promise.all([
    fetch('/hm/api/blobs', {
      method: 'POST',
      headers: {'Content-Type': 'application/cbor'},
      body: change,
    }),
    fetch('/hm/api/blobs', {
      method: 'POST',
      headers: {'Content-Type': 'application/cbor'},
      body: ref,
    }),
  ])
}
```

---

## Part 4: Tricky Parts & Challenges

### 1. CRDT State for Block Moves

**Problem:** The Go backend uses an RGA (Replicated Growable Array) CRDT for block ordering. Move operations include `ref` - an opID that indicates "insert after this position". The JS side would need to maintain CRDT state to generate correct opIDs.

**Workaround Options:**
- **Option A:** Don't support block reordering from web, only content edits
- **Option B:** Send high-level move intents, let backend resolve CRDT opIDs
- **Option C:** Implement minimal CRDT tracking client-side (complex)

**Recommendation:** Start with Option A (content-only edits) for MVP.

### 2. Compression of Move Operations

**Problem:** Go backend batches contiguous moves to reduce blob size. A sequence of moves with consecutive opIDs under same parent becomes one operation.

**Workaround:** For MVP, skip compression - generate one MoveBlocks op per move. This wastes bytes but works correctly.

### 3. Getting Change Depth

**Problem:** Depth is not exposed in current API responses.

**Solution (requires backend change):**
```protobuf
// Add to GetDocument response
message Document {
  // ... existing fields ...
  map<string, int32> head_depths = N; // CID string -> depth
}
```

Or add new RPC:
```protobuf
rpc GetChangeInfo(GetChangeInfoRequest) returns (GetChangeInfoResponse);

message GetChangeInfoRequest {
  repeated string cids = 1;
}

message GetChangeInfoResponse {
  repeated ChangeInfo changes = 1;
}

message ChangeInfo {
  string cid = 1;
  int32 depth = 2;
  int64 timestamp = 3;
}
```

### 4. Signature Format Compatibility

**Problem:** Go uses Ed25519 signing. Web Crypto API supports ECDSA but Ed25519 support varies by browser.

**Current workaround in comments:** Uses ECDSA P-256 with SHA-256, which is why the backend must support both signature schemes.

**Note:** Ensure your signing matches what the backend expects for your key type.

### 5. CBOR Encoding Compatibility

**Problem:** CBOR encoding must match exactly between JS and Go for signatures to verify.

**Key considerations:**
- Field ordering matters (Go uses `refmt` tags)
- Map key ordering must match
- Integer encoding (varint) must be consistent
- BigInt handling for timestamps
- CID encoding format

**Recommendation:** Test signature verification round-trip with backend before full implementation.

### 6. Handling Concurrent Edits

**Problem:** Multiple clients may edit simultaneously. The backend handles merge through CRDT, but web client needs to:
1. Detect version conflicts (heads changed since load)
2. Either fail with "please refresh" or implement proper merge

**Recommendation:** For MVP, fail on conflict and require user refresh.

---

## Part 5: Minimal MVP Scope

For a first implementation, support only:

1. **SetAttributes** - Update document/block attributes (title, etc.)
2. **ReplaceBlock** - Update block content (text, annotations)
3. **DeleteBlocks** - Delete blocks

Skip for MVP:
- MoveBlocks (requires CRDT state)
- Move compression
- Conflict resolution

### Required Backend Changes

1. **Expose change depth** in GetDocument response or new endpoint
2. **Add blob upload endpoint** if not exists (or use existing mechanism)
3. **Verify ECDSA signatures** if not already supported

### Estimated Complexity

| Component | Effort | Notes |
|-----------|--------|-------|
| Types & interfaces | Low | Already partially done in api.ts |
| Signing & encoding | Medium | Existing comment impl as reference |
| Fetch depth (needs backend) | Medium | New API endpoint |
| Create basic operations | Low | Straightforward |
| Submit blobs | Low | HTTP POST |
| Full CRDT moves | High | Skip for MVP |
| Compression | Medium | Skip for MVP |
| Conflict handling | High | Skip for MVP |

---

## Appendix: Blob Structure Reference

### Change Blob (CBOR)
```
{
  "type": "Change",
  "signer": <bytes>,      // Public key
  "sig": <bytes>,         // 64-byte signature
  "ts": <int64>,          // Unix milliseconds
  "genesis": <CID>,       // First change CID (omit for genesis)
  "deps": [<CID>, ...],   // Parent changes (omit for genesis)
  "depth": <int>,         // DAG depth (0 for genesis)
  "body": {
    "opCount": <int>,
    "ops": [<Op>, ...]
  }
}
```

### Ref Blob (CBOR)
```
{
  "type": "Ref",
  "signer": <bytes>,
  "sig": <bytes>,
  "ts": <int64>,
  "space": <bytes>,       // Only if != signer
  "path": <string>,
  "genesisBlob": <CID>,
  "heads": [<CID>],       // Usually single element
  "generation": <int64>,
  "visibility": "public" | "private"
}
```

### Operation Types

**SetAttributes:**
```
{"type": "SetAttributes", "block": "blockId", "attrs": [{"key": ["path"], "value": any}]}
```

**MoveBlocks:**
```
{"type": "MoveBlocks", "parent": "parentId", "blocks": ["id1", "id2"], "ref": [actor, ts, idx]}
```

**ReplaceBlock:**
```
{"type": "ReplaceBlock", "block": {"id": "...", "type": "Paragraph", "text": "...", ...}}
```

**DeleteBlocks:**
```
{"type": "DeleteBlocks", "blocks": ["id1", "id2"]}
```
