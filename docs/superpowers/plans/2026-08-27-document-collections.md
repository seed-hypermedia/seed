# Document Collections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace metadata-driven document Collections with structurally derived Collections across the shared document machine,
desktop and web drafts, backend indexing, typed document listings, and the shared file browser.

**Architecture:** A shared TypeScript predicate derives draft/runtime type and an equivalent Go derivation computes
published type from merged document heads. The document machine owns Collection transitions and rendering state; desktop
JSON and web IndexedDB draft records persist the derived value; the backend exposes its indexed value through
`DocumentInfo.document_type`. The file browser overlays matching local draft types on published directory rows.

**Tech Stack:** TypeScript, React, XState v5, Vitest, IndexedDB, Go, SQLite index metadata, Protocol Buffers, pnpm,
Please (`./dev gen`), Agent CI.

---

## File map

**Shared Collection model and machine**

- Modify `frontend/packages/shared/src/models/document-machine.ts` — canonical Collection block, structural predicate,
  context field, events, actions, guards, and selectors' source state.
- Modify `frontend/packages/shared/src/models/use-document-machine.ts` — Collection selectors backed only by machine
  context.
- Modify `frontend/packages/shared/src/models/__tests__/document-machine.test.ts` — predicate, loading, overlays, and
  conversion tests.

**Frontend domain types and draft persistence**

- Modify `frontend/packages/client/src/hm-types.ts` — `HMDocumentType`, `HMDocumentInfo.documentType`, and listed-draft
  schema/type.
- Modify `frontend/apps/desktop/src/app-drafts.ts` — derive type at the desktop draft-write boundary and store it in
  `index.json`.
- Create `frontend/apps/desktop/src/app-drafts.test.ts` — desktop persistence and legacy-read coverage.
- Modify `frontend/apps/web/app/document-edit/web-draft-db.ts` — persist derived type in IndexedDB and expose it through
  `webDraftToListedDraft`.
- Modify `frontend/apps/web/app/document-edit/web-draft-db.test.ts` — web persistence, adapter, and legacy defaults.
- Modify `frontend/apps/web/app/document-edit/web-document-actors.ts` and its test — keep web autosaves/conversions on
  the shared machine path.

**Creation and publishing**

- Modify `frontend/apps/desktop/src/utils/publish-utils.ts` and
  `frontend/apps/desktop/src/utils/__tests__/publish-utils.test.ts` — rename seed helper and remove type metadata.
- Modify `frontend/apps/desktop/src/components/create-doc-button.tsx` — New Collection desktop menu item.
- Modify `frontend/apps/web/app/web-utils.tsx` — New Collection web menu item.
- Modify `frontend/apps/web/app/document-edit/web-create-draft.ts` and its test — accept shared Collection seed and persist
  it for navigated public Collections.
- Modify `frontend/apps/desktop/src/models/documents.ts` and
  `frontend/apps/web/app/document-edit/web-document-actors.ts` only as required to keep query retargeting and content
  overrides platform-equivalent.

**Shared rendering and file browser**

- Modify `frontend/packages/ui/src/resource-page-common.tsx` — thin selector-driven rendering, renamed Collection
  components/events, confirmation dialogs, no conversion effects/toasts.
- Modify `frontend/packages/ui/src/site-file-browser.tsx` and `frontend/packages/ui/src/site-file-browser-layout.tsx` —
  merge published and listed-draft type data.
- Modify `frontend/packages/ui/src/__tests__/site-file-browser.test.tsx` and relevant resource-page tests — icons,
  confirmations, transitions, and no toasts.
- Rename remaining feature symbols in files found by the final terminology scan, including
  `frontend/packages/ui/src/document-header.tsx`, `frontend/packages/ui/src/document-metadata-affordances.tsx`, and
  their tests when they still use the old name.

**Published index and API**

- Modify `proto/documents/v3alpha/documents.proto` — `DocumentType` enum and `DocumentInfo.document_type = 16`.
- Regenerate `backend/genproto/documents/v3alpha/documents.pb.go` and
  `frontend/packages/shared/src/client/.generated/documents/v3alpha/documents_pb.ts` with `./dev gen //proto/...`.
- Modify `backend/blob/index.go`, `backend/blob/index_blockstore.go`, `backend/blob/blob_ref.go`, and
  `backend/blob/reindex.go` — injected type derivation, internal indexed attribute, incremental update, and full-reindex
  pass.
- Modify `backend/api/documents/v3alpha/documents.go` — pure Go document-type deriver, index wiring, and `DocumentInfo`
  enum mapping.
- Modify `backend/daemon/daemon.go` and `backend/manual_test.go` — install the deriver before reindex startup.
- Modify `backend/api/documents/v3alpha/documents_test.go` and relevant `backend/blob/*_test.go` files — predicate, API,
  incremental, and reindex coverage.

## Task 1: Establish the shared Collection predicate and canonical seed

- [ ] **Step 1: Replace metadata-based helper tests with failing structural cases**

In `frontend/packages/shared/src/models/__tests__/document-machine.test.ts`, replace `isDocumentCollection` coverage with
table-driven `deriveDocumentType` cases. Use real editor blocks and IDs:

```ts
expect(deriveDocumentType([], mockDocumentId)).toBe('document')
expect(deriveDocumentType([createDefaultCollectionQueryBlock('query')], mockDocumentId)).toBe('collection')
const emptyIncludesQuery = createDefaultCollectionQueryBlock('query')
expect(
  deriveDocumentType(
    [{...emptyIncludesQuery, props: {...emptyIncludesQuery.props, queryIncludes: '[]'}}],
    mockDocumentId,
  ),
).toBe('collection')
expect(deriveDocumentType([selfQuery(mockDocumentId)], mockDocumentId)).toBe('collection')
expect(deriveDocumentType([otherQuery(), paragraph()], mockDocumentId)).toBe('document')
```

Cover absent/empty includes, one empty target, one normalized self target, multiple includes, partial empty targets,
malformed non-empty JSON, arbitrary style, and query children.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
direnv exec . pnpm --dir frontend/packages/shared test -- document-machine.test.ts
```

Expected: FAIL because `deriveDocumentType` and Collection helpers do not exist.

- [ ] **Step 3: Implement the minimal shared predicate and seed**

In `document-machine.ts`, introduce exported documented symbols:

```ts
export type DocumentType = 'document' | 'collection'

/** Creates the canonical query block used by new Collections. */
export function createDefaultCollectionQueryBlock(blockId: string): EditorBlock {
  /* existing defaults, renamed */
}

/** Derives a document's runtime type from its top-level content. */
export function deriveDocumentType(
  content: HMBlockNode[] | EditorBlock[] | null | undefined,
  documentId: UnpackedHypermediaId,
): DocumentType {
  /* exact approved predicate */
}
```

Parse editor `queryIncludes` only when non-empty. For hydrated `HMBlockNode`, read `block.attributes?.query?.includes`.
Normalize explicit paths with `entityQueryPathToHmIdPath`. Do not inspect style or children.

Delete `isDocumentCollection`, `normalizeCollectionEditorBlocks`, and metadata-based repair helpers.

- [ ] **Step 4: Run the focused test and verify pass**

Run the Step 2 command. Expected: PASS.

## Task 2: Make the XState document machine authoritative

- [ ] **Step 1: Write failing machine transition tests**

Add tests asserting:

- `document.loaded` derives `context.documentType`.
- applicable `draft.resolved` content overrides published type;
- old-version routes ignore latest draft content;
- `collection.convertToCollection` replaces all content with the canonical query and enters editing;
- `collection.convertToDocument` sets content to `[]` and enters/remains editing;
- arbitrary query style does not create a repair draft;
- emitted `writeDraft.contentOverride` matches conversion content.

- [ ] **Step 2: Verify the new tests fail**

Run the shared test command from Task 1. Expected: FAIL on context/events and old repair behavior.

- [ ] **Step 3: Add machine-owned context, events, and actions**

In `document-machine.ts`:

```ts
export type DocumentMachineContext = {
  // existing fields
  documentType: DocumentType
}

export type DocumentMachineEvent =
  | {type: 'collection.query.change'; props: Partial<EditorQueryBlock['props']>}
  | {type: 'collection.convertToCollection'}
  | {type: 'collection.convertToDocument'}
  | ExistingEvents
```

Initialize `documentType: 'document'`. Recompute it in the same assignments that accept published content, resolve/clear
draft content, and replace conversion content. Keep conversion content in machine context so existing save actors
receive `contentOverride`; do not require a resource-page effect to trigger the switch.

Remove `collectionRepairAttempted`, `repairingCollection`, the repair guard, and all metadata mutations of `metadata.type`.

- [ ] **Step 4: Replace selectors with direct context selectors**

In `use-document-machine.ts`, rename selectors to Collection and make the type selector direct:

```ts
export const selectDocumentType = (snapshot: DocumentMachineSnapshot) => snapshot.context.documentType
export const selectIsCollection = (snapshot: DocumentMachineSnapshot) => snapshot.context.documentType === 'collection'
```

Rename the sole-query selector to `selectCollectionQueryBlock` and derive only the block, not the type.

- [ ] **Step 5: Run shared machine tests**

Expected: all document-machine tests PASS.

## Task 3: Add typed `DocumentInfo.documentType`

- [ ] **Step 1: Add failing frontend mapping/schema tests**

Update `frontend/packages/shared/src/models/__tests__/entity.test.tsx` to expect `documentType: 'collection'` for the
generated Collection enum and `document` for document/unspecified values.

- [ ] **Step 2: Add the protobuf enum and field**

In `proto/documents/v3alpha/documents.proto` add the accepted enum and:

```proto
// Output only. Type derived from the document's published content.
DocumentType document_type = 16;
```

- [ ] **Step 3: Regenerate protobuf bindings**

Run:

```bash
direnv exec . ./dev gen //proto/...
```

Expected: generated Go and TypeScript document bindings change; do not format them manually.

- [ ] **Step 4: Add frontend domain mapping**

In `hm-types.ts` add:

```ts
export const HMDocumentTypeSchema = z.enum(['document', 'collection'])
export type HMDocumentType = z.infer<typeof HMDocumentTypeSchema>
```

Add `documentType: HMDocumentTypeSchema.default('document')` to `HMDocumentInfoSchema` and optional/defaulted support to
listed drafts. In `prepareHMDocumentInfo`, map only generated `DOCUMENT_TYPE_FOLDER` to `collection`; map all other values
to `document`.

- [ ] **Step 5: Run mapping tests and client/shared typechecks**

```bash
direnv exec . pnpm --dir frontend/packages/client typecheck
direnv exec . pnpm --dir frontend/packages/shared test
```

Expected: PASS.

## Task 4: Derive and index published document type in Go

- [ ] **Step 1: Write failing pure derivation tests**

Beside `TestDeriveFirstContentImage` coverage in `backend/api/documents/v3alpha/documents_test.go`, build real document
changes for the approved cases and assert:

```go
got, err := DeriveDocumentType(iri, changes)
require.NoError(t, err)
require.Equal(t, blob.DocumentTypeCollection, got)
```

Mirror the TypeScript cases, including no includes, explicit self, multiple includes, styles, and children.

- [ ] **Step 2: Verify the Go test fails**

```bash
direnv exec . go test ./backend/api/documents/v3alpha -run TestDeriveDocumentType -count=1
```

Expected: FAIL because the deriver does not exist.

- [ ] **Step 3: Implement and inject the pure deriver**

Follow the existing first-image injection pattern, but keep names Collection-specific:

```go
type DocumentType string
const (
    DocumentTypeDocument DocumentType = "document"
    DocumentTypeCollection DocumentType = "collection"
)
type DeriveDocumentType func(iri IRI, changes []ChangeRecord) (DocumentType, error)
```

Add `SetDeriveDocumentType`, thread it through index options, wire it in daemon/manual startup, and implement
`documentsv3.DeriveDocumentType` by hydrating the merged document once and applying the approved predicate. Recover
docmodel panics as errors, matching the first-image safety contract.

- [ ] **Step 4: Persist incremental and reindex values**

In `blob_ref.go` add a documented internal key such as:

```go
const DocumentTypeAttr = "$db.documentType"
```

After merged heads advance, derive and always set either `document` or `collection`. Add a once-per-generation full-reindex
pass analogous to `deriveFirstContentImages`. A failed derivation logs and skips without failing indexing.

- [ ] **Step 5: Map the indexed value to protobuf**

In the `DocumentInfo` row builder, read `DocumentTypeAttr` and map:

```go
documentType := documents.DocumentType_DOCUMENT_TYPE_UNSPECIFIED
switch value {
case string(blob.DocumentTypeDocument):
    documentType = documents.DocumentType_DOCUMENT_TYPE_DOCUMENT
case string(blob.DocumentTypeCollection):
    documentType = documents.DocumentType_DOCUMENT_TYPE_FOLDER
}
```

Assign `DocumentType: documentType` on the response.

- [ ] **Step 6: Add incremental, clearing, reindex, and API tests**

Prove Collection → Document overwrites stale type, full reindex backfills Collection, and both Get/List document info return the
enum.

- [ ] **Step 7: Run backend verification for this task**

```bash
direnv exec . go test ./backend/...
```

Expected: PASS.

## Task 5: Persist derived type in desktop and web draft stores

- [ ] **Step 1: Write failing desktop draft-index tests**

Test the `drafts.write` boundary with Collection and Document content. Assert list/listAccount entries contain the derived
type and a second write replaces it. Add a legacy index fixture without the field and expect `document`.

- [ ] **Step 2: Implement desktop write-boundary derivation**

Import the shared predicate in `app-drafts.ts`. Construct the target ID from `editUid/editPath` or the new document
route from `locationUid/locationPath`, derive from `input.content`, and persist `documentType` on `newDraft`. Keep the
read schema default backward-compatible.

- [ ] **Step 3: Write failing web draft-store tests**

In `web-draft-db.test.ts`, assert `putWebDocDraft` derives rather than trusts a provided field, overwrites stale values,
and `webDraftToListedDraft` returns the value. Insert an old raw record without the property and expect `document`.

- [ ] **Step 4: Implement web write-boundary derivation**

Add `documentType` to `WebDocDraft`. In `putWebDocDraft`, unpack `record.docId`, derive from `record.content`, and
overwrite `record.documentType`. Default missing records in read/adaptation paths. No IndexedDB version bump is needed
because this is a value property, not an object-store/index change.

- [ ] **Step 5: Run focused desktop and web tests**

```bash
direnv exec . pnpm --dir frontend/apps/desktop test -- app-drafts
direnv exec . pnpm --dir frontend/apps/web test -- web-draft-db web-document-actors
```

Expected: PASS.

## Task 6: Provide New Collection on desktop and web

- [ ] **Step 1: Update seed tests to reject type metadata**

Rename `buildDocumentCollectionDraftSeed` tests to `buildDocumentCollectionDraftSeed` and expect:

```ts
expect(seed.metadata).toEqual({})
expect(deriveDocumentType(seed.content, targetId)).toBe('collection')
```

- [ ] **Step 2: Move/reuse the canonical seed without duplication**

Keep `createDefaultCollectionQueryBlock` in shared machine/domain code and make desktop/web creation wrap it. Do not
maintain two query-default objects.

- [ ] **Step 3: Add desktop New Collection**

Rename the menu key/label/helper, retain immediate persistence for seeded public drafts, and pass empty metadata plus
the canonical block.

- [ ] **Step 4: Add web New Collection**

Extend `createWebDocumentDraft` call sites so New Collection passes canonical HM block content and forces persistence even
for a navigated public draft; otherwise there would be no IndexedDB row/type for the file-browser overlay. Add
`New Collection` alongside `New Document` in `useWebCreateDocumentMenuItem`.

- [ ] **Step 5: Verify creation and publish retargeting**

Run desktop publish-utils/create tests and web create-draft tests. Assert the empty include retargets to the final
account/path on both publish actors.

## Task 7: Make shared Collection UI thin, confirmed, and toast-free

- [ ] **Step 1: Write failing shared UI tests**

Cover:

- Document menu shows Convert to Collection only when editable.
- Collection menu shows Convert to Document only when editable.
- Cancel leaves the machine snapshot unchanged.
- Confirm sends one machine intent event.
- The selector change swaps editor/table rendering.
- No Collection conversion success or Undo toast is emitted.

- [ ] **Step 2: Add controlled confirmation dialogs**

Use existing shared AlertDialog components. UI state controls only which confirmation is open. Confirm callbacks send
`collection.convertToCollection` or `collection.convertToDocument`; they do not rewrite content or metadata.

- [ ] **Step 3: Rename and simplify resource-page consumption**

In `resource-page-common.tsx` use `selectIsCollection` and `selectCollectionQueryBlock`, rename `DocumentCollectionTable` to
`DocumentCollectionTable`, and rename query-change events. Remove the conversion-detection `useRef`/`useEffect` toast block
and direct success toast from menu actions.

- [ ] **Step 4: Remove all metadata-driven rendering paths**

Update header, breadcrumbs, metadata affordances, tests, and menu-panel helpers so they consume the machine-derived
Collection state passed through existing props/selectors. Do not introduce Collection synchronization effects.

- [ ] **Step 5: Run UI tests**

```bash
direnv exec . pnpm --dir frontend/packages/ui test
```

Expected: PASS.

## Task 8: Overlay local draft types in the shared file browser

- [ ] **Step 1: Write failing precedence tests**

In `site-file-browser.test.tsx`, provide published rows and matching listed drafts. Prove precedence for new Collection,
Document → Collection, Collection → Document, navigation away, legacy missing draft type, and legacy metadata ignored.

- [ ] **Step 2: Load drafts through the universal client**

Use the existing account draft listing abstraction (`useDirectoryWithDrafts` or a focused combination of `useDirectory`
plus listed drafts) in `SiteFileBrowser`. Match drafts to rows using edit target for existing documents and
location/path target for new documents. Build the tree from the effective rows so unpublished new Collections remain
present.

- [ ] **Step 3: Render only effective typed values**

Render the Collection icon from the overlaid domain string, not protobuf enum or metadata:

```tsx
{doc.documentType === 'collection' ? <Grid3X3 aria-label="Collection" /> : /* private lock */}
```

Ensure both desktop's universal client and web's IndexedDB-backed draft provider invalidate the account-draft query
after writes/publish/delete.

- [ ] **Step 4: Run file-browser and layout tests**

```bash
direnv exec . pnpm --dir frontend/packages/ui test -- site-file-browser site-file-browser-layout
```

Expected: PASS.

## Task 9: Complete terminology cleanup and regression verification

- [ ] **Step 1: Scan feature code for the old keyword**

```bash
grep -RIn --exclude-dir=node_modules --exclude-dir=.git -E 'DocumentCollection|documentCollection|isDocumentCollection|collection\.|Collection' frontend backend proto
```

Expected: no live feature identifiers or UI strings. Retain the legacy literal only in compatibility tests/docs that
explicitly prove it is ignored.

- [ ] **Step 2: Format handwritten code**

```bash
direnv exec . pnpm --dir frontend -r format:write
direnv exec . pnpm --dir frontend -r format:check
direnv exec . gofmt -w backend/blob/index.go backend/blob/index_blockstore.go backend/blob/blob_ref.go backend/blob/reindex.go backend/api/documents/v3alpha/documents.go backend/api/documents/v3alpha/documents_test.go backend/daemon/daemon.go backend/manual_test.go
```

Do not format generated protobuf files manually. Expected: format checks PASS.

- [ ] **Step 3: Run frontend checks**

```bash
direnv exec . pnpm --dir frontend typecheck
direnv exec . pnpm --dir frontend test
direnv exec . pnpm --dir frontend audit
```

Expected: PASS.

- [ ] **Step 4: Run backend checks**

```bash
direnv exec . go test ./backend/...
direnv exec . golangci-lint run --new-from-merge-base origin/main ./backend/...
```

Expected: PASS.

- [ ] **Step 5: Run local CI parity**

```bash
direnv exec . npx @redwoodjs/agent-ci run -w .github/workflows/test-frontend-parallel.yml -p --github-token
direnv exec . npx @redwoodjs/agent-ci run -w .github/workflows/lint-go.yml -p
direnv exec . npx @redwoodjs/agent-ci run -w .github/workflows/test-go.yml -p
```

Expected: all supported jobs PASS. If a run fails, use the concrete runner name printed by Agent CI with
`npx @redwoodjs/agent-ci retry --name` after fixing the failure; do not start a fresh run.

- [ ] **Step 6: Manual desktop and web smoke test**

Before starting a live app, use Jean `get_run_environments` and test the already-running environment when available.
Verify on both platforms:

1. New Collection immediately renders Table and shows a Collection icon.
2. Navigate away before publishing; the icon remains.
3. Publish; the icon remains and now comes from `DocumentInfo`.
4. Convert a populated Document to Collection; cancel once, then confirm; content is removed only after confirmation.
5. Convert Collection to Document; cancel once, then confirm; the query disappears only after confirmation.
6. Reload between draft and publish states; rendering and icons remain correct.
7. No conversion success/Undo toast appears.
8. A one-query Card/List-shaped document still derives as Collection but renders Table for now.

Record the exact Jean URLs/ports used in the completion recap.

## Repository-state note

This plan intentionally contains no commit steps. Repository policy prohibits git state-writing commands unless the user
explicitly requests them. The ADR, design, implementation, tests, formatting, and verification can be completed without
committing.
