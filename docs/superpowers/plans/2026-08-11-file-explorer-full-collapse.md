# File Explorer Full Collapse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully remove the collapsed desktop file-explorer rail and overlay its expand control at the main content's
top-left.

**Architecture:** Keep collapse state and controls inside `SiteFileBrowserLayout`. Render no explorer-side element while
collapsed; instead, make the main-content wrapper relative and conditionally render the existing expand control as an
absolute overlay. Use the desktop sidebar's `PanelLeft` icon for collapsing and retain `FolderTree` for expanding.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, jsdom, react-resizable-panels.

---

### Task 1: Specify collapsed-layout behavior

**Files:**

- Modify: `frontend/packages/ui/src/__tests__/site-file-browser-layout.test.tsx`

- [ ] Replace the combined control test with assertions that `PanelLeft` is used while open, the collapsed state removes
      the explorer panel and resize handle, and the `FolderTree` expand control is an absolute top-left overlay inside
      the main-content wrapper.
- [ ] Click the expand control and assert that the explorer returns while the expand control disappears.
- [ ] Run `direnv exec . pnpm --filter @shm/ui test -- site-file-browser-layout.test.tsx` and confirm the new assertions
      fail because the old rail and icon remain.

### Task 2: Implement full collapse and aligned overlay

**Files:**

- Modify: `frontend/packages/ui/src/site-file-browser-layout.tsx`

- [ ] Replace `PanelLeftClose` with `PanelLeft` for the open explorer's collapse action.
- [ ] Delete the collapsed-state rail rendered before `PanelGroup`.
- [ ] Add `relative` to the main-content wrapper and render the existing `FolderTree` tooltip/button there only while
      collapsed, using `absolute top-2 left-2 z-10` so it aligns with the established page action inset.
- [ ] Run `direnv exec . pnpm --filter @shm/ui test -- site-file-browser-layout.test.tsx` and confirm all focused tests
      pass.

### Task 3: Format and verify

**Files:**

- Verify: `frontend/packages/ui/src/site-file-browser-layout.tsx`
- Verify: `frontend/packages/ui/src/__tests__/site-file-browser-layout.test.tsx`

- [ ] Run
      `direnv exec . pnpm exec prettier --ignore-unknown --write frontend/packages/ui/src/site-file-browser-layout.tsx frontend/packages/ui/src/__tests__/site-file-browser-layout.test.tsx docs/superpowers/specs/2026-08-11-file-explorer-full-collapse-design.md docs/superpowers/plans/2026-08-11-file-explorer-full-collapse.md`.
- [ ] Re-run the focused test command and confirm it passes.
- [ ] Run the UI package typecheck command discovered from `frontend/packages/ui/package.json` and confirm it exits
      successfully.
- [ ] Review `git diff` to verify only the approved layout, icon, tests, spec, and plan changed.
