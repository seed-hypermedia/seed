# ADR: Derive Document Collections from Content

- **Status:** Accepted
- **Date:** 2026-08-27
- **Decision owners:** Seed document experience
- **Related design:** `docs/superpowers/specs/2026-08-27-document-collections-design.md`

## Context

Document Collections were previously identified by a user-authored metadata value. The UI then inspected that metadata to
choose a Collection icon and table-first rendering.

This makes a user metadata attribute responsible for application behavior, duplicates type decisions in UI code, and
does not give the backend index a typed value suitable for fast document listings. It also makes draft behavior
inconsistent: the document page can know that a draft is Collection-shaped while a file-browser row cannot know until
publication.

The product term is **Collection**. A Collection is a document whose content consists of a single top-level
query block that targets itself implicitly or explicitly.

## Decision drivers

- Collection status must follow document content rather than mutable user metadata.
- Draft conversions must update rendering immediately without publishing.
- Published document lists must render Collection icons without fetching full documents.
- Unpublished Collection icons must remain correct after navigating away from a draft.
- Desktop and web must have full feature parity.
- The shared document machine should own document behavior; resource-page effects and UI callbacks should not coordinate
  state.
- Query view is not part of Collection identity because Table, Card, List, and future views are all valid Collection
  presentations.
- Existing documents and drafts must remain readable without destructive migrations.

## Decision

### Use Collection terminology everywhere

Rename the feature's identifiers, events, selectors, components, tests, accessible labels, and user-facing text to
Collection. New code uses:

```ts
documentType: 'document' | 'collection'
```

The legacy stored metadata value is discussed only for compatibility and is not used to control behavior.

### Define Collection identity structurally

A document is a Collection when:

1. it has exactly one top-level block;
2. that block is a query block; and
3. the query has no includes, or exactly one include that is empty or resolves to the document's own account and
   normalized path.

An absent includes field, an empty includes list, and an absent or empty editor includes property all mean no includes.
A partially empty target, multiple includes, another target, or malformed non-empty include data does not qualify.

The query block's view/style and nested children do not affect Collection identity.

### Make the document machine authoritative at runtime

The shared document machine derives `context.documentType` from effective content, including an applicable draft
overlay. Machine events and actions own both conversion flows, content replacement, editing transitions, and the
existing autosave intent.

The shared resource page renders selectors, sends intent events, and presents confirmation dialogs. It does not derive
Collection status, coordinate it with Collection-specific effects, or implement machine transitions in UI callbacks.

### Derive again at persistence boundaries

Runtime machine state and persisted indexes have different lifetimes, so each authoritative persistence boundary derives
the type from the content it writes rather than trusting a caller-provided type.

- Desktop stores `isCollection` in each JSON draft index entry.
- Web stores `isCollection` in each IndexedDB `WebDocDraft` record and exposes it through the listed-draft adapter.
- The backend stores only the derived internal `$db.isCollection` index value for each published document generation.

Matching draft values override published values in file-browser rows. Once publication removes the draft, the published
backend index becomes authoritative again.

### Expose the indexed published value

Expose the optional indexed value as `DocumentInfo.is_collection`. An unset value means background derivation has not
reached the document yet and renders as a normal document.

Existing published documents are processed by a bounded asynchronous backfill after migrations finish. It shares the
document replay used for other derived document fields, runs in small transactions, and never schedules a full reindex.

### Keep conversions draft-first and confirmed

- **Convert to Collection** warns that all existing content will be removed, then replaces effective content with one
  canonical query block in the local draft.
- **Convert to Document** warns that the Collection query will be removed, then leaves the local draft with empty content.
- Both conversions use normal autosave and Publish flows.
- Conversion success and Undo toasts are removed.

### Render Table for now without making it identity

Desktop and web render every Collection with the shared table view today. The stored query view is preserved and does not
affect classification, allowing other views to be rendered later without changing the data model.

## Considered options

### Continue using `metadata.type`

**Rejected.** It makes application behavior depend on a user-authored attribute, requires writers to keep metadata and
content synchronized, and keeps the file browser coupled to legacy metadata.

### Make the backend the only authority

**Rejected.** The backend only sees published content, so local conversions could not change the editor/table view or
icon until publication and reindexing.

### Derive document type only in UI components

**Rejected.** This would duplicate parsing and state coordination across resource pages and file-browser rows, encourage
Collection-specific effects, and weaken the document machine as the runtime authority.

### Derive document type only in the document machine

**Rejected.** Machine state disappears after navigation and does not cover other listed drafts or backend document
listings. Persisted draft and published indexes are still required.

### Fetch full document or draft content for every file-browser row

**Rejected.** It adds list-time I/O and parsing, makes rendering slower, and ignores the existing lightweight directory
and draft indexes.

### Store a published document-type enum

**Rejected.** Published listings only need the indexed Collection fact. Keeping `documentType` in the runtime machine
remains useful for rendering transitions, but persisting an enum would duplicate a boolean fact in the published index
and local draft indexes.

### Treat only Table queries as Collections

**Rejected.** View is presentation, not identity. Restricting identity to Table would require repair drafts and block
Card, List, and future views.

### Require exactly one include

**Rejected.** A query with no includes is implicitly self-referential and is a valid Collection. Exactly one empty or
explicit self target is also valid.

### Let query children disqualify a Collection

**Rejected.** Only the top-level document shape and query target define the Collection. Query-block children do not change
its identity.

### Migrate or delete legacy metadata

**Rejected.** Existing structurally valid documents will be classified correctly during derivation and reindexing.
Rewriting user documents adds risk without affecting the new behavior.

### Show unpublished icons only for the active machine

**Rejected.** The icon would disappear after navigating away. Storing the derived `isCollection` value in each local draft
index preserves correct rows across navigation and reloads.

### Convert immediately on the published document

**Rejected.** Conversions should be reversible through the existing editing workflow and should not bypass normal draft
review, autosave, and publication behavior.

## Consequences

### Positive

- Content is the canonical source of Collection identity.
- Runtime behavior is centralized in the shared machine.
- File-browser rows remain fast and draft-aware.
- Desktop and web behave consistently.
- New Collection views can be added without changing classification.
- Legacy data remains readable without migration.

### Negative

- The structural predicate must have equivalent TypeScript and Go implementations.
- Draft schemas and both local stores gain another derived field.
- Published Collection derivation adds work to incremental indexing and the bounded background backfill.
- Until the background backfill reaches them, old published rows appear as normal documents.

### Risk controls

- Keep matching predicate fixtures in frontend and backend tests.
- Derive persisted values at write boundaries rather than accepting caller claims.
- Always overwrite a successfully derived published value with true or false so stale Collection values cannot survive
  conversion.
- Treat malformed input and missing legacy values conservatively as normal documents.
- Keep index derivation best-effort so a type failure cannot block document indexing.

## Follow-up decisions deferred

- Rendering Card, List, or future Collection views.
- Removing legacy Collection metadata from stored documents.
- Extending Collection type to other resource APIs beyond `DocumentInfo`.
