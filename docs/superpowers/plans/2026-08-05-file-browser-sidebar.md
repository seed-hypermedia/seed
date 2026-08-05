# Site File Browser Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an authorization-aware hierarchical File Browser below the Site Header on desktop/web and in an 80%-wide
left drawer on mobile.

**Architecture:** A shared `SiteFileBrowser` owns querying, tree/search state, and navigation rows.
`SiteFileBrowserLayout` selects an inline `react-resizable-panels` container or mobile drawer, while `PageWrapper`
supplies the active site and document IDs and `SiteHeader` supplies the mobile trigger.

**Tech Stack:** React, TypeScript, TanStack Query, Tailwind, react-resizable-panels, Vitest/jsdom.

## Global Constraints

- Reuse `useDirectory(..., {mode: 'AllDescendants'})`; do not duplicate visibility filtering.
- Exclude drafts and search displayed titles only.
- Desktop width is 288 px default, 240 px minimum, and 40% maximum, with no persistence.
- Mobile drawer is full height and 80% width.
- Private locks appear immediately before document titles.

---

### Task 1: Tree search and active-path utilities

**Files:**

- Modify: `frontend/packages/shared/src/utils/all-documents-tree.ts`
- Test: `frontend/packages/shared/src/__tests__/all-documents-tree.test.ts`

- [ ] Add failing tests for flat title-only filtering and active ancestor path calculation.
- [ ] Run the focused test and confirm the new exports are missing.
- [ ] Add minimal exported, documented utility functions.
- [ ] Re-run the focused test and confirm it passes.

### Task 2: Shared File Browser component

**Files:**

- Create: `frontend/packages/ui/src/site-file-browser.tsx`
- Test: `frontend/packages/ui/src/__tests__/site-file-browser.test.tsx`

- [ ] Add failing component tests for the directory query, hierarchy, active path, title search, private lock, and
      navigation callback.
- [ ] Run the focused test and confirm the component is missing.
- [ ] Implement the shared component with loading, empty, no-results, and error states.
- [ ] Re-run the focused tests and refactor only while green.

### Task 3: Responsive containers and Site Header trigger

**Files:**

- Create: `frontend/packages/ui/src/site-file-browser-layout.tsx`
- Modify: `frontend/packages/ui/src/site-header.tsx`
- Modify: `frontend/packages/ui/src/resource-page-common.tsx`
- Test: `frontend/packages/ui/src/__tests__/site-file-browser-layout.test.tsx`

- [ ] Add failing tests for desktop default/open/collapse behavior and the mobile trigger/drawer contract.
- [ ] Run the focused tests and confirm the missing layout behavior.
- [ ] Implement the inline panel and 80%-wide mobile drawer using existing primitives and tokens.
- [ ] Integrate it below `SiteHeader` in `PageWrapper` and connect the mobile trigger.
- [ ] Re-run focused and affected Site Header tests.

### Task 4: Verification

**Files:**

- Modify only files required to resolve verification failures caused by this feature.

- [ ] Run the shared and UI focused tests.
- [ ] Run frontend typecheck and the affected package tests.
- [ ] Run `pnpm -r format:write` and `pnpm -r format:check`.
- [ ] Run `pnpm audit` and report any pre-existing or introduced findings.
- [ ] Manually smoke-test desktop open/resize/collapse and mobile open/search/navigate/close behavior.
