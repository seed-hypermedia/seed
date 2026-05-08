# Publish Messages — Implementation Decisions

A short design note documenting the decisions behind moving optional human-readable publish messages from the Ref blob to the Change blob. Ships alongside the PR.

## TL;DR

Every signed Change blob now carries an optional `message` string, analogous to a git commit message. Refs no longer carry a message field. The publish UI, CLI, activity feed, and Versions panel all read the message off the Change rather than the Ref.

## Why Change, not Ref

The first iteration of this feature stored `message` on the Ref blob. We reversed that decision before merge.

The unit of "what changed" in this system is the **Change** blob — like a commit in git. A **Ref** is a pointer/branch that names a path and points at heads. Tombstone Refs and redirect/republish Refs do not introduce new content; they only re-aim a path. There is no content delta to describe on those Refs, so a `message` field there has no consistent meaning.

Putting the message on the Change also matches the git mental model the rest of the API already leans on:

- Change ≈ commit (signed, identified by content, has a message).
- Ref ≈ branch ref (a moving pointer, not a description).

This change keeps message scope narrow and meaningful: only content changes carry one. Tombstones and redirects do not.

## Storage shape

On the Go side, `Message` is a top-level field of `blob.Change`:

```go
type Change struct {
    BaseBlob
    Genesis cid.Cid    `refmt:"genesis,omitempty"`
    Deps    []cid.Cid  `refmt:"deps,omitempty"`
    Depth   int        `refmt:"depth,omitempty"`
    Body    ChangeBody `refmt:"body,omitempty"`
    Message string     `refmt:"message,omitempty"`
}
```

Top-level (sibling of `Body`/`Deps`/`Depth`) was preferred over nesting inside `ChangeBody`. The body is reserved for the document operations themselves; metadata about *the publish event* lives at the same level as `Genesis`, `Deps`, and `Depth`.

The `omitempty` CBOR tag means changes without a message produce identical bytes to before this feature existed — backward-compatible by construction.

For SQL-side queryability, the indexer copies `Message` into `structural_blobs.extra_attrs->>'message'`, alongside `title` and `metadata`. This lets the API surface the message without re-decoding the blob.

## API surface

Proto schema changes (`proto/documents/v3alpha/documents.proto`):

- **Added** `string message = 9;` on `CreateDocumentChangeRequest` (kept from the original Ref-message branch — same field number, different semantics).
- **Added** `string message = 7;` on `PrepareChangeRequest` so the daemon can embed the message into the unsigned Change blob it returns to client-side signers.
- **Added** `string message = 5;` on `DocumentChangeInfo` so `GetDocumentChange` and `ListDocumentChanges` surface it.
- **Removed** `string message = 9;` from `CreateRefRequest`. Field number reserved (`reserved 9;`).
- **Removed** `string message = 9;` from `Ref`. Field number reserved (`reserved 9;`).

Reserving the field numbers prevents accidental reuse if anyone rebuilds an older client and tries to populate them.

Client SDK (`frontend/packages/client/src`):

- `createChangeOps` and `createDocumentChange` accept `message?: string`. When set, it is added to the unsigned Change CBOR top-level.
- `createVersionRef`, `createTombstoneRef`, `createRedirectRef` no longer accept `message`. Removed entirely — not deprecated, since the branch hasn't shipped.
- `signDocumentChange` no longer accepts `message`. The message is expected to be already embedded in the unsigned Change bytes (either by the daemon's `PrepareChange` handler, or by a client-side `createChangeOps` call).

## Display surfaces

- **Activity feed** (`activity-service.ts`, `feed.tsx`): `loadRefEvent` resolves the head change CID from the Ref's version target, then calls `GetDocumentChange` and reads `.message`. Rendered as italic text below the document update line.
- **Versions panel**: reuses `ListDocumentChanges` / `GetDocumentChange`, which now include `message`. No additional plumbing needed.
- **Desktop publish UI** (`publish-draft-button.tsx`): a textarea labeled "Publish message (optional)" in the publish popover. Forwarded through `usePublishResource → publishDocument → daemon CreateDocumentChange` (or the client-side path for new-home-document bootstrapping).
- **CLI** (`document.ts`): `--message` / `-m` flag on `document create` and `document update`. Passed into `createChangeOps`, not `createVersionRef`.

## Compatibility

The branch had not yet merged when this decision was made. There are no shipped Refs in the wild with `Ref.Message`, so we drop the field cleanly with no migration shim and no fallback read path.

Forward-compatible: clients running older code that don't send `message` simply produce changes without the field, and the indexer treats absence as "no message" (`omitempty`).

## Non-goals

- **Editing message after publish.** The message is signed into the Change blob; rewriting it would change the CID. Out of scope.
- **Rich text / markdown messages.** Plain text only. A short annotation, not a document.
- **AI-generated messages.** Orthogonal. Anyone can populate the same field later from a model — the storage doesn't care where the string came from.
- **Comment threads on versions.** Out of scope. This is a single annotation, not a discussion system.
- **Diff summaries.** Not the same feature. Could be layered on top — generate a summary, write it as the message — but that's separate work.

## Verification checklist

End-to-end test path used during implementation:

1. `direnv exec . plz run //proto/documents/v3alpha:go.gen` to regenerate proto bindings.
2. `direnv exec . go test ./backend/blob/... ./backend/api/documents/v3alpha/... -count=1` — all pass, including the new `TestChangeMessageRoundTrip`.
3. `direnv exec . pnpm typecheck` — clean across all 16 frontend workspaces.
4. `direnv exec . pnpm test` — 414 frontend tests pass.
5. Manually: open desktop app, create draft, type content, click Publish, type a message in the textarea, confirm publish.
6. Manually: open the Activity feed accessory and verify the italic message line under the publish event.
7. Manually: open the Versions panel and confirm the message appears next to the change.
8. Manually: `seed document create … -m "cli test"` → `seed document update … -m "cli edit"` → verify both messages appear via the API.
9. Manually: tombstone or redirect via `CreateRef` — confirm no `message` field is present (it's gone from the proto).
