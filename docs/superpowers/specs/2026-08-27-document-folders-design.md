# Document Folders Design

## Goal

Replace metadata-based document Folders with structurally derived document Folders. A Folder is identified from its
document content, exposed through the document machine for rendering, and persisted as derived index data for fast
published-document listings.

## Terminology

Use **Folder** throughout new and existing feature code. Do not use Folder terminology for this feature.

The document machine represents the derived type as:

```ts
documentType: 'document' | 'folder'
```

The legacy user metadata attribute `type: "Folder"` is ignored. Existing stored metadata is not migrated or removed.

## Folder Predicate

A document is a Folder when all of the following are true:

1. It has exactly one top-level block.
2. That block is a query block.
3. The query either:
   - has no includes; or
   - has exactly one include whose account and path are both empty; or
   - has exactly one include whose account and normalized path resolve to the document itself.

The following do not affect Folder status:

- The query view or style. Table, Card, List, unknown, and future views are valid.
- Child blocks nested under the sole top-level query block.

Normal empty representations of includes are equivalent: an absent includes field, an empty includes list, and an absent
or empty editor property all mean no includes. Malformed non-empty include data is not a Folder. More than one include,
a partially empty include, or an include targeting another document is not a Folder.

## Architecture

Use one shared frontend predicate and apply it at the authoritative runtime and persistence boundaries: the document
machine, each platform's local draft writer, and the backend published-document indexer.

### Frontend document machine

The document machine derives `context.documentType` from effective content:

- Use published content when there is no applicable draft.
- Use draft content when the latest document has a draft overlay.
- Do not apply a latest draft overlay while viewing an old version.

Selectors and document-page UI read `context.documentType`. They do not inspect metadata or independently decide whether
the document is a Folder.

The machine owns Folder behavior as state transitions and actions: deriving the effective type, replacing content during
both conversions, entering editing, and feeding the existing autosave flow. The shared document resource page remains a
thin consumer that renders selectors, sends intent events, and opens confirmation dialogs. It must not synchronize
Folder state with Folder-specific `useEffect` hooks or duplicate machine transition logic in UI callbacks.

The current automatic repair behavior is removed. Loading a Folder with a non-Table query view must not create a repair
draft or mutate its query.

### Backend indexer

The indexer reconstructs each published document from its merged heads, applies the same Folder predicate, and stores
`isFolder` under an internal `$db.*` indexed attribute. The internal attribute is excluded from authored document data
and public user metadata.

Derivation occurs:

- incrementally when a newly applied ref changes the merged heads; and
- in bounded asynchronous background batches for existing generations.

Adding this field does not schedule a full reindex. The indexer always writes true or false after successful derivation,
so conversion from Folder to Document clears a previously derived Folder value.

The derivation should follow the existing injected document-deriver pattern used for the first content image so the blob
index remains independent of the document model.

### Local draft indexes

Both platforms store the lightweight derived type with every locally listed draft:

```ts
isFolder: boolean
```

On desktop this is stored in the JSON draft index entry. On web it is stored in the IndexedDB `WebDocDraft` record and
exposed through its shared listed-draft adapter.

Each platform's draft write boundary derives this value from the content being persisted instead of trusting a
caller-provided value. This keeps every draft writer consistent with the stored content, including writers that do not
use the document machine. Every draft autosave refreshes the indexed value.

Legacy desktop and web draft records without `isFolder` remain readable and default to false; no draft-store migration
is required.

### Documents API

Add an optional indexed `DocumentInfo` field:

```proto
message DocumentInfo {
  // Existing fields...
  optional bool is_folder = 16;
}
```

Regenerate the Go and TypeScript bindings through the repository protobuf workflow. A missing indexed value means the
background backfill has not reached the document yet; clients treat it as a normal document.

## Creation

Rename the creation action and UI label to **New Folder** on desktop and web. Both platforms use the same shared Folder
seed, which contains no type metadata and exactly one canonical query block:

- Table view for the initial UI.
- One empty account/path include targeting children.
- Existing default sorting and table configuration.

The empty include makes the draft derive as a Folder immediately. Existing publication retargeting updates that include
to the final account and path before publishing.

## Conversions

Both conversions have desktop and web parity and are draft-first. They use the shared document machine plus each
platform's existing autosave and normal Publish actors rather than immediately changing the published document.

### Document to Folder

Editable normal documents show **Convert to Folder** in the three-dot options menu.

1. Show a confirmation dialog warning that all existing document content will be removed.
2. Cancellation makes no machine or draft changes.
3. On confirmation, snapshot the normal published base and dependencies.
4. Replace all effective draft content with exactly one canonical Folder query block.
5. Re-derive `documentType` as `folder`.
6. Enter or remain in editing and use the existing autosave flow.
7. Switch immediately from editor rendering to the Folder table.
8. Require the normal Publish action to update the published document and index.

### Folder to Document

Editable Folders show **Convert to Document** in the three-dot options menu.

1. Show a confirmation dialog warning that the Folder query will be removed.
2. Cancellation makes no machine or draft changes.
3. On confirmation, remove the sole top-level query block, leaving empty content.
4. Re-derive `documentType` as `document`.
5. Enter or remain in editing and use the existing autosave flow.
6. Switch immediately from the Folder table to the editor.
7. Require the normal Publish action.

Remove the conversion success toasts, including the Folder-creation toast with its Undo action and the
Folder-to-Document success toast.

## Rendering

For now, every Folder renders the shared dedicated table view on desktop and web, regardless of the query block's stored
view. Detection must remain view-agnostic so Card, List, and future Folder views can be rendered later without changing
the Folder definition.

The Folder table continues to use the sole query block's query, sorting, limit, and table configuration. Editing table
configuration or sorting continues through renamed Folder machine events and the existing draft autosave flow.

## File Browser

The shared file browser combines the typed published value from `DocumentInfo` with the derived value stored in matching
desktop or web draft entries:

```ts
effectiveIsFolder = matchingDraft?.isFolder ?? publishedDocument.isFolder
```

The matching draft value takes precedence so the browser updates immediately for:

- a newly created unpublished Folder;
- a published Document converted to a Folder draft; and
- a published Folder converted to a Document draft.

The local draft value remains available after navigating away from the draft on either platform. After publication
removes the draft, the backend-indexed `DocumentInfo.isFolder` becomes authoritative.

The file browser never reads legacy metadata and does not fetch or parse full draft or document content while rendering
rows.

## Failure Handling

- Malformed frontend query include data derives as `document` and renders the normal editor rather than crashing.
- Missing or unknown indexed values are exposed as document and rendered as normal documents.
- Backend derivation errors must not prevent the document from being indexed. They are logged and leave the typed value
  document until a later successful derivation or reindex.
- Conversion and publication failures use the existing draft autosave and publication error paths.
- Confirmation cancellation has no side effects.

## Testing

### Shared frontend predicate

Test Folder detection for:

- one query with absent includes;
- one query with an empty includes list;
- one query with an empty editor includes property;
- one empty account/path include;
- one self-referential include with normalized root and nested paths;
- arbitrary query styles;
- query children that do not affect detection.

Test rejection for:

- zero or multiple top-level blocks;
- one non-query block;
- multiple includes;
- another account or path;
- partially empty targets;
- malformed non-empty include data.

### Document machine

Test published loading, applicable and inapplicable draft overlays, old-version routes, Document-to-Folder conversion,
Folder-to-Document conversion, autosave inputs, and removal of the old repair path. Assert that consumers derive
rendering from `context.documentType` and that Folder state changes do not depend on resource-page effects.

### Creation and publishing

Test on desktop and web that New Folder seeds no type metadata, creates the canonical query block, derives immediately
as a Folder, records `isFolder: true` in the local draft store, and retargets its empty include on publication.

### Local draft indexes

Test both the desktop JSON index and web IndexedDB paths. Each draft write boundary must derive and persist `isFolder`
from content on every write; Folder-to-Document and Document-to-Folder autosaves replace stale values; list adapters
return the value; and legacy entries without the field default to false.

### User interface

Test desktop and web creation menus, both conditional conversion options, both confirmation dialogs, cancellation,
rendering switches after confirmation, renamed labels and accessible names, and absence of conversion success toasts.

### Backend and API

Use matching Go predicate cases. Test incremental derivation, bounded background backfill, Folder-to-Document clearing,
and `GetDocumentInfo`/document-list responses without scheduling a full reindex.

### File browser

Test on desktop and web that the Folder icon uses `DocumentInfo.isFolder` without a matching draft, prefers a matching
local draft's `isFolder`, stays correct after navigating away, treats legacy missing values as normal documents, and
ignores legacy metadata.

## Out of Scope

- Removing legacy Folder metadata from stored documents.
- Rendering Card, List, or future Folder views.
- Changing the Folder definition based on query view or children.
