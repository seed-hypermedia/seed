# Contextual Document Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the document-options New submenu with a context-aware split button that creates schema-shaped collection items consistently on web and desktop.

**Architecture:** Add a shared XState v5 creation actor and pure recursive schema helpers in `@shm/shared`. Platform hooks inject resource, capability, draft, creation, and navigation effects; a shared UI split button renders actor state. Import exits the actor with a typed handoff consumed by each existing import workflow.

**Tech Stack:** TypeScript, React 18/19-compatible components, XState 5.19, `@xstate/react`, TanStack Query, Vitest, Radix dropdown primitives.

## Global Constraints

- Web and desktop must expose identical placement, permission, and schema behavior.
- Web parent/schema permission checks start only after the current document has loaded and must not extend SSR or the initial document request.
- Ordinary non-collection documents retain the existing child-document behavior.
- Creation is removed from the three-dot document options menu; file-browser creation is unchanged.
- Import is a terminal actor handoff rather than an invoked import operation.
- Use `direnv exec .` for repository commands and `pnpm` for frontend commands.
- Do not perform git-writing operations unless the user explicitly requests them.

---

### Task 1: Recursive collection item schema

**Files:**
- Create: `frontend/packages/shared/src/models/document-creation-schema.ts`
- Create: `frontend/packages/shared/src/models/__tests__/document-creation-schema.test.ts`
- Modify: `frontend/packages/shared/src/index.ts`
- Modify: `frontend/packages/ui/src/query-block-table-model.ts`
- Modify: `frontend/packages/ui/src/__tests__/query-block-table-model.test.ts`

**Interfaces:**
- Produces `DocumentSchema`, `DocumentSchemaAttribute`, `inferDocumentSchema(...)`, `createSchemaMetadata(...)`, and `applySchemaToMetadata(...)`.
- Consumes canonical `BUILTIN_METADATA_KEYS`, `HMDocumentInfo`, `HMMetadata`, and `UnpackedHypermediaId`.

- [ ] Write failing resolver tests for direct-child filtering, draft inclusion, built-in exclusion, custom `type`, primitive defaults, recursive object shape, mixed-type frequency/ties, and non-overwriting import merge.
- [ ] Run `direnv exec . pnpm --dir frontend --filter @shm/shared test -- document-creation-schema.test.ts` and confirm failures are caused by the missing module.
- [ ] Implement the minimal recursive schema inference and metadata materialization helpers with exported-symbol doc comments.
- [ ] Run the shared tests and confirm they pass.
- [ ] Add a failing Query table test proving `type` is discovered as custom metadata, remove the one-off `type` reservation, and rerun the UI unit test.

### Task 2: Shared document creation actor

**Files:**
- Create: `frontend/packages/shared/src/models/document-creation-machine.ts`
- Create: `frontend/packages/shared/src/models/__tests__/document-creation-machine.test.ts`
- Modify: `frontend/packages/shared/src/index.ts`

**Interfaces:**
- Consumes schema helpers from Task 1.
- Produces `documentCreationMachine`, `DocumentCreationInput`, `DocumentCreationEvent`, `DocumentCreationOutput`, `DocumentCreationResolution`, and typed platform effects.

- [ ] Write failing actor tests for collection children, editable-parent siblings, parent-denied child fallback, ordinary children, hidden non-editors, resolution fallback/failure, valid menu events, duplicate request rejection, creation failure/retry, and terminal import output.
- [ ] Run the focused actor test and verify expected missing-machine failures.
- [ ] Implement the XState v5 machine with `setup(...)`, named `fromPromise(...)` effects, guards, tags, terminal outputs, and no timers or polling.
- [ ] Run actor and schema tests and confirm they pass.

### Task 3: Shared split-button presentation

**Files:**
- Create: `frontend/packages/ui/src/document-create-button.tsx`
- Create: `frontend/packages/ui/src/__tests__/document-create-button.test.tsx`

**Interfaces:**
- Consumes an actor ref/snapshot and event sender supplied by platform adapters.
- Produces an accessible `DocumentCreateButton` with primary Document action and chevron menu for Document, Collection, optional Subdocument, and Import.

- [ ] Write failing DOM tests for resolving-disabled, hidden, ready, busy, menu contents, primary click, dropdown events, and Subdocument visibility.
- [ ] Run the focused UI test and verify it fails because the component is missing.
- [ ] Implement the split button with existing Button and DropdownMenu primitives, built-in spacing/radius utilities, keyboard labels, and disabled state for both sections.
- [ ] Run the focused UI test and confirm it passes.

### Task 4: Desktop actor adapter and top-bar integration

**Files:**
- Modify: `frontend/apps/desktop/src/components/create-doc-button.tsx`
- Modify: `frontend/apps/desktop/src/components/editing-toolbar.tsx`
- Modify: `frontend/apps/desktop/src/pages/desktop-resource.tsx`
- Add or modify focused tests under `frontend/apps/desktop/src/components/__tests__/` and `frontend/apps/desktop/src/pages/__tests__/`.

**Interfaces:**
- Injects desktop resource/capability/draft/create/navigation effects into the shared machine.
- Consumes terminal import output and starts the existing desktop import dialog with destination and schema metadata.

- [ ] Write failing desktop integration tests proving New is not added to options, the split button is beside Publish, collection items target the correct parent, parent permission denial falls back to children, and import receives destination/schema.
- [ ] Run the focused desktop tests and verify the expected failures.
- [ ] Refactor the existing creation hook into a desktop actor adapter while retaining the file-browser menu helper unchanged.
- [ ] Pass the actor-backed split button into the editing top-bar actions and remove `newMenuItem` from document option arrays.
- [ ] Extend the existing desktop import entry point to merge missing schema attributes without overwriting imported values.
- [ ] Run the focused desktop tests and confirm they pass.

### Task 5: Web actor adapter and deferred integration

**Files:**
- Modify: `frontend/apps/web/app/web-utils.tsx`
- Modify: `frontend/apps/web/app/web-resource-page.tsx`
- Modify: `frontend/apps/web/app/document-edit/web-create-draft.ts` if the existing metadata input cannot express the resolved request unchanged.
- Add or modify focused tests under `frontend/apps/web/app/` and `frontend/apps/web/app/document-edit/`.

**Interfaces:**
- Injects web client, capability, IndexedDB draft, create, and navigation effects into the shared machine.
- Starts actor resolution in an effect after `currentDocument` is loaded.
- Consumes terminal import output and starts the existing Markdown import with destination/schema metadata.

- [ ] Write failing web tests proving the initial resource path does not await creation resolution, the visible split button starts disabled, non-editors lose it after resolution, creation destinations match desktop, and Markdown import receives the handoff schema.
- [ ] Run the focused web tests and verify the expected failures.
- [ ] Replace the document-options creation hook usage with a deferred client-side actor adapter; retain the separate file-browser helper.
- [ ] Render the shared split button beside Publish and remove New from web document option arrays.
- [ ] Extend Markdown import to preserve imported metadata while recursively adding missing schema attributes.
- [ ] Run the focused web tests and confirm they pass.

### Task 6: Formatting and verification

**Files:**
- Modify only files required to fix failures introduced by Tasks 1–5.

**Interfaces:**
- Verifies the complete feature; produces no new public API.

- [ ] Run focused shared, UI, desktop, and web tests again.
- [ ] Run `direnv exec . pnpm --dir frontend -r typecheck` and fix introduced type errors.
- [ ] Run `direnv exec . pnpm --dir frontend -r test` and fix introduced failures.
- [ ] Run `direnv exec . pnpm --dir frontend audit` and record the result without changing unrelated dependencies.
- [ ] Run `direnv exec . pnpm --dir frontend -r format:write`, then `direnv exec . pnpm --dir frontend -r format:check`.
- [ ] If a Jean run environment is available, use its exact URL to smoke-test editor/non-editor button states, collection child/sibling placement, schema defaults, and import handoff on web and desktop; otherwise report that live verification could not be run.
