# Account Avatars Link to Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every interactive web and desktop account avatar open that account's Seed profile, show recognizable identity details on hover or keyboard focus, and never change collection filters.

**Architecture:** Keep `HMIcon` and `UIAvatar` as visual primitives. Add one semantic `AccountAvatar` component in `@shm/ui` that owns profile routing, accessible link behavior, and the identity hover card. Replace account-specific `HMIcon` uses with this component, but keep document icons, site icons, upload previews, and account-profile hero images on the visual primitives. Query tables detect account references at the cell-rendering boundary and render the same component; the existing filter model remains field-specific and unchanged.

**Tech Stack:** React 19, TypeScript, Radix Hover Card, Seed universal routing, TanStack Table, Vitest, Testing Library/JSDOM, Tailwind CSS.

**Source issue:** [Account avatars link to profiles](https://seedteamtalks.hyper.media/tasks/account-avatars-link-to-profiles)

---

## Scope and decisions

- “Any account avatar” means every avatar that represents a person/account in the shared web UI or desktop UI, including author face piles, comments, activity, notifications, member/collaborator lists, people search/results, agent identities, and account-valued collection/table cells.
- It does not mean site/document icons, document thumbnails, profile-edit upload previews, or the large avatar already displayed as part of the current profile page.
- The avatar itself is a real anchor. Enter and click behavior comes from native link behavior and the existing universal router.
- The profile route uses `getContextualProfileRoute`: inside a site it opens the site-aware profile; outside a site it opens the global `profile` route.
- The hover card opens from hover or focus. It shows the current display name, a larger avatar, an abbreviated account ID fallback, and a clear “View profile” link.
- Avatar activation only navigates. It does not call filter setters, row click handlers, or table sorting handlers. Account filtering stays in the existing field-specific controls and chips.
- Native mobile is not in this change because it has no account-profile route or profile screen. Do not add a dead link. Track mobile parity as a separate feature that adds the destination first.

## File map

**Create**

- `frontend/packages/ui/src/account-avatar.tsx` — semantic account avatar link and hover card.
- `frontend/packages/ui/src/__tests__/account-avatar.test.tsx` — routing, accessibility, hover/focus, and fallback tests.

**Modify: core collection/table behavior**

- `frontend/packages/ui/src/query-block-table-model.ts` — identify account reference values without changing their sort/filter text.
- `frontend/packages/ui/src/query-block-table.tsx` — render account reference cells with `AccountAvatar`; keep filter actions separate.
- `frontend/packages/ui/src/face-pile.tsx` — render each visible account through `AccountAvatar`.
- `frontend/packages/ui/src/__tests__/query-block-table-model.test.ts` — account-value recognition and text conversion tests.
- `frontend/packages/ui/src/__tests__/query-block-content.test.tsx` — table avatar link, filter isolation, and field-label tests.

**Modify: shared account-avatar surfaces**

- `frontend/packages/ui/src/comments.tsx`
- `frontend/packages/ui/src/document-header.tsx`
- `frontend/packages/ui/src/feed.tsx`
- `frontend/packages/ui/src/notification-list-item.tsx`
- `frontend/packages/ui/src/embed-views.tsx`
- `frontend/packages/ui/src/following.tsx`
- `frontend/packages/ui/src/followers.tsx`
- `frontend/packages/ui/src/membership.tsx`
- `frontend/packages/ui/src/members-facepile.tsx`
- `frontend/packages/ui/src/explore-cards.tsx`
- `frontend/packages/ui/src/collaborators-page.tsx`
- `frontend/packages/ui/src/agents/message-rendering.tsx`
- `frontend/packages/ui/src/agents/signing-identity-icon.tsx`
- `frontend/packages/ui/src/agents/detail.tsx`

**Modify: desktop-only account-avatar surfaces**

- `frontend/apps/desktop/src/components/bookmarks-popover.tsx`
- `frontend/apps/desktop/src/components/site-settings-members.tsx`
- `frontend/apps/desktop/src/components/titlebar-common.tsx`
- `frontend/apps/desktop/src/components/sidebar-footer.tsx`
- `frontend/apps/desktop/src/pages/contact-page.tsx`
- `frontend/apps/desktop/src/pages/settings.tsx`

Only replace an `HMIcon` in these files when its ID is an account/profile ID. Leave site/document icons and editing previews on `HMIcon` or `UIAvatar`.

---

### Task 1: Add the semantic account avatar

**Files:**
- Create: `frontend/packages/ui/src/account-avatar.tsx`
- Create: `frontend/packages/ui/src/__tests__/account-avatar.test.tsx`
- Reuse: `frontend/packages/ui/src/hm-icon.tsx`
- Reuse: `frontend/packages/ui/src/inline-descriptor.tsx`

- [ ] **Step 1: Write failing component tests**

Cover these behaviors with the repository's existing `UniversalRoutingProvider` test pattern:

```tsx
render(
  <AccountAvatar id={hmId('alice')} name="Alice" icon="ipfs://alice" size={20} />,
)

expect(screen.getByRole('link', {name: 'Open Alice profile'})).toHaveAttribute(
  'href',
  expect.stringContaining('alice'),
)
```

Add separate tests that:

1. focus the link and assert the hover-card content contains `Alice` and `View profile`;
2. omit `name` and assert the abbreviated UID is used in the accessible name and card;
3. render inside a site route and assert the contextual `site-profile` destination is used;
4. click the link and assert the router receives only the profile route;
5. pass an `onClick` used by a table test and confirm it can call `stopPropagation` without blocking navigation.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
direnv exec . pnpm --filter @shm/ui test -- account-avatar.test.tsx
```

Expected: FAIL because `AccountAvatar` does not exist.

- [ ] **Step 3: Implement `AccountAvatar` with native link semantics**

Define and document one exported component with this public shape:

```ts
export type AccountAvatarProps = {
  id: UnpackedHypermediaId
  name?: HMMetadata['name'] | null
  icon?: HMMetadata['icon'] | null
  size?: number
  className?: string
  siteUid?: string | null
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
}
```

Implementation rules:

- Normalize the target to `hmId(id.uid)` so an accidental document path cannot send the user to a document.
- Use `useNavRoute`, `getContextualProfileRoute`, and `useRouteLink` for the destination.
- Use `HoverCard`, `HoverCardTrigger asChild`, and `HoverCardContent` so the same anchor is the trigger and focus target.
- Render the current `HMIcon` inside the anchor. Do not duplicate image resolution or identicon logic.
- Set `aria-label` to `Open ${displayName} profile`.
- In the card, show a 40px avatar, the display name or `abbreviateUid(id.uid)`, and a visible `View profile` link using the same route props.
- Keep the trigger and content keyboard accessible. Do not attach a filter or selection callback.
- Do not put one anchor inside another. The hover-card content is portaled, so its separate profile link is valid.

- [ ] **Step 4: Run the focused test and typecheck**

Run:

```bash
direnv exec . pnpm --filter @shm/ui test -- account-avatar.test.tsx
direnv exec . pnpm --filter @shm/ui typecheck
```

Expected: all account-avatar tests PASS and typecheck exits 0.

---

### Task 2: Make collection/table account cells semantic

**Files:**
- Modify: `frontend/packages/ui/src/query-block-table-model.ts`
- Modify: `frontend/packages/ui/src/query-block-table.tsx`
- Modify: `frontend/packages/ui/src/face-pile.tsx`
- Modify: `frontend/packages/ui/src/__tests__/query-block-table-model.test.ts`
- Modify: `frontend/packages/ui/src/__tests__/query-block-content.test.tsx`

- [ ] **Step 1: Add failing account-value model tests**

Add tests for a small pure helper:

```ts
expect(getQueryTableAccountIds('hm://alice', context)).toEqual([hmId('alice')])
expect(getQueryTableAccountIds(['hm://alice', 'hm://bob'], context)).toEqual([hmId('alice'), hmId('bob')])
expect(getQueryTableAccountIds('Ready', context)).toEqual([])
expect(getQueryTableAccountIds('hm://space/path', context)).toEqual([])
```

An `hm://<uid>` value is treated as an account only when it has no document path and that UID exists in `context.accountsMetadata`. This avoids rendering arbitrary document links as people.

- [ ] **Step 2: Add failing table rendering and isolation tests**

Render a table item with `metadata.assignee = 'hm://alice'` and account metadata for Alice. Make the `assignee` column visible. Assert:

- there is a link named `Open Alice profile`;
- focusing it exposes `Alice` and `View profile`;
- clicking it dispatches profile navigation;
- the active filter chips and result count do not change;
- an account filter chip includes its field name, for example `Assignee = Alice`, rather than only `Alice`.

- [ ] **Step 3: Run the focused tests and confirm they fail**

Run:

```bash
direnv exec . pnpm --filter @shm/ui test -- query-block-table-model.test.ts query-block-content.test.tsx
```

Expected: FAIL because account metadata values still render as plain text and face-pile avatars are not links.

- [ ] **Step 4: Implement account cell rendering**

Add `getQueryTableAccountIds(value, context)` at the table-rendering boundary. Keep `getQueryTableValue`, `queryTableValueToString`, sorting, and filtering behavior unchanged so this is a display-only decision.

In `query-block-table.tsx`:

```tsx
const accountIds = getQueryTableAccountIds(value, context)
if (accountIds.length) {
  return (
    <FacePile
      accounts={accountIds.map((id) => id.uid)}
      accountsMetadata={context.accountsMetadata ?? {}}
    />
  )
}
```

In `face-pile.tsx`, replace the account `HMIcon` with `AccountAvatar`. Preserve the overlap layout. Stop row-level click propagation on the profile link if a containing row later becomes clickable; do not prevent the link's default/router behavior.

- [ ] **Step 5: Keep account filters explicit and field-specific**

In the existing filter-chip label function, resolve account values to their display names but keep the descriptor label and operator in the chip text. The rendered result must stay equivalent to:

```text
Assignee = Horacio Herrera
```

Do not add an avatar click handler that calls `setFilters`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
direnv exec . pnpm --filter @shm/ui test -- query-block-table-model.test.ts query-block-content.test.tsx
```

Expected: all focused model and rendering tests PASS.

---

### Task 3: Migrate shared account-avatar surfaces

**Files:**
- Modify the shared files listed in the File map under “shared account-avatar surfaces”.
- Modify related existing tests in `frontend/packages/ui/src/__tests__/` where a migrated surface already has coverage.

- [ ] **Step 1: Add one representative failing test per interaction family**

Use existing tests rather than adding one test file per call site:

- `comments.test.tsx`: the comment author avatar is a profile link and remains separate from comment selection.
- `feed.test.ts`: activity actor/delegate avatars route to profiles.
- `document-header-breadcrumbs.test.tsx` or a new focused header test: author face-pile avatars are profile links.
- `following.test.tsx`: following/follower avatar is keyboard focusable and has the identity card.
- `collaborators-page.test.ts`: member avatar routes to that member, not to the current document.
- `assistant-message-rendering.test.tsx` in desktop tests: an agent account avatar uses the shared semantic component.

- [ ] **Step 2: Run the representative tests and confirm failure**

Run the exact test paths through:

```bash
direnv exec . pnpm --filter @shm/ui test -- <test-files>
direnv exec . pnpm --filter @shm/desktop test -- assistant-message-rendering.test.tsx
```

Expected: FAIL on missing profile-link semantics.

- [ ] **Step 3: Replace account-only `HMIcon` call sites**

For each listed shared source file:

1. verify that the ID is an account UID or profile ID;
2. replace `HMIcon` with `AccountAvatar`;
3. pass the known `name`, `icon`, `size`, and site UID when available;
4. remove any transparent absolute overlay anchor, as in `comments.tsx`, and let `AccountAvatar` be the only focus/click target;
5. if an avatar is inside a whole-card profile anchor, change the outer wrapper to a non-anchor and give the name its own profile link so there are no nested anchors;
6. preserve layout classes and avatar size.

Do not migrate document/site icons in `resource-token.tsx`, `document-list-item.tsx`, `site-logo.tsx`, `navigation.tsx`, or document destinations.

- [ ] **Step 4: Run shared UI tests and typecheck**

Run:

```bash
direnv exec . pnpm --filter @shm/ui test
direnv exec . pnpm --filter @shm/ui typecheck
```

Expected: PASS with no nested-anchor warnings in test output.

---

### Task 4: Migrate desktop-only account-avatar surfaces

**Files:**
- Modify the desktop files listed in the File map under “desktop-only account-avatar surfaces”.
- Modify: `frontend/apps/desktop/src/components/__tests__/bookmarks-popover.test.ts`
- Modify or create focused desktop tests near each surface only when no existing test covers it.

- [ ] **Step 1: Add failing desktop assertions**

At minimum, update `bookmarks-popover.test.ts` to assert the author avatar is rendered through `AccountAvatar`, and add a titlebar/account-switcher assertion that its account avatar has a profile destination without changing the selected account.

- [ ] **Step 2: Run focused desktop tests and confirm failure**

Run:

```bash
direnv exec . pnpm --filter @shm/desktop test -- bookmarks-popover.test.ts titlebar-common
```

Expected: FAIL until desktop account avatars use the semantic component.

- [ ] **Step 3: Replace desktop account-only avatar uses**

Apply the same migration rules as Task 3. Keep these cases on visual primitives:

- current-account editing/upload previews;
- site icons in the sidebar and titlebar;
- document icons in bookmarks;
- placeholder avatars that do not yet identify a real account.

For an account switcher, avatar activation must open the profile; account selection must remain a separate named control.

- [ ] **Step 4: Run desktop tests and typecheck**

Run:

```bash
direnv exec . pnpm --filter @shm/desktop test
direnv exec . pnpm --filter @shm/desktop typecheck
```

Expected: PASS.

---

### Task 5: Audit all avatar call sites and verify end to end

**Files:**
- Modify only missed source/tests found by the audit.
- Modify: `.ai/todo.md` with final verification results; keep this file untracked.

- [ ] **Step 1: Audit raw avatar primitives**

Run:

```bash
find frontend/packages/ui/src frontend/apps/desktop/src frontend/apps/web/app \
  -type f \( -name '*.ts' -o -name '*.tsx' \) \
  -not -path '*/node_modules/*' -print0 \
  | xargs -0 grep -nE 'HMIcon|UIAvatar'
```

Review every result. Every remaining use must be one of: document/site icon, form/upload preview, current profile hero, or a deliberate non-account placeholder. Convert any missed account display to `AccountAvatar`.

- [ ] **Step 2: Format and run all frontend checks**

Run:

```bash
direnv exec . pnpm -r format:write
direnv exec . pnpm -r format:check
direnv exec . pnpm --filter @shm/ui typecheck
direnv exec . pnpm --filter @shm/ui test
direnv exec . pnpm --filter @shm/desktop typecheck
direnv exec . pnpm --filter @shm/desktop test
direnv exec . pnpm audit
```

Expected: all commands PASS. If format check reports ignored generated artifacts, verify them with `git check-ignore`; do not ignore tracked source failures.

- [ ] **Step 3: Verify the running app**

Before browser testing, call Jean MCP `get_run_environments` for this worktree. Use the returned URL and startup command; do not guess a port or start a second server.

Manual smoke test:

1. Open a collection in Table view with `Authors` and an account-valued field such as `Assignee` visible.
2. Hover each avatar and confirm the current display name and `View profile` link appear.
3. Tab to each avatar and confirm the same card appears on focus.
4. Press Enter and confirm the matching Seed profile opens.
5. Return to the collection and confirm search text, sort, visible columns, and all filters are unchanged.
6. Add an explicit `Assignee = <name>` filter and confirm the chip names the field.
7. Repeat avatar checks in a comment, activity row, document author face pile, notification, member list, and account switcher.
8. Confirm a document icon and site icon still open their document/site and do not show an account hover card.

- [ ] **Step 4: Run local CI parity**

Run:

```bash
direnv exec . npx @redwoodjs/agent-ci run -w .github/workflows/test-frontend-parallel.yml -p --github-token
```

Expected: the frontend workflow passes. On failure, fix in place and use `npx @redwoodjs/agent-ci retry --name <runner-name>`.

- [ ] **Step 5: Record final results**

Update `.ai/todo.md` with the exact commands, pass/fail results, manual URL, and any separately tracked mobile follow-up. Do not add `.ai/todo.md` to Git.

---

## Self-review

- **Issue coverage:** Direct profile navigation, hover/focus identity, display-name recognition, keyboard access, no implicit filtering, and field-specific filter labels each have an implementation task and a test.
- **Repo-wide meaning:** The plan introduces one semantic component and audits every remaining primitive use instead of fixing only collection tables.
- **Minimal impact:** Routing, avatar drawing, query sorting, and query filtering keep their existing implementations. The new component composes them.
- **Known boundary:** Native mobile has account avatars but no profile destination. Adding mobile navigation without that destination would not satisfy the issue and is intentionally a separate feature.
