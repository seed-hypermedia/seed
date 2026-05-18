# Publish Messages — Implementation Decisions

Design note documenting the decisions behind optional human-readable publish messages on Change blobs.

## TL;DR

Every signed Change blob now carries an optional `message` string, analogous to a git commit message. The publish UI, CLI, activity feed, and Versions panel all read the message from the Change.

## Why the Change blob

A Change is the unit of "what changed" in a document — like a commit in git. A Ref is a pointer/branch that names a path and points at heads. Tombstone Refs and redirect/republish Refs do not introduce new content; they only re-aim a path. There is no content delta to describe on those Refs, so a `message` field there would have no consistent meaning.

Putting the message on the Change matches the git mental model the rest of the API already leans on:

- Change = commit (signed, identified by content, has a message).
- Ref = branch ref (a moving pointer, not a description).

Only content changes carry a message. Tombstones and redirects do not.

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

Top-level (sibling of `Body`/`Deps`/`Depth`) rather than inside `ChangeBody`. The body is reserved for document operations; metadata about the publish event lives at the same level as `Genesis`, `Deps`, and `Depth`.

The `omitempty` CBOR tag means changes without a message produce identical bytes to before — backward-compatible by construction.

For SQL-side queryability, the indexer copies `Message` into `structural_blobs.extra_attrs->>'message'`, alongside `title` and `metadata`.

## API surface

Proto schema changes (`proto/documents/v3alpha/documents.proto`):

- `string message = 9;` on `CreateDocumentChangeRequest`.
- `string message = 7;` on `PrepareChangeRequest` so the daemon can embed the message into unsigned Change bytes for client-side signers.
- `string message = 5;` on `DocumentChangeInfo` so `GetDocumentChange` and `ListDocumentChanges` surface it.

Client SDK (`frontend/packages/client/src`):

- `createChangeOps` and `createDocumentChange` accept `message?: string`. When set, it is added to the unsigned Change CBOR top-level.

## Display surfaces

- **Activity feed** (`activity-service.ts`, `feed.tsx`): resolves the head change CID from the Ref's version target, calls `GetDocumentChange`, reads `.message`. Rendered as italic text below the document update line.
- **Versions panel**: uses `ListDocumentChanges` / `GetDocumentChange`, which include `message`.
- **Desktop publish UI** (`publish-draft-button.tsx`): textarea labeled "Publish message (optional)" in the publish popover.
- **CLI** (`document.ts`): `--message` / `-m` flag on `document create` and `document update`.

## Compatibility

Forward-compatible: clients that don't send `message` produce changes without the field (`omitempty`). Existing data is unaffected.

## Non-goals

- **Editing message after publish.** Signed into the Change blob; rewriting changes the CID.
- **Rich text / markdown messages.** Plain text only.
- **AI-generated messages.** Orthogonal — can populate the same field later.
- **Comment threads on versions.** Single annotation, not a discussion system.
- **Diff summaries.** Separate feature; could populate this field automatically.
