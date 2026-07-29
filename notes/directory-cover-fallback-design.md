# Directory-page cover-image N+1 — indexer-side fix

**Status:** IMPLEMENTED on `perf/directory-cover-fallback` (2026-07-13). Option B, M3 (no gate). Backend fully tested (unit + end-to-end via ListDirectory); frontend edits done (typecheck pending worktree `pnpm install`). See "Implementation" at the bottom.
**Branch/worktree:** `perf/directory-cover-fallback` @ `Seed-worktrees/perf-directory-cover-fallback`
**Goal:** kill the `/projects` N+1 without losing the fallback-cover feature, and without hacks.

---

## 1. The problem, precisely

Directory pages fire one `/api/Resource` per child card — 143 of them on `/projects` (153 children) — pushing FCP to **2.57 s**. The cards already have everything they render (name, icon, author, version, activity counts) from the batched `QueryBlock` payload. The **only** missing field is the *fallback cover image*: when a child has no explicit `cover` and no `icon`, the card fetches the child's **entire document** to pull the first image block out of its content.

The trigger is one guard in `packages/ui/src/newspaper.tsx:273`:

```ts
const needsContentFetch = !explicitCover && !explicitIcon && !entity?.document?.content?.length
const lazyResource = useResource(needsContentFetch ? docId : null, {enabled: needsContentFetch})
```

`DocumentCardGrid` passes `entity={null}`, so this collapses to `!explicitCover && !explicitIcon` — and `ListDirectory` returns `DocumentInfo` (metadata only, **no content**), so 143 cards each fetch a whole document for one derived URL.

**Eric's proposal (correct instinct):** have the indexer derive the first-image URL once and store it in a reserved metadata field (e.g. `_firstImageInContent`) so it ships as fast metadata alongside the title. This document works out how to do that cleanly given the real architecture.

---

## 2. What the architecture gives us for free

Three findings make the transport trivial and one finding makes the *derivation* the only real decision.

**a. Metadata is a free-form `Struct` end-to-end — no proto change needed.**
- `DocumentInfo.metadata` and `Document.metadata` are both `google.protobuf.Struct` (`proto/documents/v3alpha/documents.proto:677`, `:769`). There is no fixed `DocumentMetadata` message — `title`/`icon`/`cover` are just conventional keys.
- Backend stores metadata as a flat CRDT key/value map (`DocIndexedAttrs`, `blob_ref.go:778`), serialized to JSON in `document_generations.metadata`, and `ListDirectory` reserializes it to a `Struct` via `documentInfoFromRow` (`documents.go:1185→1304`). A new key rides through untouched.
- Client conversion is a pass-through: `prepareHMDocumentMetadata` (`entity.ts:50`) just calls `metadata.toJson(...)`.

**b. There is a reserved-key precedent.** `PublicMap` (`blob_ref.go:819`) strips any key prefixed `$db.` before it reaches clients (`$db.visibility`, `$db.redirect` at `blob_ref.go:434,437`). So:
- internal/private computed keys use `$db.*`;
- **a key that must reach the client must NOT use `$db.`** → use `_firstImageInContent`.

**c. There is a reindex/backfill mechanism.** `Index.Reindex` / `MaybeReindex` (`backend/blob/reindex.go:62,175`) reprocesses all blobs; bumping the reindex version backfills a new derived field across existing documents. This is the idiomatic way derived index data rolls out here — which is exactly why derived data belongs in the **index**, not authored into the change log.

**d. The one real constraint — reading order is not cheaply available at index time.**
- The indexer (`blob_change.go:354 indexChange`) processes ops **per change**: `OpReplaceBlock` (`:491`) hands us `blk.Type` + `blk.Link` (image URL), and `OpMoveBlocks` (`:505`) hands us ordering refs. But a single change never carries the *resolved document order* — that's a CRDT merge across all changes.
- The fully-ordered block tree is assembled only in the **load path**: `docmodel.Hydrate` (`docmodel.go:547`) walks `dm.crdt.tree.State().DFT(...)` (`crdt_block_tree.go:191`).
- **Layering blocker:** `docmodel` imports `blob` (`docmodel/crdt.go:11`), so `blob` **cannot** import `docmodel` — no reusing `Hydrate` from the indexer.
- The generation-build path (`blob_ref.go:410 ensureChangeApplied`) only merges metadata attrs; it does **not** assemble a block tree. Setting `$db.visibility` there (`:437`) is the precedent for "compute a derived field during generation save," but that field needs no block content.
- The low-level tree CRDT `backend/crdt/tree.go` (`Tree`, `Integrate`, `Iterator`) **is** below `blob` and importable — so reading-order is *reachable* from the indexer, at the cost of replaying move ops into a tree ourselves.

So the transport, the naming convention, and the backfill are all solved. The only decision is **how faithfully we derive "first image" at index time.**

---

## 2b. Correction after deeper investigation — how to reach reading-order

The v1 doc assumed reading-order could be recomputed in the indexer by replaying moves into `backend/crdt/tree.go`. **That was wrong in a way that matters:** docmodel does *not* use `backend/crdt/tree.go`. Its block ordering is its own move-CRDT (`docmodel/crdt_block_tree.go` — `treeOpSet`, `moveRecord`, `isAncestor`, btree-backed). Re-implementing that in `blob` would risk subtle divergence from what users actually see — exactly the hack we're avoiding.

The clean path came from two facts:
- **docmodel builds purely in-memory from raw change bytes.** `loadDocument` (`documents.go:1752`) is just `docmodel.New(iri, clock)` + a loop of `doc.ApplyChange(ch.CID, ch.Data)` (`:1776`). No DB access inside the model — it's fed change blobs.
- **`blob` cannot import `docmodel` (cycle), but a function value crosses the boundary fine.**

So: **inject a deriver.** `blob` gathers the change bytes at the generation's heads and calls an injected `func(...) (firstImage string, err error)` that `documents` implements using the real docmodel. Zero CRDT duplication, zero import cycle, zero change-log pollution. This is Option B, done correctly.

**The one sharp edge — DB conn during indexing.** `IterChanges` (`index.go:464`) acquires its *own* `ReadConn` from the pool. Generation build runs inside `indexBlob`'s savepoint on a *write* conn (`index.go:160`, `sqlitex.Save`). In WAL a fresh read conn won't see writes still uncommitted in that transaction — and in a batched `PutMany` the referenced changes may be in the same outer txn. **Therefore the deriver must read change bytes via the *indexing conn*, not a fresh pool conn.** Implementation implication: add a conn-scoped change-gathering helper in `blob` (the `IterChanges` body already uses conn-level primitives — `cidsToDBIDs`, `dbBlobsGetGenesis`, `NewLookupCache` — so a `conn`-based variant is a small refactor), gather raw bytes, hand them to the pure in-memory deriver.

**Cost — the one real tradeoff, needs a call.** `crossLinkRefMaybe` (`blob_ref.go:270`) has per-change *metadata* only. Building the docmodel to get reading order means loading **all** change bytes at heads and replaying them — essentially a `Hydrate` — on the **index/write path**, once per Ref indexed on a cover-less doc. This is precisely the superlinear op the hydrate-cache commit moved *off* the read path ("dominates read-path CPU"). The `hydrateCache` does not help (keyed `iri@version`, read-path only). It only runs for docs with no explicit cover/icon, and only on write — but a hot, long-history, cover-less doc would pay it on every update.

Mitigations, cheapest first:
- **(M1) Image gate (recommended, cheap).** In `blob_change.go` `OpReplaceBlock` (`:491`) we already see every image block. Stash a per-structural-blob flag (e.g. `hasImage`) when a change carries an image. At generation build, **only** run the deriver if some change in the generation had an image — skipping the tree build entirely for the common image-less doc. Reduces the cost to "docs that actually have images *and* no explicit cover/icon."
- **(M2) Async derive.** Compute first-image *after* the index txn (a small post-index job) and upsert into `document_generations.metadata`, so the write path never blocks on hydrate. More moving parts; a follow-up if M1 proves insufficient.
- **(M3) Accept it.** One hydrate-equivalent per write is comparable to one uncached read; writes are much rarer. Simplest, but exposes pathological large-history docs to a per-write spike.

Recommendation: **M1 + M3** — gate on `hasImage`, otherwise accept the cost. Revisit M2 only if profiling shows a hot cover-less-but-image-bearing doc.

**DECISION (Eric, 2026-07-13):** keep it simple — index time is not a hot path vs. reading. Going with **M3 (just accept it)**, no `hasImage` gate. Derive at generation build whenever there's no explicit cover/icon.

---

## 3. Options for the derivation

| | Where | Order fidelity | Backfill | Effort | Notes |
|---|---|---|---|---|---|
| **A. First image *anywhere*** | `blob_change.go` per-change, merged CRDT | approximate (change/causal order, not reading order) | ✅ reindex | low | May pick an image that isn't the visually-first block on heavily-edited docs |
| **B. First image in *reading order*** | `blob_ref.go` generation build, replay moves into `crdt.Tree` + DFT | ✅ exact | ✅ reindex | medium | Reuses `backend/crdt/tree.go`; a mini-hydrate at index time |
| **C. Author at write time** | `docmodel` write path, store as change attr | ✅ exact | ❌ no auto-backfill; bakes derived data into immutable log | medium | Rejected — wrong layer for derived data; poor backfill; log-hygiene smell |
| **Interim.** IntersectionObserver on the card | client only | n/a (still fetches, just lazily) | n/a | tiny | Stopgap from the original audit; ship today, not the real fix |

**Recommendation: B**, with A as an explicit de-risking fallback.

Why B over A: the current feature is *first image in reading order* (`findFirstBlock` DFT over hydrated content, `content.ts:382,393`). A's change-order approximation diverges from reading order on any doc whose images were added out of top-to-bottom order — subtle, hard to explain, and exactly the "hack" we're trying to avoid. B reproduces the existing behavior exactly, once per generation, reusing a package the indexer can already import. The cost is bounded: we assemble the move-tree for the resource and DFT only until the first image block (short-circuit), and only when there's no explicit `cover`/`icon` to derive for.

Why not C: derived data authored into the immutable change log can't be re-derived if the rule changes, and existing docs never get it without re-saving. Reindex-backfilled index fields are the idiomatic home for this.

**Open question for review:** if B's index-time tree replay is judged too heavy, A is a one-file change and "first image anywhere" may be perfectly acceptable for a *fallback thumbnail*. This is the main call I want your read on before implementing.

---

## 4. Recommended implementation (Option B)

### Backend (injected-deriver design)

1. **Deriver hook on `blob.Index`.** Add a nil-safe function field, e.g.
   `FirstContentImage func(iri IRI, changes []ChangeRecord) (string, error)`, plus a setter. Nil = feature off (safe default; e.g. tests).

2. **docmodel: a lightweight first-image walk.** Add `func (dm *Document) FirstContentImage() string` that walks `treeState.DFT("")` (same traversal `Hydrate` uses, `docmodel.go:639`) and returns the `link` of the first block whose type is an image — short-circuiting, no full proto materialization.

3. **Implement the deriver in `documents`.** A method that does `docmodel.New(iri, clock)` + `ApplyChange` over the passed `changes` (mirrors `loadDocument` but fed bytes, no DB) → `doc.FirstContentImage()`. Wire it at daemon startup: `idx.SetFirstContentImage(srv.deriveFirstContentImage)`.

4. **Call it at generation build.** In `blob_ref.go`, after the `ensureChangeApplied` loop (`:410-412`) and before `dg.save` (`:445`), when `dg.Metadata` has no explicit `cover`/`icon` and the hook is set: gather the change bytes at `dg.Heads` **using the indexing conn** (conn-scoped variant of `IterChanges`), call the hook, and `dg.Metadata.set("_firstImageInContent", link, refTime)` (mirrors `$db.visibility` at `:437`; public key, no `$db.` prefix, so `PublicMap` keeps it). Empty result ⇒ don't set the key.

5. **No proto change.** `_firstImageInContent` flows through `document_generations.metadata` → `documentInfoFromRow` → `structpb.NewStruct` (`documents.go:1215,1304`) automatically.

6. **Backfill.** Bump the reindex version so `MaybeReindex` (`reindex.go:175`) repopulates the field for existing documents on next daemon start.

### Web / client

4. **Zod schema (mandatory).** Add `_firstImageInContent: z.string().optional()` to `HMDocumentMetadataSchema` (`frontend/packages/client/src/hm-types.ts:~528-552`). Without this, `HMQueryBlockPayloadSchema.parse(...)` (`queries.ts:222`) silently strips the unknown key and the whole fix is invisible for query-block cards.

5. **Consume it, drop the fetch.** In `packages/ui/src/newspaper.tsx`:
   - `const coverImage = explicitCover || resolvedMetadata?._firstImageInContent || firstContentImage` (line ~288),
   - and gate the fallback fetch: `needsContentFetch` (`:273`) also requires `!resolvedMetadata?._firstImageInContent`, so cards with the indexed value never call `useResource`.
   - `firstContentImage` stays as the last-resort path for `entity`-bearing callers that already have content in hand.

6. **Mirror in the shared helper.** `getDocumentImage` (`content.ts:382`) should prefer `metadata._firstImageInContent` before falling back to `findFirstBlock`, so full-document callers benefit too.

---

## 5. Sequencing & risk

- **Ship-independent order:** client steps 4–6 are safe to land first — they read a field that's simply absent until the backend populates it (cards keep their current fetch behavior until then), so there's no flag-day coupling. Backend 1–3 then flips cards over to the metadata path as generations reindex.
- **Backfill lag:** between deploying the backend and completing reindex, un-reindexed docs fall back to the existing `useResource` path — correct, just not yet fast. No broken state.
- **Risk:** low. No proto change, no new RPC, reuses the proven metadata-batching transport and the existing reindex/backfill machinery. The only genuinely new backend logic is the move-tree replay in step 1 (Option B); Option A removes even that.
- **Edge cases to cover in tests:** doc with explicit cover (must skip derivation), doc with icon but no cover (skip), doc with no images (empty/absent field — card renders no cover, same as today), image block with empty `link`, `ipfs://` scheme handling (note: the separate image-endpoint 500 bug from the audit — `ipfs://` not stripped — is orthogonal and tracked separately).

---

## 6. Files at a glance

**Backend:** `backend/blob/blob_ref.go` (derive + set, ~`:410-445`), possibly `backend/blob/blob_change.go` (op capture, ~`:491-517`), `backend/crdt/tree.go` (reuse), `backend/blob/reindex.go` (version bump). No proto edits.

**Web:** `frontend/packages/client/src/hm-types.ts` (Zod field), `frontend/packages/ui/src/newspaper.tsx` (`:273,288`), `frontend/packages/shared/src/content.ts` (`:382`). Transport files (`api-query-block.ts`, `models/queries.ts`, `models/entity.ts`, `models/directory.ts`) need **no** change beyond the Zod schema.

---

## Implementation (landed 2026-07-13)

Reserved metadata key: `_firstImageInContent` (public — no `$db.` prefix).

**Backend**
- `docmodel/docmodel.go` — `(*Document).FirstContentImage()`: walks `tree.State().DFT("")`, returns the first `Image` block's `link` (short-circuit). Mirrors client `content.ts` semantics.
- `blob/index.go` — `DeriveFirstContentImage` func type + `deriveFirstContentImage` field on `Index` + `SetDeriveFirstContentImage`; threaded onto `indexingCtx`. New `changesFromHeadsConn(conn, bs, heads, generation)` gathers change bytes on the **indexing conn** (not a pool conn).
- `blob/blob_ref.go` — in `crossLinkRefMaybe`, after `$db.visibility`: when not a tombstone, no explicit `cover`/`icon`, and the hook is set, gather changes → derive → `dg.Metadata.set("_firstImageInContent", link, refTime)`. Best-effort (logs, never fails indexing).
- Hook threaded through `indexBlob`/`reindexStashedBlobs` (+ callers in `index_blockstore.go`, `reindex.go`, `blob_capability.go`, `blob_change.go`, `blob_comment.go`).
- `documents/documents.go` — `deriveFirstContentImage(iri, changes)` builds an in-memory docmodel (mirrors `loadDocument`, no DB I/O) → `FirstContentImage()`; wired in `NewServer` via `idx.SetDeriveFirstContentImage`.
- `storage/storage_migrations.go` — migration `2026-07-13.000001` → `scheduleReindex` to backfill.

**Frontend**
- `client/src/hm-types.ts` — `_firstImageInContent` added to `HMDocumentMetadataSchema` (required, else Zod `.parse` strips it for query-block cards).
- `ui/src/newspaper.tsx` — prefer `resolvedMetadata._firstImageInContent`; gate `needsContentFetch` on it (killing the N+1); `coverImage = explicitCover || indexedFirstImage || firstContentImage`.
- `shared/src/content.ts` — `getDocumentImage` prefers the indexed value before re-walking content.

**Tests (all passing)**
- `docmodel_test.go::TestFirstContentImage` — reading-order (incl. "reading order wins over creation order"), no-image, empty-link.
- `documents_test.go::TestListDirectoryDerivesFallbackCoverImage` — full chain: publish→index→derive→`ListDirectory` returns key; explicit-cover skipped; text-only absent.

**Notes / follow-ups**
- Not-yet-reindexed docs keep the old per-card fetch until reindex completes — no flag-day.
- Image links must be valid IPFS CIDs (publish-time validation); derivation stores whatever `Image.link` holds.
- Orthogonal audit bug (image endpoint 500 from unstripped `ipfs://`) is NOT addressed here.

## Review + real-data hardening (2026-07-28)

A 17-agent adversarial review plus an end-to-end run against a copy of the real
desktop data dir (70k blobs, 5.2k generations) surfaced and fixed:

- **Stale value (the big one).** Derivation only wrote non-empty results, so a
  value derived at older heads outlived the image's removal (reproduced on real
  data: 11 of 1,549 derived values were stale). Now the result is ALWAYS
  written — empty string is a meaningful sentinel: "derived, no image". LWW
  timestamp rides at `max(refTime, dg.LastAliveRefTime)` so late-arriving old
  Refs that complete a merge still win.
- **Sentinel kills the residual N+1.** Cards treat key-present-empty as "known
  no image" and skip the fallback fetch (`needsContentFetch` gates on
  `_firstImageInContent === undefined`). On real data 3,190 imageless
  generations carry the sentinel — those cards previously still fetched.
- **Merged heads.** Derivation now uses the generation's merged heads
  (`dg.Heads`, what the read path renders) instead of the incoming Ref's
  `v.Heads`, via `changesFromHeadIDsConn`.
- **Cost gate.** Derivation only runs when the Ref actually applied new
  changes (`appliedNewChanges`) — duplicate/out-of-date Refs and the unstash
  cascade skip the O(history) replay. The one-replay-per-state-advancing-write
  cost remains per the M3 decision.
- **Cleared cover/icon.** The gate now treats nil/empty cover/icon values as
  absent (`hasNonEmptyAttr`) — docs whose cover was removed derive again.
- **Icon precedence.** An explicit icon suppresses the indexed fallback cover
  on cards (matching pre-branch behavior where icons suppressed content-derived
  covers), so a lingering key can never hide a user's icon.
- **Startup ordering.** The deriver is wired in `daemon.go` before the backfill
  reindex task spawns (it's a pure function; `documents.NewServer` re-wires for
  tests/embedders), with the field guarded by `hookMu`.

Real-data verification: full reindex 3m08s / 70k blobs, zero derivation
errors, table counts identical, 8/8 non-empty derived values match the actual
first content image, 10/10 sampled sentinels correct, and `ListDirectory`
serves the key over gRPC.

## Sibling field instead of a metadata key (2026-07-28, Eric's call)

The derived value moved out of the public metadata map into a typed field:
`DocumentInfo.first_image_in_content` (`optional string`, field 15). Storage
keeps the same LWW machinery but under the internal `$db.firstImageInContent`
attr (PublicMap strips `$db.*`, the `$db.redirect` precedent), surfaced by
`documentInfoFromRow`. Rationale: authored metadata stays pure — no `""`
sentinel on every listing item, no risk of the reserved key round-tripping
into authored changes, proper typing instead of a `_`-prefix convention.
Tri-state survives via proto3 `optional`: unset = not derived (client may
fall back to fetching), `""` = derived-no-image (client skips the fetch).
Frontend consumes `HMDocumentInfo.firstImageInContent`; `DocumentCardGrid`
passes it to `DocumentCard` as a prop. `HMDocumentMetadataSchema` no longer
mentions the key; full-`Document` metadata never carried it.
Re-verified on a fresh real-data clone: sibling field on the wire, metadata
clean, zero old-style keys in storage.
