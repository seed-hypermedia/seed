# Publish Messages

Optional human-readable message attached to each publish, analogous to a git commit message. Stored on the Change blob (signed, tamper-proof, permanent) and surfaced in the desktop publish UI, CLI, activity feed, and document versions panel.

## Problem

Version history is opaque. When a user publishes a document, the only information recorded is the timestamp and the account that published. There is no way for the publisher to explain what changed or why. Collaborators browsing the activity feed or document versions panel see a flat list of updates with no context.

## Solution

Add an optional `message` string field to the Change blob. The message is set at publish time, included in the signed Change blob, and displayed wherever versions are shown.

### Storage

The message lives on the **Change blob** because a Change is the unit of "what changed" in a document — analogous to a git commit. Tombstones and redirects produce only Refs and have no content delta to describe, so they don't carry messages.

The field uses `omitempty` so existing Changes without a message remain valid. No migration is needed.

### Stack

- **Proto**: `string message` field on `CreateDocumentChangeRequest`, `PrepareChangeRequest`, and `DocumentChangeInfo`.
- **Go daemon**: `Change.Message` field; threaded through `NewChange`, `prepareChange`, `SignChange`/`SignChangeAt`/`CreateChange`, `CreateDocumentChange` handler, `PrepareChange` handler, and `DocumentChangeInfo` response builders. Indexed into `extra_attrs` JSON.
- **TypeScript client SDK**: `message` parameter on `createChangeOps` / `createDocumentChange` (embeds into Change CBOR).
- **CLI**: `--message` / `-m` flag on `document create` and `document update` commands, passed into `createChangeOps`.
- **Desktop UI**: textarea in the publish popover (`publish-draft-button.tsx`). Both daemon and seed-client publish paths forward the message.
- **Web client**: `create-web-universal-client.ts` threads message through `PublishDocumentInput` into `PrepareDocumentChange` / `createDocumentChange`.
- **Activity feed**: `loadRefEvent` resolves the head change CID from the Ref's version target, then calls `GetDocumentChange` and reads `.message`. `feed.tsx` renders it as italic text below document-update events.
- **Document Versions panel**: reuses `ListDocumentChanges` / `GetDocumentChange`, which include the message field.

## Scope

Small feature. Fully backward compatible because the field is optional with `omitempty`.

## Rabbit Holes

- **Rich text messages.** Plain text is sufficient. Rich text adds complexity (rendering, sanitization, storage size) with no clear benefit for a short annotation.
- **Required vs optional.** The message must be optional. Most publishes are quick saves that do not need an explanation. Making it required would add friction to the most common workflow.

## No Goes

- **Comment threads on versions.** Out of scope. This is a single annotation, not a discussion system.
- **Diff summaries.** Generating a human-readable diff of what changed in the document is a separate feature.
- **AI-generated messages.** Automatic summarization of changes is interesting but orthogonal. Can be layered on later by populating the same field.
- **Editing after publish.** The message is part of the signed Change blob. Changing it after the fact would require a new Change, which changes the version identity. Not supported.
