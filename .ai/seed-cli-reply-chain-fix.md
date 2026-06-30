# Fix: `seed-cli comment create --reply` fails after comment edit

## Bug summary

`seed-cli comment create <target> --reply <commentId>` fails with `"Non-base58btc character"` when the reply parent (or any ancestor in the chain) was previously edited via `seed-cli comment edit`.

## Reproduction steps

1. Post comment A on a document
2. Post comment B with `--reply A` -- works, threaded correctly
3. Edit comment B's body via `seed-cli comment edit B --body "new text"` -- creates new CID version
4. Post comment C with `--reply B` -- **fails** with `Non-base58btc character`
5. Posting C without `--reply` works but loses threading

## Root cause analysis

The bug is in the CLI's `comment create --reply` handler and in the `@seed-hypermedia/client` library's `createSignedComment` function. There are **two separate problems** in the data flow:

### Problem 1: CLI passes RecordID where CID is expected (comment.ts lines 126-135)

File: `frontend/apps/cli/src/commands/comment.ts`

```typescript
if (options.reply) {
  const parentComment = await client.request('Comment', options.reply)
  const parentVersion = parentComment.version || parentComment.id
  if (parentVersion) replyParent = parentVersion
  if (parentComment.threadRoot) {
    threadRoot = parentComment.threadRoot           // <-- BUG: RecordID format
  } else if (parentComment.version) {
    threadRoot = parentComment.version
  }
}
```

The `HMComment` type (from `hm-types.ts`) has:
- `threadRoot: string` -- a **RecordID** like `z6Mkvz9.../z6Gis...` (authority/tsid)
- `threadRootVersion: string` -- a **CID** like `bafyreig...`
- `replyParent: string` -- a **RecordID**
- `replyParentVersion: string` -- a **CID**

The CLI uses `parentComment.threadRoot` (RecordID) as `rootReplyCommentVersion`, but the downstream code calls `CID.parse()` on it. RecordIDs contain a `/` separator which is not a valid base58btc character, causing the error.

**For a first-level reply** (no threadRoot on the parent), the code falls to `threadRoot = parentComment.version` which IS a CID, so it works. That is why replies to unedited root comments succeed.

**For deeper replies** (where the parent has a threadRoot), the code uses the RecordID format and `CID.parse()` fails.

The edit operation does not change the RecordID or threadRoot of a comment -- it only creates a new version blob with the same TSID. So the real reason editing triggers the bug is likely that the KM agent's two-pass flow (post placeholder -> edit with final answer) creates a scenario where subsequent replies to the edited comment hit the **deeper reply path** (the parent now has threadRoot set because it was itself a reply).

### Problem 2: CID.parse() in createSignedComment (comment.ts lines 306-307)

File: `frontend/packages/client/src/comment.ts`

```typescript
async function createSignedComment(comment: UnsignedComment, signer: HMSigner): Promise<SignedComment> {
  const commentForSigning = {
    ...comment,
    version: comment.version.split('.').map((v) => CID.parse(v)),
  } as SignedComment
  if (comment.threadRoot) commentForSigning.threadRoot = CID.parse(comment.threadRoot)
  if (comment.replyParent) commentForSigning.replyParent = CID.parse(comment.replyParent)
  // ...
}
```

`CID.parse()` is called on the `threadRoot` and `replyParent` strings. If these are RecordIDs instead of CID strings, the parse fails with the base58btc error.

The same issue exists in `updateComment` (lines 495-496):
```typescript
if (input.replyParentVersion) comment.replyParent = CID.parse(input.replyParentVersion)
if (input.rootReplyCommentVersion) comment.threadRoot = CID.parse(input.rootReplyCommentVersion)
```

## How the server works (for reference)

### Comment data model (Go)

File: `backend/blob/blob_comment.go`

```go
type Comment struct {
    BaseBlob
    ID           TSID           `refmt:"id,omitempty"`
    Space_       core.Principal `refmt:"space,omitempty"`
    Path         string         `refmt:"path,omitempty"`
    Version      []cid.Cid      `refmt:"version,omitempty"`
    ThreadRoot   cid.Cid        `refmt:"threadRoot,omitempty"`
    ReplyParent_ cid.Cid        `refmt:"replyParent,omitempty"`
    Body         []CommentBlock `refmt:"body"`
    Visibility   Visibility     `refmt:"visibility,omitempty"`
}
```

### Comment proto response (Go)

File: `backend/api/documents/v3alpha/comments.go`, function `commentToProto`:

```go
pb := &documents.Comment{
    Id:            blob.RecordID{Authority: cmt.Signer, TSID: tsid}.String(),  // RecordID
    Version:       c.String(),                                                  // CID (base32 encoded)
    // ...
}

if cmt.ThreadRoot.Defined() {
    ridRoot, _ := lookup.RecordID(cmt.ThreadRoot)
    ridParent, _ := lookup.RecordID(cmt.ReplyParent())

    pb.ThreadRoot = ridRoot.String()                    // RecordID format
    pb.ThreadRootVersion = cmt.ThreadRoot.String()      // CID format
    pb.ReplyParent = ridParent.String()                 // RecordID format
    pb.ReplyParentVersion = cmt.ReplyParent().String()  // CID format
}
```

Key insight: The server returns BOTH formats -- RecordID (`threadRoot`, `replyParent`) and CID (`threadRootVersion`, `replyParentVersion`). The CLI must use the `*Version` fields (CID) for blob construction, not the RecordID fields.

### CreateComment server handler (Go)

File: `backend/api/documents/v3alpha/comments.go`, function `CreateComment`:

```go
if in.ReplyParent != "" {
    rpComment, err := srv.getComment(conn, in.ReplyParent)   // Accepts RecordID or CID
    replyParent = rpComment.CID                              // Uses the BLOB CID
    threadRoot = rpComment.Comment.ThreadRoot                 // Uses the CBOR CID field
    if !threadRoot.Defined() {
        threadRoot = replyParent
    }
}
```

The server's `getComment` resolves comments by RecordID (looking up by authority + TSID, returning the latest version). The server uses the internal CID from the blob, NOT the string IDs.

### Comment edits and version chains

When a comment is edited:
- A new blob is created with the SAME TSID but different CID
- The `qGetCommentByID` query returns the latest version (`ORDER BY sb.ts DESC LIMIT 1`)
- The `version` field in the response changes to the new blob's CID
- The `id` (RecordID) stays the same
- Threading fields (threadRoot, replyParent) stay the same (they reference the original blobs)

## The fix

### Fix 1: CLI `comment create` handler

File: `frontend/apps/cli/src/commands/comment.ts`

Change lines 123-135 from:

```typescript
let replyParent: string | undefined
let threadRoot: string | undefined

if (options.reply) {
  const parentComment = await client.request('Comment', options.reply)
  const parentVersion = parentComment.version || parentComment.id
  if (parentVersion) replyParent = parentVersion
  if (parentComment.threadRoot) {
    threadRoot = parentComment.threadRoot
  } else if (parentComment.version) {
    threadRoot = parentComment.version
  }
}
```

To:

```typescript
let replyParent: string | undefined
let threadRoot: string | undefined

if (options.reply) {
  const parentComment = await client.request('Comment', options.reply)
  // Use the CID version fields, not the RecordID fields.
  // version = CID of the comment blob
  // threadRootVersion = CID of the thread root blob (if this is a reply)
  // replyParentVersion = CID of the reply parent blob (if this is a nested reply)
  const parentVersion = parentComment.version || parentComment.id
  if (parentVersion) replyParent = parentVersion
  if (parentComment.threadRootVersion) {
    threadRoot = parentComment.threadRootVersion     // <-- Use CID, not RecordID
  } else if (parentComment.version) {
    threadRoot = parentComment.version
  }
}
```

The key change: `parentComment.threadRoot` -> `parentComment.threadRootVersion`

### Fix 2: Consider also fixing `replyParent` in the CLI `comment edit` handler

File: `frontend/apps/cli/src/commands/comment.ts`, lines 198-213

The `edit` command already uses `existing.replyParentVersion` and `existing.threadRootVersion` correctly (lines 207-208). Verify this path is correct -- it appears to be.

## Files to modify

1. **`frontend/apps/cli/src/commands/comment.ts`** -- Primary fix: use `threadRootVersion` instead of `threadRoot` in the `create --reply` handler
2. **`frontend/packages/client/__tests__/comment.test.ts`** -- Add test for `createComment` with reply CID versions
3. **`frontend/apps/cli/src/test/cli.test.ts`** or **`frontend/apps/cli/src/test/cli-fixture.test.ts`** -- Add integration test for reply-after-edit scenario

## Files to read (for context)

All paths relative to the seed repo root (`/Users/horacioh/seed-hypermedia/seed`).

| File | What to look at |
|------|-----------------|
| `frontend/apps/cli/src/commands/comment.ts` | CLI command handlers (create, edit, delete) |
| `frontend/packages/client/src/comment.ts` | `createComment`, `createSignedComment`, `updateComment`, `CID.parse()` calls |
| `frontend/packages/client/src/hm-types.ts` | `HMCommentSchema` -- the `threadRoot` vs `threadRootVersion` fields |
| `backend/api/documents/v3alpha/comments.go` | Server handler: `CreateComment`, `getComment`, `commentToProto` |
| `backend/blob/blob_comment.go` | `Comment` struct, `NewComment`, `ReplyParent()` fallback logic |
| `backend/blob/index.go` | `RecordID` type, `DecodeRecordID`, `LookupCache.RecordID` |
| `backend/blob/tsid.go` | `TSID` type, base58btc encoding |
| `backend/core/principal.go` | `Principal.String()` (base58btc encoding), `DecodePrincipal` |

## Test plan

### Unit test for the CLI fix

Add to `frontend/packages/client/__tests__/comment.test.ts`:

```typescript
it('creates a reply comment with threadRoot and replyParent CIDs', async () => {
  const signer = makeSigner()
  // These should be valid CID strings, not RecordIDs
  const threadRootCID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
  const replyParentCID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
  
  const publishInput = await createComment(
    {
      content: makeBlocks('reply text'),
      docId: TEST_DOC_ID,
      docVersion: threadRootCID,
      blobs: [],
      replyCommentVersion: replyParentCID,
      rootReplyCommentVersion: threadRootCID,
    },
    signer,
  )

  const decoded = cborDecode(publishInput.blobs[0]!.data) as any
  expect(decoded.threadRoot).toBeDefined()
  expect(decoded.replyParent).toBeUndefined() // Same as threadRoot, so omitted
})
```

### Manual regression test

1. Start a local seed daemon
2. Create a document
3. Post comment A on the document
4. Post comment B with `--reply A`
5. Edit comment B: `seed-cli comment edit B --body "edited text"`
6. Post comment C with `--reply B` -- should succeed (currently fails)
7. Verify comment C has correct `replyParent` and `threadRoot`
8. Post comment D with `--reply A` (non-edited chain) -- should still work

## Impact on KM agent

Once this fix lands in the seed repo, the KM agent workaround (skipping placeholders for thread-reply triggered comments) can be removed, restoring the two-pass UX (immediate "Working on this..." placeholder followed by the real answer).

The workaround is in the seed-km repo at:
- `seed-knowledge-manager/agent/mcp/seed-cli-mcp/src/machines/poll-driver.ts` -- placeholder posting logic
- `seed-knowledge-manager/agent/mcp/seed-cli-mcp/src/tools.ts` -- `seed_reply_comment` tool (line 325)

## CID encoding note

The Go `go-cid` library (v0.6.0) encodes CIDv1 as **base32lower** by default (strings starting with `b`). The JavaScript `multiformats` CID library handles multiple multibase encodings via `CID.parse()`, so base32 CIDs from the server parse correctly. The error only occurs when a non-CID string (RecordID with `/` separator) is passed to `CID.parse()`.

## Run these commands after the fix

```bash
# From the seed repo root:

# TypeCheck
pnpm typecheck

# Client package tests
pnpm --filter @seed-hypermedia/client test

# CLI tests
pnpm --filter @shm/cli test

# Full test suite
pnpm test
```
