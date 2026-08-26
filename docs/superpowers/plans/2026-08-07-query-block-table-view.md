# Query Block Table View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a configurable, read-only TanStack Table view to Query blocks across editor and published document
surfaces.

**Architecture:** Extend the existing Query block style with `Table` and store per-block column layout in one serialized
`tableConfig` editor property and one nested HM block attribute. Keep result fetching unchanged while deriving custom
columns from each result's open metadata map. A shared UI component owns inferred column types, client-side search and
filters, resizing, progressive rows, and read-only sorting; editor integrations provide persistence callbacks.

**Tech Stack:** TypeScript, React, Zod, BlockNote, TanStack Table v8, Vitest, shared Seed UI primitives.

## Global Constraints

- Follow Option 1 from [issue #939](https://github.com/seed-hypermedia/seed/issues/939).
- Do not define backend metadata predicates, server pagination, inline editing, reusable saved views, or a formal
  attribute schema.
- Search and attribute filters are ephemeral and operate on loaded query results.
- Column layout persists per Query block; editor sorting persists through the existing query sort.
- Preserve Card/List behavior and old blocks without table configuration.

---

### Task 1: Query block model and round-trip compatibility

**Files:**

- Modify: `frontend/packages/client/src/hm-types.ts`
- Modify: `frontend/packages/client/src/editor-types.ts`
- Modify: `frontend/packages/client/src/hmblock-to-editorblock.ts`
- Modify: `frontend/packages/client/src/editorblock-to-hmblock.ts`
- Test: `frontend/packages/shared/src/client/__tests__/hmblock-to-editorblock.test.ts`
- Test: `frontend/packages/shared/src/client/__tests__/editorblock-to-hmblock.test.ts`

**Interfaces:**

- Produces: `HMQueryStyle = 'Card' | 'List' | 'Table'`.
- Produces: `HMQueryTableConfig` with ordered `{id, visible, width?}` columns.
- Produces: serialized `EditorQueryBlock.props.tableConfig` for BlockNote compatibility.

- [ ] Add failing conversion tests for a Table block with ordered, hidden, and resized columns.
- [ ] Run the two focused conversion test files and verify the new cases fail.
- [ ] Add the Zod table config schema and editor property, then serialize/deserialize it at the HM/editor boundary.
- [ ] Run the focused conversion tests and client/shared typechecks.

### Task 2: Pure table data model

**Files:**

- Create: `frontend/packages/ui/src/query-block-table-model.ts`
- Test: `frontend/packages/ui/src/__tests__/query-block-table-model.test.ts`

**Interfaces:**

- Produces: stable core/custom column descriptors.
- Produces: inferred `text | number | boolean | date | list` custom types.
- Produces: typed comparison, display, global-search, and `AND` filter helpers.

- [ ] Write tests for default order, hidden optional core columns, heterogeneous keys, mixed-type fallback, global
      search over hidden data, and typed `AND` filters.
- [ ] Run the model test and verify it fails because the module is absent.
- [ ] Implement only the pure functions required by the tests.
- [ ] Run the focused model tests and UI typecheck.

### Task 3: Shared TanStack Table renderer

**Files:**

- Create: `frontend/packages/ui/src/query-block-table.tsx`
- Modify: `frontend/packages/ui/src/query-block-content.tsx`
- Test: `frontend/packages/ui/src/__tests__/query-block-content.test.tsx`
- Test: `frontend/packages/ui/src/__tests__/query-block-table.test.tsx`

**Interfaces:**

- Consumes: descriptors/helpers from Task 2.
- Produces: `QueryBlockTable` with `tableConfig`, `onTableConfigChange`, `sorting`, and `onSortingChange` props.

- [ ] Add failing UI tests for loading, initial columns, search, filters, resizing callbacks, progressive rows, and
      filtered-empty state.
- [ ] Implement TanStack Table using existing `Table`, `Input`, `FacePile`, comments/citations data, and query
      navigation conventions.
- [ ] Add sticky Title, horizontal/touch overflow, accessible resize handles, and the toolbar filter builder.
- [ ] Route `style="Table"` through `QueryBlockContent` without changing Card/List branches.
- [ ] Run focused UI tests and UI typecheck.

### Task 4: Editor configuration and persistence

**Files:**

- Modify: `frontend/packages/editor/src/query-block.tsx`
- Modify: `frontend/apps/desktop/src/editor/query-block.tsx`
- Modify: `frontend/packages/ui/src/query-block-frontend-perf.ts`
- Test: relevant editor Query block tests or add focused tests beside the component.

**Interfaces:**

- Consumes: shared `QueryBlockTable` persistence callbacks.
- Produces: Table option in Query settings and serialized per-block layout updates.
- Produces: edit-mode header sorting mapped to existing `querySort` terms where supported.

- [ ] Add failing tests for Table selection and tableConfig persistence.
- [ ] Extend both shared/web and desktop block schemas with `Table` and `tableConfig`.
- [ ] Pass table config and persistence callbacks through `QueryBlockContent`.
- [ ] Persist supported core/custom sort choices without changing reader-only behavior.
- [ ] Run focused editor tests and typechecks.

### Task 5: Cross-surface regression and final verification

**Files:**

- Modify tests only where coverage gaps remain.

- [ ] Run client/shared/UI/editor focused test suites.
- [ ] Run `direnv exec . pnpm --filter @seed-hypermedia/client typecheck` and relevant frontend package typechecks.
- [ ] Run `direnv exec . pnpm -r format:write`, then `direnv exec . pnpm -r format:check` and inspect any ignored
      artifacts separately.
- [ ] Run the full relevant frontend tests and `pnpm audit`.
- [ ] Manually verify Card/List regressions plus Table authoring, save/reload, search/filter, resizing, horizontal touch
      scrolling, and published reader sorting.
- [ ] Run frontend agent-ci if credentials and runtime permit.
