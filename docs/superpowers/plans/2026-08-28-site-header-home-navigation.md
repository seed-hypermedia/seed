# Site Header Home Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed Home destination to every site-header navigation and place Horizontal navigation beside site
branding without breaking responsive overflow.

**Architecture:** Derive Home at the `SiteHeader` presentation boundary and prepend it to configured items before all
desktop/mobile rendering and responsive measurement. Keep persisted navigation unchanged, centralize active matching and
responsive splitting in testable pure functions, and mirror Home as a locked settings row and preview item.

**Tech Stack:** React, TypeScript, Tailwind CSS, Vitest, pnpm workspace tooling

---

### Task 1: Navigation derivation and active matching

**Files:**

- Modify: `frontend/packages/ui/src/site-header.tsx`
- Create: `frontend/packages/ui/src/__tests__/site-header.test.ts`

- [ ] **Step 1: Write failing tests** for a `getSiteHeaderItems` helper that prepends a stable Home item without
      mutating configured items, and an `isSiteHeaderItemActive` helper that activates Home only at the root while
      choosing document-section matches by path.
- [ ] **Step 2: Run the focused test** with
      `direnv exec . pnpm --filter @shm/ui test -- src/__tests__/site-header.test.ts` and confirm it fails because the
      helpers are absent.
- [ ] **Step 3: Implement the helpers** in `site-header.tsx`, using a collision-resistant reserved Home key, root site
      ID, fixed `Home` metadata label, exact root matching for Home, and prefix matching for configured document items.
- [ ] **Step 4: Route all render paths through the combined items** by passing them to `SiteHeaderMenu` and mobile
      `NavItems`; use the active helper for both active-key calculation and visible link styling.
- [ ] **Step 5: Re-run the focused test** and confirm it passes.

### Task 2: Responsive overflow correctness

**Files:**

- Modify: `frontend/packages/ui/src/use-responsive-items.ts`
- Create: `frontend/packages/ui/src/__tests__/use-responsive-items.test.ts`
- Modify: `frontend/packages/ui/src/site-header.tsx`

- [ ] **Step 1: Write failing pure-function tests** covering ordered visible/overflow splitting, Home overflowing
      normally, active-item visibility, measured widths, fallback widths, reserved controls, and the guarantee that
      every source item appears exactly once across visible and overflow arrays.
- [ ] **Step 2: Run the focused test** with
      `direnv exec . pnpm --filter @shm/ui test -- src/__tests__/use-responsive-items.test.ts` and confirm it fails
      before the calculation is exported.
- [ ] **Step 3: Extract the minimal width split into a pure function** used by `useResponsiveItems`, preserving source
      order and active priority while reserving the overflow-trigger width whenever overflow is needed.
- [ ] **Step 4: Keep measurement reactive** through the existing `ResizeObserver`, actual item refs, and stable reserved
      widths for Activity Feed, edit controls, padding, gaps, and the overflow trigger.
- [ ] **Step 5: Re-run both focused UI tests** and confirm they pass.

### Task 3: Horizontal header alignment

**Files:**

- Modify: `frontend/packages/ui/src/site-header.tsx`

- [ ] **Step 1: Change only Horizontal layout classes** so the site logo/name uses its natural width, the navigation
      starts immediately beside it, and remaining flexible width separates navigation from search/right actions.
- [ ] **Step 2: Preserve Center layout classes** so branding and navigation remain centered and stacked.
- [ ] **Step 3: Verify the UI package typecheck** with `direnv exec . pnpm --filter @shm/ui typecheck` and fix any type
      errors.

### Task 4: Settings preview and locked Home row

**Files:**

- Modify: `frontend/apps/desktop/src/components/site-settings-navigation.tsx`

- [ ] **Step 1: Prepend a non-persisted Home label** to `HeaderPreview` measurement and rendering in both layouts.
- [ ] **Step 2: Render a locked Home row** before custom rows without drag, edit, or remove controls, while leaving
      `navValue`, dirty comparison, reorder, dialogs, and save payload unchanged.
- [ ] **Step 3: Ensure an empty custom list still shows locked Home** plus the existing add-item affordance.
- [ ] **Step 4: Run desktop typecheck** with `direnv exec . pnpm --filter @shm/desktop typecheck` and fix any type
      errors.

### Task 5: Verification and formatting

**Files:**

- Verify all modified files above.

- [ ] **Step 1: Run UI tests** with `direnv exec . pnpm --filter @shm/ui test`.
- [ ] **Step 2: Run relevant web tests** with
      `direnv exec . pnpm --filter @shm/web test -- app/__tests__/web-site-header.test.ts`.
- [ ] **Step 3: Run UI and desktop typechecks** with `direnv exec . pnpm --filter @shm/ui typecheck` and
      `direnv exec . pnpm --filter @shm/desktop typecheck`.
- [ ] **Step 4: Format the whole frontend workspace** with `direnv exec . pnpm --dir frontend -r format:write`, then
      verify with `direnv exec . pnpm --dir frontend -r format:check`.
- [ ] **Step 5: Inspect the final diff** with `git diff --check` and confirm no persisted navigation schema or data
      migration changed.
- [ ] **Step 6: Manually smoke-test** Horizontal and Center headers at wide, medium, and narrow widths; verify Home
      ordering/active state, overflow completeness, mobile ordering, locked settings representation, custom reordering,
      and save persistence against the Jean run environment if one is available.
