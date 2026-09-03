# Document Options Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove redundant document menu entries, always show Attributes in document tools, and give remaining actions a semantic order.

**Architecture:** Keep platform menu construction unchanged and normalize the final menu in the shared resource page. Use a small exported pure function so filtering and ordering are directly testable; keep tab rendering within the existing `DocumentTools` component.

**Tech Stack:** React, TypeScript, Vitest, pnpm

---

### Task 1: Document menu normalization

**Files:**
- Modify: `frontend/packages/ui/src/resource-page-common.tsx`
- Test: `frontend/packages/ui/src/__tests__/resource-page-common.test.ts`

- [ ] Add a failing test passing mixed document menu items to `orderDocumentMenuItems` and asserting that `directory`, `all-documents`, and `metadata` are absent; management precedes sharing, organization, output, and utilities; and destructive items remain last.
- [ ] Run `direnv exec . pnpm --filter @shm/ui test -- src/__tests__/resource-page-common.test.ts` and confirm the missing export causes failure.
- [ ] Add `orderDocumentMenuItems`, use it from `ResourcePage`, and remove the now-unused metadata menu item.
- [ ] Rerun the focused test and confirm it passes.

### Task 2: Always-visible Attributes tab

**Files:**
- Modify: `frontend/packages/ui/src/document-tools.tsx`
- Create: `frontend/packages/ui/src/__tests__/document-tools.test.tsx`

- [ ] Add a failing jsdom test that renders `DocumentTools` with `metadataCount={0}` and asserts that Attributes is rendered with a zero count.
- [ ] Run `direnv exec . pnpm --filter @shm/ui test -- src/__tests__/document-tools.test.tsx` and confirm Attributes is absent.
- [ ] Render the Attributes configuration unconditionally and update the `metadataCount` documentation.
- [ ] Rerun the focused test and confirm it passes.

### Task 3: Verification

**Files:**
- Verify all modified frontend files.

- [ ] Run the focused tests for both changed behaviors.
- [ ] Run `direnv exec . pnpm --filter @shm/ui typecheck`.
- [ ] Run `direnv exec . pnpm --filter @shm/ui test`.
- [ ] Run `direnv exec . pnpm audit`.
- [ ] Run `direnv exec . pnpm -r format:write` followed by `direnv exec . pnpm -r format:check`.

No commit step is included because repository policy prohibits git state-writing commands unless explicitly requested.
