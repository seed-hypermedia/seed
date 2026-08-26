# Titlebar Bookmarks Popover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move desktop bookmarks from the sidebar into the approved titlebar popover without changing bookmark storage
or supported destinations.

**Architecture:** Add a focused `BookmarksPopover` component that owns bookmark resource resolution, routing, removal,
empty state, and responsive presentation. Mount it before Notifications in the shared titlebar actions and delete the
sidebar-specific bookmark UI. Continue using the existing bookmark hooks and navigation utilities.

**Tech Stack:** React 18, TypeScript, TanStack Query, Radix-based Seed UI primitives, Tailwind CSS, Vitest.

---

### Task 1: Define and test bookmark presentation order

**Files:**

- Create: `frontend/apps/desktop/src/components/__tests__/bookmarks-popover.test.ts`
- Create: `frontend/apps/desktop/src/components/bookmarks-popover.tsx`

- [ ] Write a Vitest test proving stored bookmarks are returned newest-first without mutating the query result.
- [ ] Run `direnv exec . pnpm --filter @shm/desktop test:unit -- src/components/__tests__/bookmarks-popover.test.ts` and
      confirm it fails because the new module does not exist.
- [ ] Add the minimal exported ordering function and rerun the focused test to green.

### Task 2: Build the approved popover

**Files:**

- Modify: `frontend/apps/desktop/src/components/bookmarks-popover.tsx`

- [ ] Add the persistent bookmark-only titlebar trigger, a 360px desktop/full-viewport mobile popover, fixed header with
      numeric count, 50vh/75vh scroll caps, and the approved empty state.
- [ ] Resolve all existing document/profile/view bookmark types with current metadata and icons.
- [ ] Make row titles truncate with ellipsis, navigate to the exact saved destination, and close on navigation.
- [ ] Add a hover/focus remove control that deletes immediately, cannot trigger row navigation, and remains accessible
      by keyboard.

### Task 3: Relocate the feature

**Files:**

- Modify: `frontend/apps/desktop/src/components/titlebar-common.tsx`
- Modify: `frontend/apps/desktop/src/components/sidebar.tsx`
- Delete if unused: `frontend/apps/desktop/src/components/bookmark-options-menu.tsx`
- Modify: `frontend/apps/desktop/src/components/__tests__/sidebar.test.tsx`

- [ ] Mount `BookmarksPopover` immediately before `NotificationButton` in `PageActionButtons`.
- [ ] Remove `BookmarksSection` and bookmark-only imports/components from the sidebar.
- [ ] Remove obsolete three-dot bookmark-menu tests and delete the component if no callers remain.

### Task 4: Verify the desktop frontend

**Files:**

- Format all frontend workspace files as required by `frontend/AGENTS.md`.

- [ ] Run the focused unit test and relevant desktop unit tests.
- [ ] Run `direnv exec . pnpm --filter @shm/desktop typecheck`.
- [ ] Run `direnv exec . pnpm -r format:write`, followed by `direnv exec . pnpm -r format:check`.
- [ ] Run the practical relevant test/audit commands available in the session and report any unrelated failures
      separately.
- [ ] Manually verify both populated and empty popover states, newest-first ordering, ellipsis, scrolling,
      navigation/close, and immediate removal.
