# Plan: Adding Reactions to the Seed Hypermedia System

## Overview

Reactions (emojis, upvotes, etc.) will be added as a new signed blob type, mirroring the existing comment pattern. Reactions support four target types: documents, comments, blocks, and block-level text fragments.

---

## 1. Design Decisions

### Storage Model: Individual Signed Blobs

Each reaction action is its own content-addressed signed blob. This follows the same pattern as comments and gives verifiability, p2p sync, and consistent tooling.

- **Add** = create a new `Reaction` blob (signed by the user)
- **Remove** = create a tombstone `Reaction` blob with the same TSID (empty emoji + `deleted` flag in extra_attrs, same as comment deletion)

### Target Granularity: Four Levels

A reaction can target any of these:

| Target Type | Identifier |
|---|---|
| Document | `account` + `path` |
| Comment | comment TSID |
| Block | `account` + `path` + `block_id` |
| Block fragment | `account` + `path` + `block_id` + `start` + `end` offsets |

### Emoji Model: Free-Form

Any Unicode emoji codepoint is valid. No predefined set.

### Mutations: Explicit Add/Remove

Separate `AddReaction` and `RemoveReaction` RPCs. A user can have multiple distinct emoji reactions on the same target (e.g. both 👍 and ❤️ on the same comment).

### Visibility: Inherited from Target

Same as comments — reactions on a private document are visible only to the document owner and their writers (via `blob_visibility` propagation).

### Aggregation: In ActivitySummary

Reaction counts per document/space will be tracked alongside comment counts in `ActivitySummary`, `document_generations`, and `spaces` tables.

### Resource Union

Reaction will be added to the `Resource` union in `resources.proto`, alongside `Document`, `Comment`, and `Contact`.

---

## 2. Proto Definitions

### 2a. New File: `proto/documents/v3alpha/reactions.proto`

```protobuf
syntax = "proto3";
package com.seed.documents.v3alpha;

import "google/protobuf/empty.proto";
import "google/protobuf/timestamp.proto";

option go_package = "seed/backend/genproto/documents/v3alpha;documents";

service Reactions {
  rpc AddReaction(AddReactionRequest) returns (Reaction);
  rpc RemoveReaction(RemoveReactionRequest) returns (google.protobuf.Empty);
  rpc ListReactions(ListReactionsRequest) returns (ListReactionsResponse);
  rpc GetReactionAggregates(GetReactionAggregatesRequest) returns (GetReactionAggregatesResponse);
}

message Reaction {
  string id = 1;
  string author = 2;
  string emoji = 3;
  oneof target {
    DocumentTarget document_target = 4;
    CommentTarget comment_target = 5;
    BlockTarget block_target = 6;
    BlockFragmentTarget block_fragment_target = 7;
  }
  string target_version = 8;
  google.protobuf.Timestamp create_time = 9;
  string version = 10;
  string visibility = 11;
}

message DocumentTarget {
  string account = 1;
  string path = 2;
}

message CommentTarget {
  string comment_id = 1;
}

message BlockTarget {
  string account = 1;
  string path = 2;
  string block_id = 3;
}

message BlockFragmentTarget {
  string account = 1;
  string path = 2;
  string block_id = 3;
  int32 start = 4;
  int32 end = 5;
}

message AddReactionRequest {
  string target_account = 1;
  string target_path = 2;
  string target_comment_id = 3;
  string target_block_id = 4;
  optional int32 target_fragment_start = 5;
  optional int32 target_fragment_end = 6;
  string emoji = 10;
  string target_version = 11;
  string signing_key_name = 12;
  string capability = 13;
}

message RemoveReactionRequest {
  string id = 1;
  string signing_key_name = 2;
}

message ListReactionsRequest {
  string target_account = 1;
  string target_path = 2;
  optional string target_comment_id = 3;
  optional string target_block_id = 4;
  optional int32 target_fragment_start = 5;
  optional int32 target_fragment_end = 6;
  int32 page_size = 10;
  string page_token = 11;
}

message ListReactionsResponse {
  repeated Reaction reactions = 1;
  string next_page_token = 2;
  map<string, int32> emoji_counts = 3;
}

message GetReactionAggregatesRequest {
  string target_account = 1;
  string target_path = 2;
  optional string target_comment_id = 3;
  optional string target_block_id = 4;
  optional int32 target_fragment_start = 5;
  optional int32 target_fragment_end = 6;
}

message GetReactionAggregatesResponse {
  map<string, int32> emoji_counts = 1;
  int32 total_reactions = 2;
}
```

### 2b. Modify `proto/documents/v3alpha/documents.proto`

Add two fields to `ActivitySummary` (after `is_unread`):

```protobuf
int32 reaction_count = 6;
google.protobuf.Timestamp latest_reaction_time = 7;
```

### 2c. Modify `proto/documents/v3alpha/resources.proto`

Add to the `Resource.oneof kind` (using field number 5, since 4 is taken by `version`):

```protobuf
Reaction reaction = 5;
```

Add the import:
```protobuf
import "documents/v3alpha/reactions.proto";
```

---

## 3. Backend Domain Model

### 3a. New File: `backend/blob/blob_reaction.go`

```go
const TypeReaction Type = "Reaction"

type ReactionTargetType string
const (
    ReactionTargetDocument ReactionTargetType = "document"
    ReactionTargetComment  ReactionTargetType = "comment"
    ReactionTargetBlock    ReactionTargetType = "block"
    ReactionTargetFragment ReactionTargetType = "fragment"
)

type ReactionTarget struct {
    Type          ReactionTargetType
    Account       string
    Path          string
    CommentID     string
    BlockID       string
    FragmentStart int32
    FragmentEnd   int32
}

type Reaction struct {
    BaseBlob
    ID         TSID
    Space_     core.Principal  // only set when signer != space owner
    Path       string
    Version    []cid.Cid       // target document version at reaction time
    Emoji      string
    Target     ReactionTarget
    Visibility Visibility
}
```

Key methods:
- `NewReaction(kp, id, space, path, version, emoji, target, visibility, ts) (*EncodedReaction, error)` — signs and encodes
- `TSID() TSID` — implements `ReplacementBlob`
- `Space() core.Principal` — convenience for when `Space_` is empty

**CBOR Registration:** Register `Reaction{}` and `ReactionTarget{}` types via `cbornode.RegisterCborType`.

**Decoder:** Follow the same pattern as comments — validate signature against raw map first, then decode into `Reaction` struct.

### 3b. Indexer Logic (`indexReaction`)

1. Parse target IRI from space + path
2. Detect tombstones: `isTombstone := v.Emoji == ""`
3. Build `structuralBlob` with:
   - `Type: TypeReaction`
   - `ExtraAttrs`: `{emoji, tsid, target_type, target_comment_id?, target_block_id?, target_fragment_start?, target_fragment_end?, visibility?, deleted?}`
4. Set visibility spaces for private reactions (signer + target space)
5. Link to document resource via `resource_links` (type: `"reaction/target"`)
6. Call `ictx.SaveBlob(sb)`
7. Update reaction stats using pattern from comments:
   - Compute `reactionCountDelta()` (same logic as `commentCountDelta`)
   - For each matching `documentGeneration`: update `LastReaction`, `LastReactionTime`, `ReactionCount`
   - Update `spaceReactionStats` on the `spaces` table
8. No FTS indexing needed (reactions aren't searchable text)

### 3c. `reactionCountDelta` Function

Same logic as `commentCountDelta` in `blob_comment.go`:
- New TSID → +1
- Same TSID (edit) → 0
- First tombstone for live TSID → -1
- Live after tombstone (out-of-order P2P) → +1

Query uses `extra_attrs->>'tsid'` and `extra_attrs->>'deleted'` on `structural_blobs WHERE type = 'Reaction'`.

### 3d. `spaceReactionStats` Struct

Mirrors `spaceCommentStats`:
```go
type spaceReactionStats struct {
    shouldUpdate     bool
    ID               string
    LastReaction     int64
    LastReactionTime int64
    ReactionCount    int64
}
```

With `load()` and `save()` methods using `qLoadSpaceReactionStats`, `qInsertSpaceReactionStats`, `qUpdateSpaceReactionStats`.

### 3e. Registration in `blob_reaction.go` (init)

```go
func init() {
    matcher := makeCBORTypeMatch(TypeReaction)
    registerIndexer(TypeReaction, decodeFunc, indexReaction)
}
```

---

## 4. Schema Changes

### 4a. `backend/storage/schema.sql`

**`spaces` table** — add after `comment_count`:
```sql
last_reaction INTEGER REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE,
last_reaction_time INTEGER NOT NULL DEFAULT (0),
reaction_count INTEGER NOT NULL DEFAULT (0),
```

**`document_generations` table** — add after `comment_count`:
```sql
last_reaction INTEGER REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE,
last_reaction_time INTEGER NOT NULL DEFAULT (0),
reaction_count INTEGER NOT NULL DEFAULT (0),
```

**New indexes** (foreign key requirement):
```sql
CREATE INDEX spaces_by_last_reaction ON spaces (last_reaction) WHERE last_reaction IS NOT NULL;
CREATE INDEX document_generations_by_last_reaction ON document_generations (last_reaction) WHERE last_reaction IS NOT NULL;
```

### 4b. `backend/storage/storage_migrations.go`

New migration (added at top of descending list):
```go
{Version: "2026-05-14.000000", Run: func(_ *Store, conn *sqlite.Conn) error {
    return sqlitex.ExecScript(conn, sqlfmt(`
        ALTER TABLE document_generations ADD COLUMN last_reaction INTEGER REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE;
        ALTER TABLE document_generations ADD COLUMN last_reaction_time INTEGER NOT NULL DEFAULT (0);
        ALTER TABLE document_generations ADD COLUMN reaction_count INTEGER NOT NULL DEFAULT (0);

        ALTER TABLE spaces ADD COLUMN last_reaction INTEGER REFERENCES blobs (id) ON UPDATE CASCADE ON DELETE CASCADE;
        ALTER TABLE spaces ADD COLUMN last_reaction_time INTEGER NOT NULL DEFAULT (0);
        ALTER TABLE spaces ADD COLUMN reaction_count INTEGER NOT NULL DEFAULT (0);

        CREATE INDEX IF NOT EXISTS document_generations_by_last_reaction ON document_generations (last_reaction) WHERE last_reaction IS NOT NULL;
        CREATE INDEX IF NOT EXISTS spaces_by_last_reaction ON spaces (last_reaction) WHERE last_reaction IS NOT NULL;
    `))
}},
```

### 4c. `backend/storage/schema.gen.go`

Auto-regenerated by `./dev gen //backend/...`. Will get new column constants for the six new columns.

---

## 5. Modify `backend/blob/blob_ref.go` — documentGeneration Fields

Add three new fields to the `documentGeneration` struct:
```go
LastReaction     int64
LastReactionTime int64
ReactionCount    int64
```

**Update `fromRow()`:** Read new columns after `CommentCount`.

**Update `save()`:** Write reaction columns in the `sqlitex.Exec` call with `lastReaction` (nullable via `maybe.Value`), `dg.LastReactionTime`, `dg.ReactionCount`.

**Update SQL queries** to include the three new columns:
- `qLoadDocumentGeneration`
- `qLoadGenerationsForResource`
- `qInsertDocumentGeneration` (add columns + values)
- `qUpdateDocumentGeneration` (add SET clauses, renumber params after 6)

---

## 6. Backend API Layer

### 6a. New File: `backend/api/documents/v3alpha/reactions.go`

**`AddReaction`** (follows `CreateComment` pattern):
1. Validate signing key, emoji, target version
2. Parse target type from request fields (document / comment / block / fragment)
3. Get document visibility from target
4. Call `blob.NewReaction(kp, "", space, path, versionHeads, emoji, target, visibility, ts)`
5. Call `srv.idx.Put(ctx, eb)`
6. Return proto via `reactionToProto()`

**`RemoveReaction`** (follows `DeleteComment` pattern):
1. Decode reaction record ID
2. Verify signing key matches reaction author
3. Load original reaction to get target info
4. Create tombstone: `NewReaction(kp, rid.TSID, space, path, version, "", originalTarget, visibility, ts)`
5. Store and index

**`ListReactions`**:
1. Query `structural_blobs WHERE type = 'Reaction'` for the target IRI
2. Use `ROW_NUMBER() OVER (PARTITION BY tsid ORDER BY ts DESC)` to dedupe versions
3. Filter out deleted reactions
4. Restrict visibility if `cfg.PublicOnly`
5. Aggregate emoji counts in-app

**`GetReactionAggregates`**:
1. SQL: `SELECT emoji, COUNT(*) FROM (...) WHERE rn = 1 AND deleted IS NULL GROUP BY emoji ORDER BY cnt DESC`
2. Return emoji→count map + total

**DB mapper** (`reactionDBMapper`): Same pattern as `commentDBMapper` — decompress blob data, decode CBOR into `*blob.Reaction`.

**SQL queries:**
- `qIterReactions` / `qIterReactionsPublicOnly` — list reactions for a resource
- `qGetReactionByTSID` — lookup by author + TSID
- `qGetReactionByCID` — lookup by CID
- `qReactionAggregates` / `qReactionAggregatesPublicOnly` — GROUP BY emoji counts

### 6b. Modify `backend/api/documents/v3alpha/documents.go`

**Register ReactionsServer:**
```go
documents.RegisterReactionsServer(rpc, srv)
```

**Update `baseAccountQuery()`** — add to SELECT:
```
"spaces.last_reaction",
"spaces.last_reaction_time",
"spaces.reaction_count",
```

**Update `accountFromRow()`** — read new columns and populate:
```go
ActivitySummary: &documents.ActivitySummary{
    ...
    ReactionCount:      int32(reactionCount),
    LatestReactionTime: latestReactionTime,
}
```

**Update `baseListDocumentsQuery()`** — add to SELECT:
```
"dg.last_reaction",
"dg.last_reaction_time",
"dg.reaction_count",
```

**Update `documentInfoFromRow()`** — read new columns and populate ActivitySummary similarly.

**Note:** Only `reaction_count` and `latest_reaction_time` are in `ActivitySummary`. There is no `latest_reaction_id` field in the proto summary (unlike comments which have `latest_comment_id`). This keeps the reaction aggregation more lightweight.

---

## 7. Change Summary (Files Touched)

| File | Action | Purpose |
|---|---|---|
| `proto/documents/v3alpha/reactions.proto` | **New** | Reaction service + message definitions |
| `proto/documents/v3alpha/documents.proto` | Modify | Add fields to `ActivitySummary` |
| `proto/documents/v3alpha/resources.proto` | Modify | Add `Reaction` to `Resource` union |
| `backend/blob/blob_reaction.go` | **New** | Domain model, constructor, indexer, stats |
| `backend/blob/blob_ref.go` | Modify | Add reaction fields to `documentGeneration` |
| `backend/storage/schema.sql` | Modify | Add 6 columns + 2 indexes to 2 tables |
| `backend/storage/storage_migrations.go` | Modify | Migration for new columns |
| `backend/storage/schema.gen.go` | Auto-gen | Regenerated by `./dev gen` |
| `backend/api/documents/v3alpha/reactions.go` | **New** | gRPC handlers + SQL queries |
| `backend/api/documents/v3alpha/documents.go` | Modify | Register server, ActivitySummary reads |

---

## 8. Testing Strategy

- **Unit tests**: `NewReaction()` encoding/decoding, tombstone detection, target serialization, `reactionCountDelta` edge cases
- **Integration tests**: Add + List + Remove cycle, verifying count toggles correctly
- **Schema tests**: Verify new columns exist via `schema_test.go`
- **API tests**: Following existing comment test patterns

---

## 9. Open Question

For **block fragment targets** (text selections within a block):

- **Raw offsets** (`start`, `end` ints): Simpler to implement, but fragile — if the block text changes, the offsets may no longer be meaningful.
- **Annotation reference** (reference an existing `Annotation` on the block): More stable, but requires the annotation to exist first.

The plan above uses raw offsets. This should be confirmed before implementation.
