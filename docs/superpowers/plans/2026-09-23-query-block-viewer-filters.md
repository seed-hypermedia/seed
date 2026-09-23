# Query Block Viewer Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make temporary query-block search and filters run against the complete source query before the saved result limit, with the same removable-chip presentation as Explore.

**Architecture:** Add viewer-only search/filter fields to the Query Block request and include them in the React Query key. Lift temporary state to query-owning renderers, evaluate it in the shared Query Block resolver before `query.limit`, and make `QueryBlockContent` controlled for remote-query contexts while retaining local behavior for other consumers.

**Tech Stack:** React, TypeScript, Zod, TanStack Query, Vitest, Tailwind CSS, Seed universal requests.

---

### Task 1: Request contract and complete-query filtering

**Files:**
- Modify: `frontend/packages/client/src/hm-types.ts`
- Create: `frontend/packages/shared/src/models/query-block-filter.ts`
- Create: `frontend/packages/shared/src/models/__tests__/query-block-filter.test.ts`
- Modify: `frontend/packages/shared/src/api-query-block.ts`
- Modify: `frontend/packages/shared/src/__tests__/api-query-block.test.ts`

- [ ] Add failing tests for case-insensitive search, typed AND filters, ignored empty filters, and `totalMatches` before limit.
- [ ] Run the focused shared tests and confirm the expected failures.
- [ ] Add viewer input and payload schemas, implement the evaluator, and apply it before `query.limit`.
- [ ] Run the focused tests and confirm that they pass.

### Task 2: Query cache and controlled viewer state

**Files:**
- Modify: `frontend/packages/shared/src/models/queries.ts`
- Modify: `frontend/packages/shared/src/models/__tests__/queries.test.ts`
- Modify: `frontend/packages/editor/src/query-block.tsx`
- Modify: `frontend/packages/ui/src/resource-page-common.tsx`

- [ ] Add a failing query-key test for temporary viewer state and confirm the failure.
- [ ] Add debounced state to both query-owning renderers and include it in `queryQueryBlock` without writing block props.
- [ ] Pass controlled state, callbacks, counts, and refetch status to `QueryBlockContent`.
- [ ] Run focused tests and affected package typechecks.

### Task 3: Shared Explore chips and polished filter UI

**Files:**
- Modify: `frontend/packages/ui/src/explore-filters.tsx`
- Modify: `frontend/packages/ui/src/explore-page.tsx`
- Modify: `frontend/packages/ui/src/query-block-content.tsx`
- Modify: `frontend/packages/ui/src/__tests__/query-block-content.test.tsx`

- [ ] Add failing UI tests for removable chips, Clear all, result count, and controlled callbacks.
- [ ] Run the focused UI test and confirm the expected failures.
- [ ] Extract shared chip components and use them in Explore and Query Block.
- [ ] Replace the cramped filter row with labeled responsive controls and exclude unsupported filters.
- [ ] Keep old results visible during refetch and show updating and clearable empty states.
- [ ] Run focused UI tests and confirm that they pass.

### Task 4: Verification

- [ ] Run focused client, shared, UI, and editor tests.
- [ ] Run relevant package typechecks.
- [ ] Run whole-workspace formatting and the formatting check.
- [ ] Run the frontend audit.
- [ ] Check Jean Run environments before live UI verification and record the exact URL used.
- [ ] Review the diff and record results in `.ai/todo.md`.
