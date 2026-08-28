---
name: 'Introducing Document Folders'
summary:
  'Make folders a structural document type that stays correct across drafts, publishing, and file-browser listings.'
---

# Introducing Document Folders

## Problem

Seed documents can already contain query blocks, but the initial Document Collections approach made a user-authored
attribute (`type: "Collection"`) responsible for application behavior. That created several problems:

- Metadata and content could disagree, so a document could claim to be a collection without containing a usable query.
- Every writer and UI surface had to preserve the same magic metadata value.
- The file browser could not identify published folders from typed listing data without inspecting metadata or fetching
  full documents.
- Local conversions could look correct on the document page but lose their folder icon after navigation because the
  information was not stored with the draft.
- Repairing missing queries or forcing queries into Table style added complexity and could create drafts merely by
  opening a document.

The product model has also become simpler: the feature is called a **Folder**, not a Document Collection. A Folder is
still a document. Its behavior comes from its content, not from a user-authored type flag.

## Solution

### Define Folder identity from document content

A document is a Folder when all of the following are true:

1. It has exactly one top-level block.
2. That block is a Query block.
3. The query has no includes, an empty includes list, or exactly one include that is empty or targets the document's own
   account and normalized path.

Presentation is not identity. Table, Card, List, and future query views all qualify. Blocks nested under the sole
top-level Query block also do not change the result. Multiple top-level blocks, multiple includes, malformed non-empty
include data, a partially empty target, or a target pointing elsewhere make it a normal document.

The legacy `type: "Collection"` metadata value remains readable as user metadata but no longer controls behavior. We do
not migrate or delete it.

### Make the document machine authoritative at runtime

The shared document machine derives `documentType: 'document' | 'folder'` from effective content:

- Published content is used when there is no applicable draft.
- Draft content overrides the published document while editing the latest version.
- A draft for the latest version is ignored when viewing an older published version.

The document page reads Folder status directly from machine selectors. React does not inspect metadata, manufacture
Folder state, coordinate repair effects, or write drafts directly.

For now, every Folder renders with the shared Table view, even when its stored query asks for Card or List. We preserve
the stored presentation so additional views can be supported later without changing Folder identity.

### Make conversion explicit and draft-first

- **Convert to Folder** asks for confirmation because it removes the document's existing top-level content. Confirming
  replaces the effective content with one canonical self-query block and enters the normal editing flow.
- **Convert to Document** asks for confirmation because it removes the Folder query. Confirming leaves an empty document
  draft in the normal editing flow.
- Canceling either dialog makes no change.
- Both conversions use the existing autosave and Publish lifecycle. They do not publish immediately.
- Conversion success, Undo, and repair toasts are not shown.

### Support creation on desktop and web

Add **New Folder** beside **New Document** on desktop and web. A new Folder starts as a normal public draft with empty
user metadata and one canonical Query block. The query initially uses the Table view, Children mode, the existing
default sort and columns, and an empty target that is retargeted to the final account and path during publication.

The file browser shows the Folder icon immediately, including before publication and after navigating away or reloading.

### Derive at every persistence boundary

Runtime state and persisted indexes have different lifetimes, so each persistence boundary derives Folder status from
the content it writes instead of trusting a caller-provided flag:

- Desktop stores `isFolder` in each JSON draft-index entry.
- Web stores `isFolder` in each IndexedDB draft record.
- The backend stores `$db.isFolder` as an internal derived attribute for each published document generation.

A matching local draft overrides the published value in file-browser rows. After publication removes the draft, the
backend's published value becomes authoritative again. Older draft records without the field default to a normal
document.

### Expose published Folder status as typed listing data

`DocumentInfo.is_folder` exposes the optional backend-derived value without polluting user metadata. The indexer derives
it from the merged published document heads and overwrites both `true` and `false`, so converting a Folder back into a
document cannot leave stale state behind.

Existing documents are processed after startup by a bounded asynchronous backfill. It reuses the same document replay
that derives other document-level fields, runs in small transactions, and does not block daemon startup with a full
reindex. Until an old document is reached, an unset value means "not derived yet" and is displayed as a normal document.

### User stories and acceptance criteria

- As an author, I can create a Folder on desktop or web and immediately see a Table view and Folder icon.
- As an author, I can navigate away from an unpublished Folder and still see its correct icon in the file browser.
- As an editor, I can convert a populated document to a Folder only after confirming that its content will be removed.
- As an editor, I can convert a Folder to an empty document only after confirming that its query will be removed.
- As an editor, I can cancel either conversion without changing the draft.
- As a reader, I see published Folder icons from lightweight document listing data without fetching every document.
- As a user, I see the draft's type when a local draft and published document disagree.
- As a user, I do not see conversion success or Undo toasts.
- A one-query document remains a Folder regardless of query presentation or nested children.
- A document with ordinary prose, multiple top-level blocks, or a query targeting another document remains a document.

## Scope

The implementation spans the shared document model, both application draft stores, creation flows, shared rendering, the
file browser, and backend indexing.

### Phase 1: Shared model and machine

- Add the shared structural predicate and canonical Folder query seed.
- Derive runtime type from published content plus the applicable draft overlay.
- Move conversion transitions and content replacement into the document machine.
- Expose direct selectors for document type and the Folder query block.

### Phase 2: Draft persistence and creation

- Persist derived `isFolder` values in desktop JSON and web IndexedDB draft records.
- Keep legacy draft records readable with a normal-document default.
- Add New Folder creation on desktop and web using the same canonical seed.
- Preserve query retargeting when a new Folder is published at its final location.

### Phase 3: Rendering and file-browser integration

- Render Folders through the shared Table view without making Table part of their identity.
- Add confirmed, toast-free conversion actions.
- Overlay matching local draft status on published directory rows.
- Render unpublished new Folders and conversions correctly across navigation and reloads.

### Phase 4: Published index and rollout

- Derive Folder status from the real Go document model during incremental indexing.
- Expose optional `DocumentInfo.is_folder` listing data.
- Backfill existing published documents asynchronously in bounded batches.
- Keep derivation best-effort so a malformed document cannot block indexing or daemon startup.

## Rabbit Holes

- Building a general registry or plugin system for future document types before a second specialized type exists.
- Supporting Card, List, gallery, kanban, calendar, or user-selectable Folder rendering in the first version.
- Persisting query search and ad hoc filters as part of Folder identity.
- Fetching full document or draft content for every file-browser row instead of using lightweight indexes.
- Rewriting or deleting legacy Collection metadata from existing documents.
- Adding a separate published document-type enum when listings only need the derived Folder fact.
- Making the backend the only authority, which would delay local draft behavior until publication.
- Making the document machine the only authority, which would lose type information after navigation.
- Reworking the query engine or changing query-target semantics beyond normalizing the document's own path.

## No Gos

- Do not use authored metadata to decide whether a document is a Folder.
- Do not trust a caller-provided Folder flag at draft or backend write boundaries; derive it from content.
- Do not require Table presentation for Folder identity or rewrite Card/List queries merely because they are Folders.
- Do not create repair drafts when a Folder is opened.
- Do not publish conversions automatically or bypass the normal draft review and Publish flow.
- Do not let React coordinate conversion state, directly write Folder drafts, or independently reproduce the predicate.
- Do not show conversion success, Undo, or automatic-repair toasts.
- Do not use a blocking migration or migration-triggered full reindex to backfill Folder status.
- Do not treat an unset backend value as a proven `false`; it means derivation has not run yet.
- Do not break ordinary document creation, editing, version viewing, or rendering.
