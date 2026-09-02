# Document Collections Design

## Goal

Replace metadata-based document Collections with structurally derived document Collections. A Collection is identified from its
document content, exposed through the document machine for rendering, and persisted as derived index data for fast
published-document listings.

## Terminology

Use **Collection** throughout new and existing feature code. Do not use Collection terminology for this feature.

The document machine represents the derived type as:

```ts
documentType: 'document' | 'collection'
```

The legacy user metadata attribute `type: "Collection"` is ignored. Existing stored metadata is not migrated or removed.

## Collection Predicate

A document is a Collection when all of the following are true:

1. It has exactly one top-level block.
2. That block is a query block.
3. The query either:
   - has no includes; or
   - has exactly one include whose account and path are both empty; or
   - has exactly one include whose account and normalized path resolve to the document itself.

The following do not affect Collection status:

- The query view or style. Table, Card, List, unknown, and future views are valid.
- Child blocks nested under the sole top-level query block.

Normal empty representations of includes are equivalent: an absent includes field, an empty includes list, and an absent
or empty editor property all mean no includes. Malformed non-empty include data is not a Collection. More than one include,
a partially empty include, or an include targeting another document is not a Collection.

## Architecture

Use one shared frontend predicate and apply it at the authoritative runtime and persistence boundaries: the document
machine, each platform's local draft writer, and the backend published-document indexer.

### Frontend document machine

The document machine derives `context.documentType` from effective content:

- Use published content when there is no applicable draft.
- Use draft content when the latest document has a draft overlay.
- Do not apply a latest draft overlay while viewing an old version.

Selectors and document-page UI read `context.documentType`. They do not inspect metadata or independently decide whether
the document is a Collection.

The machine owns Collection behavior as state transitions and actions: deriving the effective type, replacing content during
both conversions, entering editing, and feeding the existing autosave flow. The shared document resource page remains a
thin consumer that renders selectors, sends intent events, and opens confirmation dialogs. It must not synchronize
Collection state with Collection-specific `useEffect` hooks or duplicate machine transition logic in UI callbacks.

The current automatic repair behavior is removed. Loading a Collection with a non-Table query view must not create a repair
draft or mutate its query.

### Backend indexer

The indexer reconstructs each published document from its merged heads, applies the same Collection predicate, and stores
`isCollection` under an internal `$db.*` indexed attribute. The internal attribute is excluded from authored document data
and public user metadata.

Derivation occurs:

- incrementally when a newly applied ref changes the merged heads; and
- in bounded asynchronous background batches for existing generations.

Adding this field does not schedule a full reindex. The indexer always writes true or false after successful derivation,
so conversion from Collection to Document clears a previously derived Collection value.

The derivation should follow the existing injected document-deriver pattern used for the first content image so the blob
index remains independent of the document model.

### Local draft indexes

Both platforms store the lightweight derived type with every locally listed draft:

```ts
isCollection: boolean
```

On desktop this is stored in the JSON draft index entry. On web it is stored in the IndexedDB `WebDocDraft` record and
exposed through its shared listed-draft adapter.

Each platform's draft write boundary derives this value from the content being persisted instead of trusting a
caller-provided value. This keeps every draft writer consistent with the stored content, including writers that do not
use the document machine. Every draft autosave refreshes the indexed value.

Legacy desktop and web draft records without `isCollection` remain readable and default to false; no draft-store migration
is required.

### Documents API

Add an optional indexed `DocumentInfo` field:

```proto
message DocumentInfo {
  // Existing fields...
  optional bool is_collection = 16;
}
```

Regenerate the Go and TypeScript bindings through the repository protobuf workflow. A missing indexed value means the
background backfill has not reached the document yet; clients treat it as a normal document.

## Creation

Rename the creation action and UI label to **New Collection** on desktop and web. Both platforms use the same shared Collection
seed, which contains no type metadata and exactly one canonical query block:

- Table view for the initial UI.
- One empty account/path include targeting children.
- Existing default sorting and table configuration.

The empty include makes the draft derive as a Collection immediately. Existing publication retargeting updates that include
to the final account and path before publishing.

## Conversions

Both conversions have desktop and web parity and are draft-first. They use the shared document machine plus each
platform's existing autosave and normal Publish actors rather than immediately changing the published document.

### Document to Collection

Editable normal documents show **Convert to Collection** in the three-dot options menu.

1. Show a confirmation dialog warning that all existing document content will be removed.
2. Cancellation makes no machine or draft changes.
3. On confirmation, snapshot the normal published base and dependencies.
4. Replace all effective draft content with exactly one canonical Collection query block.
5. Re-derive `documentType` as `collection`.
6. Enter or remain in editing and use the existing autosave flow.
7. Switch immediately from editor rendering to the Collection table.
8. Require the normal Publish action to update the published document and index.

### Collection to Document

Editable Collections show **Convert to Document** in the three-dot options menu.

1. Show a confirmation dialog warning that the Collection query will be removed.
2. Cancellation makes no machine or draft changes.
3. On confirmation, remove the sole top-level query block, leaving empty content.
4. Re-derive `documentType` as `document`.
5. Enter or remain in editing and use the existing autosave flow.
6. Switch immediately from the Collection table to the editor.
7. Require the normal Publish action.

Remove the conversion success toasts, including the Collection-creation toast with its Undo action and the
Collection-to-Document success toast.

## Rendering

For now, every Collection renders the shared dedicated table view on desktop and web, regardless of the query block's stored
view. Detection must remain view-agnostic so Card, List, and future Collection views can be rendered later without changing
the Collection definition.

The Collection table continues to use the sole query block's query, sorting, limit, and table configuration. Editing table
configuration or sorting continues through renamed Collection machine events and the existing draft autosave flow.

## File Browser

The shared file browser combines the typed published value from `DocumentInfo` with the derived value stored in matching
desktop or web draft entries:

```ts
effectiveIsCollection = matchingDraft?.isCollection ?? publishedDocument.isCollection
```

The matching draft value takes precedence so the browser updates immediately for:

- a newly created unpublished Collection;
- a published Document converted to a Collection draft; and
- a published Collection converted to a Document draft.

The local draft value remains available after navigating away from the draft on either platform. After publication
removes the draft, the backend-indexed `DocumentInfo.isCollection` becomes authoritative.

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

Test Collection detection for:

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

Test published loading, applicable and inapplicable draft overlays, old-version routes, Document-to-Collection conversion,
Collection-to-Document conversion, autosave inputs, and removal of the old repair path. Assert that consumers derive
rendering from `context.documentType` and that Collection state changes do not depend on resource-page effects.

### Creation and publishing

Test on desktop and web that New Collection seeds no type metadata, creates the canonical query block, derives immediately
as a Collection, records `isCollection: true` in the local draft store, and retargets its empty include on publication.

### Local draft indexes

Test both the desktop JSON index and web IndexedDB paths. Each draft write boundary must derive and persist `isCollection`
from content on every write; Collection-to-Document and Document-to-Collection autosaves replace stale values; list adapters
return the value; and legacy entries without the field default to false.

### User interface

Test desktop and web creation menus, both conditional conversion options, both confirmation dialogs, cancellation,
rendering switches after confirmation, renamed labels and accessible names, and absence of conversion success toasts.

### Backend and API

Use matching Go predicate cases. Test incremental derivation, bounded background backfill, Collection-to-Document clearing,
and `GetDocumentInfo`/document-list responses without scheduling a full reindex.

### File browser

Test on desktop and web that the Collection icon uses `DocumentInfo.isCollection` without a matching draft, prefers a matching
local draft's `isCollection`, stays correct after navigating away, treats legacy missing values as normal documents, and
ignores legacy metadata.

## Out of Scope

- Removing legacy Collection metadata from stored documents.
- Rendering Card, List, or future Collection views.
- Changing the Collection definition based on query view or children.
